"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

import abc
import asyncio
import collections
import copy
import dataclasses
import datetime
import hashlib
import json
import logging
import os
import tempfile
import time
from typing import List, Dict, Tuple, Type
import urllib.parse

import aiofiles
import redis  # type: ignore
import redis.asyncio  # type: ignore
import pydantic
import yaml

from src.lib.data import storage
from src.lib.utils import common, osmo_errors, priority as wf_priority
from src.utils import connectors
from src.utils.job import app, backend_job_defs, common as task_common, kb_objects, task, workflow
from src.utils.job.jobs_base import Job, JobResult, JobStatus, update_progress_writer
from src.utils.progress_check import progress


# The name of the delayed job queue
DELAYED_JOB_QUEUE = 'delayed_job_queue'

PROGRESS_ITER_WRITE = 100

CONCURRENT_UPLOADS = 10


class JobExecutionContext(pydantic.BaseModel):
    """Context from the worker process, needed for executing jobs"""
    postgres: connectors.PostgresConnector
    redis: connectors.RedisConfig

    class Config:
        arbitrary_types_allowed = True
        extra = 'forbid'


def cleanup_workflow_group(context: JobExecutionContext, workflow_id: str, workflow_uuid: str,
                           group_name: str):
    """
    Cleans up a workflow group and enqueues a workflow cleanup job if all groups are cleaned up.

    This function marks a workflow group as cleaned up in the database. If all groups in
    the workflow are cleaned up, it enqueues a CleanupWorkflow job to perform final
    workflow cleanup tasks.

    Args:
        context: The job execution context containing database and Redis connections
        workflow_id: The ID of the workflow to clean up
        workflow_uuid: The UUID of the workflow to clean up
        group_name: The name of the group to mark as cleaned up

    Returns:
        None
    """
    all_cleaned_up = task.TaskGroup.patch_cleaned_up(context.postgres,
        workflow_id, group_name)
    if all_cleaned_up:
        cleanup_job = CleanupWorkflow(
            workflow_id=workflow_id,
            workflow_uuid=workflow_uuid
        )
        cleanup_job.send_job_to_queue()


class FrontendJob(Job):
    """ Describes a job that can be run in the service worker """
    super_type: str = 'frontend'

    @abc.abstractmethod
    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns info on whether the job completed successfully.
        """
        pass

    def prepare_execute(self, context: JobExecutionContext,
                        progress_writer: progress.ProgressWriter,
                        progress_iter_freq: datetime.timedelta = \
                            datetime.timedelta(seconds=15)) -> Tuple[bool, str]:
        # pylint: disable=unused-argument
        """
        Runs execute checks and prerequisites.

        Returns whether execute is ready to run and error message if failed
        """
        return True, ''

    def handle_failure(self, context: JobExecutionContext, error: str):
        """
        Handles job failure in the case that something goes wrong.
        """
        pass

    def get_redis_options(self):
        return connectors.EXCHANGE, connectors.JOBS, connectors.TRANSPORT_OPTIONS

    def send_delayed_job_to_queue(self, delay_duration: datetime.timedelta):
        """
        Stores a serialized Job and the timestamp to a Redis Sorted Set (Zset).
        The timestamp added represents the time step for the DelayedJobMonitor to add the
        job into the job queue.
        """
        redis_client = connectors.RedisConnector.get_instance().client
        serialized_job = self.json()
        timeout_time = time.time() + delay_duration.total_seconds()
        redis_client.zadd(DELAYED_JOB_QUEUE, {serialized_job: timeout_time})
        self.log_delayed_submission(delay_duration)


class WorkflowJob(FrontendJob):
    """
    Represents some workflow task that needs to be executed by a worker.
    """
    workflow_id: task_common.NamePattern
    workflow_uuid: common.UuidPattern

    def log_submission(self):
        logging.info('Submitted new job %s to the job queue', self,
                     extra={'workflow_uuid': self.workflow_uuid})

    def log_labels(self) -> Dict[str, str]:
        return {'workflow_uuid': self.workflow_uuid}


class BackendJob(Job):
    """
    Represents jobs that are sent to a backend worker.
    """
    backend: str

    def get_redis_options(self):
        return connectors.EXCHANGE, connectors.BACKEND_JOBS,\
            connectors.get_backend_transport_option(self.backend)


class SubmitWorkflow(WorkflowJob):
    """
    Submit workflow job contains a workflow spec that has been submitted by the user.
    When executed, it should do the following:
    - Create an entry in the database for the overall workflow.
    - Create entries in the database for each task in the job.
    - Schedule "Submit Task" jobs for all tasks in the workflow that have no preconditions.
    """
    user: str
    spec: workflow.WorkflowSpec
    original_spec: Dict
    group_and_task_uuids: Dict[str, common.UuidPattern]
    parent_workflow_id: task_common.NamePattern | None
    app_uuid: str | None = None
    app_version: int | None = None
    task_db_keys: Dict[str, str] | None = None
    priority: wf_priority.WorkflowPriority = wf_priority.WorkflowPriority.NORMAL

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["workflow_uuid"]}-submit'

    @pydantic.validator('job_id')
    @classmethod
    def validate_job_id(cls, value: str) -> str:
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        if not value.endswith('-submit'):
            raise osmo_errors.OSMOServerError(
                f'SubmitWorkflow job_id should end with \"-submit\": {value}.')
        return value

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the job was completed successful and can
        be removed from the message queue, or false if the job failed.
        """
        last_timestamp = datetime.datetime.now()
        postgres = context.postgres

        # Create workflow and groups in database
        remaining_upstream_groups: Dict = collections.defaultdict(set)
        downstream_groups: Dict = collections.defaultdict(set)
        workflow_obj = workflow.Workflow.from_workflow_spec(context.postgres, self.workflow_id,
            self.workflow_uuid, self.user, self.spec, context.redis.redis_url,
            self.group_and_task_uuids, remaining_upstream_groups, downstream_groups,
            parent_workflow_id=self.parent_workflow_id, task_db_keys=self.task_db_keys,
            app_uuid=self.app_uuid, app_version=self.app_version,
            priority=self.priority)
        version = self.original_spec['version'] if 'version' in self.original_spec else '2'
        workflow_obj.insert_to_db(version)

        self.workflow_id = workflow_obj.workflow_id

        for group_obj in workflow_obj.groups:
            group_obj.workflow_id_internal = workflow_obj.workflow_id
            group_obj.spec = \
                group_obj.spec.parse(postgres, workflow_obj.workflow_id,
                                     self.group_and_task_uuids)
            group_obj.insert_to_db()
            for task_obj, task_obj_spec in zip(group_obj.tasks, group_obj.spec.tasks):
                task_obj.workflow_id_internal = workflow_obj.workflow_id
                task_obj.insert_to_db(
                    gpu_count=task_obj_spec.resources.gpu or 0,
                    cpu_count=task_obj_spec.resources.cpu or 0,
                    disk_count=common.convert_resource_value_str(
                        task_obj_spec.resources.storage or '0', 'GiB'),
                    memory_count=common.convert_resource_value_str(
                        task_obj_spec.resources.memory or '0', 'GiB'))

                current_timestamp = datetime.datetime.now()
                time_elapsed = last_timestamp - current_timestamp
                if time_elapsed > progress_iter_freq:
                    progress_writer.report_progress()
                    last_timestamp = current_timestamp
        progress_writer.report_progress()

        # Fetch workflow_obj to get latest info
        workflow_obj = workflow.Workflow.fetch_from_db(context.postgres, workflow_obj.workflow_id)

        # Enqueue a delayed job to check the queue timeout
        if not workflow_obj.pool:
            raise osmo_errors.OSMOUserError('No Pool Specified')
        pool_info = connectors.Pool.fetch_from_db(context.postgres, workflow_obj.pool)
        workflow_config = context.postgres.get_workflow_configs()
        queue_timeout = workflow_obj.timeout.queue_timeout or \
            common.to_timedelta(pool_info.default_queue_timeout
                                if pool_info.default_queue_timeout else
                                workflow_config.default_queue_timeout)
        check_queue_timeout = CheckQueueTimeout(workflow_id=workflow_obj.workflow_id,
                                                workflow_uuid=self.workflow_uuid)
        check_queue_timeout.send_delayed_job_to_queue(queue_timeout)

        # Check if workflow has been canceled.
        # If it hasn't, mark all the groups as WAITING
        # If this is false, the workflow has been canceled
        if workflow_obj.mark_groups_as_waiting():
            # Determine which groups don't have prerequisites and enqueue CreateGroup jobs
            # for them
            backend_config_cache = connectors.BackendConfigCache()
            for group_obj in workflow_obj.groups:
                group_obj.workflow_id_internal = workflow_obj.workflow_id
                if not group_obj.remaining_upstream_groups:
                    backend_name = group_obj.spec.tasks[0].backend
                    backend = backend_config_cache.get(backend_name)

                    group_obj.set_tasks_to_processing()
                    group_obj.update_status_to_db(
                        common.current_time(),
                        task.TaskGroupStatus.PROCESSING,
                        scheduler_settings=backend.scheduler_settings)
                    submit_task = CreateGroup(
                        backend=workflow_obj.backend,
                        group_name=group_obj.name,
                        workflow_id=workflow_obj.workflow_id,
                        workflow_uuid=self.workflow_uuid,
                        user=self.user)
                    submit_task.send_job_to_queue()

        return JobResult()

    def handle_failure(self, context: JobExecutionContext, error: str):
        """
        Update Workflow to FAILED_SERVER_ERROR
        Set Failure Reason to log file
        """
        try:
            workflow_obj = workflow.Workflow.fetch_from_db(context.postgres, self.workflow_id)
        except osmo_errors.OSMODatabaseError:
            logging.info('Cannot find %s workflow during SubmitWorkflow handle failure',
                         self.workflow_id, extra={'workflow_uuid': self.workflow_uuid})
            return

        parsed_result = urllib.parse.urlparse(workflow_obj.logs)

        if parsed_result.scheme in ('redis', 'rediss'):
            redis_client = redis.from_url(workflow_obj.logs)
            logs = connectors.redis.LogStreamBody(
                    time=common.current_time(), io_type=connectors.redis.IOType.OSMO_CTRL,
                    source='OSMO', retry_id=0, text='Failed SubmitWorkflow for workflow ' +
                    f'{workflow_obj.workflow_id} with error: {error}')
            redis_client.xadd(f'{self.workflow_id}-logs', json.loads(logs.json()))
            redis_client.expire(f'{self.workflow_id}-logs', connectors.MAX_LOG_TTL, nx=True)

        for group_obj in workflow_obj.get_group_objs():
            if group_obj.status.finished():
                continue

            # Update unfinished task statuses
            message = f'Task is canceled due to Failed Infra: {self.user}, {error}'
            canceled_task_status = task.TaskGroupStatus.FAILED_SERVER_ERROR
            update_task = UpdateGroup(
                workflow_id=self.workflow_id,
                workflow_uuid=self.workflow_uuid,
                group_name=group_obj.name,
                status=canceled_task_status,
                message=message,
                user=self.user,
                exit_code=task.ExitCode.FAILED_SERVER_ERROR.value
            )
            update_task.send_job_to_queue()


@dataclasses.dataclass
class File:
    """Stores a file to be uploaded to a workflow's outputs directory"""
    path: str
    content: str


class UploadWorkflowFiles(WorkflowJob):
    """
    Uploads a list of workflow files to a workflow's outputs directory
    """
    files: List[File]

    @classmethod
    def _get_job_id(cls, values):
        # Generate unique id using sha256 of all file paths
        # 16 bytes of the hash is enough to guarantee uniqueness
        all_paths = '\n'.join(file.path for file in values['files'])
        digest = hashlib.sha256(all_paths.encode('utf-8')).hexdigest()[:32]
        return f'{values["workflow_uuid"]}-{digest}-upload-files'

    @pydantic.validator('job_id')
    @classmethod
    def validate_job_id(cls, value: str) -> str:
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        if not value.endswith('-upload-files'):
            raise osmo_errors.OSMOServerError(
                f'UploadFiles job_id should end with \"-upload-files\": {value}.')
        return value

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the job was completed successful and can
        be removed from the message queue, or false if the job failed.
        """
        workflow_config = context.postgres.get_workflow_configs()

        if workflow_config.workflow_log.credential is None:
            return JobResult(
                success=False,
                error='Workflow log credential is not set',
            )

        storage_client = storage.Client.create(
            data_credential=workflow_config.workflow_log.credential,
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            for file in self.files:
                file_path = os.path.join(temp_dir, file.path)
                with open(file_path, 'w+', encoding='utf-8') as local_file:
                    local_file.write(file.content)
                    local_file.flush()

            # Trigger progress update (if applicable) whenever a file is uploaded
            last_timestamp = datetime.datetime.now()

            def _upload_callback(upload_input, upload_resp) -> None:
                # pylint: disable=unused-argument
                nonlocal last_timestamp
                current_timestamp = datetime.datetime.now()
                time_elapsed = last_timestamp - current_timestamp
                if time_elapsed > progress_iter_freq:
                    progress_writer.report_progress()
                    last_timestamp = current_timestamp

            storage_client.upload_objects(
                source=os.path.join(temp_dir, '*'), # upload contents only
                destination_prefix=self.workflow_id,
                callback=_upload_callback,
            )

        return JobResult()


class CreateGroup(BackendJob, WorkflowJob, backend_job_defs.BackendCreateGroupMixin):
    """ This is the frontend implementation for the BackendCreateGroup job
    that is put in backend queue and worked on by backend worker. It's execute function
    will be called only if the backend's execute function succeeds """
    user: str
    k8s_resources: List[Dict] | None = None  # type: ignore[assignment]

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["workflow_uuid"]}-{values["group_name"]}-submit'

    @pydantic.validator('job_id', check_fields=False)
    @classmethod
    def validate_job_id(cls, value: str) -> str:
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        if not value.endswith('-submit'):
            raise osmo_errors.OSMOServerError(
                f'CreateGroup job_id should end with \"-submit\": {value}.')
        return value

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        # Status update is executed before sending the CreateGroup job to the queue
        return JobResult()

    def prepare_execute(self, context: JobExecutionContext,
                        progress_writer: progress.ProgressWriter,
                        progress_iter_freq: datetime.timedelta = \
                            datetime.timedelta(seconds=15)) -> Tuple[bool, str]:
        """
        Runs execute checks and prerequisites.

        Returns whether execute is ready to run and error message if failed
        """
        group_obj = task.TaskGroup.fetch_from_db(context.postgres, self.workflow_id,
                                                 self.group_name)

        if group_obj.status not in \
            (task.TaskGroupStatus.WAITING, task.TaskGroupStatus.PROCESSING):
            return False, f'Create Group Failed: Group {group_obj.name} has status: ' +\
            f'{group_obj.status.value}.'

        if not self.k8s_resources:
            workflow_config = context.postgres.get_workflow_configs()
            backend_config_cache = connectors.BackendConfigCache()
            workflow_obj = workflow.Workflow.fetch_from_db(context.postgres, self.workflow_id)
            resources, pod_specs = group_obj.get_kb_specs(
                self.workflow_uuid,
                self.user,
                workflow_config,
                backend_config_cache,
                group_obj.spec.tasks[0].backend,
                workflow_obj.pool or '',  # pool is validated in SubmitWorkflow
                progress_writer,
                progress_iter_freq,
                workflow_obj.plugins,
                workflow_obj.priority,
            )

            self.k8s_resources = resources

            upload_task = UploadWorkflowFiles(
                workflow_id=workflow_obj.workflow_id,
                workflow_uuid=self.workflow_uuid,
                files=[File(f'{task_name}.spec', yaml.dump(pod_spec))
                        for task_name, pod_spec in pod_specs.items()])
            upload_task.send_job_to_queue()

        return True, ''

    def handle_failure(self, context: JobExecutionContext, error: str):
        """
        Handles job failure in the case that something goes wrong.
        """
        update_task = UpdateGroup(
            workflow_id=self.workflow_id,
            workflow_uuid=self.workflow_uuid,
            status=task.TaskGroupStatus.FAILED_SERVER_ERROR,
            group_name=self.group_name,
            message=f'CreateGroup job failed: {error}',
            user=self.user,
            exit_code=task.ExitCode.FAILED_SERVER_ERROR.value)
        update_task.send_job_to_queue()


class CleanupGroup(BackendJob, WorkflowJob, backend_job_defs.BackendCleanupGroupMixin):
    """ This is the frontend implementation for the CleanupGroup job
    that is put in backend queue and worked on by backend worker. It's execute function
    will be called only if the backend's execute function succeeds """

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["workflow_uuid"]}-{values["group_name"]}-backend-cleanup'

    @pydantic.validator('job_id', check_fields=False)
    @classmethod
    def validate_job_id(cls, value: str) -> str:
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        if not value.endswith('-cleanup'):
            raise osmo_errors.OSMOServerError(
                f'CleanupGroup job_id should end with \"-cleanup\": {value}.')
        return value

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        cleanup_workflow_group(context, self.workflow_id, self.workflow_uuid, self.group_name)
        return JobResult()

    def prepare_execute(self, context: JobExecutionContext,
                        progress_writer: progress.ProgressWriter,
                        progress_iter_freq: datetime.timedelta = \
                            datetime.timedelta(seconds=15)) -> Tuple[bool, str]:
        # pylint: disable=unused-argument
        """
        Runs execute checks and prerequisites.

        Returns whether execute is ready to run and error message if failed
        """
        # Clear the error-logs in case the job has already ran before
        redis_client = connectors.RedisConnector.get_instance().client
        group_obj = task.TaskGroup.fetch_from_db(context.postgres, self.workflow_id,
                                                 self.group_name)
        for task_obj in group_obj.tasks:
            redis_client.delete(
                f'{self.workflow_id}-{task_obj.task_uuid}-{task_obj.retry_id}-error-logs')
        return True, ''


class UpdateGroup(WorkflowJob):
    """
    Update task job contains the id of a task, its container status and optional failure reason.
    When executed, it should do the following:
    - Update the task status and workflow status.
    - Schedule BackendCleanupGroup if needed.
    """
    group_name: task_common.NamePattern
    task_name: task_common.NamePattern | None = None
    retry_id: int | None = None
    status: task.TaskGroupStatus
    message: str = ''
    user: str
    exit_code: int | None = None
    force_cancel: bool = False
    lead_task: bool = True

    @classmethod
    def _get_job_id(cls, values):
        status = values.get('status')
        if isinstance(status, task.TaskGroupStatus):
            status = status.name
        name_list = [values['workflow_uuid'], values['group_name']]
        if values.get('task_name'):
            name_list.append(values['task_name'])
            if values.get('retry_id') is not None:
                name_list.append(str(values['retry_id']))
        name_list += ['update', status]

        return '-'.join(name_list)

    @pydantic.root_validator
    @classmethod
    def validate_job_id(cls, values):
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        job_id = values.get('job_id')
        status = values.get('status')
        if job_id is None or status is None:
            return values

        if isinstance(status, task.TaskGroupStatus):
            status = status.name

        suffix = f'-update-{status}'
        if not job_id.endswith(suffix):
            raise osmo_errors.OSMOServerError(
                f'Job id for an UpdateGroup is in valid: {job_id} should ends with {suffix}.')
        return values

    @pydantic.root_validator
    @classmethod
    def validate_retry_id(cls, values):
        """
        Validates that when task_name exists, retry id is not None. Returns values if valid.
        """
        job_id = values.get('job_id')
        task_name = values.get('task_name')
        retry_id = values.get('retry_id')
        if task_name and retry_id is None:
            raise osmo_errors.OSMOServerError(f'UpdateGroup: {job_id} is missing retry_id.')
        return values

    def send_job_to_queue(self):
        """
        Sends a Job to the job queue.
        """
        redis_connector = connectors.RedisConnector.get_instance()
        redis_client = redis_connector.client

        key_name = f'dedupe:{self.job_id}'
        if not self.status.canceled() and redis_client.get(key_name):
            logging.info('Skipping enqueuing job %s because it is a duplicate', self,
                         extra={'workflow_uuid': self.workflow_uuid})
            return

        self.send_job(redis_client, redis_connector.config, key_name)

    def _update_and_fetch_task_status(self, context: JobExecutionContext,
                                      current_task: task.Task, update_time: datetime.datetime
                                      ) -> task.TaskGroupStatus:
        current_task.update_status_to_db(update_time, self.status, self.message, self.exit_code)

        if not self.task_name or self.retry_id is None:
            raise osmo_errors.OSMOError('Task name and retry id are required to update task status')

        updated_task = task.Task.fetch_from_db(
            context.postgres,
            self.workflow_id,
            self.task_name,
            self.retry_id,
        )

        return updated_task.status

    def _update_all_tasks(
        self,
        context: JobExecutionContext,
        progress_writer: progress.ProgressWriter,
        progress_iter_freq: datetime.timedelta,
        group_obj: task.TaskGroup,
        pool: connectors.Pool,
        update_time: datetime.datetime,
        total_timeout: int,
        redis_client: redis.Redis,
        workflow_config: connectors.WorkflowConfig,
        backend_config_cache: connectors.BackendConfigCache,
        workflow_obj: workflow.Workflow,
        current_task: task.Task,
    ) -> task.TaskGroupStatus:
        # pylint: disable=unused-argument
        """
        Update tasks if needed.
        """
        if not self.status.finished():
            return self._update_and_fetch_task_status(context, current_task, update_time)

        backend_config = backend_config_cache.get(group_obj.spec.tasks[0].backend)
        k8s_factory = group_obj.get_k8s_object_factory(backend_config)
        max_retries = workflow_config.max_retry_per_task
        if not k8s_factory.retry_allowed():
            max_retries = 0
        self._apply_exit_action(current_task, max_retries, pool)

        if self.lead_task:  # Lead task finished
            if group_obj.spec.has_group_barrier():
                self._remove_all_barrier(redis_client)
            update_status = self._update_and_fetch_task_status(context, current_task, update_time)
            if self.status != update_status:
                return update_status

            if self.status == task.TaskGroupStatus.RESCHEDULED:
                self._retry_task(
                    current_task,
                    group_obj,
                    pool.name,
                    workflow_config,
                    backend_config,
                    context,
                    progress_writer,
                    workflow_obj,
                    k8s_factory
                )
                # If group leader reschedules, the other tasks should restart
                for task_obj in group_obj.tasks:
                    if task_obj.name == self.task_name:
                        continue
                    else:
                        self._restart_task(redis_client, task_obj, total_timeout)
            else:
                for task_obj in group_obj.tasks:
                    if task_obj.name == self.task_name:
                        continue
                    # If group leader exits with a special failed status like
                    # FAILED_EVICTED, the other tasks should be labeled as FAILED
                    # (not FAILED_EVICTED)
                    status = task.TaskGroupStatus.FAILED if self.status.failed() else self.status
                    # TODO: Add a new status type for status caused by Lead Container finishing
                    task_obj.update_status_to_db(update_time, status, 'Lead task finished')
        else:  # Nonlead task finished
            if group_obj.spec.has_group_barrier():
                self._remove_barrier(redis_client)
            update_status = self._update_and_fetch_task_status(context, current_task, update_time)
            if group_obj.spec.has_group_barrier() and current_task.status != update_status:
                self._notify_barrier(context.postgres, redis_client, total_timeout)
            if self.status != update_status:
                return update_status
            if self.status == task.TaskGroupStatus.RESCHEDULED:
                if not group_obj.spec.ignoreNonleadStatus:
                    if group_obj.spec.has_group_barrier():
                        self._remove_all_barrier(redis_client)
                    for task_obj in group_obj.tasks:
                        if task_obj.name == self.task_name:
                            continue
                        else:
                            self._restart_task(redis_client, task_obj, total_timeout)
                self._retry_task(
                    current_task,
                    group_obj,
                    pool.name,
                    workflow_config,
                    backend_config,
                    context,
                    progress_writer,
                    workflow_obj,
                    k8s_factory
                )
            elif self.status.failed() and not group_obj.spec.ignoreNonleadStatus:
                for task_obj in group_obj.tasks:
                    if task_obj.name == self.task_name:
                        continue
                    task_obj.update_status_to_db(update_time, task.TaskGroupStatus.FAILED,
                                                 f'Task {self.task_name} Failed.')
        return update_status

    def schedule_cleanup_job(self, context: JobExecutionContext, workflow_obj: workflow.Workflow,
                             group_obj: task.TaskGroup,
                             workflow_config: connectors.WorkflowConfig,
                             backend: connectors.Backend | None):
        # Is the status being updated to finished? If so, enqueue BackendCleanup task
        # Schedule BackendCleanupGroup if needed. We only schedule cleanup if the lead
        # task has a completed status, OR if any task (including non-lead) has a failed
        # status.
        lead_finished = self.status.finished() and self.lead_task
        nonlead_triggered_failed = self.status.failed() and not group_obj.spec.ignoreNonleadStatus
        if not(lead_finished or nonlead_triggered_failed or self.force_cancel):
            return

        job_id = f'{self.workflow_uuid}-{self.group_name}-{common.generate_unique_id(6)}'\
                    '-backend-cleanup'

        # TODO: Get labels from same place they are created
        labels={
            'osmo.workflow_uuid': self.workflow_uuid,
            'osmo.group_uuid': group_obj.group_uuid
        }

        if backend is None:
            logging.info('Backend %s not found for group %s. '
                        'Skipping CleanupGroup and checking CleanupWorkflow.',
                        workflow_obj.backend, group_obj.name,
                        extra={'workflow_uuid': self.workflow_uuid})

            cleanup_workflow_group(context, workflow_obj.workflow_id,
                                    workflow_obj.workflow_uuid,
                                    group_obj.name)
        else:
            factory = group_obj.get_k8s_object_factory(backend)
            cleanup_specs = [
                backend_job_defs.BackendCleanupSpec(resource_type='Secret', labels=labels),
                backend_job_defs.BackendCleanupSpec(resource_type='Service', labels=labels),
            ] + factory.get_group_cleanup_specs(labels)

            force_job_id = f'{self.workflow_uuid}-{self.group_name}-'\
                        f'{common.generate_unique_id(6)}-force-backend-cleanup'
            error_log_spec = None
            if self.status.has_error_logs():
                error_log_spec = factory.get_error_log_specs(labels)

            cleanup_task = CleanupGroup(
                backend=workflow_obj.backend,
                job_id=job_id if not self.force_cancel else force_job_id,
                group_name=group_obj.name,
                workflow_id=self.workflow_id,
                workflow_uuid=self.workflow_uuid,
                force_delete=self.force_cancel,
                cleanup_specs=cleanup_specs, error_log_spec=error_log_spec,
                max_log_lines=workflow_config.max_error_log_lines)
            cleanup_task.send_job_to_queue()

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the job was completed successful and can
        be removed from the message queue, or false if the job failed.
        """

        # Read current status from db
        group_obj = task.TaskGroup.fetch_from_db(context.postgres, self.workflow_id,
                                                 self.group_name)

        update_time = common.current_time()
        if self.status.canceled():
            # If it is force cancel, bypass PROCESSING
            if group_obj.status != task.TaskGroupStatus.PROCESSING or self.force_cancel:
                # Try to change it to Canceled
                group_obj.update_status_to_db(update_time,
                                              self.status, self.message, self.force_cancel)

                # Get the status again to see if Canceled was applied
                group_obj.fetch_status()

            # Need to check status here because the status could have changed due to fetch_status
            if group_obj.status == task.TaskGroupStatus.PROCESSING:
                delayed_job = copy.deepcopy(self)
                delayed_job.job_id = \
                    f'{common.generate_unique_id(5)}-{UpdateGroup._get_job_id(delayed_job.dict())}'
                delayed_job.send_delayed_job_to_queue(
                    datetime.timedelta(minutes=1))

                # Put it back into the queue
                return JobResult(
                    status=JobStatus.FAILED_NO_RETRY,
                    message=f'Group status is {group_obj.status}: Adding back into job queue.')

        workflow_config = context.postgres.get_workflow_configs()
        backend_config_cache = connectors.BackendConfigCache()
        workflow_obj = workflow.Workflow.fetch_from_db(context.postgres, self.workflow_id)
        total_timeout = task_common.calculate_total_timeout(
            workflow_obj.workflow_id,
            workflow_obj.timeout.queue_timeout, workflow_obj.timeout.exec_timeout)
        redis_client = connectors.RedisConnector.get_instance().client
        if not workflow_obj.pool:
            raise osmo_errors.OSMOUserError('No Pool Specified')

        if self.status.canceled() or \
            self.status in [task.TaskGroupStatus.FAILED_UPSTREAM,
                            task.TaskGroupStatus.FAILED_SERVER_ERROR]:
            for task_obj in group_obj.tasks:
                task_obj.update_status_to_db(update_time, self.status,
                                             self.message, self.exit_code)
        else:
            pool_info = connectors.Pool.fetch_from_db(context.postgres, workflow_obj.pool)

            if self.task_name and self.retry_id is not None:
                current_task = task.Task.fetch_from_db(
                    context.postgres, self.workflow_id, self.task_name, self.retry_id)

                if (not current_task.status.prerunning()) and \
                    self.status == task.TaskGroupStatus.FAILED_START_TIMEOUT:
                    logging.info('Skipping updating task %s to FAILED_START_TIMEOUT '
                                 'as it is in %s state.',
                                 current_task.name, current_task.status,
                                 extra={'workflow_uuid': self.workflow_uuid})
                    return JobResult()

                update_status = self._update_all_tasks(
                    context,
                    progress_writer,
                    progress_iter_freq,
                    group_obj,
                    pool_info,
                    update_time,
                    total_timeout,
                    redis_client,
                    workflow_config,
                    backend_config_cache,
                    workflow_obj,
                    current_task
                )
                if self.status != update_status:  # If no change occurs, don't update anything
                    return JobResult()

            # Change self.status to group status
            if self.status == task.TaskGroupStatus.RESCHEDULED:
                self.status = task.TaskGroupStatus.RUNNING

            # Is the status being updated to running? If so, schedule a CheckRunTimeout task
            if group_obj.status.prerunning() and self.status == task.TaskGroupStatus.RUNNING:
                exec_timeout = workflow_obj.timeout.exec_timeout or \
                    common.to_timedelta(pool_info.default_exec_timeout
                                        if pool_info.default_exec_timeout else
                                        workflow_config.default_exec_timeout)
                check_run_timeout = CheckRunTimeout(workflow_id=self.workflow_id,
                                                    workflow_uuid=self.workflow_uuid)
                check_run_timeout.send_delayed_job_to_queue(exec_timeout)

        group_obj.update_status_to_db(update_time, self.status, self.message)
        canceled_by = self.user if \
            (self.status == task.TaskGroupStatus.FAILED_CANCELED) else ''
        workflow_status = workflow_obj.update_status_to_db(update_time, canceled_by=canceled_by)

        # Send notification only for the last lead task that ran, which excludes FAILED_UPSTREAM
        if workflow_status.finished() and self.lead_task and \
            self.status != task.TaskGroupStatus.FAILED_UPSTREAM \
                and context.postgres.method != 'dev':
            workflow_obj.send_notification(workflow_status)

        backend: connectors.Backend | None = None
        try:
            backend = backend_config_cache.get(workflow_obj.backend)
        except osmo_errors.OSMOBackendError:
            pass

        self.schedule_cleanup_job(context, workflow_obj, group_obj,
                                  workflow_config, backend)

        # Fetch the group obj in case of race-condition
        group_obj.fetch_status()
        if backend is None:
            downstream_status = task.TaskGroupStatus.FAILED
            for downstream_group in group_obj.downstream_groups:
                downstream_update_task = UpdateGroup(
                    workflow_id=self.workflow_id,
                    workflow_uuid=self.workflow_uuid,
                    group_name=downstream_group,
                    status=downstream_status,
                    message='Backend not found.',
                    user=self.user,
                    exit_code=task.ExitCode.FAILED_UPSTREAM.value)
                downstream_update_task.send_job_to_queue()
        # Update downstream tasks' status to FAILED_UPSTREAM
        elif group_obj.status.failed():
            downstream_status = task.TaskGroupStatus.FAILED_UPSTREAM
            for downstream_group in group_obj.downstream_groups:
                downstream_update_task = UpdateGroup(
                    workflow_id=self.workflow_id,
                    workflow_uuid=self.workflow_uuid,
                    group_name=downstream_group,
                    status=downstream_status,
                    message='Upstream task failed.',
                    user=self.user,
                    exit_code=task.ExitCode.FAILED_UPSTREAM.value)
                downstream_update_task.send_job_to_queue()
        # If this group succeeded, remove this as a dependency for all downstream groups and
        # launch downstream groups that can be launched
        elif group_obj.status == task.TaskGroupStatus.COMPLETED:
            downstream_groups = group_obj.update_downstream_groups_in_db()
            for downstream_group_obj in downstream_groups:
                if not workflow_obj.pool:
                    raise osmo_errors.OSMOUserError('No Pool Specified')
                downstream_group_obj.set_tasks_to_processing()
                downstream_group_obj.update_status_to_db(
                    common.current_time(),
                    task.TaskGroupStatus.PROCESSING,
                    scheduler_settings=backend.scheduler_settings)
                submit_task = CreateGroup(
                    backend=workflow_obj.backend,
                    group_name=downstream_group_obj.name,
                    workflow_id=self.workflow_id,
                    workflow_uuid=self.workflow_uuid,
                    user=self.user)
                submit_task.send_job_to_queue()

        return JobResult()

    def handle_failure(self, context: JobExecutionContext, error: str):
        """
        Schedule cleanup in case UpdateGroup fails.
        """
        workflow_obj = workflow.Workflow.fetch_from_db(context.postgres, self.workflow_id)
        if not workflow_obj.status.finished():
            return
        workflow_config = context.postgres.get_workflow_configs()
        backend_config_cache = connectors.BackendConfigCache()
        group_obj = task.TaskGroup.fetch_from_db(context.postgres, self.workflow_id,
                                                 self.group_name)
        backend: connectors.Backend | None = None
        try:
            backend = backend_config_cache.get(workflow_obj.backend)
        except osmo_errors.OSMOBackendError:
            pass

        self.schedule_cleanup_job(context, workflow_obj, group_obj,
                                  workflow_config, backend)

    def _apply_exit_action(self, task_obj: task.Task, max_retry: int, pool: connectors.Pool):
        """ Override status according to exit actions. """
        def _in_range(ranges: str, num: int) -> bool:
            """ Checks whether num is in the range indicated by ranges. """
            intervals = ranges.split(',')
            for interval in intervals:
                boundries = list(map(int, interval.split('-')))
                if boundries[0] <= num <= boundries[-1]:
                    return True
            return False

        def _get_exit_action(code: int, exit_actions: Dict[str, str]) -> task.ExitAction | None:
            """ Given exit code, gets corresponding action. """
            for key, value in exit_actions.items():
                if _in_range(value, code):
                    return task.ExitAction(key.upper())
            return None

        if self.exit_code is not None:
            action = None
            if task_obj.exit_actions:
                action = _get_exit_action(self.exit_code, task_obj.exit_actions)
            if not action and pool.default_exit_actions:
                action = _get_exit_action(self.exit_code, pool.default_exit_actions)

            if action and self.status.name != action.name:
                if action == task.ExitAction.RESCHEDULED and task_obj.retry_id >= max_retry:
                    self.message += \
                        f'No exit action applied due to retry limit {max_retry}.'
                    return
                self.status = task.TaskGroupStatus(action.name)
                self.message += \
                    f'Exit Action: {action.value} the task for exit code {self.exit_code}.'

    def _retry_task(
        self,
        task_obj: task.Task,
        group: task.TaskGroup,
        pool: str,
        workflow_config: connectors.WorkflowConfig,
        backend_config: connectors.Backend,
        context: JobExecutionContext,
        progress_writer: progress.ProgressWriter,
        workflow_obj: workflow.Workflow,
        k8s_factory: kb_objects.K8sObjectFactory,
    ):
        progress_writer.report_progress()

        # Get task spec and its index from group spec
        spec = None
        for task_spec in group.spec.tasks:
            if task_obj.name == task_spec.name:
                spec = task_spec
                break

        if spec is None:
            raise osmo_errors.OSMOError(
                f'Task {task_obj.name} is not found in group {group.name}.')

        # Create new database entry
        new_task = task_obj.create_new()
        new_task.insert_to_db(
            gpu_count=spec.resources.gpu or 0,
            cpu_count=spec.resources.cpu or 0,
            disk_count=common.convert_resource_value_str(
                spec.resources.storage or '0', 'GiB'),
            memory_count=common.convert_resource_value_str(
                spec.resources.memory or '0', 'GiB'),
            status=task.TaskGroupStatus.PROCESSING)
        # Copy refresh token so that no new file need to be created
        update_cmd = '''
            UPDATE tasks SET refresh_token = (
                SELECT refresh_token FROM tasks where task_db_key = %s
            ) WHERE task_db_key = %s;
        '''
        context.postgres.execute_commit_command(
            update_cmd,
            (task_obj.task_db_key, new_task.task_db_key))

        # Refetch group so retry_id is updated
        group = task.TaskGroup.fetch_from_db(context.postgres, self.workflow_id,
                                             self.group_name)

        # Get cleanup job
        labels = {
            'osmo.workflow_uuid': self.workflow_uuid,
            'osmo.group_uuid': group.group_uuid,
            'osmo.task_name': task.shorten_name_to_fit_kb(task_obj.name),
            'osmo.retry_id': str(task_obj.retry_id),
        }
        error_log_spec = backend_job_defs.BackendCleanupSpec(resource_type='Pod', labels=labels)
        cleanup_job = CleanupGroup(
            backend=spec.backend,
            group_name=group.name,
            workflow_id=self.workflow_id,
            workflow_uuid=self.workflow_uuid,
            cleanup_specs=[error_log_spec], error_log_spec=error_log_spec,
            max_log_lines=workflow_config.max_error_log_lines)

        # Get create job
        pod_list = {new_task.name: kb_objects.construct_pod_name(
            self.workflow_uuid, new_task.task_uuid)}
        pod, _, = group.convert_to_pod_spec(
            new_task,
            spec,
            self.workflow_uuid,
            self.user,
            pool,
            workflow_obj.plugins,
            k8s_factory,
            pod_list,
            workflow_config,
            backend_config,
            workflow_obj.priority,
            skip_refresh_token=True,
        )
        k8s_factory.update_pod_k8s_resource(pod, group.group_uuid, pool, workflow_obj.priority)

        create_job = CreateGroup(
            backend=spec.backend,
            group_name=group.name,
            workflow_id=self.workflow_id,
            workflow_uuid=self.workflow_uuid,
            k8s_resources=[pod],
            user=self.user)

        reschedule_job = RescheduleTask(
            workflow_id=self.workflow_id,
            workflow_uuid=self.workflow_uuid,
            backend=spec.backend,
            retry_id=new_task.retry_id,
            task_name=new_task.name,
            lead_task=self.lead_task,
            create_job=create_job,
            cleanup_job=cleanup_job)
        reschedule_job.send_job_to_queue()

        progress_writer.report_progress()

    def _remove_barrier(self, redis_client):
        key = task_common.barrier_key(self.workflow_id, self.group_name, task.GROUP_BARRIER_NAME)
        logging.info('Remove member %s from barrier %s', self.task_name, key)
        redis_client.srem(key, self.task_name)

    def _remove_all_barrier(self, redis_client):
        key = task_common.barrier_key(self.workflow_id, self.group_name, task.GROUP_BARRIER_NAME)
        logging.info('Remove all members from barrier %s', key)
        redis_client.delete(key)

    def _notify_barrier(self, database, redis_client, total_timeout: int):
        key = task_common.barrier_key(self.workflow_id, self.group_name, task.GROUP_BARRIER_NAME)
        count = task.TaskGroup.fetch_active_group_size(database, self.workflow_id, self.group_name)
        barrier_set = redis_client.smembers(key)

        if len(barrier_set) >= count:
            key = f'barrier-{common.generate_unique_id()}'
            attributes: Dict[str, str] = {'action': 'barrier'}
            redis_client.set(key, json.dumps(attributes))
            redis_client.expire(key, total_timeout, nx=True)
            for name in barrier_set:
                task_obj = task.Task.fetch_from_db(database, self.workflow_id, name.decode())
                logging.info('Notify %s:%s for barrier count meeting %d',
                             self.workflow_id, task_obj.name, count)
                queue_name = workflow.action_queue_name(
                    self.workflow_id, task_obj.name, task_obj.retry_id)
                redis_client.lpush(queue_name, key)

    def _restart_task(self, redis_client, task_obj: task.Task, total_timeout: int):
        key = f'restart-{common.generate_unique_id()}'
        attributes = {'action': 'restart'}
        queue_name = workflow.action_queue_name(self.workflow_id, task_obj.name, task_obj.retry_id)

        redis_client.set(key, json.dumps(attributes))
        redis_client.expire(key, total_timeout, nx=True)
        redis_client.lpush(queue_name, key)
        redis_client.expire(queue_name, total_timeout, nx=True)
        logging.info('Send action key %s to queue %s', key, queue_name)


class RescheduleTask(BackendJob, WorkflowJob):
    """
    Reschedule a task.
    """
    retry_id: int
    task_name: str
    lead_task: bool = False
    create_job: CreateGroup
    cleanup_job: CleanupGroup

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["workflow_uuid"]}-{values["task_name"]}-{values["retry_id"]}-reschedule'

    @pydantic.validator('job_id')
    @classmethod
    def validate_job_id(cls, value: str) -> str:
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        if not value.endswith('-reschedule'):
            raise osmo_errors.OSMOServerError(
                f'RescheduleTask job_id should end with \"-reschedule\": {value}.')
        return value

    def _delay_cleanup_pod(self):
        cleanup_job = CleanupGroup(**self.cleanup_job.dict())
        # Update retry id label
        if cleanup_job.error_log_spec:
            cleanup_job.error_log_spec.labels['osmo.retry_id'] = str(self.retry_id)
        for spec in cleanup_job.cleanup_specs:
            spec.labels['osmo.retry_id'] = str(self.retry_id)

        # Update job id
        job_id = f'{self.workflow_uuid}-{self.task_name}-{self.retry_id}-'\
            f'{common.generate_unique_id(6)}-backend-cleanup'
        cleanup_job.job_id = job_id

        cleanup_delay = datetime.timedelta(hours=1)
        cleanup_job.send_delayed_job_to_queue(cleanup_delay)

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the job was completed successful and can
        be removed from the message queue, or false if the job failed.
        """
        group_name = task.Task.fetch_group_name(context.postgres, self.workflow_id, self.task_name)
        group = task.TaskGroup.fetch_from_db(
            context.postgres, self.workflow_id, group_name)
        if group.status.group_finished():
            # UpdateGroup changed status of all tasks and cleaned up
            self._delay_cleanup_pod()
        return JobResult()

    def prepare_execute(self, context: JobExecutionContext,
                        progress_writer: progress.ProgressWriter,
                        progress_iter_freq: datetime.timedelta = \
                            datetime.timedelta(seconds=15)) -> Tuple[bool, str]:
        # pylint: disable=unused-argument
        """
        Runs execute checks and prerequisites:
        Inserts task entry into database.

        Returns whether execute is ready to run and error message if failed
        """
        updated_task = task.Task.fetch_from_db(
            context.postgres, self.workflow_id, self.task_name)
        if updated_task.retry_id != self.retry_id:
            return False, 'Reschedule Task Failed: ' +\
                f'Latest retry is {updated_task.retry_id} for task {self.task_name}'
        if not updated_task.status.prescheduling():
            if updated_task.status.group_finished():
                # UpdateGroup changed status of all tasks and cleaned up
                self._delay_cleanup_pod()
            return False, f'Reschedule Task Failed: Task has status {updated_task.status.value}'

        # Clear the error-logs in case the job has already ran before
        redis_client = connectors.RedisConnector.get_instance().client
        redis_client.delete(
            f'{self.workflow_id}-{updated_task.task_uuid}-{updated_task.retry_id - 1}-error-logs')
        return True, ''

    def handle_failure(self, context: JobExecutionContext, error: str):
        """
        Handles job failure in the case that something goes wrong.
        """
        update_task = UpdateGroup(
            workflow_id=self.workflow_id,
            workflow_uuid=self.workflow_uuid,
            status=task.TaskGroupStatus.FAILED_BACKEND_ERROR,
            group_name=self.create_job.group_name,
            task_name=self.task_name,
            retry_id=self.retry_id,
            message=f'RescheduleTask job failed: {error}',
            user=self.create_job.user,
            exit_code=task.ExitCode.FAILED_BACKEND_ERROR.value,
            lead_task=self.lead_task)
        update_task.send_job_to_queue()


class CleanupWorkflow(WorkflowJob):
    """
    CleanupJob moves the logs for a workflow from redis to swiftstack.
    """

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["workflow_uuid"]}-cleanup'

    @pydantic.validator('job_id')
    @classmethod
    def validate_job_id(cls, value: str) -> str:
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        if not value.endswith('-cleanup'):
            raise osmo_errors.OSMOServerError(
                f'CleanupWorkflow job_id should end with \"-cleanup\": {value}.')
        return value

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the job was completed successful and can
        be removed from the message queue, or false if the job failed.
        """
        last_timestamp = datetime.datetime.now()

        workflow_obj = workflow.Workflow.fetch_from_db(context.postgres, self.workflow_id,
                                                       verbose=True)
        parsed_result = urllib.parse.urlparse(workflow_obj.logs)

        if not parsed_result.scheme in ('redis', 'rediss'):
            return JobResult()

        redis_client = redis.from_url(workflow_obj.logs)

        redis_batch_pipeline = redis_client.pipeline()

        if workflow_obj.status.failed():
            start_delimiter = '\n' + '-' * 100 + '\n'
            end_delimiter =  '-' * 100 + '\n'
            base_url = context.postgres.get_workflow_service_url()
            error_logs_url = f'{base_url}/api/workflow/{self.workflow_id}/error_logs'
            status_url = f'{base_url}/workflows/{self.workflow_id}'
            if context.postgres.config.method == 'dev':
                status_url = f'{base_url}/api/workflow/{self.workflow_id}'

            log_message = f'{start_delimiter}Workflow terminated ' +\
                          f'abnormally, view task status at:\n{status_url}\n\n' +\
                          f'View task error logs at:\n{error_logs_url}\n{end_delimiter}'
            logs = connectors.redis.LogStreamBody(
                time=common.current_time(), io_type=connectors.redis.IOType.DUMP,
                source='OSMO', retry_id=0, text=log_message)
            redis_batch_pipeline.xadd(f'{self.workflow_id}-logs', json.loads(logs.json()))

        logs = connectors.redis.LogStreamBody(
            time=common.current_time(), io_type=connectors.redis.IOType.END_FLAG,
            source='', retry_id=0, text='')
        redis_batch_pipeline.xadd(f'{self.workflow_id}-logs', json.loads(logs.json()))
        redis_batch_pipeline.expire(f'{self.workflow_id}-logs', connectors.MAX_LOG_TTL, nx=True)
        redis_batch_pipeline.xadd(common.get_workflow_events_redis_name(self.workflow_uuid),
                                  json.loads(logs.json()))
        redis_batch_pipeline.expire(common.get_workflow_events_redis_name(self.workflow_uuid),
                                    connectors.MAX_LOG_TTL, nx=True)
        for group in workflow_obj.groups:
            for task_obj in group.tasks:
                for retry_idx in range(task_obj.retry_id + 1):
                    redis_batch_pipeline.xadd(
                        common.get_redis_task_log_name(
                            self.workflow_id, task_obj.name, retry_idx),
                        json.loads(logs.json()))
                    redis_batch_pipeline.expire(
                        common.get_redis_task_log_name(
                            self.workflow_id, task_obj.name, retry_idx),
                        connectors.MAX_LOG_TTL, nx=True)
                redis_batch_pipeline.xadd(
                    f'{self.workflow_id}-{task_obj.task_uuid}-{task_obj.retry_id}-error-logs',
                    json.loads(logs.json()))
                redis_batch_pipeline.expire(
                    f'{self.workflow_id}-{task_obj.task_uuid}-{task_obj.retry_id}-error-logs',
                    connectors.MAX_LOG_TTL, nx=True)

        redis_batch_pipeline.execute()

        last_timestamp = update_progress_writer(
            progress_writer,
            last_timestamp,
            progress_iter_freq)

        # Create a storage client to upload logs to S3
        workflow_config = context.postgres.get_workflow_configs()
        if workflow_config.workflow_log.credential is None:
            return JobResult(
                success=False,
                error='Workflow log credential is not set',
            )
        storage_client = storage.Client.create(
            data_credential=workflow_config.workflow_log.credential,
            executor_params=storage.ExecutorParameters(
                num_processes=1,
                # Additional threads just for context switching between upload
                # coroutines to be safe
                num_threads=CONCURRENT_UPLOADS + 2,
            ),
        )

        async def migrate_logs(redis_url: str, redis_key: str, file_name: str):
            ''' Uploads logs to S3 and deletes them from Redis. Returns the S3 file path. '''

            async with aiofiles.tempfile.NamedTemporaryFile(mode='w+') as temp_file:
                await connectors.write_redis_log_to_disk(
                    redis_url,
                    redis_key,
                    str(temp_file.name),
                )

                await progress_writer.report_progress_async()

                await temp_file.flush()

                # Wrap the call in a concrete no-arg function to avoid overload issues during lint.
                def _upload_logs() -> storage.UploadSummary:
                    return storage_client.upload_objects(
                        source=str(temp_file.name),
                        destination_prefix=self.workflow_id,
                        destination_name=file_name,
                    )

                await asyncio.to_thread(_upload_logs)

                await progress_writer.report_progress_async()

        semaphore = asyncio.Semaphore(CONCURRENT_UPLOADS)

        async def migrate_logs_concurrently(redis_url: str, redis_key: str, file_name: str):
            async with semaphore:
                await migrate_logs(redis_url, redis_key, file_name)

        workflow_logs_redis_key = f'{self.workflow_id}-logs'
        workflow_events_redis_key = common.get_workflow_events_redis_name(self.workflow_uuid)

        # Create a list of task parameters
        task_parameters : List[Tuple[str, str, str]] = [
            (workflow_obj.logs, workflow_logs_redis_key, common.WORKFLOW_LOGS_FILE_NAME),
            (workflow_obj.logs, workflow_events_redis_key, common.WORKFLOW_EVENTS_FILE_NAME)
        ]

        for group in workflow_obj.groups:
            for task_obj in group.tasks:
                task_parameters.append(
                    (workflow_obj.logs,
                     common.get_redis_task_log_name(
                       self.workflow_id, task_obj.name, task_obj.retry_id),
                     common.get_task_log_file_name(
                       task_obj.name, task_obj.retry_id)))
                if task_obj.status.has_error_logs():
                    prefix = f'{self.workflow_id}-{task_obj.task_uuid}-{task_obj.retry_id}'
                    task_error_log_name = task_obj.name
                    if task_obj.retry_id > 0:
                        task_error_log_name += f'_{task_obj.retry_id}'
                    task_error_log_name += common.ERROR_LOGS_SUFFIX_FILE_NAME
                    task_parameters.append(
                        (workflow_obj.logs, f'{prefix}-error-logs', task_error_log_name))

        async def run_log_migrations():
            await asyncio.gather(
                *(
                    migrate_logs_concurrently(redis_url, redis_key, file_name)
                    for redis_url, redis_key, file_name in task_parameters
                )
            )

        asyncio.run(run_log_migrations())

        wf_logs_ss_file_path = task_common.get_workflow_logs_path(
            workflow_id=self.workflow_id,
            file_name=common.WORKFLOW_LOGS_FILE_NAME,
        )

        wf_events_ss_file_path = task_common.get_workflow_logs_path(
            workflow_id=self.workflow_id,
            file_name=common.WORKFLOW_EVENTS_FILE_NAME,
        )

        # Update logs field in database to remove Redis URL
        workflow_obj.update_log_to_db(wf_logs_ss_file_path)
        workflow_obj.update_events_to_db(wf_events_ss_file_path)

        # Remove logs from Redis
        redis_keys_to_delete : List[str] = [workflow_logs_redis_key, workflow_events_redis_key]
        for group in workflow_obj.groups:
            for task_obj in group.tasks:
                task_redis_path = common.get_redis_task_log_name(
                    self.workflow_id, task_obj.name, task_obj.retry_id)
                redis_keys_to_delete.append(task_redis_path)
                if task_obj.status.has_error_logs():
                    prefix = f'{self.workflow_id}-{task_obj.task_uuid}-{task_obj.retry_id}'
                    redis_keys_to_delete.append(f'{prefix}-error-logs')

        # Delete in batches to avoid an excessively large single DEL command.
        for idx in range(0, len(redis_keys_to_delete), 1000):
            redis_client.delete(*redis_keys_to_delete[idx:idx + 1000])

        return JobResult()


class CancelWorkflow(WorkflowJob):
    """
    Cancel workflow job contains the id of a workflow.
    When executed, it should do the following:
    - Create UpdateGroup for each unfinished task with status failed and reason canceled.
    """
    user: str
    workflow_status: workflow.WorkflowStatus = workflow.WorkflowStatus.FAILED
    task_status: task.TaskGroupStatus = task.TaskGroupStatus.FAILED_CANCELED
    message: str | None = None
    force: bool = False

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["workflow_uuid"]}-cancel'

    @pydantic.validator('job_id')
    @classmethod
    def validate_job_id(cls, value: str) -> str:
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        if not value.endswith('-cancel'):
            raise osmo_errors.OSMOServerError(
                f'CancelWorkflow job_id should end with \"-cancel\": {value}.')
        return value

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the workflow was canceled.
        """

        # Indicate that the workflow is to be canceled
        workflow_obj = workflow.Workflow.fetch_from_db(context.postgres, self.workflow_id)
        workflow_obj.update_cancelled_by(self.user)

        # Iterate through each group and create a task to mark it as failed
        for group_obj in workflow_obj.get_group_objs():
            # As an optimization, we can skip groups that have already finished
            if group_obj.status.finished() and not self.force:
                continue

            # Update unfinished task statuses
            message = f'Task was canceled by user: {self.user}.'
            if self.message:
                message += f' {self.message}'
            if self.workflow_status == workflow.WorkflowStatus.FAILED_EXEC_TIMEOUT:
                limit_message = 'Task ran longer than the set limit'
                if workflow_obj.timeout.exec_timeout:
                    limit_message += \
                        f' of {common.readable_timedelta(workflow_obj.timeout.exec_timeout)}'
                message = f'{limit_message}.'
            elif self.workflow_status == workflow.WorkflowStatus.FAILED_QUEUE_TIMEOUT:
                limit_message = 'Task stayed in queue longer than the set limit'
                if workflow_obj.timeout.queue_timeout:
                    limit_message += \
                        f' of {common.readable_timedelta(workflow_obj.timeout.queue_timeout)}'
                message = f'{limit_message}.'

            job_id = f'{self.workflow_uuid}-{group_obj.name}-update-{self.task_status.name}'
            if self.force:
                job_id = f'{self.workflow_uuid}-{group_obj.name}-{common.generate_unique_id(5)}' +\
                         f'-force-update-{self.task_status.name}'

            update_task = UpdateGroup(
                job_id=job_id,
                workflow_id=self.workflow_id,
                workflow_uuid=self.workflow_uuid,
                group_name=group_obj.name,
                status=self.task_status,
                message=message,
                user=self.user,
                force_cancel=self.force
            )
            update_task.send_job_to_queue()

        return JobResult()

class CheckRunTimeout(WorkflowJob):
    """
    CheckRunTimeout job. When executed, it should create a CancelWorkflow job if the
    target workflow is still running.
    """

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["workflow_uuid"]}-{common.generate_unique_id(5)}-check_run_timeout'

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Return true if the CancelWorkflow job is submitted.
        """
        workflow_obj = workflow.Workflow.fetch_from_db(context.postgres, self.workflow_id)
        if not workflow_obj.status.finished():
            if workflow_obj.start_time:
                time_elapsed = datetime.datetime.now() - workflow_obj.start_time

                if not workflow_obj.pool:
                    raise osmo_errors.OSMOUserError('No Pool Specified')
                pool_info = connectors.Pool.fetch_from_db(context.postgres, workflow_obj.pool)
                workflow_config = context.postgres.get_workflow_configs()
                exec_timeout = workflow_obj.timeout.exec_timeout or \
                    common.to_timedelta(pool_info.default_exec_timeout
                                        if pool_info.default_exec_timeout else
                                        workflow_config.default_exec_timeout)
                # Comparing two timedelta objects
                if exec_timeout > time_elapsed:
                    logging.info('Execution timeout for workflow %s increased from %s to %s, '
                                'resubmitting it back to delayed job queue.',
                                self.workflow_id, time_elapsed, exec_timeout,
                                extra={'workflow_uuid': self.workflow_uuid})
                    check_queue_timeout = CheckRunTimeout(workflow_id=self.workflow_id,
                                                        workflow_uuid=self.workflow_uuid)
                    # The amount of time left before hitting the new expiration timestamp
                    delta = exec_timeout - time_elapsed
                    check_queue_timeout.send_delayed_job_to_queue(delta)
                else:
                    cancel_job = CancelWorkflow(
                        workflow_id=self.workflow_id,
                        workflow_uuid=self.workflow_uuid, user='osmo',
                        workflow_status=workflow.WorkflowStatus.FAILED_EXEC_TIMEOUT,
                        task_status=task.TaskGroupStatus.FAILED_EXEC_TIMEOUT
                    )
                    cancel_job.send_job_to_queue()

        return JobResult()

class CheckQueueTimeout(WorkflowJob):
    """
    CheckQueueTimeout job. When executed, it should create a CancelWorkflow job if the
    target workflow is still pending (stuck in queue).
    """

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["workflow_uuid"]}-{common.generate_unique_id(5)}-check_queue_timeout'

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Return true if the CancelWorkflow job is submitted.
        """
        workflow_obj = workflow.Workflow.fetch_from_db(context.postgres, self.workflow_id)
        if workflow_obj.status == workflow.WorkflowStatus.PENDING:
            if workflow_obj.submit_time:
                time_since_submission = datetime.datetime.now() - workflow_obj.submit_time

                if not workflow_obj.pool:
                    raise osmo_errors.OSMOUserError('No Pool Specified')
                pool_info = connectors.Pool.fetch_from_db(context.postgres, workflow_obj.pool)
                workflow_config = context.postgres.get_workflow_configs()
                queue_timeout = workflow_obj.timeout.queue_timeout or \
                    common.to_timedelta(pool_info.default_queue_timeout
                                        if pool_info.default_queue_timeout else
                                        workflow_config.default_queue_timeout)
                if queue_timeout > time_since_submission:
                    logging.info('Queue timeout for workflow %s increased from %s to %s, '
                                'resubmitting it back to delayed job queue.',
                                self.workflow_id, time_since_submission, queue_timeout,
                                extra={'workflow_uuid': self.workflow_uuid})
                    check_queue_timeout = CheckQueueTimeout(workflow_id=self.workflow_id,
                                                            workflow_uuid=self.workflow_uuid)
                    # The amount of time left before hitting the new expiration timestamp
                    delta = queue_timeout - time_since_submission
                    check_queue_timeout.send_delayed_job_to_queue(delta)
                else:
                    cancel_job = CancelWorkflow(
                        workflow_id=self.workflow_id,
                        workflow_uuid=self.workflow_uuid, user='osmo',
                        workflow_status=workflow.WorkflowStatus.FAILED_QUEUE_TIMEOUT,
                        task_status=task.TaskGroupStatus.FAILED_QUEUE_TIMEOUT
                    )
                    cancel_job.send_job_to_queue()

        return JobResult()


class UploadApp(FrontendJob):
    """
    Uploads the workflow spec to storage
    """
    app_uuid: str
    app_version: int
    app_content: str

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["app_uuid"]}-{values["app_version"]}-upload-app'

    @pydantic.validator('job_id')
    @classmethod
    def validate_job_id(cls, value: str) -> str:
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        if not value.endswith('-upload-app'):
            raise osmo_errors.OSMOServerError(
                f'UploadApp job_id should end with \"-upload-app\": {value}.')
        return value

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the job was completed successful and can
        be removed from the message queue, or false if the job failed.
        """
        workflow_config = context.postgres.get_workflow_configs()

        if workflow_config.workflow_app.credential is None:
            return JobResult(
                success=False,
                error='Workflow app credential is not set',
            )

        storage_client = storage.Client.create(
            data_credential=workflow_config.workflow_app.credential,
        )

        # Fetch app from database
        app_info = app.AppVersion.fetch_from_db_with_uuid(
            context.postgres, self.app_uuid, self.app_version)

        with tempfile.NamedTemporaryFile(mode='w+', encoding='utf-8') as temp_file:
            temp_file.write(self.app_content)
            temp_file.flush()
            storage_client.upload_objects(
                source=temp_file.name,
                destination_prefix=f'{self.app_uuid}/{self.app_version}',
                destination_name=common.WORKFLOW_APP_FILE_NAME,
            )

        # Update app in database
        app_info.update_status(context.postgres, app.AppStatus.READY)

        return JobResult()


class DeleteApp(FrontendJob):
    """
    Deletes the app from storage
    """
    app_uuid: str
    app_versions: List[int]

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["app_uuid"]}-{values["app_versions"]}-delete-app'

    @pydantic.validator('job_id')
    @classmethod
    def validate_job_id(cls, value: str) -> str:
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        if not value.endswith('-delete-app'):
            raise osmo_errors.OSMOServerError(
                f'DeleteApp job_id should end with \"-delete-app\": {value}.')
        return value

    def execute(self, context: JobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the job was completed successful and can
        be removed from the message queue, or false if the job failed.
        """
        workflow_config = context.postgres.get_workflow_configs()

        if workflow_config.workflow_app.credential is None:
            return JobResult(
                success=False,
                error='Workflow app credential is not set',
            )

        storage_client = storage.Client.create(
            data_credential=workflow_config.workflow_app.credential,
        )

        # Fetch app from database
        for app_version in self.app_versions:
            app_info = app.AppVersion.fetch_from_db_with_uuid(
                context.postgres, self.app_uuid, app_version)

            storage_client.delete_objects(
                prefix=os.path.join(self.app_uuid, str(app_version)),
            )

            # Update app in database
            app_info.update_status(context.postgres, app.AppStatus.DELETED)

        return JobResult()



FRONTEND_JOBS: Dict[str, Type[FrontendJob]] = {
    'SubmitWorkflow': SubmitWorkflow,
    'CreateGroup': CreateGroup,
    'UpdateGroup': UpdateGroup,
    'CleanupWorkflow': CleanupWorkflow,
    'CleanupGroup': CleanupGroup,
    'RescheduleTask': RescheduleTask,
    'CancelWorkflow': CancelWorkflow,
    'CheckRunTimeout': CheckRunTimeout,
    'CheckQueueTimeout': CheckQueueTimeout,
    'UploadWorkflowFiles': UploadWorkflowFiles,
    'UploadApp': UploadApp,
    'DeleteApp': DeleteApp,
}
