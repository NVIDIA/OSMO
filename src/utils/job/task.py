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

import base64
import copy
import datetime
import enum
import json
import logging
import math
import re
import secrets
import time
from typing import Any, Dict, List, Optional, Set, Tuple, Union
from urllib.parse import urlencode

import pydantic
import urllib3  # type: ignore
import yaml

from src.lib.data import constants, storage
from src.lib.utils import (cache, common, credentials, jinja_sandbox, osmo_errors,
                        priority as wf_priority)
from src.utils.job import common as task_common, kb_objects
from src.utils import auth, connectors
from src.utils.progress_check import progress


urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

OSMO_CONFIG_FILE_DIR = '/osmo/login/config'

OSMO_CONFIG_MOUNT_DIR = '/osmo'

# Path regex which does not allow: , ? " < >
PATH_REGEX = r'^([^\/\\,?\"<>|\r\n]+(\/|\\)?)+$'

REFRESH_TOKEN_LENGTH = 32

REFRESH_TOKEN_FILENAME = '.refresh_token'

GROUP_BARRIER_NAME = 'osmo-group-ready'

OSMO_PREFIX = 'osmo.'

WORKFLOW_PREFIX = 'WORKFLOW_'

# A valid list of exit codes
CODE_REGEX = r'^(\d+(-\d+)?)+(,\d+(-\d+)?)*$'


def create_login_dict(user: str,
                      url: str,
                      token: str | None = None,
                      refresh_endpoint: str | None = None) -> Dict:
    if token:
        return {
            'token_login': {
                'id_token': token,
                'refresh_url': refresh_endpoint
            },
            'url': url,
            'osmo_token': True,
            'username': user
        }

    return {
        'dev_login': {
            'username': user
        },
        'url': url
    }



def create_config_dict(data_info: Dict[str, credentials.DecryptedDataCredential],
                       cache_config: Optional[cache.CacheConfig] = None) -> Dict:
    '''
    Creates the config dict where the input should be a dict containing key values like:
    url:
        id: <id>
        key: <key>
    '''
    data = {
        'auth': {
            'data': {data_key: data_value.dict() for data_key, data_value in data_info.items()}
        }
    }
    if cache_config:
        data['cache'] = cache_config.dict()
    return data


def shorten_name_to_fit_kb(name: str) -> str:
    '''
    Shortens the name as little as possible to be within K8's character maximum and
    while not ending with a special character (hyphen or underscore).
    '''
    if len(name) <= 63:
        return name
    return name[:63].rstrip('-_')


class ExitAction(enum.Enum):
    """
    Represents the exit actions of a task and corresponding status.
    In the format of "Status = Action".
    """
    COMPLETED = 'COMPLETE'
    FAILED = 'FAIL'
    RESCHEDULED = 'RESCHEDULE'


class ExitCode(enum.Enum):
    """ Represents the service defined exit codes. """
    # A task that this task depends on failed
    FAILED_PREFLIGHT = 1001
    FAILED_UPSTREAM = 3000
    FAILED_BACKEND_ERROR = 3001
    FAILED_SERVER_ERROR = 3002
    FAILED_START_ERROR = 3003
    FAILED_EVICTED = 3004
    FAILED_START_TIMEOUT = 3005
    FAILED_PREEMPTED = 3006
    FAILED_UNKNOWN = 4000


class TaskGroupStatus(enum.Enum):
    """ Represents the status of a task group """
    # The task gone through submit but has not be read by the service worker
    SUBMITTING = 'SUBMITTING'
    # The task has not been processed by service worker yet
    WAITING = 'WAITING'
    # The task has been read by service worker but has not been read by backend worker
    PROCESSING = 'PROCESSING'
    # The task has been read by backend worker and is in the kubernetes queue
    SCHEDULING = 'SCHEDULING'
    # The task is currently being initialized
    INITIALIZING = 'INITIALIZING'
    # The task is currently being executed
    RUNNING = 'RUNNING'
    # The task has completed successfully
    COMPLETED = 'COMPLETED'
    # The task is ended from a non-finished status and a new copy of the task is rescheduled
    RESCHEDULED = 'RESCHEDULED'  # This is a task specific status. Should not be used in TaskGroup
    # The task has failed in an uncategorized way
    FAILED = 'FAILED'
    # User canceled the workflow and task had not finished
    FAILED_CANCELED = 'FAILED_CANCELED'
    # Failed due to service internal error
    FAILED_SERVER_ERROR = 'FAILED_SERVER_ERROR'
    # Failed due to some occurance in the backend cluster
    FAILED_BACKEND_ERROR = 'FAILED_BACKEND_ERROR'
    # The task ran too long
    FAILED_EXEC_TIMEOUT = 'FAILED_EXEC_TIMEOUT'
    # The task was queued too long
    FAILED_QUEUE_TIMEOUT = 'FAILED_QUEUE_TIMEOUT'
    # Failed due to image pull issues
    FAILED_IMAGE_PULL = 'FAILED_IMAGE_PULL'
    # A task that this task depends on failed
    FAILED_UPSTREAM = 'FAILED_UPSTREAM'
    # A task that failed due to eviction
    FAILED_EVICTED = 'FAILED_EVICTED'
    # A task that failed start the pod
    FAILED_START_ERROR = 'FAILED_START_ERROR'
    # A task that took too long to start the pod
    FAILED_START_TIMEOUT = 'FAILED_START_TIMEOUT'
    # The task was preempted by a higher priority task
    FAILED_PREEMPTED = 'FAILED_PREEMPTED'

    @classmethod
    def backend_states(cls):
        ''' Returns all the states for when the task is in the backend '''
        # TODO: Segment out RUNNING status into DOWNLOADING, RUNNING, and UPLOADING.
        # DOWNLOADING and UPLOADING are not included in TaskGroupStatus for now.
        return ['SCHEDULING', 'DOWNLOADING', 'RUNNING', 'UPLOADING']

    @classmethod
    def get_alive_statuses(cls) -> List['TaskGroupStatus']:
        """ Returns all the alive statuses """
        return [
            cls.SUBMITTING,
            cls.WAITING,
            cls.PROCESSING,
            cls.SCHEDULING,
            cls.INITIALIZING,
            cls.RUNNING,
            cls.RESCHEDULED,
        ]

    def finished(self) -> bool:
        """ Returns true if the task has a finished status. """
        return self.name == 'COMPLETED' or self.name == 'RESCHEDULED' or self.failed()

    def group_finished(self) -> bool:
        """
        Returns true if the group has a finished status.
        Rescheduled or restarted are considered a finished status for task, but not for group
        """
        return self.name == 'COMPLETED' or self.failed()

    def failed(self) -> bool:
        """" Returns if task has failed. """
        return self.name.startswith('FAILED')

    def prescheduling(self) -> bool:
        """ Returns true if the task has not began the scheduling process yet. """
        return self.name in ('SUBMITTING', 'WAITING', 'PROCESSING')

    def in_queue(self) -> bool:
        """ Returns true if the task hasn't begun running yet. """
        return self.name in ('SUBMITTING', 'WAITING', 'PROCESSING', 'SCHEDULING')

    def prerunning(self) -> bool:
        """ Returns true if the task hasn't begun running yet. """
        return self.in_queue() or self.name == 'INITIALIZING'

    def canceled(self) -> bool:
        """ Returns true if the status is canceled in any form. """
        return self.name in ('FAILED_CANCELED', 'FAILED_EXEC_TIMEOUT', 'FAILED_QUEUE_TIMEOUT')

    def server_errored(self) -> bool:
        """ Returns true if the status is canceled in any form. """
        return self.name in ('FAILED_SERVER_ERROR', 'FAILED_EVICTED',
                             'FAILED_START_ERROR', 'FAILED_IMAGE_PULL')

    def has_error_logs(self) -> bool:
        """ Returns true if the task should save error logs """
        return self == TaskGroupStatus.RESCHEDULED or \
            (self.failed() \
             and not self.server_errored() \
             and self != TaskGroupStatus.FAILED_UPSTREAM \
             and not self.canceled())


class TaskInputOutput(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents an input/output that is another task """
    task: task_common.TaskNamePattern
    regex: str = ''

    @pydantic.validator('regex')
    @classmethod
    def validate_regex(cls, regex: str) -> str | None:
        """
        Validates regex. Returns the value of regex if valid.

        Raises:
            ValueError: regex fails validation.
        """
        if not regex:
            return regex

        try:
            re.compile(regex)
            return regex
        except re.error as err:
            raise ValueError(f'Invalid regex: {regex}') from err

    def is_from_previous_workflow(self) -> bool:
        '''
        The task is either workflow_id:task_name or task_name.
        Therefore, if it has no second field, it is not from a previous task.
        '''
        task_name_match = re.fullmatch(task_common.TASKNAMEREGEX, self.task)
        if not task_name_match:
            raise osmo_errors.OSMOServerError(
                f'Invalid Task Input: {self.task}')
        return task_name_match.group('previous_task') is not None

    def parsed_workflow_info(self) -> Tuple[str, Optional[str]]:
        ''' Returns either (workflow_id, task_name) or (task_name, None) '''
        task_name_match = re.fullmatch(task_common.TASKNAMEREGEX, self.task)
        if not task_name_match:
            raise osmo_errors.OSMOSubmissionError(
                f'Invalid Task Input: {self.task}')
        first_field = task_name_match.group('workflow_id_or_task')
        if not first_field:
            raise osmo_errors.OSMOSubmissionError(
                f'Invalid Task Input: {self.task}')
        return first_field, task_name_match.group('previous_task')

    def __hash__(self):
        return hash((self.__class__.__name__, self.task))


class DatasetInputOutput(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents an input/output that is a dataset """
    class _Dataset(pydantic.BaseModel, extra=pydantic.Extra.forbid):
        """ Represents dataset info """
        name: str
        path: str = ''
        metadata: List[str] = []
        labels: List[str] = []
        regex: str = ''
        localpath: str | None = None

        @pydantic.validator('name')
        @classmethod
        def validate_name(cls, name: str) -> str:
            """
            Validates name. Returns the value of name if valid.

            Raises:
                ValueError: name fails validation.
            """
            try:
                common.DatasetStructure(name, workflow_spec=True)
            except osmo_errors.OSMOUserError as err:
                raise ValueError(f'Invalid name: {err}') from err
            return name

        @pydantic.validator('path')
        @classmethod
        def validate_path(cls, path: str) -> str:
            """
            Validates path. Returns the value of path if valid.

            Raises:
                ValueError: path fails validation.
            """
            try:
                re.fullmatch(PATH_REGEX, path)
            except re.error as err:
                raise ValueError(f'Invalid path: {path}') from err
            return path

        @pydantic.validator('metadata')
        @classmethod
        def validate_metadata(cls, metadata: List[str]) -> List[str]:
            """
            Validates metadata. Returns the value of metadata if valid.

            Raises:
                ValueError: metadata fails validation.
            """
            for path in metadata:
                try:
                    re.fullmatch(PATH_REGEX, path)
                except re.error as err:
                    raise ValueError(f'Invalid path: {path}') from err
            return metadata

        @pydantic.validator('labels')
        @classmethod
        def validate_labels(cls, labels: List[str]) -> List[str]:
            """
            Validates labels. Returns the value of labels if valid.

            Raises:
                ValueError: labels fails validation.
            """
            for path in labels:
                try:
                    re.fullmatch(PATH_REGEX, path)
                except re.error as err:
                    raise ValueError(f'Invalid path: {path}') from err
            return labels

        @pydantic.validator('regex')
        @classmethod
        def validate_regex(cls, regex: str) -> str | None:
            """
            Validates regex. Returns the value of regex if valid.

            Raises:
                ValueError: regex fails validation.
            """
            if not regex:
                return regex

            try:
                re.compile(regex)
                return regex
            except re.error as err:
                raise ValueError(f'Invalid regex: {regex}') from err

    dataset: _Dataset

    def __hash__(self):
        return hash((self.__class__.__name__, self.dataset.name, self.dataset.path))


class UpdateDatasetOutput(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents an input/output that is a dataset """
    class _Dataset(pydantic.BaseModel, extra=pydantic.Extra.forbid):
        """ Represents dataset info """
        name: str
        paths: List[str] = []
        metadata: List[str] = []
        labels: List[str] = []

        @pydantic.validator('name')
        @classmethod
        def validate_name(cls, name: str) -> str:
            """
            Validates name. Returns the value of name if valid.

            Raises:
                ValueError: name fails validation.
            """
            try:
                common.DatasetStructure(name, workflow_spec=True)
            except osmo_errors.OSMOUserError as err:
                raise ValueError(f'Invalid name: {err}') from err
            return name

        @pydantic.validator('paths')
        @classmethod
        def validate_paths(cls, paths: List[str]) -> List[str]:
            """
            Validates paths. Returns the value of paths if valid.

            Raises:
                ValueError: paths fails validation.
            """
            for path in paths:
                try:
                    re.fullmatch(PATH_REGEX, path)
                except re.error as err:
                    raise ValueError(f'Invalid path: {path}') from err
            return paths

        @pydantic.validator('metadata')
        @classmethod
        def validate_metadata(cls, metadata: List[str]) -> List[str]:
            """
            Validates metadata. Returns the value of metadata if valid.

            Raises:
                ValueError: metadata fails validation.
            """
            for path in metadata:
                try:
                    re.fullmatch(PATH_REGEX, path)
                except re.error as err:
                    raise ValueError(f'Invalid path: {path}') from err
            return metadata

        @pydantic.validator('labels')
        @classmethod
        def validate_labels(cls, labels: List[str]) -> List[str]:
            """
            Validates labels. Returns the value of labels if valid.

            Raises:
                ValueError: labels fails validation.
            """
            for path in labels:
                try:
                    re.fullmatch(PATH_REGEX, path)
                except re.error as err:
                    raise ValueError(f'Invalid path: {path}') from err
            return labels

    update_dataset: _Dataset

    def __hash__(self):
        return hash((self.__class__.__name__, self.update_dataset.name))


class URLInputOutput(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents a url used for input/output """
    url: str
    regex: str = ''

    @pydantic.validator('regex')
    @classmethod
    def validate_regex(cls, regex: str) -> str | None:
        """
        Validates regex. Returns the value of regex if valid.

        Raises:
            ValueError: regex fails validation.
        """
        if not regex:
            return regex

        try:
            re.compile(regex)
            return regex
        except re.error as err:
            raise ValueError(f'Invalid regex: {regex}') from err

    def __hash__(self):
        return hash((self.__class__.__name__, self.url))


# Valid inputs to a task
InputType = TaskInputOutput | DatasetInputOutput | URLInputOutput
# Valid outputs to a task
OutputType = DatasetInputOutput | URLInputOutput | UpdateDatasetOutput


class CheckpointSpec(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents a checkpoint spec """
    path: str
    url: constants.StorageBackendPattern
    frequency: datetime.timedelta
    regex: str = ''

    @pydantic.validator('frequency', pre=True)
    @classmethod
    def validate_frequency(cls, value) ->datetime.timedelta:
        if isinstance(value, (int, float)):
            return datetime.timedelta(seconds=value)
        if isinstance(value, datetime.timedelta):
            return value
        return common.to_timedelta(value)

    @pydantic.validator('regex')
    @classmethod
    def validate_regex(cls, regex: str) -> str | None:
        """
        Validates regex. Returns the value of regex if valid.

        Raises:
            ValueError: regex fails validation.
        """
        if not regex:
            return regex

        try:
            re.compile(regex)
            return regex
        except re.error as err:
            raise ValueError(f'Invalid regex: {regex}') from err


class TaskKPI(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents a KPI stored in a task """
    index: str
    path: str


class File(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Encodes text contents to uniformly support text and binary files. """
    base64: bool = False
    path: str
    contents: str

    @pydantic.validator('path')
    @classmethod
    def validate_path(cls, path: str) -> str:
        """
        Validates path. Returns the value of path if valid.

        Raises:
            ValueError: path fails validation.
        """
        # Special case where the path is for metadata
        if path.startswith(f'{kb_objects.DATA_LOCATION}/output/'):
            return path

        paths = [i for i in path.split('/') if i]
        if not paths or paths[0] == 'osmo':
            raise ValueError(f'Empty path or adding file to "/osmo" is forbidden for file: {path}')
        return path

    def encoded_contents(self) -> str:
        """ Encodes text """
        if not self.base64:
            return base64.b64encode(self.contents.encode('utf-8')).decode('utf-8')
        return self.contents


class TaskSpec(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the container spec in a task spec. """
    name: task_common.NamePattern
    image: str
    command: List[str]
    inputs: List[InputType] = []
    outputs: List[OutputType] = []
    kpis: List[TaskKPI] = []
    args: List[str] = []
    lead: bool = False
    environment: Dict[str, str] = {}
    files: List[File] = []
    privileged: bool = False
    hostNetwork: bool = False  # pylint: disable=invalid-name
    volumeMounts: List[str] = []  # pylint: disable=invalid-name
    credentials: Dict[str, Union[str, Dict[str, str]]] = {}
    downloadType: Optional[connectors.DownloadType] = None  # pylint: disable=invalid-name
    cacheSize: Optional[str] = None  # pylint: disable=invalid-name
    exitActions: Dict[str, str] = {}  # pylint: disable=invalid-name
    checkpoint: List[CheckpointSpec] = []
    resources: connectors.ResourceSpec = connectors.ResourceSpec()
    backend: str = ''
    # A simplified resource representation in the workflow spec
    resource: str = 'default'

    @pydantic.validator('downloadType', pre=True)
    @classmethod
    def validate_download_type(cls, download_type: Optional[Union[str, connectors.DownloadType]],
        values: Dict) -> Optional[connectors.DownloadType]:
        """
        Validates downloadType. Converts string values to DownloadType enum.

        Raises:
            ValueError: downloadType is not supported.
        """
        if download_type is None:
            return None
        name = values.get('name', '')
        if isinstance(download_type, connectors.DownloadType):
            return download_type
        if isinstance(download_type, str):
            for enum_member in connectors.DownloadType:
                if enum_member.value == download_type:
                    return enum_member
            valid_types = [dt.value for dt in connectors.DownloadType]
            raise ValueError(f'Task "{name}" uses invalid downloadType "{download_type}". '
                           f'Valid types are: {valid_types}')


    @pydantic.validator('name')
    @classmethod
    def validate_name(cls, name: task_common.NamePattern) -> task_common.NamePattern:
        """
        Validates name. Returns the value of name if valid.

        Raises:
            ValueError: Containers fails validation.
        """
        if kb_objects.k8s_name(shorten_name_to_fit_kb(name)) == 'osmo-ctrl':
            raise ValueError(f'Container {name} cannot be named "osmo-ctrl". '
                             'This is a restricted name.')
        return name

    @pydantic.validator('command')
    @classmethod
    def validate_command(cls, command: List[str], values: Dict) -> List[str]:
        """
        Validates command. Returns the value of command if valid.

        Raises:
            ValueError: Containers fails validation.
        """
        name = values.get('name', '')
        if not command:
            raise ValueError(f'Container {name} should have at least one command.')
        return command

    @pydantic.validator('files')
    @classmethod
    def validate_files(cls, files: List[File], values: Dict) -> List[File]:
        """
        Validates that all file paths are unique. Returns the list if valid

        Raises:
            ValueError: There are duplicate file paths
        """
        name = values.get('name', '')
        all_paths: Set[str] = set()
        for file in files:
            if file.path in all_paths:
                raise ValueError(
                    f'Task "{name}" has multiple files at the same path "{file.path}". ' +
                    'Each file path must be unique.')
            all_paths.add(file.path)
        return files

    def propagate_resource_values(self, resources: Dict[str, connectors.ResourceSpec]):
        resource_spec = resources.get(self.resource, None)
        if not resource_spec:
            if self.resource == 'default':
                raise osmo_errors.OSMOResourceError(
                    f'Task {self.name} has no specified resource. '
                    f'Specify a {self.resource} resource in the resources section.')
            raise osmo_errors.OSMOResourceError(
                f'Requesting undefined resource {self.resource}.')
        self.resources = resource_spec

    @pydantic.validator('exitActions')
    @classmethod
    def validate_exit_actions(cls, exit_actions: Dict[str, str], values: Dict) -> Dict[str, str]:
        name = values.get('name', '')
        regex = re.compile(CODE_REGEX)
        for key, value in exit_actions.items():
            try:
                ExitAction(key.upper())   # Check if key is an instance of ExitAction
            except ValueError as err:
                raise ValueError(f'Invalid exit action {key} for task {name}.') from err
            if not regex.fullmatch(value):
                raise ValueError(
                    f'Invalid exit codes {value} for action {key} for task {name}.')
        return exit_actions

    def validate_privilege_host_mount(self, platforms: Dict[str, connectors.Platform]):
        """
        Validates privilege and host network based on target platform.
        Validates if the volumeMounts in the task spec are allowed based on default
        and allowed mounts defined in the platform.

        Raises:
            OSMOUserError: Task fails validation.
        """
        if self.privileged or self.hostNetwork or self.volumeMounts:
            if not self.resources.platform:
                raise osmo_errors.OSMOResourceError(
                    f'Task {self.name} does not have a platform!')
            task_platform = platforms[self.resources.platform]
            if self.privileged and not task_platform.privileged_allowed:
                raise osmo_errors.OSMOResourceError(
                    f'Task with platform: {self.resources.platform} does not have ' +
                    f'privileged flag enabled. Task {self.name}')
            if self.hostNetwork and not task_platform.host_network_allowed:
                raise osmo_errors.OSMOResourceError(
                    f'Task with platform: {self.resources.platform} does not have ' +
                    f'hostNetwork flag enabled. Task {self.name}')
            for task_mount in self.volumeMounts:
                split_mount = task_mount.split(':')
                src_mount = split_mount[0]
                if len(split_mount) > 2 or \
                    (len(split_mount) == 2 and split_mount[1] == ''):
                    raise osmo_errors.OSMOResourceError(
                        f'Invalid task volume mount: {task_mount}.')
                task_platform_mounts = \
                    set(task_platform.allowed_mounts).union(set(task_platform.default_mounts))
                if src_mount not in task_platform_mounts:
                    raise osmo_errors.OSMOResourceError(
                        f'Task with platform: {self.resources.platform} does not allow ' +
                        f'mount: {src_mount}. Task {self.name}')

    def get_filemounts(self, group_uid: str,
                       k8s_factory: kb_objects.K8sObjectFactory) -> List[kb_objects.FileMount]:
        return [
            kb_objects.FileMount(
                group_uid=group_uid, path=file.path, content=file.encoded_contents(),
                k8s_factory=k8s_factory)
            for file in self.files
        ]

    def get_resource_from_spec(self, resource: Dict[str, Any],
                               request_label: str, unit: Optional[str]):
        """ Helper function to parse resource from resource spec dictionary. """
        return resource.get(request_label) if unit \
            else resource.get(request_label, {}).get('count', None)

    def to_pod_resource_spec(self, resource: connectors.ResourceSpec) -> Dict:
        """ Convert the resource spec from WorkflowSpec to the K8 pod resource spec. """
        resource_spec = resource.dict()
        pod_resource_spec = {}
        for resource_type in common.ALLOCATABLE_RESOURCES_LABELS:
            resource = self.get_resource_from_spec(
                resource_spec, resource_type.name, resource_type.unit)
            if resource:
                pod_resource_spec[resource_type.kube_label] = resource
        if 'nvidia.com/gpu' in pod_resource_spec and pod_resource_spec['nvidia.com/gpu'] == '0':
            del pod_resource_spec['nvidia.com/gpu']
        return pod_resource_spec

    def to_pod_container(self, user_args: List[str],
                         files: List[kb_objects.FileMount],
                         mounts: List[kb_objects.HostMount],
                         user_secrets_name: str,
                         config_dir_secret_name: str,
                         using_gpu: bool = False) -> Dict:
        """
        Converts to k8s pod container.

        Args:
            user_args (List[str]): args contains workflow info.
            files (List[kb_objects.FileMount]): FileMounts.
            default_resources (Dict): The default resource spec to use.
            mounts (List[kb_objects.FileMount]): HostMounts.
            user_secrets_name (str): Name of user secrets.

        Returns:
            Dict: Pod container spec.
        """
        container: Dict = {
            'imagePullPolicy': 'Always',
            'name': kb_objects.k8s_name(shorten_name_to_fit_kb(self.name)),
            'image': self.image,
            'volumeMounts': [{'name': 'osmo', 'mountPath': '/osmo/bin/osmo_exec',
                              'subPath': 'osmo/osmo_exec', 'readOnly': True},
                             {'name': 'osmo-data', 'mountPath': kb_objects.DATA_LOCATION +
                              '/socket', 'subPath': 'socket'},
                             {'name': 'osmo-data', 'mountPath': kb_objects.DATA_LOCATION +
                              '/input', 'subPath': 'input',
                              'mountPropagation': 'HostToContainer'},
                             {'name': 'osmo-data', 'mountPath': kb_objects.DATA_LOCATION +
                              '/output', 'subPath': 'output'},
                             {'name': 'osmo-data', 'mountPath': kb_objects.DATA_LOCATION +
                              '/benchmarks', 'subPath': 'benchmarks'},
                             {'name': 'osmo-login', 'mountPath': task_common.LOGIN_LOCATION +
                              '/config', 'subPath': 'user/config'},
                             {'name': 'osmo-usr-bin',
                              'mountPath': task_common.USER_BIN_LOCATION,
                              'readOnly': True},
                             {'name': 'osmo-run',
                              'mountPath': task_common.RUN_LOCATION}
                              ],
            'command': ['/osmo/bin/osmo_exec'],
            'args': user_args,
            'securityContext': {
                'privileged': self.privileged
            },
        }

        for i in self.command:
            container['args'] += ['-commands', i]
        for i in self.args:
            container['args'] += ['-args', i]

        container['env'] = []
        for key, value in self.environment.items():
            container['env'].append({'name': key, 'value': value})
        cred_envs = {k: v for k, v in self.credentials.items() if isinstance(v, Dict)}
        merged_cred_envs = {k: v for subdict in cred_envs.values() for k, v in subdict.items()}
        for cred_env, cred_key in merged_cred_envs.items():
            env_var = {
                'name': cred_env,
                'valueFrom': {'secretKeyRef': {'name': user_secrets_name, 'key': cred_key}}
            }
            container['env'].append(env_var)
        container['env'].append({
            'name': common.OSMO_CONFIG_OVERRIDE,
            'valueFrom': {
                'secretKeyRef': {
                    'name': config_dir_secret_name,
                    'key': 'fileDir'
                }
            }
        })

        # Override this environment variable if GPU is set to 0
        if not using_gpu:
            container['env'].append({
                'name': 'NVIDIA_VISIBLE_DEVICES',
                'value': ''
            })

        if files:
            container['volumeMounts'] += [file.volume_mount() for file in files]

        if mounts:
            container['volumeMounts'] += [mount.volume_mount() for mount in mounts]

        return container

    def parse(self, workflow_id: str, host_tokens: Dict[str, str]) -> 'TaskSpec':
        """
        Substitutes osmo tokens with real values.
        """
        input_token = f'{kb_objects.DATA_LOCATION}/input'
        output_token = f'{kb_objects.DATA_LOCATION}/output'

        tokens = {
            'workflow_id': workflow_id,
            'output': output_token,
        }
        tokens.update(host_tokens)

        for index, input_source in enumerate(self.inputs):
            if isinstance(input_source, TaskInputOutput):
                first_field, second_field = input_source.parsed_workflow_info()
                source = first_field if not second_field else second_field
                tokens[f'input:{source}'] = f'{input_token}/{index}'
                tokens[f'input:{index}'] = f'{input_token}/{index}'
            elif isinstance(input_source, (DatasetInputOutput, URLInputOutput)):
                tokens[f'input:{index}'] = f'{input_token}/{index}'
            else:
                raise osmo_errors.OSMOUsageError('Unknown Input Type')

        parsed_json = self.json()
        for key, value in tokens.items():
            parsed_json = re.sub('{{[ ]*' + key + '[ ]*}}', value, parsed_json)

        return TaskSpec(**json.loads(parsed_json))

    def saved_spec(self) -> Dict:
        base_spec = self.dict(exclude_defaults=True)
        if 'resources' in base_spec:
            del base_spec['resources']
        if 'backend' in base_spec:
            del base_spec['backend']
        return base_spec


class TaskGroupSpec(pydantic.BaseModel):
    """ Represents a task group """
    name: task_common.NamePattern
    barrier: bool = True
    ignoreNonleadStatus: bool = True  # pylint: disable=invalid-name
    tasks: List[TaskSpec]

    class Config:
        use_enum_values = True
        extra = 'forbid'

    @property
    def inputs(self) -> List[InputType]:
        inputs: Set[InputType] = set()
        for task in self.tasks:
            inputs |= set(task.inputs)
        return list(inputs)

    @pydantic.validator('tasks')
    @classmethod
    def validate_tasks(cls, value: List[TaskSpec], values: Dict) -> List[TaskSpec]:
        """
        Validates tasks. Returns the value of tasks if valid.

        Raises:
            ValueError: Containers fails validation.
        """
        group_name = values['name']

        # Need at least one task
        if not value:
            raise ValueError(
                f'Group \"{group_name}\" needs to have at least one task.')

        # Make sure there is one lead task.
        if len(value) == 1:
            value[0].lead = True
        num_leaders = sum(1 for task in value if task.lead)
        if num_leaders != 1:
            raise ValueError(
                f'Group \"{group_name}\" has {num_leaders} leader(s) but must have exactly one.')

        return value

    def has_group_barrier(self) -> bool:
        """ Return if group barrier is used. """
        return len(self.tasks) > 1 and self.barrier


    def initialize_group_tasks(
            self, group_and_task_uuids: Dict[str, common.UuidPattern],
            resources: Dict[str, connectors.ResourceSpec]) -> 'TaskGroupSpec':
        """
        Initialize group tasks with unique uuids and propagate resource values.
        """
        group_uuid = common.generate_unique_id()
        group_and_task_uuids[self.name] = group_uuid
        for current_task in self.tasks:
            task_uuid = common.generate_unique_id()
            group_and_task_uuids[current_task.name] = task_uuid
            current_task.propagate_resource_values(resources)

        return TaskGroupSpec(
            name=self.name,
            barrier=self.barrier,
            ignoreNonleadStatus=self.ignoreNonleadStatus,
            tasks=self.tasks)


    def parse(self, database: connectors.PostgresConnector,
              workflow_id: str, group_and_task_uuids: Dict[str, common.UuidPattern]) \
                -> 'TaskGroupSpec':
        """
        Substitutes osmo tokens with real values.
        """
        backend = connectors.Backend.fetch_from_db(database, self.tasks[0].backend)
        namespace = backend.k8s_namespace
        group_uuid = group_and_task_uuids[self.name]

        # To create a valid subdomain name for the group, we need to prepend alphabetical character
        suffix = f'{common.get_group_subdomain_name(group_uuid)}.{namespace}.svc.cluster.local'
        tokens = {}
        for current_task in self.tasks:
            task_uuid = group_and_task_uuids[current_task.name]
            tokens[f'host:{current_task.name}'] = f'{task_uuid}.{suffix}'

        tasks = [current_task.parse(workflow_id, tokens)
                 for current_task in self.tasks]

        return TaskGroupSpec(
            name=self.name,
            barrier=self.barrier,
            ignoreNonleadStatus=self.ignoreNonleadStatus,
            tasks=tasks)

    def saved_spec(self) -> Dict:
        base_spec = self.dict(exclude_defaults=True)
        base_spec['tasks'] = [task.saved_spec() for task in self.tasks]
        return base_spec


class TaskGroupMetrics(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """  Represents metrics submitted by each user task in a workflow
    """
    retry_id: int = 0
    type_of_metrics: str
    start_time: datetime.datetime
    end_time: datetime.datetime


class Task(pydantic.BaseModel):
    """ Represents the task object . """
    workflow_id_internal: task_common.NamePattern | None = None
    workflow_uuid: str
    name: task_common.NamePattern
    group_name: task_common.NamePattern
    task_uuid: common.UuidPattern
    task_db_key: common.UuidPattern
    retry_id: int = 0
    status: TaskGroupStatus = TaskGroupStatus.WAITING
    start_time: datetime.datetime | None = None
    end_time: datetime.datetime | None = None
    failure_message: str | None = None
    database: connectors.PostgresConnector
    exit_actions: Dict[str, str]
    node_name: str | None
    pod_ip: str | None
    lead: bool

    class Config:
        arbitrary_types_allowed = True

    def insert_to_db(self, gpu_count: float, cpu_count: float, disk_count: float,
                     memory_count: float, status: TaskGroupStatus = TaskGroupStatus.WAITING,
                     failure_message: str | None = None):
        """ Creates an entry in the database for the task. """
        insert_cmd = '''
            INSERT INTO tasks
            (workflow_id, name, group_name, task_db_key, retry_id, task_uuid, status, pod_name,
             failure_message, gpu_count, cpu_count, disk_count, memory_count, exit_actions, lead)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING;
        '''
        workflow_uuid = self.workflow_uuid if self.workflow_uuid else ''
        self.database.execute_commit_command(
            insert_cmd,
            (self.workflow_id_internal, self.name, self.group_name, self.task_db_key,
             self.retry_id, self.task_uuid, status.name,
             kb_objects.construct_pod_name(workflow_uuid, self.task_uuid),
             failure_message, gpu_count, cpu_count,
             disk_count, memory_count,
             json.dumps(self.exit_actions, default=common.pydantic_encoder),
             self.lead))

    @property
    def workflow_id(self) -> str:
        if self.workflow_id_internal:
            return self.workflow_id_internal

        fetch_cmd = 'SELECT workflow_id FROM tasks WHERE task_uuid = %s'
        task_info = self.database.execute_fetch_command(
            fetch_cmd, (self.task_uuid,), True)
        try:
            fetched_workflow_id: str = task_info[0]['workflow_id']
            self.workflow_id_internal = fetched_workflow_id
        except IndexError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Task with UUID {self.task_uuid} with name {self.name} needs to '
                'be inserted in the database first.') from err
        return fetched_workflow_id


    def add_refresh_token_to_db(self, refresh_token: str):
        """ Hash and store refresh token in the database. """
        # Hash the refresh token
        hashed_token = auth.hash_access_token(refresh_token)

        update_cmd = '''
            UPDATE tasks SET refresh_token = %s
            WHERE task_db_key = %s;
        '''

        # Database write
        self.database.execute_commit_command(
            update_cmd,
            (hashed_token, self.task_db_key))

    @classmethod
    def from_db_row(cls, task_row, database) -> 'Task':
        return Task(workflow_id=task_row['workflow_id'],
                    workflow_uuid=task_row['workflow_uuid'],
                    name=task_row['name'], group_name=task_row['group_name'],
                    task_uuid=task_row['task_uuid'],
                    task_db_key=task_row['task_db_key'],
                    retry_id=task_row['retry_id'],
                    status=task_row['status'], start_time=task_row['start_time'],
                    end_time=task_row['end_time'],
                    failure_message=task_row['failure_message'],
                    database=database,
                    exit_actions=task_row['exit_actions'],
                    node_name=task_row['node_name'],
                    lead=task_row['lead'])

    @classmethod
    def fetch_row_from_db(cls, database: connectors.PostgresConnector,
                          workflow_id: task_common.NamePattern,
                          name: task_common.NamePattern,
                          retry_id: int = -1) -> Dict:
        """
        Fetches the raw row from the database.

        Args:
            database (PostgresConnector): The database.
            workflow_id (NamePattern): The workflow id.
            name (NamePattern): The task name.
            retry_id (int): The retry_id. -1 means the latest retry.

        Returns:
            The raw row from the database.
        """
        fetch_cmd = '''
            SELECT tasks.*, workflows.workflow_uuid
            FROM tasks
            JOIN workflows ON tasks.workflow_id = workflows.workflow_id
            WHERE tasks.workflow_id = %s AND tasks.name = %s
            ORDER BY retry_id ASC;
        '''
        task_rows = database.execute_fetch_command(fetch_cmd, (workflow_id, name), True)

        try:
            return task_rows[retry_id]
        except IndexError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Task {name} of workflow {workflow_id} is not found.') from err

    @classmethod
    def fetch_from_db(cls, database: connectors.PostgresConnector,
                      workflow_id: task_common.NamePattern,
                      name: task_common.NamePattern,
                      retry_id: int = -1) -> 'Task':
        """
        Creates a Task instance from a database task entry.

        Args:
            workflow_id (NamePattern): The workflow id.
            name (NamePattern): The task name.
            retry_id (int): The retry_id. -1 means the latest retry.

        Raises:
            OSMODatabaseError: The task is not found in the database.

        Returns:
            Task: The task.
        """
        task_row = cls.fetch_row_from_db(database, workflow_id, name, retry_id)
        return cls.from_db_row(task_row, database)

    @classmethod
    def fetch_group_name(cls, database: connectors.PostgresConnector,
                         workflow_id: task_common.NamePattern,
                         name: task_common.NamePattern) -> str:
        """
        Get the group name from a database task entry.

        Args:
            workflow_id (NamePattern): The workflow id.
            name (NamePattern): The task name.

        Raises:
            OSMODatabaseError: The task is not found in the database.

        Returns:
            The group name.
        """
        fetch_cmd = 'SELECT group_name FROM tasks WHERE workflow_id = %s AND name = %s;'
        rows = database.execute_fetch_command(fetch_cmd, (workflow_id, name), True)
        try:
            group_name = rows[0]['group_name']
        except (IndexError, KeyError) as err:
            raise osmo_errors.OSMODatabaseError(
                f'Task {name} of workflow {workflow_id} is not found.') from err
        return group_name

    @classmethod
    def fetch_from_db_from_uuid(cls, database: connectors.PostgresConnector,
                                workflow_uuid: task_common.NamePattern,
                                task_uuid: common.UuidPattern,
                                retry_id: int = -1) -> 'Task':
        """
        Creates a Task instance from a database task entry.

        Args:
            workflow_uuid (NamePattern): The workflow uuid.
            task_uuid (NamePattern): The task uuid.
            retry_id (int): The retry_id. -1 means the latest retry.

        Raises:
            OSMODatabaseError: The task is not found in the database.

        Returns:
            Task: The task.
        """
        fetch_cmd = '''
            SELECT tasks.*, workflows.workflow_uuid
            FROM tasks
            JOIN workflows ON tasks.workflow_id = workflows.workflow_id
            WHERE workflows.workflow_uuid = %s AND tasks.task_uuid = %s
            ORDER BY retry_id ASC;
        '''
        task_rows = database.execute_fetch_command(fetch_cmd, (workflow_uuid, task_uuid), True)
        try:
            task_row = task_rows[retry_id]
        except IndexError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Task UUID {task_uuid} of workflow UUID {workflow_uuid} is not found.') from err
        return cls.from_db_row(task_row, database)

    @classmethod
    def list_task_rows_by_group_name(cls, database: connectors.PostgresConnector,
                                     workflow_id: task_common.NamePattern,
                                     group_name: task_common.NamePattern,
                                     verbose: bool = False, sort: bool = False) -> List:
        """
        Creates a list of task rows from a database task entry.

        Args:
            workflow_id (NamePattern): The workflow id.
            group_name (NamePattern): The group name.
            verbose (bool): Whether to list all retries.
            sort (bool): Whether to sort tasks

        Raises:
            OSMODatabaseError: No tasks were found in the database.

        Returns:
            List: The task database rows.
        """
        if verbose:
            fetch_cmd = f'''
                SELECT tasks.*, workflows.workflow_uuid
                FROM tasks
                JOIN workflows ON tasks.workflow_id = workflows.workflow_id
                WHERE tasks.workflow_id = %s AND tasks.group_name = %s
                {'ORDER BY name ASC, retry_id DESC' if sort else ''};
            '''
            task_rows = database.execute_fetch_command(fetch_cmd, (workflow_id, group_name), True)
        else:
            fetch_cmd = f'''
                SELECT t.*, workflows.workflow_uuid FROM tasks t
                JOIN workflows ON t.workflow_id = workflows.workflow_id
                WHERE t.workflow_id = %s AND t.group_name = %s
                    AND retry_id = (
                        SELECT MAX(retry_id) FROM tasks
                        WHERE name = t.name AND workflow_id = %s AND group_name = %s
                    )
                {'ORDER BY name ASC' if sort else ''};
            '''
            task_rows = database.execute_fetch_command(
                fetch_cmd, (workflow_id, group_name, workflow_id, group_name), True)

        if not task_rows:
            raise osmo_errors.OSMODatabaseError(
                f'No tasks were found for {group_name} of workflow '\
                f'{workflow_id} is not found.')

        return task_rows

    @classmethod
    def list_by_group_name(cls, database: connectors.PostgresConnector,
                           workflow_id: task_common.NamePattern,
                           group_name: task_common.NamePattern,
                           verbose: bool = False) -> List['Task']:
        task_rows = Task.list_task_rows_by_group_name(database, workflow_id, group_name, verbose)
        return [cls.from_db_row(task_row, database) for task_row in task_rows]

    def update_status_to_db(self, update_time: datetime.datetime, status: TaskGroupStatus,
                            message: str, exit_code: int | None = None):
        """
        Updates task status in the database.

        Args:
            update_time (datetime.datetime): Time of the update.
            status (ContainerStatus): The status to update.
            message (str): Any error message from the container.
        """
        if self.status.finished() or self.status == status:
            return

        # New status is either running or finished
        # Only update start_time when it hasnt started
        update_cmd = connectors.PostgresUpdateCommand(table='tasks')
        update_cmd.add_condition('task_db_key = %s', [self.task_db_key])
        if status == TaskGroupStatus.PROCESSING:
            update_cmd.add_condition('processing_start_time IS NULL', [])
            update_cmd.add_condition("status IN ('WAITING')", [])
            update_cmd.add_field('processing_start_time', update_time)
        elif status == TaskGroupStatus.SCHEDULING:
            update_cmd.add_condition('scheduling_start_time IS NULL', [])
            update_cmd.add_condition("status IN ('PROCESSING', 'WAITING')", [])
            update_cmd.add_field('scheduling_start_time', update_time)
        elif status == TaskGroupStatus.INITIALIZING:
            update_cmd.add_condition('initializing_start_time IS NULL', [])
            update_cmd.add_condition(
                "status IN ('WAITING','PROCESSING', 'SCHEDULING')", [])
            update_cmd.add_field('initializing_start_time', update_time)
        elif status == TaskGroupStatus.RUNNING:
            update_cmd.add_condition('start_time IS NULL', [])
            update_cmd.add_condition(
                "status IN ('WAITING', 'PROCESSING', 'SCHEDULING', 'INITIALIZING')",
                [])
            update_cmd.add_field('start_time', update_time)
        elif status.finished():
            update_cmd.add_condition('end_time IS NULL', [])
            if status == TaskGroupStatus.FAILED_START_TIMEOUT:
                update_cmd.add_condition(
                    "status IN ('WAITING', 'PROCESSING', 'SCHEDULING', "
                    "'INITIALIZING')", [])
            else:
                update_cmd.add_condition(
                    "status IN ('WAITING', 'PROCESSING', 'SCHEDULING', "\
                    "'INITIALIZING', 'RUNNING')",
                    [])
            update_cmd.add_field('end_time', update_time)
            if exit_code is not None:
                update_cmd.add_field('exit_code', exit_code)
            if message:
                update_cmd.add_field('failure_message', message)
        update_cmd.add_field('status', status.name)
        self.database.execute_commit_command(*update_cmd.get_args())

    def create_new(self) -> 'Task':
        """ Creates an new Task from the existing one. """
        return Task(workflow_id_internal=self.workflow_id,
                    workflow_uuid=self.workflow_uuid,
                    name=self.name,
                    group_name=self.group_name,
                    task_uuid=self.task_uuid,
                    task_db_key=common.generate_unique_id(),
                    retry_id=self.retry_id + 1,
                    database=self.database,
                    exit_actions=self.exit_actions,
                    lead=self.lead)

def substitute_pod_template_tokens(pod_template: Dict, tokens: Dict[str, Any]):
    keys_to_delete = []
    def replace_helper(value, tokens):
        try:
            rendered_str = jinja_sandbox.sandboxed_jinja_substitute(value, tokens)
            # Match for special array string
            match = re.fullmatch(r'^ARRAY:\[(.*)\]$', rendered_str)
            if match:
                array_content = match.group(1)
                # Convert that string into an array
                return array_content.split(',')
            else:
                return rendered_str
        except jinja_sandbox.exceptions.TemplateSyntaxError as e:
            raise osmo_errors.OSMOSchemaError(
                f'In configs, key "{key}" has invalid template value "{value}", '
                f'with error: {e}')

    for key, value in pod_template.items():
        if isinstance(value, dict):
            substitute_pod_template_tokens(value, tokens)
        elif isinstance(value, List):
            for i, list_item in enumerate(value):
                if isinstance(list_item, dict):
                    substitute_pod_template_tokens(list_item, tokens)
                elif not isinstance(pod_template[key], bool):
                    value[i] = replace_helper(value[i], tokens)
        else:
            if isinstance(pod_template[key], str):
                replaced_value = replace_helper(pod_template[key], tokens)
                if replaced_value is not None:
                    pod_template[key] = replaced_value
                else:
                    keys_to_delete.append(key)

    for key in keys_to_delete:
        del pod_template[key]

def apply_pod_template(pod: Dict, pod_override: Dict):
    return common.recursive_dict_update(pod, pod_override, common.merge_lists_on_name)


class TaskGroup(pydantic.BaseModel):
    """ Represents the group object . """
    # pylint: disable=pointless-string-statement
    workflow_id_internal: task_common.NamePattern | None = None
    name: task_common.NamePattern
    group_uuid: common.UuidPattern
    spec: TaskGroupSpec
    tasks: List[Task]
    remaining_upstream_groups: Set[str]
    downstream_groups: Set[str]
    failure_message: str | None = None
    database: connectors.PostgresConnector
    processing_start_time: datetime.datetime | None = None
    scheduling_start_time: datetime.datetime | None = None
    initializing_start_time: datetime.datetime | None = None
    start_time: datetime.datetime | None = None
    end_time: datetime.datetime | None = None
    status: TaskGroupStatus = TaskGroupStatus.SUBMITTING
    # This is set when the task group is queued into the backends
    scheduler_settings: connectors.BackendSchedulerSettings | None = None

    class Config:
        arbitrary_types_allowed = True
        extra = 'forbid'

    def insert_to_db(self, status: TaskGroupStatus = TaskGroupStatus.SUBMITTING,
                     failure_message: str | None = None):
        """ Creates an entry in the database for the group. """
        spec = self.spec.json()
        insert_cmd = '''
            INSERT INTO groups
            (workflow_id, name, group_uuid, spec, status, failure_message,
             remaining_upstream_groups, downstream_groups, cleaned_up, scheduler_settings)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, FALSE, %s) ON CONFLICT DO NOTHING;
        '''
        self.database.execute_commit_command(
            insert_cmd,
            (self.workflow_id_internal, self.name, self.group_uuid, spec, status.name,
             failure_message,
             _encode_hstore(self.remaining_upstream_groups),
             _encode_hstore(self.downstream_groups),
             self.scheduler_settings.json() if self.scheduler_settings else None))

    @property
    def workflow_id(self) -> str:
        if self.workflow_id_internal:
            return self.workflow_id_internal

        fetch_cmd = 'SELECT workflow_id FROM groups where group_uuid = %s'
        workflow_info = self.database.execute_fetch_command(fetch_cmd,
                                                            (self.group_uuid,), True)
        try:
            fetched_workflow_id: str = workflow_info[0]['workflow_id']
            self.workflow_id_internal = fetched_workflow_id
        except IndexError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Group with UUID {self.group_uuid} needs to '
                'be inserted in the database first.') from err
        return fetched_workflow_id

    @classmethod
    def from_db_row(cls, group_row, database, verbose: bool = False) -> 'TaskGroup':
        """
        Gets TaskGroup from DB row

        Args:
            verbose (bool, optional): Whether to include rescheduled/restarted tasks.
        """
        remaining_upstream_groups = set()
        if group_row.remaining_upstream_groups:
            remaining_upstream_groups = decode_hstore(group_row.remaining_upstream_groups)
        downstream_groups = set()
        if group_row.downstream_groups:
            downstream_groups = decode_hstore(group_row.downstream_groups)

        tasks = Task.list_by_group_name(database, group_row.workflow_id, group_row.name, verbose)

        scheduler_settings: connectors.BackendSchedulerSettings | None = None
        if group_row.scheduler_settings:
            scheduler_settings = connectors.BackendSchedulerSettings(
                **json.loads(group_row.scheduler_settings))

        return TaskGroup(workflow_id_internal=group_row.workflow_id,
                         name=group_row.name, group_uuid=group_row.group_uuid,
                         spec=TaskGroupSpec(**group_row.spec), tasks=tasks,
                         remaining_upstream_groups=remaining_upstream_groups,
                         downstream_groups=downstream_groups,
                         start_time=group_row.start_time, end_time=group_row.end_time,
                         processing_start_time=group_row.processing_start_time,
                         scheduling_start_time=group_row.scheduling_start_time,
                         initializing_start_time=group_row.initializing_start_time,
                         status=group_row.status, database=database,
                         scheduler_settings=scheduler_settings)

    @classmethod
    def fetch_from_db(cls, database: connectors.PostgresConnector,
                      workflow_id: task_common.NamePattern,
                      name: task_common.NamePattern, verbose: bool = False) -> 'TaskGroup':
        """
        Creates a Task instance from a database task entry.

        Args:
            workflow_id (NamePattern): The workflow id.
            name (NamePattern): The group name.

        Raises:
            OSMODatabaseError: The task is not found in the database.

        Returns:
            Task: The task.
        """
        fetch_cmd = 'SELECT * FROM groups WHERE workflow_id = %s AND name = %s;'
        group_rows = database.execute_fetch_command(fetch_cmd, (workflow_id, name))
        try:
            group_row = group_rows[0]
        except IndexError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Group {name} of workflow {workflow_id} is not found.') from err
        return cls.from_db_row(group_row, database, verbose)

    @classmethod
    def fetch_active_group_size(cls, database: connectors.PostgresConnector,
                                workflow_id: task_common.NamePattern,
                                name: task_common.NamePattern) -> int:
        """
        Get the number of tasks that are in non-finished status.

        Args:
            workflow_id (NamePattern): The workflow id.
            name (NamePattern): The group name.

        Raises:
            OSMODatabaseError: The group is not found in the database.

        Returns:
            The group size.
        """
        fetch_cmd = '''
            SELECT t.status FROM tasks t
            WHERE workflow_id = %s AND group_name = %s
                AND retry_id = (
                    SELECT MAX(retry_id) FROM tasks
                    WHERE name = t.name AND workflow_id = %s AND group_name = %s
                );
        '''
        rows = database.execute_fetch_command(
            fetch_cmd, (workflow_id, name, workflow_id, name), True)
        if len(rows) == 0:
            raise osmo_errors.OSMODatabaseError(
                f'Group {name} of workflow {workflow_id} is not found.')
        try:
            status = [TaskGroupStatus[x['status']] for x in rows]
            size = len([x for x in status if not x.group_finished()])
        except KeyError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Tasks for group {name} of workflow {workflow_id} has status missing.') from err
        return size

    @classmethod
    def fetch_task_secrets(cls, database: connectors.PostgresConnector,
                           workflow_id: task_common.NamePattern,
                           task_name: task_common.NamePattern,
                           user: str, retry_id: int) -> Set:
        """
        Creates a Task instance from a database task entry.

        Args:
            workflow_id (NamePattern): The workflow id.
            task_name (NamePattern): The task name.

        Raises:
            OSMODatabaseError: The task is not found in the database.

        Returns:
            Set of secret values
        """

        fetch_cmd = '''
            SELECT spec FROM groups
            WHERE workflow_id = %s
            AND name = (SELECT group_name from tasks
                        where workflow_id = %s and name = %s and retry_id = %s);
        '''
        group_rows = database.execute_fetch_command(fetch_cmd,
                                                    (workflow_id, workflow_id, task_name, retry_id))
        try:
            group_row = group_rows[0]
        except IndexError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Task {task_name} of workflow {workflow_id} is not found.') from err

        # Fetch Task Spec
        task_creds = None
        for task_spec in TaskGroupSpec(**group_row.spec).tasks:
            if task_spec.name == task_name:
                task_creds = task_spec.credentials
                break
        if task_creds is None:
            logging.exception('Could not find task %s', task_name)
            task_creds = {}
        # Fetch all the creds used for this task
        task_cred_values: Set[str] = set()
        for cred_key, cred_values in task_creds.items():
            key_info = database.get_generic_cred(user, cred_key)
            if isinstance(cred_values, str):
                # user is using file so track all the values
                for value in key_info.values():
                    if len(value) < 8:
                        continue
                    task_cred_values.add(value)
            elif isinstance(cred_values, Dict):
                # user is using specific cred
                for cred_value in cred_values.values():
                    if cred_value not in key_info.keys() or len(key_info[cred_value]) < 8:
                        continue
                    task_cred_values.add(key_info[cred_value])
        return task_cred_values

    @classmethod
    def fetch_task_secrets_uuid(cls, database: connectors.PostgresConnector,
                                workflow_id: task_common.NamePattern,
                                task_uuid: task_common.NamePattern,
                                user: str, retry_id: int) -> Set:
        """
        Creates a Task instance from a database task entry.

        Args:
            workflow_id (NamePattern): The workflow id.
            task_uuid (NamePattern): The task name.

        Raises:
            OSMODatabaseError: The task is not found in the database.

        Returns:
            Set of secret values
        """

        fetch_cmd = '''
            SELECT groups.spec, tasks.name FROM tasks INNER JOIN groups
            ON tasks.workflow_id = groups.workflow_id
            WHERE task_uuid = %s and retry_id = %s;
        '''
        task_rows = database.execute_fetch_command(fetch_cmd,
                                                   (task_uuid, retry_id))
        try:
            task_row = task_rows[0]
        except IndexError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Task {task_uuid} of workflow {workflow_id} is not found.') from err

        # Fetch Task Spec
        task_creds = None
        for task_spec in TaskGroupSpec(**task_row.spec).tasks:
            if task_spec.name == task_row.name:
                task_creds = task_spec.credentials
                break
        if task_creds is None:
            logging.exception('Could not find task uuid %s', task_row.name)
            task_creds = {}
        # Fetch all the creds used for this task
        task_cred_values: Set[str] = set()
        for cred_key, cred_values in task_creds.items():
            key_info = database.get_generic_cred(user, cred_key)
            if isinstance(cred_values, str):
                # user is using file so track all the values
                for value in key_info.values():
                    if len(value) < 8:
                        continue
                    task_cred_values.add(value)
            elif isinstance(cred_values, Dict):
                # user is using specific cred
                for cred_value in cred_values.values():
                    if cred_value not in key_info.keys() or len(key_info[cred_value]) < 8:
                        continue
                    task_cred_values.add(key_info[cred_value])
        return task_cred_values

    def fetch_status(self):
        fetch_cmd = 'SELECT status FROM groups WHERE workflow_id = %s and name = %s;'
        group_rows = self.database.execute_fetch_command(fetch_cmd,
                                                         (self.workflow_id, self.name))
        try:
            group_row = group_rows[0]
        except IndexError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Workflow {self.workflow_id} is not found.') from err
        self.status = TaskGroupStatus[group_row.status]

    def update_status_to_db(self, update_time: datetime.datetime, status: TaskGroupStatus,
                            message: str = '', force_cancel: bool = False,
                            scheduler_settings: connectors.BackendSchedulerSettings | None = None):
        """
        Updates task status in the database.

        Args:
            update_time (datetime.datetime): Time of the update.
            status (ContainerStatus): The status to update.
            message (str): Any error message from the container.
        """
        group_status = None
        # If status falls under in_queue() or canceled(), skip the status aggregation step
        if status.in_queue() or status.canceled():
            group_status = status
        else:
            tasks = Task.list_by_group_name(self.database, self.workflow_id, self.name)
            group_status = self._aggregate_status(tasks)
            if group_status == self.status:
                return

        # New status is either running or finished
        # Only update start_time when it hasnt started
        update_cmd = connectors.PostgresUpdateCommand(table='groups')
        update_cmd.add_condition('workflow_id = %s AND name = %s', [self.workflow_id, self.name])
        if scheduler_settings is not None:
            update_cmd.add_field('scheduler_settings', scheduler_settings.json())
        if group_status == TaskGroupStatus.WAITING:
            update_cmd.add_condition("status IN ('SUBMITTING')", [])
        if group_status == TaskGroupStatus.PROCESSING:
            update_cmd.add_condition('processing_start_time IS NULL', [])
            update_cmd.add_condition("status IN ('SUBMITTING', 'WAITING')", [])
            update_cmd.add_field('processing_start_time', update_time)
        elif group_status == TaskGroupStatus.SCHEDULING:
            update_cmd.add_condition('scheduling_start_time IS NULL', [])
            update_cmd.add_condition("status IN ('SUBMITTING', 'WAITING', 'PROCESSING')", [])
            update_cmd.add_field('scheduling_start_time', update_time)
        elif group_status == TaskGroupStatus.INITIALIZING:
            update_cmd.add_condition('initializing_start_time IS NULL', [])
            update_cmd.add_condition(
                "status IN ('SUBMITTING', 'WAITING', 'PROCESSING', 'SCHEDULING')", [])
            update_cmd.add_field('initializing_start_time', update_time)
        elif group_status == TaskGroupStatus.RUNNING:
            update_cmd.add_condition('start_time IS NULL', [])
            update_cmd.add_condition(
                "status IN ('SUBMITTING', 'WAITING', 'PROCESSING', 'SCHEDULING', "
                "'INITIALIZING')", [])
            update_cmd.add_field('start_time', update_time)
        else:
            update_cmd.add_condition('end_time IS NULL', [])
            # Cancel cannot bypass processing unless it is force
            if group_status.canceled() and not force_cancel:
                update_cmd.add_condition(
                    "status IN ('SUBMITTING', 'WAITING', 'SCHEDULING', 'INITIALIZING', 'RUNNING')",
                    [])
            else:
                update_cmd.add_condition(
                    "status IN ('SUBMITTING', 'WAITING', 'PROCESSING', 'SCHEDULING', "\
                    "'INITIALIZING', 'RUNNING')",
                    [])
            update_cmd.add_field('end_time', update_time)
            if group_status.failed():
                update_cmd.add_field('failure_message', message)
        update_cmd.add_field('status', group_status.name)
        self.database.execute_commit_command(*update_cmd.get_args())

    def update_downstream_groups_in_db(self) -> List['TaskGroup']:
        """
        Removes this task from the remaining_upstream_groups set for all downstream_groups.

        Returns:
            List[str]: A list of downstream_groups that have no remaining_upstream_groups.
        """
        update_cmd = '''
            UPDATE groups SET remaining_upstream_groups = delete(remaining_upstream_groups, %s)
            WHERE workflow_id = %s AND name = %s
            RETURNING *
        '''

        downstream_groups = []
        for group_name in self.downstream_groups:
            group_rows = self.database.execute_fetch_command(
                update_cmd, (self.name, self.workflow_id, group_name))
            try:
                group_row = group_rows[0]
            except (IndexError, TypeError) as err:
                raise osmo_errors.OSMODatabaseError(
                    f'Group {group_name} of workflow {self.workflow_id} is not found.') from err
            if not group_row.remaining_upstream_groups:
                downstream_groups.append(TaskGroup.from_db_row(group_row, self.database))
        return downstream_groups

    def set_tasks_to_processing(self):
        """
        Sets all tasks in the group to PROCESSING.
        """
        update_cmd = '''
            UPDATE tasks SET status = 'PROCESSING' WHERE workflow_id = %s AND group_name = %s
                AND status IN ('WAITING');
        '''
        self.database.execute_commit_command(update_cmd, (self.workflow_id, self.name))

    @staticmethod
    def patch_cleaned_up(database: connectors.PostgresConnector,
                         workflow_id: str, group: str) -> bool:
        """
        Marks the task as cleaned up. Returns True if all tasks in the workflow are now cleaned up.
        """

        # Mark the current group as cleaned_up
        update_cmd = '''
            UPDATE groups SET cleaned_up = TRUE
            WHERE workflow_id = %s AND name = %s;'''
        database.execute_commit_command(update_cmd, (workflow_id, group))

        # Fetch the cleaned_up status of all groups in the workflow
        fetch_cmd = '''
            SELECT cleaned_up FROM groups WHERE workflow_id = %s and cleaned_up = FALSE;
        '''
        groups = database.execute_fetch_command(fetch_cmd, (workflow_id,))

        # Return True if they are all cleaned_up
        return len(groups) == 0

    @classmethod
    def patch_metrics_in_db(cls,
                            database: connectors.PostgresConnector,
                            workflow_id: str,
                            task_name: str,
                            retry_id: int,
                            metrics_type: str,
                            start_time: datetime.datetime,
                            end_time: datetime.datetime):
        """
        Patch metrics for given group in DB
        """
        if metrics_type == 'input_download':
            update_cmd = '''
                UPDATE tasks SET input_download_start_time =  %s, input_download_end_time =  %s
                WHERE workflow_id = %s AND name = %s AND retry_id = %s;
            '''
        elif metrics_type == 'output_upload':
            update_cmd = '''
                UPDATE tasks SET output_upload_start_time =  %s, output_upload_end_time =  %s
                WHERE workflow_id = %s AND name = %s AND retry_id = %s;
            '''
        database.execute_commit_command(
            update_cmd,
            (start_time, end_time, workflow_id, task_name, retry_id)
        )

    def _aggregate_status(self, tasks: List[Task]) -> TaskGroupStatus:
        """
        Gets the group status from task statuses.

        Args:
            tasks (List[Task]): Tasks.

        Returns:
            TaskGroupStatus: New group status.
        """
        def is_considered(task: Task) -> bool:
            return not self.spec.ignoreNonleadStatus or task.lead

        if any(not t.status.group_finished() for t in tasks):
            if any(t.status == TaskGroupStatus.RUNNING for t in tasks):
                return TaskGroupStatus.RUNNING
            return TaskGroupStatus.INITIALIZING
        if any(t.status == TaskGroupStatus.FAILED_UPSTREAM for t in tasks):
            return TaskGroupStatus.FAILED_UPSTREAM
        if any(t.status == TaskGroupStatus.FAILED_SERVER_ERROR for t in tasks):
            return TaskGroupStatus.FAILED_SERVER_ERROR
        if any(t.status == TaskGroupStatus.FAILED_PREEMPTED for t in tasks):
            return TaskGroupStatus.FAILED_PREEMPTED
        if any(t.status == TaskGroupStatus.FAILED_EVICTED for t in tasks if is_considered(t)):
            return TaskGroupStatus.FAILED_EVICTED
        if any(t.status.failed() for t in tasks if is_considered(t)):
            return TaskGroupStatus.FAILED
        if all(t.status == TaskGroupStatus.COMPLETED for t in tasks if is_considered(t)):
            return TaskGroupStatus.COMPLETED
        return TaskGroupStatus.RUNNING

    def _get_pod_name(self, task: str, workflow_uuid: str) -> str:
        return f'{kb_objects.k8s_name(task)}-{workflow_uuid}'

    def get_pod_names(self, workflow_uuid: str) -> List[str]:
        return [self._get_pod_name(task.name, workflow_uuid) for task in self.spec.tasks]

    def get_k8s_object_factory(self, backend: connectors.Backend) -> kb_objects.K8sObjectFactory:
        backend_copy = copy.deepcopy(backend)
        if self.scheduler_settings:
            backend_copy.scheduler_settings = self.scheduler_settings

        return kb_objects.get_k8s_object_factory(backend_copy)

    def get_kb_specs(
        self, workflow_uuid: str, user: str,
        workflow_config: connectors.WorkflowConfig,
        backend_config_cache: connectors.BackendConfigCache,
        backend_name: str,
        pool: str,
        progress_writer: progress.ProgressWriter,
        progress_iter_freq: datetime.timedelta,
        workflow_plugins: task_common.WorkflowPlugins,
        priority: wf_priority.WorkflowPriority,
    ) -> Tuple[List[Dict], Dict[str, Dict]]:
        """
        Generates the list of resources to be deployed to k8s (In order).

        Args:
            workflow_id (str): the workflow name + unique base32 id across all workflows.
            user (str): user who submitted workflow

        Returns:
            List[Dict]: List of k8s resources to create
            Dict[str, Dict]: List of pod specs

        Raises:
            OSMOServerError: Failed to create k8s resources.
        """
        last_timestamp = datetime.datetime.now()

        group_uid = self.group_uuid

        backend_config = backend_config_cache.get(backend_name)

        k8s_factory = self.get_k8s_object_factory(backend_config)

        labels = self._labels(user, workflow_uuid)

        file_dir_secrets = k8s_factory.create_secret(
            f'{group_uid}-file-dir',
            labels, {},
            {
                'fileDir': OSMO_CONFIG_FILE_DIR
            })

        all_secrets, user_secrets = {}, {}
        for task in self.spec.tasks:
            for cred_name, cred_map in task.credentials.items():
                payload = self.database.get_generic_cred(user, cred_name)
                if isinstance(cred_map, str):
                    for cred_key, cred_value in payload.items():
                        cred_file = File(path=cred_map + '/' + cred_key,
                                         contents=cred_value)
                        task.files.append(cred_file)
                elif isinstance(cred_map, Dict):
                    for cred_key in cred_map.values():
                        if cred_key not in payload.keys():
                            raise ValueError(f'{cred_key} is not a valid credential key ' \
                                             f'please choose from {payload.keys()}')
                        all_secrets[cred_key] = payload[cred_key]
                else:
                    raise ValueError(f'{cred_map} is not a valid credential map.' \
                            'It should be either be a Dict[envirionment_variables:cred_key]' \
                            'or a mount directory str')
                current_timestamp = datetime.datetime.now()
                time_elapsed = last_timestamp - current_timestamp
                if time_elapsed > progress_iter_freq:
                    progress_writer.report_progress()
                    last_timestamp = current_timestamp
        progress_writer.report_progress()

        if all_secrets:
            user_secrets = k8s_factory.create_secret(
                f'{group_uid}-user-secrets', labels, {}, all_secrets)

        registry_creds_user, registry_cred_osmo = self._get_registry_creds(user, workflow_config)
        image_secrets_user = k8s_factory.create_image_secret(
            self._get_image_secret_name(group_uid, 'user'), labels, registry_creds_user)
        if registry_cred_osmo:
            image_secrets_osmo = k8s_factory.create_image_secret(
                self._get_image_secret_name(group_uid, 'osmo'), labels, registry_cred_osmo)

        headless_service = None
        if len(self.spec.tasks) > 1:
            headless_service = k8s_factory.create_headless_service(group_uid, labels)

        pods, files_list, task_names = self.convert_all_pod_specs(
            workflow_uuid,
            user,
            pool,
            workflow_config,
            workflow_plugins,
            priority,
            progress_writer,
            progress_iter_freq,

        )
        group_objects = k8s_factory.create_group_k8s_resources(group_uid, pods, labels, pool,
                                                               priority)

        pod_specs = dict(zip(task_names, pods))

        kb_resources = []
        # Create secrets
        for file in files_list:
            kb_resources.append(file.secret(labels))

        kb_resources.append(file_dir_secrets)
        if user_secrets:
            kb_resources.append(user_secrets)

        kb_resources.append(image_secrets_user)
        if registry_cred_osmo:
            kb_resources.append(image_secrets_osmo)

        # Create groups
        kb_resources += group_objects

        # Create headless service
        if headless_service:
            kb_resources.append(headless_service)

        return kb_resources, pod_specs

    def _labels(self, user: str,
                workflow_uuid: str) -> Dict[str, str]:
        """
        Creates workflow id, task name, and user labels.

        If 'user' is a string that does not satisfy the requirements of a Kubernetes label,
        if 'user' is an email, it will parse the username of the email and check to
        see if it satisfies the Kubernetes label requirement.

        The function will not add a user label if the Kubernetes label requirement fails
        both times.
        """
        user_label = str(user)
        label = {
            'osmo.workflow_id': shorten_name_to_fit_kb(self.workflow_id),
            'osmo.workflow_uuid': shorten_name_to_fit_kb(workflow_uuid),
            'osmo.group_name': shorten_name_to_fit_kb(self.name),
            'osmo.group_uuid': shorten_name_to_fit_kb(self.group_uuid)
        }

        k8_label_requirement = '^[a-zA-Z0-9][A-Za-z0-9-_.]{0,61}[a-zA-Z0-9]$'
        match = re.search(k8_label_requirement, user_label)
        if not match:
            # If 'user' is an email, parse the username part of the email because K8 labels
            # cannot have special characters like @
            if user_label.find('@') != -1:
                email_arr = user_label.split('@')
                user_label = email_arr[0]
                email_user_match = re.search(k8_label_requirement, user_label)
                if not email_user_match:
                    return label
            else:
                return label
        label['osmo.submitted_by'] = shorten_name_to_fit_kb(user_label)
        return label

    def _task_labels(self, user: str, workflow_uuid: str,
                     task: Task, spec: TaskSpec,
                     pool: str, priority: wf_priority.WorkflowPriority) -> Dict[str, str]:
        """
        Creates labels for k8s task resources.
        """
        labels = self._labels(user, workflow_uuid)
        labels['osmo.task_name'] = shorten_name_to_fit_kb(task.name)
        labels['osmo.task_uuid'] = task.task_uuid
        labels['osmo.retry_id'] = str(task.retry_id)
        if spec.lead:
            labels['osmo.lead_container'] = 'true'
        labels['osmo.pool'] = pool
        if not spec.resources.platform:
            raise osmo_errors.OSMOError(
                f'Task {spec.name} does not have a platform!')
        labels['osmo.platform'] = spec.resources.platform
        labels['osmo.priority'] = priority.value.lower()
        return labels

    def _ctrl_args(self, task_name: str, retry_id: int,
                   service_config: connectors.postgres.ServiceConfig) -> List[str]:
        host, port, ws_scheme, http_scheme = service_config.get_parsed_field()
        ctrl_args = [
            '-workflow', self.workflow_id,
            '-groupName', self.name,
            '-retryId', str(retry_id),
            '-logSource', task_name,
            '-host', host,
            '-port', port,
            '-scheme', ws_scheme,
            '-refreshToken', f'{OSMO_CONFIG_MOUNT_DIR}/{REFRESH_TOKEN_FILENAME}',
            '-refreshScheme', http_scheme,
        ]

        if self.spec.has_group_barrier():
            ctrl_args += ['-barrier', GROUP_BARRIER_NAME]

        return ctrl_args

    def _convert_labels_to_variables(self, labels: Dict[str, str]) -> Dict[str, str]:
        """
        Turn labels that follow format osmo.* into variables.
        Skip labels that do not start with 'osmo.*'. If the label does not start with
        workflow after stripping 'osmo.', append WF_ to variable name. If it starts
        with workflow, replace it with WF.

        For example:
        osmo.workflow_uuid -> WF_UUID
        osmo.group_name -> WF_GROUP_NAME
        """
        variables_dict = {}
        for key in labels.keys():
            if key.startswith(OSMO_PREFIX):
                # Upper case and replace period with underscore
                variable_name = key[len(OSMO_PREFIX):].upper()
                if variable_name.startswith(WORKFLOW_PREFIX):
                    variable_name = f'WF_{variable_name[len(WORKFLOW_PREFIX):]}'
                else:
                    variable_name = f'WF_{variable_name}'
                variables_dict[variable_name] = labels[key]
        return variables_dict

    def _get_image_secret_name(self, group_uid: str, name: str):
        """ Get ImagePullSecret Name. """
        return f'{group_uid}-{name}'

    def _get_registry_creds(self, user: str, workflow_config: connectors.WorkflowConfig):
        """ Got registry credentials for both user and osmo. """
        registry_creds_user = {}
        for task in self.spec.tasks:
            image_info = common.docker_parse(task.image)
            payload = self.database.get_registry_cred(user, image_info.host)
            if payload:
                auth_string = f'''{payload['username']}:{payload['auth']}'''
                registry_creds_user[image_info.host] = \
                    {'auth': base64.b64encode(auth_string.encode('utf-8')).decode('utf-8')}

        registry_cred_osmo = None
        osmo_cred = workflow_config.backend_images.credential
        if (
            osmo_cred
            and osmo_cred.registry
            and osmo_cred.username
            and osmo_cred.auth.get_secret_value()
        ):
            auth_string = (
                f'{osmo_cred.username}:{osmo_cred.auth.get_secret_value()}')
            registry_cred_osmo = {
                osmo_cred.registry: {
                    'auth': base64.b64encode(auth_string.encode('utf-8')).decode('utf-8')
                }
            }
        return registry_creds_user, registry_cred_osmo

    def convert_to_pod_spec(
        self,
        task_obj: Task,
        task_spec: TaskSpec,
        workflow_uuid: str,
        user: str,
        pool: str,
        workflow_plugins: task_common.WorkflowPlugins,
        k8s_factory: kb_objects.K8sObjectFactory,
        pod_list: Dict[str, str],
        workflow_config: connectors.WorkflowConfig,
        backend_config: connectors.Backend,
        priority: wf_priority.WorkflowPriority,
        # Optional arguments
        service_config: connectors.ServiceConfig | None = None,
        dataset_config: connectors.DatasetConfig | None = None,
        pool_info: connectors.Pool | None = None,
        data_endpoints: Dict[str, credentials.DecryptedDataCredential] | None = None,
        skip_refresh_token: bool = False,
    ) -> Tuple[Dict, Dict[str, kb_objects.FileMount]]:
        """
        Convert a task spec to a pod spec.
        """
        if workflow_config.workflow_data.credential is None:
            raise osmo_errors.OSMOServerError('Workflow data credential is not set')

        if pool_info is None:
            pool_info = connectors.Pool.fetch_from_db(self.database, pool)
        if service_config is None:
            service_config = self.database.get_service_configs()
        if dataset_config is None:
            dataset_config = self.database.get_dataset_configs()
        if data_endpoints is None:
            data_endpoints = self.database.get_all_data_creds(user)
        if backend_config is None:
            backend_config = connectors.Backend.fetch_from_db(
                self.database, self.spec.tasks[0].backend)

        files = task_spec.get_filemounts(self.group_uuid, k8s_factory)
        all_files = {file.digest: file for file in files}
        labels = self._task_labels(user, workflow_uuid, task_obj, task_spec, pool, priority)

        if task_spec.resources.platform not in pool_info.platforms:
            raise osmo_errors.OSMOError(
                f'Platform {task_spec.resources.platform} is not found in in pool {pool}!')
        task_platform = pool_info.platforms[task_spec.resources.platform]

        if task_spec.downloadType is None:
            task_spec.downloadType = pool_info.download_type if pool_info.download_type \
                else workflow_config.workflow_data.download_type

        ctrl_extra_args = self._ctrl_args(task_spec.name, task_obj.retry_id, service_config)
        user_args = []

        url_prefix = workflow_config.workflow_data.credential.endpoint

        input_urls: List[str] = []
        input_datasets: List[str] = []

        service_creds = credentials.decrypt(workflow_config.workflow_data.credential)

        disabled_data = workflow_config.credential_config.disable_data_validation
        # TODO: Make extra_args a dumped json to be parsed by osmo-ctrl
        for index, spec_input in enumerate(task_spec.inputs):
            # Input/output is in the form 'folderName' + 'url'
            if isinstance(spec_input, TaskInputOutput):
                first_field, second_field = spec_input.parsed_workflow_info()
                task_workflow_id = first_field if second_field else self.workflow_id
                task_name = first_field if not second_field else second_field
                task_io_url = f'{url_prefix}/{task_workflow_id}/{task_name}'
                ctrl_extra_args += ['-inputs', f'task:{index},{task_io_url},{spec_input.regex}']
            elif isinstance(spec_input, DatasetInputOutput):
                dataset_info = common.DatasetStructure(spec_input.dataset.name)
                bucket_info = dataset_config.get_bucket_config(dataset_info.bucket)
                task_io_url = dataset_info.full_name
                ctrl_extra_args += ['-inputs',
                                    f'dataset:{index},{task_io_url},{spec_input.dataset.regex}']
                input_datasets.append(task_io_url)
            elif isinstance(spec_input, URLInputOutput):
                task_io_url = spec_input.url
                ctrl_extra_args += ['-inputs', f'url:{index},{task_io_url},{spec_input.regex}']
                input_urls.append(task_io_url)
            else:
                raise osmo_errors.OSMOServerError('Unexpected InputType')

        # Tasks will upload output data if there is a downstream task or
        # there is no outputs defined
        if self.downstream_groups or not task_spec.outputs:
            task_io_url = f'{url_prefix}/{self.workflow_id}/{task_spec.name}'
            ctrl_extra_args += ['-outputs', f'task:{task_io_url}']

        for kpi in task_spec.kpis:
            task_io_url = f'{url_prefix}/{self.workflow_id}/{task_spec.name}'
            if '/' in kpi.path:
                task_io_url += f'/{kpi.path.rsplit("/", 1)[0]}'
            ctrl_extra_args += ['-outputs', f'kpi:{task_io_url},{kpi.path}']

        for spec_output in task_spec.outputs:
            if isinstance(spec_output, DatasetInputOutput):
                dataset_info = common.DatasetStructure(spec_output.dataset.name, True)
                bucket_info = dataset_config.get_bucket_config(dataset_info.bucket)
                task_io_url = dataset_info.full_name
                fetch_creds(user, data_endpoints, bucket_info.dataset_path,
                            disabled_data)
                ctrl_extra_args += ['-outputs',
                                    f'dataset:{task_io_url},' +
                                    f'{spec_output.dataset.path},' +
                                    f'{",".join(spec_output.dataset.metadata)};' +
                                    f'{",".join(spec_output.dataset.labels)};' +
                                    spec_output.dataset.regex]
            if isinstance(spec_output, UpdateDatasetOutput):
                dataset_info = common.DatasetStructure(spec_output.update_dataset.name, True)
                bucket_info = dataset_config.get_bucket_config(dataset_info.bucket)
                task_io_url = dataset_info.full_name
                fetch_creds(user, data_endpoints, bucket_info.dataset_path,
                            disabled_data)
                ctrl_extra_args += ['-outputs',
                                    f'update_dataset:{task_io_url};' +
                                    f'{",".join(spec_output.update_dataset.paths)};' +
                                    f'{",".join(spec_output.update_dataset.metadata)};' +
                                    ','.join(spec_output.update_dataset.labels)]
            if isinstance(spec_output, URLInputOutput):
                task_io_url = spec_output.url
                fetch_creds(user, data_endpoints, task_io_url, disabled_data)
                ctrl_extra_args += ['-outputs', f'url:{task_io_url},{spec_output.regex}']

        for checkpoint in task_spec.checkpoint:
            checkpoint_path = checkpoint.path
            if not checkpoint_path.startswith('/'):
                checkpoint_path = f'/{checkpoint_path}'
            user_args += [
                '-checkpoint',
                f'{checkpoint_path};{checkpoint.url};' +
                f'{int(checkpoint.frequency.total_seconds())};{checkpoint.regex}'
                ]

        host_mounts = []
        for i, mount in enumerate(task_spec.volumeMounts):
            split_mount = mount.split(':', 2)
            src_mount = split_mount[0]
            allowed_mounts_set = set(task_platform.allowed_mounts)
            default_mounts_set = set(task_platform.default_mounts)
            if src_mount in allowed_mounts_set:
                # If not part of default mounts, then add it to host_mounts
                if src_mount not in default_mounts_set:
                    host_mounts.append(
                        kb_objects.HostMount(name=f'host-mount-{i}', path=mount))
            else:
                raise ValueError(
                    f'Mount {src_mount} not allowed for selected platform '
                    f'{task_spec.resources.platform}.')

        # List of volumes to be created and made available to all containers
        volumes = [file.volume() for file in files]
        volumes += [mount.volume() for mount in host_mounts]

        file_mounts = [file.volume_mount() for file in files if
            file.path.startswith(kb_objects.DATA_LOCATION + '/output/')]

        # TODO: Move files creation to separate file creation for sidecar
        # Add filemounts specified by user
        end_timeout = int(time.time() + common.ACCESS_TOKEN_TIMEOUT)
        token = service_config.service_auth.create_idtoken_jwt(
            end_timeout,
            user,
            service_config.service_auth.ctrl_roles,
            workflow_id=self.workflow_id)

        refresh_token = secrets.token_hex(REFRESH_TOKEN_LENGTH)

        # Workaround for validation
        token_file = File(path='/token', contents=refresh_token)
        token_file.path = f'{OSMO_CONFIG_MOUNT_DIR}/{REFRESH_TOKEN_FILENAME}'
        if task_obj.retry_id == 0 and not skip_refresh_token:
            task_obj.add_refresh_token_to_db(refresh_token)

        # Create Login and Config yaml
        service_url = service_config.service_base_url
        service_method = connectors.PostgresConnector.get_instance().config.method
        if service_method == 'dev':
            login_yaml = create_login_dict(user, service_url)
        else:
            query = urlencode({'workflow_id': self.workflow_id,
                                'group_name': self.name,
                                'task_name': task_spec.name,
                                'retry_id': task_obj.retry_id,
                                'refresh_token': refresh_token})
            refresh_url = f'{service_url}/api/auth/jwt/refresh_token?{query}'
            login_yaml = create_login_dict(user, service_url, token, refresh_url)

        user_config_yaml = create_config_dict(data_endpoints)

        service_profile = storage.construct_storage_backend(
            workflow_config.workflow_data.credential.endpoint).profile
        service_config_yaml = create_config_dict({service_profile: service_creds})

        # User CLI login config
        login_file = File(path='/login',
                            contents=yaml.dump(login_yaml))
        login_file.path = f'{OSMO_CONFIG_MOUNT_DIR}/login.yaml'
        login_file_mount = kb_objects.FileMount(
            group_uid=self.group_uuid,
            path=login_file.path,
            content=login_file.encoded_contents(),
            k8s_factory=k8s_factory)
        login_file_mount.custom_digest(f'{task_obj.task_uuid}-login')

        volumes.append(login_file_mount.volume())

        # User CLI data config
        user_config_file = File(path='/config',
                                contents=yaml.dump(user_config_yaml))
        user_config_file.path = f'{OSMO_CONFIG_MOUNT_DIR}/user_config.yaml'
        user_config_file_mount = kb_objects.FileMount(
            group_uid=self.group_uuid,
            path=user_config_file.path,
            content=user_config_file.encoded_contents(),
            k8s_factory=k8s_factory)
        file_mounts.append(user_config_file_mount.volume_mount())
        volumes.append(user_config_file_mount.volume())

        # Service CLI data config
        service_config_file = File(path='/config',
                                    contents=yaml.dump(service_config_yaml))
        service_config_file.path = f'{OSMO_CONFIG_MOUNT_DIR}/service_config.yaml'
        ctrl_extra_args += ['-userConfig', user_config_file.path,
                            '-serviceConfig', service_config_file.path]

        # Create default metadata file
        dataset_metadata_info = {
            'default': {
                'input_data': input_urls,
                'input_datasets': input_datasets,
                'wfid': self.workflow_id,
                'created_by': user
            }
        }
        metadata_file = File(path='/metadata',
                                contents=yaml.dump(dataset_metadata_info))
        metadata_file.path = f'{kb_objects.DATA_LOCATION}/default_metadata.yaml'

        def _build_file_mount(file: File) -> kb_objects.FileMount:
            return kb_objects.FileMount(
                group_uid=self.group_uuid,
                path=file.path,
                content=file.encoded_contents(),
                k8s_factory=k8s_factory)

        # Ctrl specific file mounts to be added to new file list
        control_file_mounts = [_build_file_mount(file) for file in
                                (service_config_file, metadata_file)]
        # When we reschedule a task, we will no longer have access to the value of the
        # refresh-token here in the service. So we must hash refresh token secret by something
        # that will be consistent across reschedules.
        token_file_mount = _build_file_mount(token_file)
        token_file_mount.custom_digest(f'{task_obj.task_uuid}-refresh-token')
        control_file_mounts.append(token_file_mount)

        user_files: List[kb_objects.FileMount] = files.copy()
        for file_mount in control_file_mounts:
            file_mounts.append(file_mount.volume_mount())
            volumes.append(file_mount.volume())

        control_file_mounts.append(login_file_mount)
        control_file_mounts.append(user_config_file_mount)
        all_files.update({file.digest: file for file in control_file_mounts})

        # Union default env values and values defined by the spec, with spec values
        # overriding default values if the same key is shared
        default_variables = common.recursive_dict_update(
            copy.deepcopy(pool_info.common_default_variables),
            task_platform.default_variables,
            common.merge_lists_on_name)

        jinja_variables = task_spec.resources.get_allocatable_tokens(default_variables,
                                                                     task_spec.cacheSize)
        jinja_variables['USER_CONTAINER_NAME'] =\
            kb_objects.k8s_name(shorten_name_to_fit_kb(task_spec.name))
        jinja_variables.update(self._convert_labels_to_variables(labels))

        # Specify the cache size in MiB
        user_cache_size = math.floor(common.convert_resource_value_str(
                                    str(jinja_variables.get('USER_CACHE', '0MiB')),
                                    target='MiB'))

        control_container_spec = k8s_factory.create_control_container(
            ctrl_extra_args, workflow_config.backend_images.client, self.group_uuid, file_mounts,
            task_spec.downloadType.value, task_spec.resources, user_cache_size)

        using_gpu = bool(task_spec.resources.gpu and task_spec.resources.gpu > 0)
        user_args += [
            '-socketPath', f'{kb_objects.DATA_LOCATION}/socket/data.sock',
            '-userBinPath', task_common.USER_BIN_LOCATION,
        ]

        init_extra_args = []

        if workflow_plugins.rsync:
            init_extra_args += ['--enable_rsync']
            user_args += ['-enableRsync']
            rsync_config = workflow_config.plugins_config.rsync
            user_args += [
                '-rsyncReadLimit', str(rsync_config.read_bandwidth_limit),
                '-rsyncWriteLimit', str(rsync_config.write_bandwidth_limit),
            ]
            if rsync_config.allowed_paths:
                allowed_paths = [
                    f'{module_name}:{allowed_path.path}:{str(allowed_path.writable).lower()}'
                    for module_name, allowed_path in rsync_config.allowed_paths.items()
                ]
                user_args += [
                    '-rsyncPathAllowList', ','.join(allowed_paths),
                ]

        user_container_spec = task_spec.to_pod_container(
            user_args,
            user_files,
            host_mounts,
            f'{self.group_uuid}-user-secrets',
            f'{self.group_uuid}-file-dir',
            using_gpu)

        image_pull_secrets = [{'name': self._get_image_secret_name(self.group_uuid, 'user')}]
        # Check if osmo credentials are configured
        osmo_cred = workflow_config.backend_images.credential
        if (
            osmo_cred
            and osmo_cred.registry
            and osmo_cred.username
            and osmo_cred.auth.get_secret_value()
        ):
            image_pull_secrets.append(
                {'name': self._get_image_secret_name(self.group_uuid, 'osmo')})

        spec : Dict[str, Any] = {
            'restartPolicy': 'Never',
            'imagePullSecrets': image_pull_secrets,
            'hostNetwork': task_spec.hostNetwork,
            'containers': [user_container_spec, control_container_spec],
            'initContainers': [
                k8s_factory.create_init_container(
                    login_file_mount.volume_mount(),
                    user_config_file_mount.volume_mount(),
                    init_extra_args,
                ),
            ],
            'volumes': [
                {'name': 'osmo'},
                {'name': 'osmo-data'},
                {'name': 'osmo-login'},
                {'name': 'osmo-usr-bin'},
                {'name': 'osmo-run'},
            ] + volumes
        }
        if len(self.spec.tasks) > 1:
            spec['hostname'] = task_obj.task_uuid
            # Subdomain needs to start with alphabetical character
            spec['subdomain'] = common.get_group_subdomain_name(self.group_uuid)

        if task_spec.privileged:
            if not task_platform.privileged_allowed:
                raise ValueError('Privileged flag not allowed for selected platform.')
        if task_spec.hostNetwork:
            if not task_platform.host_network_allowed:
                raise ValueError('Host network flag not allowed for selected platform.')

        # Add node selectors to pod labels
        labels.update(task_platform.labels)
        pod: Dict[str, Any] = {
            'kind': 'Pod',
            'apiVersion': 'v1',
            'metadata': {
                'name': pod_list[task_spec.name],
                'labels': labels,
                'finalizers': ['osmo.nvidia.com/cleanup']
            },
            'spec': spec
        }

        override_pod_template = copy.deepcopy(task_platform.parsed_pod_template)
        substitute_pod_template_tokens(override_pod_template, jinja_variables)
        pod = apply_pod_template(pod, override_pod_template)

        return pod, all_files

    def convert_all_pod_specs(
        self,
        workflow_uuid: str,
        user: str,
        pool: str,
        workflow_config: connectors.WorkflowConfig,
        workflow_plugins: task_common.WorkflowPlugins,
        priority: wf_priority.WorkflowPriority,
        progress_writer: progress.ProgressWriter | None = None,
        progress_iter_freq: datetime.timedelta = datetime.timedelta(minutes=1),
    ) -> Tuple[List, List[kb_objects.FileMount], List]:
        """
        Converts a task to kubernetes pods.

        Args:
            workflow_uuid (str): A unique id for the workflow.
            user (str): User who submitted the workflow.
            pool (str): Pool to submit to.
            workflow_config (connectors.WorkflowConfig): Workflow config.
            workflow_plugins (task_common.WorkflowPlugins): Workflow plugins.
            priority (wf_priority.WorkflowPriority): Workflow priority.
            progress_writer (progress.ProgressWriter): Progress writer.
            progress_iter_freq (datetime.timedelta): Progress iteration frequency.

        Returns:
            List: List of pod in kubernetes spec.
            List[kb_objects.FileMount]: New File Mounts with metadata defaults
        """
        last_timestamp = datetime.datetime.now()

        postgres = connectors.PostgresConnector.get_instance()
        service_config = self.database.get_service_configs()
        dataset_config = self.database.get_dataset_configs()
        backend_config = connectors.Backend.fetch_from_db(postgres, self.spec.tasks[0].backend)
        k8s_factory = self.get_k8s_object_factory(backend_config)
        pool_info = connectors.Pool.fetch_from_db(postgres, pool)
        pod_list = {
            t.name: kb_objects.construct_pod_name(
                workflow_uuid, t.task_uuid) for t in self.tasks}

        pods = []
        task_names = []

        # A list of new files to be returned to caller for further operation (e.g. secret creation)
        all_files: Dict[str, kb_objects.FileMount] = {}
        data_endpoints = postgres.get_all_data_creds(user)

        for task_spec in self.spec.tasks:
            task_obj: Task | None = None
            for task_value in self.tasks:
                if task_value.name == task_spec.name:
                    task_obj = task_value
            if task_obj is None:
                raise osmo_errors.OSMOError(
                    f'Task {task_spec.name} is not found!')

            pod, files = self.convert_to_pod_spec(
                task_obj,
                task_spec,
                workflow_uuid,
                user,
                pool,
                workflow_plugins,
                k8s_factory,
                pod_list,
                workflow_config,
                backend_config,
                priority,
                service_config,
                dataset_config,
                pool_info,
                data_endpoints)

            pods.append(pod)
            all_files.update(files)
            task_names.append(task_spec.name)

            if progress_writer:
                current_timestamp = datetime.datetime.now()
                time_elapsed = last_timestamp - current_timestamp
                if time_elapsed > progress_iter_freq:
                    progress_writer.report_progress()
                    last_timestamp = current_timestamp

        return pods, list(all_files.values()), task_names


def _encode_hstore(tasks: Set[str]) -> str:
    """ Encodes a set of tasks into a query str. """
    return ', '.join([f'"{task}" => "NULL"' for task in tasks])


def decode_hstore(tasks: str) -> Set[str]:
    """ Decodes a str of tasks into a set. """
    return {tp[0] for tp in re.findall(f'"({task_common.NAMEREGEX})"=>"NULL"', tasks)}


def fetch_creds(user: str, data_creds: Dict[str, credentials.DecryptedDataCredential], path: str,
                disabled_data: Optional[List[str]] = None) -> Dict:
    backend_info = storage.construct_storage_backend(path)

    if backend_info.profile not in data_creds:
        if not disabled_data or backend_info.scheme not in disabled_data:
            raise osmo_errors.OSMOCredentialError(
                f'Could not find {backend_info.profile} credential for user {user}.')
        return {}

    return data_creds[backend_info.profile].dict()
