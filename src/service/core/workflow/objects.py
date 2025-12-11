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

import collections
import datetime
import math
from typing import Any, Dict, List, NamedTuple, Optional, Set
import yaml

import pydantic

from src.lib.data import storage
from src.lib.utils import credentials, common, osmo_errors, priority as wf_priority
import src.lib.utils.logging
from src.utils.job import app, common as task_common, jobs, kb_objects, task, workflow
from src.utils import connectors, static_config, yaml as util_yaml
from src.utils.metrics import metrics


class WorkflowServiceConfig(connectors.RedisConfig, connectors.PostgresConfig,
                            src.lib.utils.logging.LoggingConfig,
                            static_config.StaticConfig, metrics.MetricsCreatorConfig):
    """ Manages configuration specific to the workflow service. """
    host: str = pydantic.Field(
        command_line='host',
        default='http://0.0.0.0:8000',
        description='The url to bind to when serving the workflow service.')
    device_endpoint: str | None = pydantic.Field(
        command_line='device_endpoint',
        default=None,
        description='The url to bind to when authenticating with the device endpoint.')
    device_client_id: str | None = pydantic.Field(
        command_line='device_client_id',
        default=None,
        description='The client id to use when authenticating with the device endpoint.')
    browser_endpoint: str | None = pydantic.Field(
        command_line='browser_endpoint',
        default=None,
        description='The url to bind to when authenticating with the browser endpoint.')
    browser_client_id: str | None = pydantic.Field(
        command_line='browser_client_id',
        default=None,
        description='The client id to use when authenticating with the browser endpoint.')
    token_endpoint: str | None = pydantic.Field(
        command_line='token_endpoint',
        default=None,
        description='The url to bind to when authenticating with the token endpoint.')
    logout_endpoint: str | None = pydantic.Field(
        command_line='logout_endpoint',
        default=None,
        description='The url to bind to when authenticating with the logout endpoint.')
    progress_file: str = pydantic.Field(
        command_line='progress_file',
        env='OSMO_PROGRESS_FILE',
        default='/var/run/osmo/last_progress',
        description='The file to write progress timestamps to (For liveness/startup probes)')
    progress_iter_frequency: str = pydantic.Field(
        command_line='progress_iter_frequency',
        env='OSMO_PROGRESS_ITER_FREQUENCY',
        default='15s',
        description='How often to write to progress file when processing tasks in a loop ('
                    'e.g. write to progress every 1 minute processed, like uploaded to DB). '
                    'Format needs to be <int><unit> where unit can be either s (seconds) and '
                    'm (minutes).')


class WorkflowServiceContext(pydantic.BaseModel):
    """ Shared context that needs to be access from all api methods. """
    config: WorkflowServiceConfig
    database: connectors.PostgresConnector
    _instance: Optional['WorkflowServiceContext'] = None

    class Config:
        arbitrary_types_allowed = True
        extra = 'forbid'

    @classmethod
    def set(cls, instance: 'WorkflowServiceContext'):
        cls._instance = instance

    @classmethod
    def get(cls) -> 'WorkflowServiceContext':
        if cls._instance is None:
            raise ValueError(
                'Using WorkflowServiceContext before initialization.')
        return cls._instance

class ResourceUsage(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing resource usage information. """
    quota_used: str
    quota_free: str
    quota_limit: str
    total_usage: str
    total_capacity: str
    total_free: str


class PoolResourceUsage(connectors.PoolMinimal, extra=pydantic.Extra.forbid):
    """ Object storing pool information. """
    resource_usage: ResourceUsage


class PoolNodeSetResourceUsage(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing pool node set information. """
    pools: List[PoolResourceUsage]


class PoolResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing pool information. """
    node_sets: List[PoolNodeSetResourceUsage]
    resource_sum: ResourceUsage


class SubmitResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing workflow name, logs, and spec after submission. """
    # The name of the newly created workflow
    name: str
    overview: Optional[str]
    logs: Optional[str]
    spec: Optional[str]
    dashboard_url: Optional[str]

    @classmethod
    @pydantic.root_validator
    def logs_or_spec(cls, values):
        if (values['logs'] is not None, values['spec'] is not None).count(True) != 1:
            raise ValueError('Exactly one of "logs" or "spec" must be set')
        return values


class CancelResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing workflow name. """
    name: str


class ListEntry(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Entry for list API results. """
    user: str
    name: str
    workflow_uuid: str
    submit_time: datetime.datetime
    start_time: datetime.datetime | None
    end_time: datetime.datetime | None
    queued_time: datetime.timedelta
    duration: datetime.timedelta | None
    status: workflow.WorkflowStatus
    overview: str
    logs: str
    error_logs: str | None
    grafana_url: str | None
    dashboard_url: str | None
    pool: str | None
    app_owner: str | None
    app_name: str | None
    app_version: int | None
    priority: str

    @classmethod
    def from_db_row(cls, row: Any, base_url: str,
                    backend_lookup: Dict) -> 'ListEntry':
        """ Create ListEntry from the DB query result. """
        context = WorkflowServiceContext.get()
        config = context.config
        overview = f'{base_url}/workflows/{row["workflow_id"]}'
        if config.method == 'dev':
            overview = f'{base_url}/api/workflow/{row["workflow_id"]}'
        return ListEntry.construct(
            user=row['submitted_by'], name=row['workflow_id'],
            workflow_uuid=row['workflow_uuid'],
            submit_time=row['submit_time'],
            start_time=row['start_time'], end_time=row['end_time'],
            status=workflow.WorkflowStatus(row['status']),
            queued_time=get_workflow_queued_time(row, use_raw_row=True),
            duration=get_workflow_duration(row, use_raw_row=True),
            overview=overview,
            logs=f'{base_url}/api/workflow/{row["workflow_id"]}/logs',
            error_logs=f'{base_url}/api/workflow/{row["workflow_id"]}/error_logs' if \
                str(row['status']).startswith('FAILED') else None,
            grafana_url=generate_grafana_url(
                row['workflow_uuid'], row['backend'], row['start_time'],
                row['end_time'], backend_lookup),
            dashboard_url=generate_dashboard_url(row['workflow_uuid'],
                                                         row['backend'], backend_lookup),
            pool=row['pool'],
            app_owner=row['app_owner'],
            app_name=row['app_name'],
            app_version=row['app_version'],
            priority=row['priority'])


class ListResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    workflows: List[ListEntry]
    more_entries: bool

    @classmethod
    def from_db_rows(cls, rows: Any, base_url: str, more_entries: bool) -> 'ListResponse':
        backend_lookup: Dict = {}
        workflows = [ListEntry.from_db_row(row, base_url, backend_lookup) for row in rows]
        return ListResponse.construct(workflows=workflows, more_entries=more_entries)


class ListTaskSummaryEntry(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Entry for task list API results. """
    user: str
    pool: str | None
    storage: int # Gi
    cpu: int
    memory: int # Gi
    gpu: int
    priority: str

    @classmethod
    def from_db_row(cls, row: Any) -> 'ListTaskSummaryEntry':
        """ Create ListEntry from the DB query result. """
        return ListTaskSummaryEntry(
            user=row['submitted_by'],
            pool=row['pool'],
            storage=row['disk_count'],
            cpu=row['cpu_count'],
            memory=row['memory_count'],
            gpu=row['gpu_count'],
            priority=row['priority'],
            )

class ListTaskAggregatedEntry(ListTaskSummaryEntry, extra=pydantic.Extra.forbid):
    """ Entry for task list API results, aggregated by workflow. """
    workflow_id: str

    @classmethod
    def from_db_row(cls, row: Any) -> 'ListTaskAggregatedEntry':
        return ListTaskAggregatedEntry.construct(
            workflow_id=row['workflow_id'],
            **ListTaskSummaryEntry.from_db_row(row).dict()
            )

class ListTaskSummaryResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    summaries: List[ListTaskSummaryEntry]

    @classmethod
    def from_db_rows(cls, rows: Any) -> 'ListTaskSummaryResponse':
        summaries = [ListTaskSummaryEntry.from_db_row(row) for row in rows]
        return ListTaskSummaryResponse(summaries=summaries)


class ListTaskAggregatedResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    summaries: List[ListTaskAggregatedEntry]

    @classmethod
    def from_db_rows(cls, rows: Any) -> 'ListTaskAggregatedResponse':
        summaries = [ListTaskAggregatedEntry.from_db_row(row) for row in rows]
        return ListTaskAggregatedResponse(summaries=summaries)

class TaskEntry(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Entry for task GET API result. """
    workflow_id: str
    task_name: str
    node: str | None
    start_time: datetime.datetime | None
    end_time: datetime.datetime | None
    status: task.TaskGroupStatus
    storage: int  # Gi
    cpu: int
    memory: int  # Gi
    gpu: int


    @classmethod
    def from_db_row(cls, row: Dict) -> 'TaskEntry':
        """ Create TaskEntry from the DB query result. """
        return TaskEntry(
            workflow_id=row['workflow_id'],
            task_name=row['name'],
            node=row['node_name'],
            start_time=row['start_time'],
            end_time=row['end_time'],
            status=task.TaskGroupStatus(row['status']),
            storage=row['disk_count'],
            cpu=row['cpu_count'],
            memory=row['memory_count'],
            gpu=row['gpu_count'],
        )


class ListTaskEntry(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Entry for task list API results. """
    user: str
    workflow_id: str
    workflow_uuid: str
    task_name: str
    retry_id: int
    pool: str | None
    node: str | None
    start_time: datetime.datetime | None
    end_time: datetime.datetime | None
    duration: datetime.timedelta | None
    status: task.TaskGroupStatus
    overview: str
    logs: str
    error_logs: str | None
    grafana_url: str | None
    dashboard_url: str | None
    storage: int # Gi
    cpu: int
    memory: int # Gi
    gpu: int
    priority: str

    @classmethod
    def from_db_row(cls, row: Any, base_url: str,
                    backend_lookup: Dict) -> 'ListTaskEntry':
        """ Create ListEntry from the DB query result. """
        context = WorkflowServiceContext.get()
        config = context.config
        overview = f'{base_url}/workflows/{row["workflow_id"]}'
        if config.method == 'dev':
            overview = f'{base_url}/api/workflow/{row["workflow_id"]}'
        return ListTaskEntry(
            user=row['submitted_by'],
            workflow_id=row['workflow_id'],
            workflow_uuid=row['workflow_uuid'],
            task_name=row['name'],
            pool=row['pool'],
            retry_id=row['retry_id'],
            node=row['node_name'],
            start_time=row['start_time'],
            end_time=row['end_time'],
            status=task.TaskGroupStatus(row['status']),
            duration=get_workflow_duration(row, use_raw_row=True),
            overview=overview,
            logs=f'{base_url}/api/workflow/{row["workflow_id"]}/logs?task_name={row["name"]}',
            error_logs=
                f'{base_url}/api/workflow/{row["workflow_id"]}/error_logs?task_name={row["name"]}'\
                if str(row['status']).startswith('FAILED') else None,
            grafana_url=generate_grafana_url(
                row['workflow_uuid'], row['backend'], row['start_time'],
                row['end_time'], backend_lookup),
            dashboard_url=generate_dashboard_url(row['workflow_uuid'],
                                                         row['backend'], backend_lookup),
            storage=row['disk_count'],
            cpu=row['cpu_count'],
            memory=row['memory_count'],
            gpu=row['gpu_count'],
            priority=row['priority'],
            )


class ListTaskResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    tasks: List[ListTaskEntry]

    @classmethod
    def from_db_rows(cls, rows: Any, base_url: str) -> 'ListTaskResponse':
        backend_lookup: Dict = {}
        tasks = [ListTaskEntry.from_db_row(row, base_url, backend_lookup) for row in rows]
        return ListTaskResponse(tasks=tasks)


class TaskQueryResponse(pydantic.BaseModel):
    """ Represents the queryed group information. """
    name: str
    retry_id: int
    status: task.TaskGroupStatus
    failure_message: str | None
    exit_code: int | None = None
    logs: str
    error_logs: str | None = None
    processing_start_time: datetime.datetime | None = None
    scheduling_start_time: datetime.datetime | None = None
    initializing_start_time: datetime.datetime | None = None
    events: str
    start_time: datetime.datetime | None = None
    end_time: datetime.datetime | None = None
    input_download_start_time: datetime.datetime | None = None
    input_download_end_time: datetime.datetime | None = None
    output_upload_start_time: datetime.datetime | None = None
    dashboard_url: str | None = None
    pod_name: str
    pod_ip: str | None = None
    task_uuid: str
    node_name: str | None = None
    lead: bool = False

class GroupQueryResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the queryed task information. """
    name: str
    status: task.TaskGroupStatus
    start_time: datetime.datetime | None = None
    end_time: datetime.datetime | None = None
    processing_start_time: datetime.datetime | None = None
    scheduling_start_time: datetime.datetime | None = None
    initializing_start_time: datetime.datetime | None = None
    remaining_upstream_groups: Set[str] | None
    downstream_groups: Set[str] | None
    failure_message: str | None = None
    tasks: List[TaskQueryResponse] = []


class WorkflowQueryResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the queryed workflow information. """
    name: str
    uuid: str
    submitted_by: str
    cancelled_by: str | None
    spec: str
    template_spec: str
    logs: str
    events: str
    overview: str
    parent_name: str | None
    parent_job_id: int | None
    dashboard_url: str | None
    grafana_url: str | None
    tags: List[str] = []
    submit_time: datetime.datetime
    start_time: datetime.datetime | None
    end_time: datetime.datetime | None
    exec_timeout: datetime.timedelta | None
    queue_timeout: datetime.timedelta | None
    duration: datetime.timedelta | None
    queued_time: datetime.timedelta
    status: workflow.WorkflowStatus
    outputs: str = ''
    groups: List[GroupQueryResponse]
    pool: str | None
    backend: str | None
    app_owner: str | None
    app_name: str | None
    app_version: int | None
    plugins: task_common.WorkflowPlugins
    priority: str

    @classmethod
    def fetch_from_db(cls, database: connectors.PostgresConnector,
                      name: str, skip_groups: bool = False, verbose: bool = False
                      ) -> 'WorkflowQueryResponse':
        """ Fetch workflow information from the database. """
        workflow_obj = workflow.Workflow.fetch_from_db(database, name, fetch_groups=False)
        base_url = database.get_workflow_service_url()
        logs = f'{base_url}/api/workflow/{workflow_obj.workflow_id}/logs?last_n_lines=1000'
        events = f'{base_url}/api/workflow/{workflow_obj.workflow_id}/events'
        spec = f'{base_url}/api/workflow/{workflow_obj.workflow_id}/spec'
        template_spec = f'{spec}?use_template=true'
        context = WorkflowServiceContext.get()
        config = context.config
        overview = f'{base_url}/workflows/{workflow_obj.workflow_id}'
        if config.method == 'dev':
            overview = f'{base_url}/api/workflow/{workflow_obj.workflow_id}'
        groups = [] if skip_groups else get_groups(
            database, workflow_obj.workflow_id, logs, events,
            base_url, workflow_obj.backend, verbose)

        app_info: app.App | None = None
        if workflow_obj.app_uuid:
            try:
                app_info = app.App.fetch_from_db_from_uuid(database, workflow_obj.app_uuid)
            except osmo_errors.OSMOUserError:
                pass

        return WorkflowQueryResponse(
            name=workflow_obj.workflow_id,
            uuid=workflow_obj.workflow_uuid,
            submitted_by=workflow_obj.user,
            cancelled_by=workflow_obj.cancelled_by,
            spec=spec,
            template_spec=template_spec,
            logs=logs,
            events=events,
            overview=overview,
            parent_name=workflow_obj.parent_name,
            parent_job_id=workflow_obj.parent_job_id,
            dashboard_url=generate_dashboard_url(workflow_obj.workflow_uuid,
                                                         workflow_obj.backend),
            grafana_url=generate_grafana_url(workflow_obj.workflow_uuid,
                                                     workflow_obj.backend,
                                                     workflow_obj.start_time,
                                                     workflow_obj.end_time),
            tags = get_workflow_tags(workflow_obj.workflow_uuid),
            submit_time=workflow_obj.submit_time,
            start_time=workflow_obj.start_time, end_time=workflow_obj.end_time,
            queued_time=get_workflow_queued_time(workflow_obj),
            exec_timeout=workflow_obj.timeout.exec_timeout,
            queue_timeout=workflow_obj.timeout.queue_timeout,
            duration=get_workflow_duration(workflow_obj), status=workflow_obj.status,
            outputs=workflow_obj.outputs, groups=groups,
            pool=workflow_obj.pool,
            backend=workflow_obj.backend,
            app_owner=app_info.owner if app_info else None,
            app_name=app_info.name if app_info else None,
            app_version=workflow_obj.app_version,
            plugins=workflow_obj.plugins,
            priority=workflow_obj.priority)


class ResourcesResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing execution cluster node resource information. """
    resources: List[workflow.ResourcesEntry]


class PoolResourcesEntry(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Entry for resources API results. """
    pool: str
    platform: str
    status: connectors.PoolStatus
    usage_fields: Dict
    allocatable_fields: Dict
    backend: str


class PoolResourcesResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing execution cluster node resource information. """
    pools: List[PoolResourcesEntry]


class DataUploadResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Upload Response. """
    version_id: str
    container: str
    endpoint_url: str
    path: str


class DataDownloadResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing Download Response. """
    location: str
    container: str
    endpoint_url: str


class CredentialRecord(NamedTuple):
    cred_type: str
    profile: str | None
    payload: str


class UserRegistryCredential(credentials.RegistryCredential, extra=pydantic.Extra.forbid):
    """ Authentication information for a Docker registry. """
    auth: str = pydantic.Field(
        description='The authentication token for the Docker registry')  # type: ignore

    @staticmethod
    def type() -> connectors.CredentialType:
        return connectors.CredentialType.REGISTRY

    def to_db_row(self, user: str, postgres: connectors.PostgresConnector) -> CredentialRecord:
        payload = {'username': self.username, 'auth': self.auth}
        payload = postgres.encrypt_dict(payload, user)
        return CredentialRecord(self.type().value,
                                self.registry,
                                connectors.PostgresConnector.encode_hstore(payload))

    def valid_cred(self, workflow_config: connectors.WorkflowConfig):
        self.registry = common.registry_parse(self.registry)
        if self.registry in workflow_config.credential_config.disable_registry_validation:
            return
        response = common.registry_auth(f'https://{self.registry}/v2/',
                                        self.username, self.auth)
        if response.status_code != 200:
            raise osmo_errors.OSMOCredentialError('Registry authentication failed.')



class UserDataCredential(credentials.DataCredential, extra=pydantic.Extra.forbid):
    """ Authentication information for a data service. """
    access_key: str = pydantic.Field(
        description='The authentication secret for the data service')  # type: ignore

    @staticmethod
    def type() -> connectors.CredentialType:
        return connectors.CredentialType.DATA

    def to_db_row(self, user: str, postgres: connectors.PostgresConnector) -> CredentialRecord:
        payload = {'access_key_id': self.access_key_id,
                   'access_key': self.access_key,
                   'region': self.region}
        payload = postgres.encrypt_dict(payload, user)
        return CredentialRecord(self.type().value,
                                self.endpoint,
                                connectors.PostgresConnector.encode_hstore(payload))

    def valid_cred(self, workflow_config: connectors.WorkflowConfig):
        storage_info = storage.construct_storage_backend(self.endpoint, True)
        if storage_info.scheme in workflow_config.credential_config.disable_data_validation:
            return
        storage_info.data_auth(self.access_key_id, self.access_key, self.region)


class UserCredential(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Generic authentication information. """
    credential: Dict[str, str] = pydantic.Field(
        description='The credential dictionary that contains authentication information'
    )

    @staticmethod
    def type() -> connectors.CredentialType:
        return connectors.CredentialType.GENERIC

    def to_db_row(self, user: str, postgres: connectors.PostgresConnector) -> CredentialRecord:
        payload = postgres.encrypt_dict(self.credential, user)
        return CredentialRecord(self.type().value, None,
                                connectors.PostgresConnector.encode_hstore(payload))

    @staticmethod
    def from_db_row(rows) -> List:
        creds = [{
            'cred_name': row.cred_name,
            'cred_type': row.cred_type,
            'profile': row.profile,
        } for row in rows]
        return creds

    @staticmethod
    def commit_cmd() -> str:
        cmd = '''
            INSERT INTO credential
            (user_name, cred_name, cred_type, profile, payload)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (user_name, profile) DO UPDATE SET
            cred_name = EXCLUDED.cred_name,
            cred_type = EXCLUDED.cred_type,
            payload = EXCLUDED.payload;
            '''
        return cmd

    def valid_cred(self, workflow_config: connectors.WorkflowConfig):
        # pylint: disable=unused-argument
        pass


class CredentialOptions(pydantic.BaseModel):
    """ Credential options """
    registry_credential: Optional[UserRegistryCredential] = pydantic.Field(
        description='Authentication information for a Docker registry')
    data_credential: Optional[UserDataCredential] = pydantic.Field(
        description='Authentication information for a data service')
    generic_credential: Optional[UserCredential] = pydantic.Field(
        description='Generic authentication information')

    @pydantic.root_validator(pre=True)
    def validate_credential(cls, values):  # pylint: disable=no-self-argument
        """ A valid credential can only be one of the three types """
        num_fields_set = sum(1 for value in values.values()
                             if value is not None)
        if num_fields_set != 1:
            raise osmo_errors.OSMOUserError(
                f'Exactly one of the following must be set {cls.__fields__.keys()}')
        return values


class CredentialGetResponse(pydantic.BaseModel):
    """ Credential Response. """
    credentials: List[Dict[str, Optional[str]]]


class RouterResponse(pydantic.BaseModel):
    """ Router Information Response. """
    router_address: str
    key: str
    cookie: str


class WorkflowSubmitInfo(pydantic.BaseModel):
    ''' Performs the workflow submission in steps '''
    context: WorkflowServiceContext
    base32_id: str = ''
    name: str = ''
    parent_workflow_id: str | None
    app_uuid: str | None = None
    app_version: int | None = None
    user: str
    pool: str = ''
    priority: wf_priority.WorkflowPriority = wf_priority.WorkflowPriority.NORMAL
    backend: str = ''

    def build_workflow_object(self,
                     rendered_spec: workflow.WorkflowSpec,
                     group_and_task_uuids: Dict,
                     remaining_upstream_groups: Dict,
                     downstream_groups: Dict,
                     failure_message: str | None = None) -> workflow.Workflow:
        workflow_obj = workflow.Workflow.from_workflow_spec(
            self.context.database, self.name,
            self.base32_id, self.user, rendered_spec, self.context.config.redis_url,
            group_and_task_uuids, remaining_upstream_groups, downstream_groups,
            status=workflow.WorkflowStatus.PENDING\
                if failure_message is None else workflow.WorkflowStatus.FAILED_SUBMISSION,
            failure_message=failure_message or '', parent_workflow_id=self.parent_workflow_id,
            app_uuid=self.app_uuid, app_version=self.app_version, priority=self.priority)
        return workflow_obj

    def insert_failed_submission_to_db(self, failure_message: str) -> workflow.Workflow:
        workflow_obj = workflow.Workflow.from_workflow(
            self.context.database, self.name,
            self.base32_id, self.user, backend=self.backend, pool=self.pool,
            failure_message=failure_message or '',
            parent_workflow_id=self.parent_workflow_id, app_uuid=self.app_uuid,
            app_version=self.app_version, priority=self.priority)
        workflow_obj.insert_to_db()
        return workflow_obj

    def construct_workflow_dict(self, template_spec: workflow.TemplateSpec) -> Dict:
        # Render the workflow spec

        # Verify pool
        pool_info = connectors.Pool.fetch_from_db(self.context.database, self.pool)
        self.backend = pool_info.backend

        try:
            updated_workflow_txt = template_spec.load_template_with_variables()
            updated_workflow_dict: Dict[str, Any] = yaml.safe_load(updated_workflow_txt)
            if 'default-values' in updated_workflow_dict:
                del updated_workflow_dict['default-values']
        except yaml.YAMLError as yaml_error:
            err_msg=f'Workflow spec is not properly formatted: {yaml_error}'
            # Construct a workflow ID with format <name>-<number>
            # Appending failed in the front because the base32_id may start with a number, which
            # fails the regex check.
            self.name = f'failed-{self.base32_id}'
            # Needs to be in the above format to pass the deconstruct_workflow_id() function in
            # the from_workflow() call
            try:
                self.insert_failed_submission_to_db(str(yaml_error))
            except:  # pylint: disable=bare-except
                pass
            raise osmo_errors.OSMOUsageError(err_msg, workflow_id=self.base32_id)

        self.name = updated_workflow_dict.get('workflow', {}).get('name', '')
        self.name = self.name if self.name else f'failed-{self.base32_id}'

        return updated_workflow_dict


    def construct_workflow_spec_from_dict(self, workflow_dict: Dict)\
        -> workflow.WorkflowSpec:
        try:
            versioned_workflow_spec = workflow.VersionedWorkflowSpec(
                **workflow_dict)
        except pydantic.ValidationError as err:
            try:
                self.insert_failed_submission_to_db(str(err))
            except:  # pylint: disable=bare-except
                pass
            raise osmo_errors.OSMOUsageError(f'{err}', workflow_id=self.name)

        return versioned_workflow_spec.workflow

    def update_dataset_buckets(self, workflow_spec: workflow.WorkflowSpec):
        postgres = connectors.PostgresConnector.get_instance()
        dataset_config = postgres.get_dataset_configs()
        default_user_bucket = connectors.UserProfile.fetch_from_db(postgres, self.user).bucket

        def _fetch_bucket(dataset_info_bucket: str) -> str:
            if dataset_info_bucket:
                bucket = dataset_info_bucket
            elif default_user_bucket:
                bucket = default_user_bucket
            elif dataset_config.default_bucket:
                bucket = dataset_config.default_bucket
            else:
                raise osmo_errors.OSMOUserError(
                    'No default bucket set. Specify default bucket using the '
                    '"osmo profile set" CLI.')

            return bucket

        def _update_bucket(task_obj: task.TaskSpec):
            for dataset_input in task_obj.inputs + task_obj.outputs:
                if isinstance(dataset_input, task.DatasetInputOutput):
                    dataset_info = common.DatasetStructure(dataset_input.dataset.name,
                                                           workflow_spec=True)
                    dataset_info.bucket = _fetch_bucket(dataset_info.bucket)
                    dataset_input.dataset.name = dataset_info.full_name
                elif isinstance(dataset_input, task.UpdateDatasetOutput):
                    dataset_info = common.DatasetStructure(dataset_input.update_dataset.name,
                                                           workflow_spec=True)
                    dataset_info.bucket = _fetch_bucket(dataset_info.bucket)
                    dataset_input.update_dataset.name = dataset_info.full_name

        for group in workflow_spec.groups:
            for group_task in group.tasks:
                _update_bucket(group_task)

        for task_obj in workflow_spec.tasks:
            _update_bucket(task_obj)

    def send_workflow_spec_to_queue(self, workflow_id: str, workflow_dict: Dict,
                                    original_templated_spec: str | None = None):

        # Convert file contents to YamlLiteral for better output format
        def convert_task_file_contents(curr_task_spec: Dict):
            for file in curr_task_spec.get('files', []):
                file['contents'] = util_yaml.YamlLiteral(file['contents'])

        for task_spec in workflow_dict['workflow'].get('tasks', []):
            convert_task_file_contents(task_spec)

        for group in workflow_dict['workflow'].get('groups', []):
            for task_spec in group.get('tasks', []):
                convert_task_file_contents(task_spec)

        workflow_spec = yaml.dump(workflow_dict, default_flow_style=False, allow_unicode=True)
        files = [
            jobs.File(path=common.WORKFLOW_SPEC_FILE_NAME, content=workflow_spec)
        ]
        if original_templated_spec is not None:
            files.append(jobs.File(
                path=common.TEMPLATED_WORKFLOW_SPEC_FILE_NAME,
                content=original_templated_spec))

        upload_spec_job = jobs.UploadWorkflowFiles(
            workflow_id=workflow_id,
            workflow_uuid=self.base32_id,
            files=files)
        upload_spec_job.send_job_to_queue()


    def validate_workflow_spec(
        self, rendered_spec: workflow.WorkflowSpec,
        group_and_task_uuids: Dict[str, common.UuidPattern],
        roles: List[str],
        original_templated_spec: str | None,
        priority: wf_priority.WorkflowPriority = wf_priority.WorkflowPriority.NORMAL):
        """
        Validate workflow spec by checking:
        - if user has the necessary credentials to pull datasets
        - if the workflow can match any resource node that has enough allocatables for the workflow
        - if this workflow's Docker containers can be pull with user and service Docker credentials

        If validation fails, insert this workflow entry into the database, and upload the spec.
        """
        remaining_upstream_groups: Dict = collections.defaultdict(set)
        downstream_groups: Dict = collections.defaultdict(set)
        upload_workflow_spec = True
        try:
            # Validate tasks
            rendered_spec.validate_name_and_inputs()

            # Check if pool is online
            pool_info = connectors.Pool.fetch_from_db(self.context.database, self.pool)
            if pool_info.status == connectors.PoolStatus.MAINTENANCE:
                if 'osmo-admin' not in roles:
                    upload_workflow_spec = False
                    raise osmo_errors.OSMOUsageError(
                        f'Pool {self.pool} is undergoing maintenance. '
                        'Users will have to wait until maintenance is completed before submission.')

            # Validate priority
            backend_info = connectors.Backend.fetch_from_db(self.context.database, self.backend)
            object_factory = kb_objects.get_k8s_object_factory(backend_info)
            if not object_factory.priority_supported():
                if priority != wf_priority.WorkflowPriority.NORMAL:
                    upload_workflow_spec = False
                    required_priority = wf_priority.WorkflowPriority.NORMAL.value
                    raise osmo_errors.OSMOUsageError(
                        f'Backend {self.backend} does not support priority. '
                        f'Workflows must be submitted with {required_priority} priority',
                        workflow_id=self.name)

            # Validate gpu counts for NORMAL/HIGH priority workflows
            if priority != wf_priority.WorkflowPriority.LOW:
                for group_obj_spec in rendered_spec.groups:
                    group_gpus = 0
                    for task_obj_spec in group_obj_spec.tasks:
                        group_gpus += task_obj_spec.resources.gpu or 0
                    if pool_info.resources.gpu and pool_info.resources.gpu.guarantee != -1 and \
                        group_gpus > pool_info.resources.gpu.guarantee:

                        raise osmo_errors.OSMOUsageError(
                            f'Pool {self.pool} has {pool_info.resources.gpu.guarantee} GPUs '
                            'guaranteed for NORMAL/HIGH priority workflows and '
                            f'group {group_obj_spec.name} requires {group_gpus} GPUs. '
                            'Higher gpu counts must be submitted with '
                            f'{wf_priority.WorkflowPriority.LOW.value} priority',
                            workflow_id=self.name)

            # Validate the resources
            resources_list = get_resources(pools=[self.pool], verbose=True).resources
            platform_to_resource_map: Dict[str, List[workflow.ResourcesEntry]] = {}
            for resource in resources_list:
                for platform in resource.pool_platform_labels[self.pool]:
                    if platform not in platform_to_resource_map:
                        platform_to_resource_map[platform] = [resource]
                    else:
                        platform_to_resource_map[platform].append(resource)
            rendered_spec.validate_resources(platform_to_resource_map)

            rendered_spec.validate_credentials(self.user)
        except Exception as err:  # pylint: disable=broad-except
            if upload_workflow_spec:
                workflow_obj = self.build_workflow_object(
                    failure_message=(str(err) if not isinstance(err, osmo_errors.OSMOError)
                                    else err.message),
                    rendered_spec=rendered_spec,
                    group_and_task_uuids=group_and_task_uuids,
                    remaining_upstream_groups=remaining_upstream_groups,
                    downstream_groups=downstream_groups)
                workflow_obj.insert_to_db()
                uploaded_workflow_dict = {'version': 2,
                                        'workflow': rendered_spec.dict(exclude_defaults=True)}
                self.send_workflow_spec_to_queue(workflow_obj.workflow_id,
                                                 uploaded_workflow_dict,
                                                 original_templated_spec)
            raise err


    def send_submit_workflow_to_queue(self,
                                      rendered_spec: workflow.WorkflowSpec,
                                      group_and_task_uuids: Dict[str, common.UuidPattern],
                                      original_templated_spec: str | None = None)\
        -> SubmitResponse:

        workflow_dict = {'version': 2,
                         'workflow': rendered_spec.saved_spec()}

        postgres = self.context.database
        service_url = self.context.database.get_workflow_service_url()
        remaining_upstream_groups: Dict = collections.defaultdict(set)
        downstream_groups: Dict = collections.defaultdict(set)

        workflow_obj = self.build_workflow_object(
            rendered_spec=rendered_spec,
            group_and_task_uuids=group_and_task_uuids,
            remaining_upstream_groups=remaining_upstream_groups,
            downstream_groups=downstream_groups)
        task_db_keys = workflow_obj.get_task_db_keys()

        submit_job = jobs.SubmitWorkflow(
            workflow_id=self.name,
            workflow_uuid=self.base32_id, user=self.user, spec=rendered_spec,
            original_spec=workflow_dict,
            group_and_task_uuids=group_and_task_uuids,
            parent_workflow_id=self.parent_workflow_id,
            app_uuid=self.app_uuid, app_version=self.app_version,
            task_db_keys=task_db_keys,
            priority=self.priority)
        submit_job.send_job_to_queue()

        # Write workflow and group objects to the database
        workflow_obj.insert_to_db()
        for group_obj in workflow_obj.groups:
            group_obj.workflow_id_internal = workflow_obj.workflow_id
            group_obj.spec = \
                group_obj.spec.parse(
                    postgres, workflow_obj.workflow_id, group_and_task_uuids)
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

        logs = f'{service_url}/api/workflow/{workflow_obj.workflow_id}/logs'
        context = WorkflowServiceContext.get()
        config = context.config
        overview = f'{service_url}/workflows/{workflow_obj.workflow_id}'
        if config.method == 'dev':
            overview = f'{service_url}/api/workflow/{workflow_obj.workflow_id}'

        self.send_workflow_spec_to_queue(
            workflow_obj.workflow_id, workflow_dict, original_templated_spec)

        return SubmitResponse(
            name=workflow_obj.workflow_id,
            overview=overview,
            logs=logs,
            dashboard_url=generate_dashboard_url(self.base32_id[:16], self.backend))


def get_groups(database: connectors.PostgresConnector,
               workflow_id: str, logs: str, events: str, base_url: str, backend: str,
               verbose: bool = False) -> List[GroupQueryResponse]:
    """ Fetch group status. """
    fetch_cmd = '''
        SELECT groups.*, workflows.workflow_uuid FROM groups JOIN workflows
        ON groups.workflow_id = workflows.workflow_id WHERE
        groups.workflow_id = %s;
    '''
    groups = []
    group_rows = database.execute_fetch_command(fetch_cmd, (workflow_id,), True)

    for group_row in group_rows:
        task_rows = task.Task.list_task_rows_by_group_name(
            database, workflow_id, group_row['name'], verbose=verbose, sort=True)

        tasks = [TaskQueryResponse(
            name=task_row['name'], retry_id=task_row['retry_id'], status=task_row['status'],
            failure_message=task_row['failure_message'],
            exit_code=task_row['exit_code'],
            logs=fr'{logs}&task_name={task_row["name"]}&retry_id={task_row["retry_id"]}',
            error_logs=f'{base_url}/api/workflow/{task_row["workflow_id"]}/' +
                    f'error_logs?task_name={task_row["name"]}&retry_id={task_row["retry_id"]}' if \
                    task.TaskGroupStatus[task_row['status']].has_error_logs() else None,
            processing_start_time=group_row['processing_start_time'],
            scheduling_start_time=task_row['scheduling_start_time'],
            initializing_start_time=task_row['initializing_start_time'],
            events=fr'{events}?task_name={task_row["name"]}&retry_id={task_row["retry_id"]}',
            start_time=task_row['start_time'],
            end_time=task_row['end_time'],
            input_download_start_time=task_row['input_download_start_time'],
            input_download_end_time=task_row['input_download_end_time'],
            output_upload_start_time=task_row['output_upload_start_time'],
            output_upload_end_time=task_row['output_upload_end_time'],
            pod_name=task_row['pod_name'] if task_row['pod_name'] \
                else kb_objects.construct_pod_name(
                    group_row['workflow_uuid'], task_row['task_uuid']),
            task_uuid=task_row['task_uuid'],
            dashboard_url=generate_task_dashboard_url(
                task_pod_name=task_row['pod_name'] if task_row['pod_name'] \
                    else kb_objects.construct_pod_name(
                        group_row['workflow_uuid'], task_row['task_uuid']),
                backend=backend),
            node_name=task_row['node_name'],
            pod_ip=task_row['pod_ip'],
            lead=task_row['lead'])
            for task_row in task_rows]

        group_query_response = GroupQueryResponse(
            name=group_row['name'], status=group_row['status'],
            failure_message=group_row['failure_message'],
            tasks=tasks,
            start_time=group_row['start_time'],
            end_time=group_row['end_time'],
            processing_start_time=group_row['processing_start_time'],
            scheduling_start_time=group_row['scheduling_start_time'],
            initializing_start_time=group_row['initializing_start_time'],
            remaining_upstream_groups=task.decode_hstore(group_row['remaining_upstream_groups']),
            downstream_groups=task.decode_hstore(group_row['downstream_groups']))
        groups.append(group_query_response)

    return groups


def get_resources(backends: List[str] | None = None,
                  pools: List[str] | None = None,
                  platforms: List[str] | None = None,
                  resource_name: str | None = None,
                  verbose: bool = False) -> ResourcesResponse:
    """
    Fetch resources from database and put them in a row.

    Each parameter is used as a filter in the underlying SQL call to query for
    the resources. Resources returned will satisfy all the filters defined in
    the parameters passed into this function.
    """
    backend_resources = connectors.BackendResource.list_from_db(
        backends, pools, platforms, resource_name)

    return ResourcesResponse(resources=[
        workflow.ResourcesEntry.from_backend_resource(resource, verbose)
        for resource in backend_resources
    ])


def get_time_diff(start_time: datetime.datetime,
                  end_time: datetime.datetime,
                  round_to: int=3600) -> float:
    """
    Calculate the time difference between two datetime objects
    to the nearest specified interval.

    Args:
        start_time: The starting datetime.
        end_time: The ending datetime.
        round_to: The interval to show the time difference in seconds
                  Defaults to 3600 seconds (1 hour).

    Returns:
        float: The rounded time difference in the specified interval.
    """
    time_difference = (end_time - start_time).total_seconds()
    return time_difference / round_to


def use_backend_info_cache(backend: str, backend_lookup: Optional[Dict] = None):
    """
    Caching mechanism for looking up information about a specific backend.
    If a lookup dictionary is provided, backend info will retrieved from the database
    and cached, so it can be reused when that specific backend's information is requested
    again.
    If a lookup dictionary is not provided, it will retrieve the information from the datbase.
    """
    context = WorkflowServiceContext.get()
    backend_info = None
    if backend_lookup is None or backend not in backend_lookup:
        try:
            backend_info = connectors.Backend.fetch_from_db(context.database, backend)
        except osmo_errors.OSMOResourceError as _:
            backend_info = None
        except osmo_errors.OSMOBackendError as _:
            backend_info = None
        if backend_lookup is not None:
            backend_lookup[backend] = backend_info
    elif backend in backend_lookup:
        backend_info = backend_lookup[backend]
    return backend_info


def get_workflow_queued_time(row: Any, use_raw_row: bool = False) -> datetime.timedelta:
    # Check if workflow got canceled before starting
    if use_raw_row:
        try:
            run_time = row['start_time'] if row['start_time'] else row['end_time']
        except KeyError:
            run_time = None
    else:
        run_time = row.start_time if row.start_time else row.end_time
    # If the workflow has not started yet
    if not run_time:
        run_time = common.current_time()
    if use_raw_row:
        try:
            return run_time - row['submit_time']
        except KeyError:
            return datetime.timedelta()
    return run_time - row.submit_time


def get_workflow_duration(row: Any, use_raw_row: bool = False) -> datetime.timedelta | None:
    # Remove microseconds in response and compute the duration
    duration = None
    if use_raw_row:
        try:
            if row['start_time']:
                end_time = row['end_time'] or common.current_time()
                duration = end_time - row['start_time']
        except KeyError:
            return duration
    else:
        if row.start_time:
            end_time = row.end_time or common.current_time()
            duration = end_time - row.start_time
    return duration


def generate_grafana_url(
        pod_suffix: str,
        backend: str,
        start_time: Optional[datetime.datetime] = None,
        end_time: Optional[datetime.datetime] = None,
        backend_lookup: Optional[Dict] = None) -> Optional[str]:
    """ Generate the grafana URL for a task. """
    backend_info = use_backend_info_cache(backend, backend_lookup)

    if not backend_info:
        return None

    base_url = backend_info.grafana_url
    backend_namespace = backend_info.k8s_namespace
    if not base_url:
        return None

    end_time_url = 'now'
    end_hours = 0
    if end_time is not None and end_time + datetime.timedelta(minutes=60) < datetime.datetime.now():
        end_hours = math.floor(get_time_diff(end_time, datetime.datetime.now()))
        end_time_url =f'now-{end_hours}h'

    # If the workflow has not started or if the workflow has been running for 30 days, 1 hour
    # from the end time will be the default start time
    start_hours = 1 + end_hours
    if start_time is not None:
        calculated_start_hours = math.ceil(get_time_diff(start_time, datetime.datetime.now()))
        # If the workflow started less that 720 hours (30 days) before now,
        # use that value
        if calculated_start_hours < 720:
            start_hours = calculated_start_hours
    start_time_url = f'now-{start_hours}h'
    if '?' in base_url:
        base_url = base_url + '&'
    else:
        base_url = base_url + '?'
    return f'{base_url}var-namespace={backend_namespace}' + \
        f'&var-uuid={pod_suffix[:16]}' + \
        f'&from={start_time_url}' + \
        f'&to={end_time_url}'


def generate_dashboard_url(pod_suffix: str, backend: str,
                           backend_lookup: Optional[Dict] = None) -> Optional[str]:
    """ Generate a Kubernetes dashboard URL for a task. """
    backend_info = use_backend_info_cache(backend, backend_lookup)
    if not backend_info or not backend_info.dashboard_url:
        return None

    base_url = backend_info.dashboard_url

    return f'{base_url}/#/search?namespace={backend_info.k8s_namespace}&q={pod_suffix[:16]}'


def generate_task_dashboard_url(task_pod_name: str,
                                backend: str, backend_lookup: Optional[Dict] = None) -> \
                                    Optional[str]:
    """ Generate a Kubernetes dashboard URL for a task. """
    backend_info = use_backend_info_cache(backend, backend_lookup)

    if not backend_info or not backend_info.dashboard_url:
        return None

    base_url = backend_info.dashboard_url

    return f'{base_url}/#/pod/{backend_info.k8s_namespace}/' \
           f'{task_pod_name}?namespace={backend_info.k8s_namespace}'


def get_workflow_tags(workflow_id: str) -> List[str]:
    """ Fetches tags from a workflow """
    context = WorkflowServiceContext.get()
    fetch_cmd = '''
            SELECT tag from workflow_tags where workflow_uuid = (
                    SELECT workflow_uuid FROM workflows
                    WHERE workflow_id = %s or workflow_uuid = %s
                )
        '''
    tag_rows = context.database.execute_fetch_command(fetch_cmd, (workflow_id, workflow_id), True)
    return [tag_row['tag'] for tag_row in tag_rows]
