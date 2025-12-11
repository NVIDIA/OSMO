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
import datetime
import os
import time
import json
import logging
import pydantic
import yaml
from typing import Any, Dict, List, Set, Type

import kubernetes.client as kb_client  # type: ignore
import kubernetes.client.exceptions as kb_exceptions  # type: ignore
import kubernetes.utils as kb_utils  # type: ignore
import urllib3  # type: ignore

from src.lib.utils import common, osmo_errors, jinja_sandbox
from src.utils import connectors, backend_messages
from src.utils.job import jobs_base, backend_job_defs, kb_methods
from src.utils.job.jobs_base import JobResult, JobStatus  # pylint: disable=unused-import
from src.utils.progress_check import progress


# Max retry times for reschedule a pod
MAX_RETRY = 5


class BackendJobExecutionContext:
    """Context from the backend worker process, needed for executing jobs"""

    @abc.abstractmethod
    def get_kb_client(self) -> kb_client.ApiClient:
        pass

    @abc.abstractmethod
    def get_kb_namespace(self) -> str:
        pass

    @abc.abstractmethod
    def get_test_runner_namespace(self) -> str | None:
        pass

    @abc.abstractmethod
    def get_test_runner_cronjob_spec_file(self) -> str | None:
        pass

    @abc.abstractmethod
    def send_message(self, message: backend_messages.MessageBody):
        pass


class BackendJob(jobs_base.Job):
    """ Represents a job to be executed by the backend worker """

    super_type: str = 'backend'
    backend: str

    @abc.abstractmethod
    def execute(self, context: BackendJobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns info on whether the job completed successfully.
        """
        pass

    def get_redis_options(self):
        return connectors.EXCHANGE, connectors.BACKEND_JOBS,\
            connectors.get_backend_transport_option(self.backend)

    def handle_failure(self, context: BackendJobExecutionContext, error: str):
        """
        Handles job failure in the case that something goes wrong.
        """
        pass


class BackendWorkflowJob(BackendJob):
    """
    Represents some workflow task that needs to be executed by a backend worker.
    """
    workflow_uuid: str

    def log_labels(self) -> Dict[str, str]:
        return {'workflow_uuid': self.workflow_uuid}


class BackendCreateGroup(backend_job_defs.BackendCreateGroupMixin, BackendWorkflowJob):
    """Creates the kubernetes resources for a task group in the backend cluster"""

    @classmethod
    def _get_allowed_job_type(cls):
        return ['CreateGroup']


    def execute(self, context: BackendJobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the job was completed successful and can
        be removed from the message queue, or false if the job failed.
        """
        last_timestamp = datetime.datetime.now()
        # Create all resources in k8s
        # If something fails, then schedule an UpdateGroup-FAILED job
        api = context.get_kb_client()
        namespace = context.get_kb_namespace()
        custom_api = kb_client.CustomObjectsApi(api)

        api.configuration.timeout = self.backend_k8s_timeout

        result = JobResult()

        for resource in self.k8s_resources:
            resource['metadata']['namespace'] = namespace
            message = f'Creating {resource["kind"]} named {resource["metadata"]["name"]} '\
                      f'in namespace {resource["metadata"]["namespace"]}'
            logging.info(message, extra={'workflow_uuid': self.workflow_uuid})

            try:
                # Is this a custom resource type?
                if '/' in resource['apiVersion']:
                    api_major, api_minor = resource['apiVersion'].split('/')
                    # Convert a string like like PodGroup to podgroups
                    path = resource['kind'].lower() + 's'
                    custom_api.create_namespaced_custom_object(
                        api_major, api_minor, namespace, path, resource)
                else:
                    kb_utils.create_from_dict(api, resource)
            # If create_from_dict fails because the resource already exists,
            # omit a warning and continue
            except kb_utils.FailToCreateError as error:
                api_exception = error.api_exceptions[0]
                body = json.loads(api_exception.body)
                if 'reason' in body:
                    reason = body['reason']
                elif 'message' in body:
                    reason = body['message']
                else:
                    reason = api_exception.body
                # Ignore failures to create due to an already existing resource
                if reason == 'AlreadyExists':
                    result.message = reason
                    message = f'Skipping creation of {resource["kind"]} named '\
                              f'{resource["metadata"]["name"]} '\
                              f'in namespace {resource["metadata"]["namespace"]} '\
                              'because it already exists'
                    logging.warning(message, extra={'workflow_uuid': self.workflow_uuid})
                else:
                    raise
            # If create_namespaced_custom_object fails because the resource already exists,
            # omit a warning and continue
            except kb_exceptions.ApiException as api_exception:
                reason = json.loads(api_exception.body)['reason']
                # Ignore failures to create due to an already existing resource
                if reason == 'AlreadyExists':
                    result.message = reason
                    message = f'Skipping creation of {resource["kind"]} named '\
                              f'{resource["metadata"]["name"]} '\
                              f'in namespace {resource["metadata"]["namespace"]} '\
                              'because it already exists'
                    logging.warning(message, extra={'workflow_uuid': self.workflow_uuid})
                else:
                    raise
            # Handle connection errors and retry
            except urllib3.exceptions.ProtocolError as error:
                error_message = f'Connection error when creating {resource["kind"]} named '\
                    f'{resource["metadata"]["name"]}: {error}'
                logging.error(error_message, extra={'workflow_uuid': self.workflow_uuid})
                return JobResult(status=JobStatus.FAILED_RETRY, message=error_message)
            finally:
                last_timestamp = jobs_base.update_progress_writer(progress_writer,
                                                                  last_timestamp,
                                                                  progress_iter_freq)
        return result


class BackendCleanupGroup(backend_job_defs.BackendCleanupGroupMixin, BackendWorkflowJob):
    """Cleans up the kubernetes resources for a task group in the backend cluster"""

    @classmethod
    def _get_allowed_job_type(cls):
        return ['CleanupGroup']

    def get_pod_logs(self, context: BackendJobExecutionContext, selector: str,
                     max_log_lines: int):
        api = context.get_kb_client()
        namespace = context.get_kb_namespace()
        v1_api = kb_client.CoreV1Api(api)

        end_delimiter =  '-' * 80 + '\n' * 2
        pods = v1_api.list_namespaced_pod(namespace, label_selector=selector)

        def is_failed_pod(pod):
            statuses = pod.status.container_statuses or []
            statuses = statuses + (pod.status.init_container_statuses or [])
            for status in statuses:
                if status.state.terminated and status.state.terminated.exit_code != 0:
                    return True
            return False

        failed_pods = [pod for pod in pods.items if is_failed_pod(pod)]
        for pod in failed_pods:
            for container in pod.spec.init_containers + pod.spec.containers:
                # Note which pod it is
                name = f'{pod.metadata.labels.get("osmo.task_name", "")}: {container.name}'
                task_uuid = pod.metadata.labels.get('osmo.task_uuid', None)
                retry_id = pod.metadata.labels.get('osmo.retry_id', 0)
                yield f'Logs for container {name} ...\n', task_uuid, retry_id, False
                try:
                    log_stream = v1_api.read_namespaced_pod_log(
                        pod.metadata.name, namespace,
                        _preload_content=False,
                        container=container.name, async_req=False, tail_lines=max_log_lines)
                except kb_exceptions.ApiException as error:
                    message = f'Warning: Unable to get logs for pod {pod.metadata.name} container' \
                              f' {name} due to exception {type(error).__name__}: {error}'
                    yield message, task_uuid, retry_id, False
                    continue
                line: bytes
                for line in log_stream.stream():
                    # If the line is not completely decodable, salvage the remaining
                    # line and replace characters that are not decodable
                    if line is None:
                        break
                    decoded_line = line.decode('utf-8', errors='replace')
                    yield decoded_line, task_uuid, retry_id, True
                yield end_delimiter, task_uuid, retry_id, False

    def execute(self, context: BackendJobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the job was completed successful and can
        be removed from the message queue, or false if the job failed.
        """
        last_timestamp = datetime.datetime.now()
        # Push error logs if an error_log_spec was provided
        if self.error_log_spec:
            for line, task_name, retry_id, mask in self.get_pod_logs(
                context, self.error_log_spec.k8s_selector,
                    self.max_log_lines):
                context.send_message(backend_messages.MessageBody(
                    type=backend_messages.MessageType.POD_LOG,
                    body=backend_messages.PodLogBody(
                        text=line, task=task_name, retry_id=retry_id, mask=mask)))

                current_timestamp = datetime.datetime.now()
                time_elapsed = last_timestamp - current_timestamp
                if time_elapsed > progress_iter_freq:
                    progress_writer.report_progress()
                    last_timestamp = current_timestamp
            progress_writer.report_progress()

        api = context.get_kb_client()
        namespace = context.get_kb_namespace()
        delete_options = None
        if self.force_delete:
            delete_options = \
                kb_client.V1DeleteOptions(
                    api_version='v1', grace_period_seconds=0, propagation_policy='Foreground')
        need_retry = False
        err_message = None

        def create_cleanup_message(before: bool, resources: Any, error: str | None = None):
            resources_list = [resource.metadata.name for resource in resources.items] \
                             if resources else []
            error_message = f'Error: {error}. ' if error else ''
            return f'CleanupJob {self.job_id} for group {self.group_name} '\
                    f'listed pods [{",".join(resources_list)}] '\
                    f'{"before" if before else "after"} deletion. '\
                    f'{error_message}'

        for cleanup in self.cleanup_specs:
            last_timestamp = jobs_base.update_progress_writer(
                progress_writer,
                last_timestamp,
                progress_iter_freq)

            methods = kb_methods.kb_methods_factory(api, cleanup)
            try:
                resources = methods.list_resource(namespace, label_selector=cleanup.k8s_selector,
                    watch=False)
            except urllib3.exceptions.MaxRetryError as error:
                err_message = f'Listing resource type {cleanup.resource_type} failed during ' + \
                          f'cleanup. Error: {error}'
                logging.error(err_message, extra={'workflow_uuid': self.workflow_uuid})
                need_retry = True
                # Skip deleting for this resource type because list failed
                continue
            except kb_exceptions.ApiException as api_exception:
                err_message = f'Listing resource type {cleanup.resource_type} ApiException: ' + \
                              f'{api_exception}'
                logging.error(err_message, extra={'workflow_uuid': self.workflow_uuid})
                need_retry = True
                # Skip deleting for this resource type because list failed
                continue

            if cleanup.resource_type == 'Pod':
                context.send_message(backend_messages.MessageBody(
                    type=backend_messages.MessageType.LOGGING,
                    body=backend_messages.LoggingBody(
                        type=backend_messages.LoggingType.INFO,
                        text=create_cleanup_message(True, resources),
                        workflow_uuid=self.workflow_uuid
                    )
                ))

            for resource in resources.items:
                message = f'Deleting {cleanup.resource_type} named {resource.metadata.name}'
                logging.info(message, extra={'workflow_uuid': self.workflow_uuid})
                try:
                    methods.delete_resource(resource.metadata.name, namespace, body=delete_options)
                except kb_exceptions.ApiException as api_exception:
                    code = json.loads(api_exception.body)['code']
                    if code == 404:
                        message = f'Skipping deletion of {cleanup.resource_type} named '\
                                  f'{resource.metadata.name} '\
                                  f'in namespace {namespace} '\
                                  'because it has already been deleted'
                        logging.warning(message, extra={'workflow_uuid': self.workflow_uuid})
                    elif code >= 500:
                        err_message = f'Deletion of {cleanup.resource_type} named '\
                                      f'{resource.metadata.name} error: {api_exception}'
                        logging.warning(err_message, extra={'workflow_uuid': self.workflow_uuid})
                        need_retry = True
                    else:
                        raise
            if cleanup.resource_type == 'Pod':
                resources = None
                list_error = None
                try:
                    resources = methods.list_resource(namespace,
                                                      label_selector=cleanup.k8s_selector,
                                                      watch=False)
                except (urllib3.exceptions.MaxRetryError, kb_exceptions.ApiException) as e:
                    list_error = str(e)
                context.send_message(backend_messages.MessageBody(
                    type=backend_messages.MessageType.LOGGING,
                    body=backend_messages.LoggingBody(
                        type=backend_messages.LoggingType.INFO,
                        text=create_cleanup_message(False, resources, list_error),
                        workflow_uuid=self.workflow_uuid
                    )
                ))
        if need_retry:
            return JobResult(status=JobStatus.FAILED_RETRY, message=err_message)
        return JobResult()


class BackendRescheduleTask(BackendWorkflowJob):
    """Reschedule a task in the backend cluster"""

    retry_id: int
    create_job: BackendCreateGroup
    cleanup_job: BackendCleanupGroup

    @classmethod
    def _get_allowed_job_type(cls):
        return ['RescheduleTask']

    def _list_pod_retry_id(self, context: BackendJobExecutionContext) -> int | None:
        """ Gets the current pod's retry id. """
        api = context.get_kb_client()
        namespace = context.get_kb_namespace()
        v1_api = kb_client.CoreV1Api(api)

        if self.cleanup_job.error_log_spec is None:
            return None  # For pytype check
        labels = self.cleanup_job.error_log_spec.labels
        selector = ','.join(
            f'{key}={value}' for key, value in labels.items() if key != 'osmo.retry_id')

        pods = v1_api.list_namespaced_pod(namespace, label_selector=selector)
        if pods.items:
            return int(pods.items[0].metadata.labels['osmo.retry_id'])
        return None

    def execute(self, context: BackendJobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the job was completed successful and can
        be removed from the message queue, or false if the job failed.
        """
        progress_writer.report_progress()
        last_timestamp = datetime.datetime.now()

        for _ in range(MAX_RETRY):
            result = self.cleanup_job.execute(context, progress_writer, progress_iter_freq)
            if result.status != JobStatus.SUCCESS:
                return result

            # Wait for the pod to be completely deleted in k8s
            time.sleep(3)

            result = self.create_job.execute(context, progress_writer, progress_iter_freq)
            if result.status == JobStatus.SUCCESS and result.message == 'AlreadyExists':
                retry_id = self._list_pod_retry_id(context)
                if retry_id is not None and retry_id >= self.retry_id:
                    return result  # Skip if newer pod is created
            else:
                return result

            self.cleanup_job.force_delete = True  # Force delete the pod if the first attempt fails

            current_timestamp = datetime.datetime.now()
            time_elapsed = last_timestamp - current_timestamp
            if time_elapsed > progress_iter_freq:
                progress_writer.report_progress()
                last_timestamp = current_timestamp

        return JobResult(status=JobStatus.FAILED_RETRY,
                         message=f'Failed to create pod: max retry {MAX_RETRY} reached.')


class LabelNode(BackendWorkflowJob):
    """Label a node"""

    node_name: str
    labels: Dict[str, str]

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["node_name"]}-{common.generate_unique_id(5)}-labelnode'

    def execute(self, context: BackendJobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns true if the job was completed successful and can
        be removed from the message queue, or false if the job failed.
        """
        progress_writer.report_progress()

        api = context.get_kb_client()
        v1_api = kb_client.CoreV1Api(api)
        body = {
            'metadata': {
                'labels': self.labels
            }
        }
        try:
            v1_api.patch_node(self.node_name, body)
        except kb_exceptions.ApiException as err:
            return JobResult(status=JobStatus.FAILED_RETRY, message=str(err))

        progress_writer.report_progress()
        return JobResult()


class BackendSynchronizeQueues(backend_job_defs.BackendSynchronizeQueuesMixin, BackendJob):
    """Configures the k8s queues in the backend to match the given spec"""

    @classmethod
    def _get_allowed_job_type(cls):
        return ['BackendSynchronizeQueues']

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["backend"]}-modify-queues-{common.generate_unique_id()}'

    @pydantic.validator('job_id', check_fields=False)
    @classmethod
    def validate_job_id(cls, value: str) -> str:
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        if 'modify-queues' not in value:
            raise osmo_errors.OSMOServerError(
                f'SynchronizeQueues job_id should contain \"modify-queues\": {value}.')
        return value

    def _get_queues(self, context: BackendJobExecutionContext) -> List[Dict]:
        """Gets the queues from the backend"""
        api = context.get_kb_client()
        custom_api = kb_client.CustomObjectsApi(api)
        if self.cleanup_spec.custom_api is None:
            raise osmo_errors.OSMOError('Custom API not provided for queue')
        return custom_api.list_cluster_custom_object(
            self.cleanup_spec.custom_api.api_major,
            self.cleanup_spec.custom_api.api_minor,
            self.cleanup_spec.custom_api.path,
            label_selector=self.cleanup_spec.k8s_selector)['items']

    def _apply_queue(self, context: BackendJobExecutionContext, queue: Dict,
            resource_version: str | None = None):
        """Creates or updates a queue in the backend"""
        client = context.get_kb_client()
        custom_api = kb_client.CustomObjectsApi(client)
        if self.cleanup_spec.custom_api is None:
            raise osmo_errors.OSMOError('Custom API not provided for queue')
        if resource_version is None:
            custom_api.create_cluster_custom_object(
                self.cleanup_spec.custom_api.api_major,
                self.cleanup_spec.custom_api.api_minor,
                self.cleanup_spec.custom_api.path,
                queue)
        else:
            queue['metadata']['resourceVersion'] = resource_version
            custom_api.replace_cluster_custom_object(
                self.cleanup_spec.custom_api.api_major,
                self.cleanup_spec.custom_api.api_minor,
                self.cleanup_spec.custom_api.path,
                queue['metadata']['name'],
                queue)

    def _delete_queue(self, context: BackendJobExecutionContext, name: str):
        """Deletes a queue in the backend"""
        client = context.get_kb_client()
        custom_api = kb_client.CustomObjectsApi(client)
        if self.cleanup_spec.custom_api is None:
            raise osmo_errors.OSMOError('Custom API not provided for queue')
        custom_api.delete_cluster_custom_object(
            self.cleanup_spec.custom_api.api_major,
            self.cleanup_spec.custom_api.api_minor,
            self.cleanup_spec.custom_api.path,
            name)

    def execute(self, context: BackendJobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns info on whether the job completed successfully.
        """
        try:
            # Get the current queues
            queues = self._get_queues(context)
            all_queues: Dict[str, Dict] = {queue['metadata']['name']: queue for queue in queues}

            # Create/Update all queues specified in the job
            for queue in self.k8s_resources:
                resource_version = None
                if queue['metadata']['name'] in all_queues:
                    original_queue = all_queues[queue['metadata']['name']]
                    resource_version = original_queue['metadata']['resourceVersion']
                    queue['metadata']['resourceVersion'] = resource_version
                self._apply_queue(context, queue, resource_version)

            # Delete all extra queues that exist in the backend but not in the job
            target_queues: Set[str] = {queue['metadata']['name'] for queue in self.k8s_resources}
            for queue_name in all_queues:
                if queue_name not in target_queues:
                    self._delete_queue(context, queue_name)

        except urllib3.exceptions.MaxRetryError as error:
            err_message = f'Listing resource type {self.cleanup_spec.resource_type} failed ' + \
                        f'during cleanup. Error: {error}'
            logging.error(err_message)
            return JobResult(status=JobStatus.FAILED_RETRY, message=err_message)

        except kb_exceptions.ApiException as api_exception:
            err_message = f'Listing resource type {self.cleanup_spec.resource_type} ' + \
                            f'ApiException: {api_exception}'
            logging.error(err_message)
            return JobResult(status=JobStatus.FAILED_RETRY, message=err_message)

        return JobResult()


class BackendSynchronizeBackendTest(backend_job_defs.BackendSynchronizeBackendTestMixin,
                                    BackendJob):
    """Synchronize backend test CronJobs and ConfigMaps to match the given spec"""

    @classmethod
    def _get_allowed_job_type(cls):
        return ['BackendSynchronizeBackendTest']

    @classmethod
    def _get_job_id(cls, values):
        return f'{values["backend"]}-sync-tests-{common.generate_unique_id()}'

    @pydantic.validator('job_id', check_fields=False)
    @classmethod
    def validate_job_id(cls, value: str) -> str:
        """
        Validates job_id. Returns the value of job_id if valid.
        """
        if 'sync-tests' not in value:
            raise osmo_errors.OSMOServerError(
                f'SynchroniseTest job_id should contain \"sync-tests\": {value}.')
        return value

    def _get_cronjobs(self, context: BackendJobExecutionContext) -> List[Dict]:
        """Gets the CronJobs from the backend"""
        api = context.get_kb_client()
        batch_v1_api = kb_client.BatchV1Api(api)
        namespace = context.get_test_runner_namespace()

        cronjobs = batch_v1_api.list_namespaced_cron_job(
            namespace,
            label_selector=f'{self.node_condition_prefix}component=backend-test'
        )
        return [cronjob.to_dict() for cronjob in cronjobs.items]

    def _get_configmaps(self, context: BackendJobExecutionContext) -> List[Dict]:
        """Gets the ConfigMaps from the backend"""
        api = context.get_kb_client()
        v1_api = kb_client.CoreV1Api(api)
        namespace = context.get_test_runner_namespace()

        configmaps = v1_api.list_namespaced_config_map(
            namespace,
            label_selector=f'{self.node_condition_prefix}component=backend-test-config'
        )
        return [configmap.to_dict() for configmap in configmaps.items]

    def _apply_cronjob(self, context: BackendJobExecutionContext, cronjob: Dict,
                      resource_version: str | None = None):
        """Creates or updates a CronJob in the backend"""
        api = context.get_kb_client()
        batch_v1_api = kb_client.BatchV1Api(api)
        namespace = context.get_test_runner_namespace()
        cronjob_name = cronjob['metadata']['name']

        try:
            if resource_version is None:
                logging.info('Creating CronJob %s in namespace %s', cronjob_name, namespace,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                result = batch_v1_api.create_namespaced_cron_job(namespace, cronjob)
                logging.info('Successfully created CronJob %s: %s', cronjob_name,
                           result.metadata.name,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            else:
                logging.info('Updating CronJob %s in namespace %s with resourceVersion %s',
                           cronjob_name, namespace, resource_version,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                cronjob['metadata']['resourceVersion'] = resource_version
                result = batch_v1_api.replace_namespaced_cron_job(cronjob_name, namespace,
                                                                  cronjob)
                logging.info('Successfully updated CronJob %s: %s', cronjob_name,
                           result.metadata.name,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
        except kb_exceptions.ApiException as e:
            error_msg = 'Failed to %s CronJob %s: %s'
            action = 'create' if resource_version is None else 'update'
            logging.error(error_msg, action, cronjob_name, e,
                         extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            logging.error('CronJob spec: %s', cronjob,
                         extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            raise
        except Exception as e:
            error_msg = 'Unexpected error when %s CronJob %s: %s'
            action = 'creating' if resource_version is None else 'updating'
            logging.error(error_msg, action, cronjob_name, e,
                         extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            raise

    def _apply_configmap(self, context: BackendJobExecutionContext, configmap: Dict,
                        resource_version: str | None = None):
        """Creates or updates a ConfigMap in the backend"""
        api = context.get_kb_client()
        v1_api = kb_client.CoreV1Api(api)
        namespace = context.get_test_runner_namespace()
        configmap_name = configmap['metadata']['name']

        try:
            if resource_version is None:
                logging.info('Creating ConfigMap %s in namespace %s', configmap_name,
                           namespace,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                result = v1_api.create_namespaced_config_map(namespace, configmap)
                logging.info('Successfully created ConfigMap %s: %s', configmap_name,
                           result.metadata.name,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            else:
                logging.info('Updating ConfigMap %s in namespace %s with resourceVersion %s',
                           configmap_name, namespace, resource_version,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                configmap['metadata']['resourceVersion'] = resource_version
                result = v1_api.replace_namespaced_config_map(configmap_name, namespace,
                                                             configmap)
                logging.info('Successfully updated ConfigMap %s: %s', configmap_name,
                           result.metadata.name,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
        except kb_exceptions.ApiException as e:
            error_msg = 'Failed to %s ConfigMap %s: %s'
            action = 'create' if resource_version is None else 'update'
            logging.error(error_msg, action, configmap_name, e,
                         extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            logging.error('ConfigMap spec: %s', configmap,
                         extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            raise
        except Exception as e:
            error_msg = 'Unexpected error when %s ConfigMap %s: %s'
            action = 'creating' if resource_version is None else 'updating'
            logging.error(error_msg, action, configmap_name, e,
                         extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            raise

    def _delete_cronjob(self, context: BackendJobExecutionContext, name: str):
        """Deletes a CronJob in the backend"""
        api = context.get_kb_client()
        batch_v1_api = kb_client.BatchV1Api(api)
        namespace = context.get_test_runner_namespace()

        try:
            batch_v1_api.delete_namespaced_cron_job(name, namespace)
        except kb_exceptions.ApiException as e:
            if e.status != 404:  # Ignore if CronJob doesn't exist
                raise

    def _delete_configmap(self, context: BackendJobExecutionContext, name: str):
        """Deletes a ConfigMap in the backend"""
        api = context.get_kb_client()
        v1_api = kb_client.CoreV1Api(api)
        namespace = context.get_test_runner_namespace()

        try:
            v1_api.delete_namespaced_config_map(name, namespace)
        except kb_exceptions.ApiException as e:
            if e.status != 404:  # Ignore if ConfigMap doesn't exist
                raise

    def _generate_backend_test_resources_from_configs(self,
        spec_file_path: str) -> List[Dict]:
        """
        Generate Kubernetes CronJob specifications and ConfigMaps for backend tests
        from test configs.

        Returns:
            List of Kubernetes resources (ConfigMaps and CronJobs) specifications
        """
        k8s_resources = []

        for test_name, test_config in self.test_configs.items():
            try:

                resource_name = f'{test_name}'.lower()
                configmap_name = f'{resource_name}-config'

                # Load and render CronJob spec from template.
                cronjob_spec = self._load_cronjob_spec(test_name, test_config, resource_name,
                                                      configmap_name, spec_file_path)
                if not cronjob_spec:
                    logging.error('Failed to load CronJob spec for test %s', test_name,
                                 extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                    continue

                configmap_data = {
                    'test_config.json': json.dumps(test_config)
                }

                configmap_spec = {
                    'apiVersion': 'v1',
                    'kind': 'ConfigMap',
                    'metadata': {
                        'name': configmap_name,
                        'labels': {
                            f'{self.node_condition_prefix}component': 'backend-test-config',
                            f'{self.node_condition_prefix}backend': self.backend,
                            f'{self.node_condition_prefix}test': test_name,
                        }
                    },
                    'data': configmap_data
                }

                k8s_resources.append(configmap_spec)
                k8s_resources.append(cronjob_spec)

            except (OSError, FileNotFoundError, PermissionError, yaml.YAMLError) as error:
                logging.error('Failed to generate CronJob spec for test %s: %s', test_name, error)
                continue
        message = f'Generated {len(k8s_resources)} k8s resources for backend {self.backend}'
        logging.info(message, extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
        return k8s_resources

    def _load_cronjob_spec(self, test_name: str, test_config, resource_name: str,
                          configmap_name: str, spec_file_path: str) -> Dict:
        """
        Load the CronJob spec from template file and render it with values.

        Returns:
            Dictionary containing the rendered CronJob spec, or empty dict if loading fails
        """
        try:
            # Handle both absolute paths (ConfigMap mounts) and relative paths (legacy file-based)
            if not os.path.isabs(spec_file_path):
                spec_file_path = os.path.join(
                    os.path.dirname(os.path.realpath(__file__)), spec_file_path)

            if not os.path.exists(spec_file_path):
                logging.warning('CronJob template file not found at %s', spec_file_path,
                              extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                return {}

            # Prepare values for Jinja templating
            values = {
                'backend_name': self.backend,
                'test_name': test_name,
                'resource_name': resource_name,
                'configmap_name': configmap_name,
                'cron_schedule': test_config['cron_schedule'],
                'node_condition_prefix': self.node_condition_prefix,
            }

            # Load template content and render with Jinja
            spec_content = common.load_contents_from_file(spec_file_path)
            rendered_spec = jinja_sandbox.sandboxed_jinja_substitute(spec_content, values)
            cronjob_spec = yaml.safe_load(rendered_spec)

            logging.info('Successfully loaded and rendered CronJob spec from %s', spec_file_path,
                        extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            return cronjob_spec
        except (OSError, FileNotFoundError, PermissionError, yaml.YAMLError) as e:
            logging.error('Failed to load CronJob specification: %s', e,
                         extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            return {}

    def execute(self, context: BackendJobExecutionContext,
                progress_writer: progress.ProgressWriter,
                progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> JobResult:
        """
        Executes the job. Returns info on whether the job completed successfully.
        """
        try:
            logging.info('Starting BackendSynchronizeBackendTest execution',
                        extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})

            spec_file_path = context.get_test_runner_cronjob_spec_file()
            if not spec_file_path:
                logging.info('No CronJob spec file provided, skipping execution',
                             extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                return JobResult()

            k8s_resources = self._generate_backend_test_resources_from_configs(spec_file_path)

            # Get the current CronJobs and ConfigMaps
            cronjobs = self._get_cronjobs(context)
            configmaps = self._get_configmaps(context)
            logging.info('Found %s existing CronJobs and %s existing ConfigMaps',
                        len(cronjobs), len(configmaps),
                        extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})

            all_cronjobs: Dict[str, Dict] = {
                cronjob['metadata']['name']: cronjob for cronjob in cronjobs
            }
            all_configmaps: Dict[str, Dict] = {
                configmap['metadata']['name']: configmap for configmap in configmaps
            }

            # Separate k8s_resources by kind
            target_cronjobs = []
            target_configmaps = []

            logging.info('Processing %s k8s resources', len(k8s_resources),
                        extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})

            for resource in k8s_resources:
                resource_kind = resource.get('kind')
                resource_name = resource.get('metadata', {}).get('name', 'unknown')
                logging.info('Processing resource: kind=%s, name=%s', resource_kind,
                           resource_name,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})

                if resource_kind == 'CronJob':
                    target_cronjobs.append(resource)
                elif resource_kind == 'ConfigMap':
                    target_configmaps.append(resource)
                else:
                    logging.warning('Unknown resource kind: %s for resource %s',
                                  resource_kind, resource_name,
                                  extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})

            logging.info('Found %s target CronJobs and %s target ConfigMaps',
                        len(target_cronjobs), len(target_configmaps),
                        extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})

            # STEP 1: Delete existing CronJobs that will be recreated
            target_cronjob_names: Set[str] = {
                cronjob['metadata']['name'] for cronjob in target_cronjobs
            }
            existing_cronjobs_to_delete = [name for name in all_cronjobs
                                          if name in target_cronjob_names]
            if existing_cronjobs_to_delete:
                logging.info('Step 1: Deleting %s existing CronJobs to recreate: %s',
                           len(existing_cronjobs_to_delete), existing_cronjobs_to_delete,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                for cronjob_name in existing_cronjobs_to_delete:
                    self._delete_cronjob(context, cronjob_name)

            # STEP 2: Delete existing ConfigMaps that will be recreated
            target_configmap_names: Set[str] = {
                configmap['metadata']['name'] for configmap in target_configmaps
            }
            existing_configmaps_to_delete = [name for name in all_configmaps
                                            if name in target_configmap_names]
            if existing_configmaps_to_delete:
                logging.info('Step 2: Deleting %s existing ConfigMaps to recreate: %s',
                           len(existing_configmaps_to_delete), existing_configmaps_to_delete,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                for configmap_name in existing_configmaps_to_delete:
                    self._delete_configmap(context, configmap_name)

            # STEP 3: Create all ConfigMaps (CronJobs depend on them)
            logging.info('Step 3: Creating ConfigMaps',
                        extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            for configmap in target_configmaps:
                configmap_name = configmap['metadata']['name']
                logging.info('Creating ConfigMap %s', configmap_name,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                # Always create (resource_version=None) since we deleted existing ones
                self._apply_configmap(context, configmap, resource_version=None)

            # STEP 4: Create all CronJobs (after ConfigMaps are ready)
            logging.info('Step 4: Creating CronJobs',
                        extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
            for cronjob in target_cronjobs:
                cronjob_name = cronjob['metadata']['name']
                logging.info('Creating CronJob %s', cronjob_name,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                # Always create (resource_version=None) since we deleted existing ones
                self._apply_cronjob(context, cronjob, resource_version=None)

            # STEP 5: Delete extra CronJobs that are not in the target list
            extra_cronjobs_to_delete = [name for name in all_cronjobs
                                       if name not in target_cronjob_names]
            if extra_cronjobs_to_delete:
                logging.info('Step 5: Deleting %s extra CronJobs: %s',
                           len(extra_cronjobs_to_delete), extra_cronjobs_to_delete,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                for cronjob_name in extra_cronjobs_to_delete:
                    self._delete_cronjob(context, cronjob_name)

            # STEP 6: Delete extra ConfigMaps that are not in the target list
            extra_configmaps_to_delete = [name for name in all_configmaps
                                         if name not in target_configmap_names]
            if extra_configmaps_to_delete:
                logging.info('Step 6: Deleting %s extra ConfigMaps: %s',
                           len(extra_configmaps_to_delete), extra_configmaps_to_delete,
                           extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})
                for configmap_name in extra_configmaps_to_delete:
                    self._delete_configmap(context, configmap_name)

            logging.info('BackendSynchronizeBackendTest execution completed successfully',
                        extra={'workflow_uuid': getattr(self, 'workflow_uuid', None)})

        except urllib3.exceptions.MaxRetryError as error:
            err_message = 'Listing CronJobs/ConfigMaps failed during synchronization. Error: %s'
            logging.error(err_message, error)
            return JobResult(status=JobStatus.FAILED_RETRY, message=err_message % error)

        except kb_exceptions.ApiException as api_exception:
            err_message = 'CronJob/ConfigMap synchronization ApiException: %s'
            logging.error(err_message, api_exception)
            return JobResult(status=JobStatus.FAILED_RETRY, message=err_message % api_exception)

        return JobResult()


BACKEND_JOBS: Dict[str, Type[BackendJob]] = {
    'CreateGroup': BackendCreateGroup,
    'CleanupGroup': BackendCleanupGroup,
    'RescheduleTask': BackendRescheduleTask,
    'LabelNode': LabelNode,
    'BackendSynchronizeQueues': BackendSynchronizeQueues,
    'BackendSynchronizeBackendTest': BackendSynchronizeBackendTest,
}
