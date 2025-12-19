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

import copy
import datetime
import enum
import hashlib
from itertools import chain
import logging
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union
from urllib.parse import urlparse

import pydantic
import requests  # type: ignore

from src.lib.data import storage
from src.lib.utils import (common, jinja_sandbox, osmo_errors, priority as wf_priority,
                        workflow as workflow_utils)
from src.utils.job import common as task_common, kb_objects, task
from src.utils import connectors, notify


INSERT_RETRY_COUNT = 5

K8_TOKENS_SET = {f'K8_{resource_type.name.upper()}' \
                 for resource_type in common.ALLOCATABLE_RESOURCES_LABELS}.union(
                {'K8_GPU_PRODUCT', 'K8_GPU_CUDA_DRIVER'})


def action_queue_name(workflow_id: str, task_name: str, retry_id: int) -> str:
    return f'client-connections:{workflow_id}:{task_name}:{retry_id}'


class WorkflowStatus(str, enum.Enum):
    """ Represents the status of a workflow. """
    # No task has started for the workflow yet
    PENDING = 'PENDING'
    # At least one task has started
    RUNNING = 'RUNNING'
    # At least one task has started but nothing is running right now
    WAITING = 'WAITING'
    # All tasks have succeeded
    COMPLETED = 'COMPLETED'
    # At least one task has failed
    FAILED = 'FAILED'
    # Failed by user due to submission error's
    FAILED_SUBMISSION = 'FAILED_SUBMISSION'
    # Failed due to service internal error
    FAILED_SERVER_ERROR = 'FAILED_SERVER_ERROR'
    # Failure because of execution timeout
    FAILED_EXEC_TIMEOUT = 'FAILED_EXEC_TIMEOUT'
    # Failure because of queue timeout
    FAILED_QUEUE_TIMEOUT = 'FAILED_QUEUE_TIMEOUT'
    # Failure because of cancelation
    FAILED_CANCELED = 'FAILED_CANCELED'
    # Failed due to some occurance in the backend cluster
    FAILED_BACKEND_ERROR = 'FAILED_BACKEND_ERROR'
    # Failed due to image pull issues
    FAILED_IMAGE_PULL = 'FAILED_IMAGE_PULL'
    # Failed due to eviction
    FAILED_EVICTED = 'FAILED_EVICTED'
    # Failed start the pod
    FAILED_START_ERROR = 'FAILED_START_ERROR'
    # A task that took too long to start the pod
    FAILED_START_TIMEOUT = 'FAILED_START_TIMEOUT'
    # Workflow was preempted by a higher priority workflow
    FAILED_PREEMPTED = 'FAILED_PREEMPTED'

    def alive(self) -> bool:
        """ Returns true if the workflow is in a non-finished state. """
        return self in self.get_alive_statuses()

    def finished(self) -> bool:
        """ Returns true if the workflow has a finished status. """
        return not self.alive()

    @classmethod
    def get_alive_statuses(cls) -> List['WorkflowStatus']:
        """ Returns a list of all statuses which are not finished """
        return [WorkflowStatus.PENDING, WorkflowStatus.RUNNING, WorkflowStatus.WAITING]

    def failed(self) -> bool:
        """ Returns true if the workflow has a finished status. """
        return not self.alive() and self.name != 'COMPLETED'


class ResourcesEntry(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Entry for resources API results. """
    hostname: str
    exposed_fields: Dict
    taints: List[Dict]
    usage_fields: Dict
    conditions: List[str] | None
    non_workflow_usage_fields: Dict
    allocatable_fields: Dict
    platform_allocatable_fields: Dict | None
    platform_available_fields: Dict | None
    platform_workflow_allocatable_fields: Dict | None
    config_fields: Dict | None
    backend: str
    label_fields: Dict | None
    pool_platform_labels: Dict[str, List[str]]
    resource_type: connectors.BackendResourceType

    @classmethod
    def from_backend_resource(cls, resource: connectors.BackendResource,
                              verbose: bool) -> 'ResourcesEntry':
        return ResourcesEntry.construct(
            hostname=resource.name,
            backend=resource.backend,
            usage_fields=resource.converted_usage_fields,
            non_workflow_usage_fields=resource.non_workflow_usage_fields,
            allocatable_fields=resource.converted_allocatable_fields,
            platform_workflow_allocatable_fields=\
                resource.converted_platform_workflow_allocatable_fields,
            platform_allocatable_fields=resource.converted_platform_allocatable_fields,
            platform_available_fields=resource.converted_platform_available_fields,
            exposed_fields=resource.exposed_fields(verbose),
            taints=resource.taint_fields,
            config_fields=resource.config_fields,
            label_fields=resource.label_fields if verbose else None,
            pool_platform_labels=resource.pool_platform_labels,
            resource_type=resource.resource_type)


class ResourceValidationResult(pydantic.BaseModel):
    """
    Stores the result of validation. If the validation failed, logs will be populated in this
    object.
    """
    passed: bool
    logs: str = ''


def build_resource_lookup_table(resource_entry: ResourcesEntry,
                                pool: str,
                                platform: str) -> Dict[str, Any]:
    """
    Build a lookup table containing the K8 special tokens that can be referenced in resource
    validation rules.
    """
    mapping : Dict[str, Any] = {}
    try:
        if not resource_entry.platform_workflow_allocatable_fields:
            raise IndexError
        exposed_fields = resource_entry.platform_workflow_allocatable_fields[pool][platform]
        for resource_type in common.ALLOCATABLE_RESOURCES_LABELS:
            upper_name = resource_type.name.upper()
            if resource_type.unit:
                value = exposed_fields.get(resource_type.name, '0')
                value = f'{common.convert_resource_value_str(value, target="Ki")}Ki'
                mapping[f'K8_{upper_name}'] = value
            else:
                mapping[f'K8_{upper_name}'] = \
                    exposed_fields.get(resource_type.name, '0')
    except KeyError:
        # Fall back to pre-existing logic if the new allocatable fields can't be
        # found in the platform_allocatable_fields dictionary
        exposed_fields = resource_entry.exposed_fields
        for resource_type in common.ALLOCATABLE_RESOURCES_LABELS:
            upper_name = resource_type.name.upper()
            if resource_type.unit:
                value = exposed_fields.get(resource_type.name, None)
                value = f'{value}{resource_type.unit}' if value else '0'
                mapping[f'K8_{upper_name}'] = value
            else:
                mapping[f'K8_{upper_name}'] = \
                    exposed_fields.get(resource_type.name, '0')
    return mapping


class TimeoutSpec(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the timeout spec. """
    exec_timeout: datetime.timedelta | None = None
    queue_timeout: datetime.timedelta | None = None

    @pydantic.validator('exec_timeout', 'queue_timeout', pre=True)
    @classmethod
    def validate_timeout(cls, value) -> Optional[datetime.timedelta]:
        if isinstance(value, (int, float)):
            return datetime.timedelta(seconds=value)
        if value is None or isinstance(value, datetime.timedelta):
            return value
        return common.to_timedelta(value)

    def fill_defaults(self, workflow_config: connectors.WorkflowConfig, pool_info: connectors.Pool):
        """ Replace "None" value with defaults, and make sure timeouts don't go over limit """
        max_exec_timeout = pool_info.max_exec_timeout if pool_info.max_exec_timeout else \
            workflow_config.max_exec_timeout
        max_queue_timeout = pool_info.max_queue_timeout if pool_info.max_queue_timeout else \
            workflow_config.max_queue_timeout
        if not self.exec_timeout:
            self.exec_timeout = common.to_timedelta(
                pool_info.default_exec_timeout if pool_info.default_exec_timeout else \
                workflow_config.default_exec_timeout)
        if not self.queue_timeout:
            self.queue_timeout = common.to_timedelta(
                pool_info.default_queue_timeout if pool_info.default_queue_timeout else \
                workflow_config.default_queue_timeout)

        self.exec_timeout = min(self.exec_timeout, common.to_timedelta(max_exec_timeout))
        self.queue_timeout = min(self.queue_timeout, common.to_timedelta(max_queue_timeout))


def split_assertion_rules(assertions: List[connectors.ResourceAssertion]) -> \
    Tuple[List[connectors.ResourceAssertion], List[connectors.ResourceAssertion]]:
    """
    Helper function that returns two assertion lists:
    First assertion list is static assertions, which means the assertion is evaluated
    once for the resource spec.
    Second assertion list is Kubernetes assertions, which are assertions evaluated against
    each resource available in the cluster.
    """
    k8_assertions: List[connectors.ResourceAssertion] = []
    static_assertions: List[connectors.ResourceAssertion] = []
    for assertion in assertions:
        matches_left = re.findall(common.TOKEN_MAPPING_REGEX, assertion.left_operand)
        if matches_left and any(token in matches_left[0] for token in K8_TOKENS_SET):
            k8_assertions.append(assertion)
            continue
        matches_right = re.findall(common.TOKEN_MAPPING_REGEX, assertion.right_operand)
        if matches_right and any(token in matches_right[0] for token in K8_TOKENS_SET):
            k8_assertions.append(assertion)
            continue
        static_assertions.append(assertion)
    return static_assertions, k8_assertions


class WorkflowSpec(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the workflow spec from the workflow service. """
    name: task_common.NamePattern
    pool: str = ''
    groups: List[task.TaskGroupSpec] = []
    tasks: List[task.TaskSpec] = []
    resources: Dict[str, connectors.ResourceSpec] = {'default': connectors.ResourceSpec()}
    timeout: TimeoutSpec = TimeoutSpec()
    backend: str = ''

    @pydantic.root_validator()
    @classmethod
    def validate_tasks_groups(cls, values):
        """
        Validates tasks. Returns the value of tasks if valid.

        Raises:
            ValueError: Workflow spec fails validation.
        """
        if values.get('groups') and values.get('tasks'):
            raise ValueError('Cannot use both groups and tasks in the same workflow.')

        if not values.get('groups') and not values.get('tasks'):
            raise ValueError('Workflows need to have at least one group or one task.')

        # Make sure all tasks AND groups have different names.
        name_set = set()
        def _validate_name(spec_name: str):
            name = kb_objects.k8s_name(spec_name)
            if name in name_set:
                raise ValueError(
                    f'Multiple tasks/groups have the same name: "{name}". ' \
                    'Note that names are not case sensitive and ' \
                    'we consider "-" and "_" the same. For example, ' \
                    '"Group_1" and "group-1" are considered the same name.')
            name_set.add(name)

        for task_spec in values.get('tasks', []):
            _validate_name(task_spec.name)

        for group_spec in values.get('groups', []):
            _validate_name(group_spec.name)
            for task_spec in group_spec.tasks:
                _validate_name(task_spec.name)

        return values

    def _validate_groups(self):
        """ Validates groups. """
        task_to_group: Dict[str, str] = {}
        for group_spec in self.groups:
            for task_spec in group_spec.tasks:
                # Create a map of tasks names to groups
                task_to_group[task_spec.name] = group_spec.name

        # Validate group dependencies. Make sure that:
        # 1. For each group, its upstream groups exist and are defined before itself
        # 2. No circular dependency
        # 3. No self dependency
        upstream_groups = set()
        for group_spec in self.groups:
            for group_input in group_spec.inputs:
                if isinstance(group_input, task.TaskInputOutput)\
                    and not group_input.is_from_previous_workflow():
                    try:
                        upstream_group = task_to_group[group_input.task]
                    except KeyError as _:
                        raise osmo_errors.OSMOSubmissionError(
                            f'Task input {group_input.task} does not exist.')
                    if upstream_group not in upstream_groups:
                        raise ValueError(
                            f'Group \"{group_spec.name}\" requires input group ' \
                            f'\"{upstream_group}\" exists before itself.')
            upstream_groups.add(group_spec.name)

    def parse(self, database: connectors.PostgresConnector,
              backend: str, pool: str, group_and_task_uuids: Dict[str, common.UuidPattern])\
        -> 'WorkflowSpec':
        """
        Merges non-group tasks to groups.
        Updates backend and pool values.
        Substitues resource str and osmo tokens with real values.

        Args:
            workflow_id (str): The workflow id.
            workflow_uuid (str): A unique hex id across all workflows.

        Returns:
            WorkflowSpec: The parsed workflow spec.
        """
        for task_obj in self.tasks:
            self.groups.append(task.TaskGroupSpec(name=f'{task_obj.name}-group', tasks=[task_obj]))
        self.tasks = []
        self._validate_groups()

        self.backend = backend
        self.pool = pool
        for group in self.groups:
            for task_obj in group.tasks:
                task_obj.backend = backend

        database = connectors.PostgresConnector.get_instance()
        pool_info = connectors.Pool.fetch_from_db(database, self.pool)
        for name, resource in self.resources.items():
            if not resource.platform:
                if not pool_info.default_platform or \
                    pool_info.default_platform not in pool_info.platforms:
                    raise osmo_errors.OSMOResourceError(
                        f'Resource {name} does not have a platform!')
                resource.platform = pool_info.default_platform

        try:
            groups = [group.initialize_group_tasks(group_and_task_uuids, self.resources)
                      for group in self.groups]
            if 'timeout' in self.dict(exclude_defaults=True):
                return WorkflowSpec(name=self.name, groups=groups, timeout=self.timeout,
                                    resources=self.resources, backend=self.backend, pool=self.pool)
            return WorkflowSpec(name=self.name, groups=groups,
                                resources=self.resources, backend=self.backend, pool=self.pool)

        except pydantic.ValidationError as err:
            raise osmo_errors.OSMOUsageError(f'{err}')

    def _validate_resource(self, group_task: task.TaskSpec,
                           resource_entry: ResourcesEntry,
                           resource_assertions: List[connectors.ResourceAssertion],
                           platform: str, default_variables: Dict) -> \
        ResourceValidationResult:
        """ Validate the resources and selector sections of the workflow spec. """
        lookup_table = build_resource_lookup_table(resource_entry, self.pool, platform) | \
            group_task.resources.get_allocatable_tokens(default_variables, group_task.cacheSize)

        # Quantitative resource validation: do these nodes have enough resources?
        for assertion in resource_assertions:
            try:
                assertion.evaluate(lookup_table, group_task.name)
            except AssertionError as e:
                return ResourceValidationResult(passed=False, logs=str(e))

        return ResourceValidationResult(passed=True)

    def validate_resources(self, resources: Dict[str, List[ResourcesEntry]]):
        """
        Validates the resource spec of the workflow with available resources.

        Args:
            resources (List[ResourcesEntry]): A list of the available resources and their spec

        Returns:
            bool: Represents whether or not there exists a resource that satisfies the resource
                  spec's requirements
        """
        database = connectors.PostgresConnector.get_instance()
        pool_info = connectors.Pool.fetch_from_db(database, self.pool)
        validated_resources_dict: Dict[connectors.ResourceSpec, bool] = {}
        validated_privilege_host_mount: Set[int] = set()
        for group in self.groups:
            for group_task in group.tasks:
                platform = group_task.resources.platform if group_task.resources.platform \
                    else pool_info.default_platform
                if not platform:
                    raise osmo_errors.OSMOResourceError(
                        f'Task {group_task.name} does not have a platform!')
                if platform not in pool_info.platforms:
                    raise osmo_errors.OSMOResourceError(
                        f'Platform {platform} does not exist in pool {self.pool}!')
                resource_assertions = copy.deepcopy(
                    pool_info.platforms[platform].parsed_resource_validations)

                static_assertions, k8_assertions = split_assertion_rules(resource_assertions)
                task_platform_config = pool_info.platforms[platform]
                default_variables = common.recursive_dict_update(
                    copy.deepcopy(pool_info.common_default_variables),
                    task_platform_config.default_variables,
                    common.merge_lists_on_name)
                resource_tokens = group_task.resources.get_allocatable_tokens(default_variables,
                                                                              group_task.cacheSize)
                for static_assertion in static_assertions:
                    try:
                        static_assertion.evaluate(resource_tokens, group_task.name)
                    except AssertionError as e:
                        raise osmo_errors.OSMOUserError(
                            f'Resource validation failed for task: {group_task.name}\n'
                            f'{str(e)}')
                # Check if privilege, host, and mount has been seen before
                # The node_config is based on labels and backend
                privilege_host_mount_hash = hash((group_task.privileged,
                                                  group_task.hostNetwork,
                                                  # Make list hashable
                                                  tuple(group_task.volumeMounts),
                                                  platform))
                if privilege_host_mount_hash not in validated_privilege_host_mount:
                    group_task.validate_privilege_host_mount(pool_info.platforms)
                    validated_privilege_host_mount.add(privilege_host_mount_hash)

                failure_reasons = []
                all_resources_list: List[ResourcesEntry] = []
                target_resources = []
                if k8_assertions and group_task.resources not in validated_resources_dict:
                    # Mark as False first if there are no resources
                    validated_resources_dict[group_task.resources] = False
                    if platform:
                        if platform not in resources:
                            raise osmo_errors.OSMOResourceError(
                                f'There are no resources in platform {platform} and '
                                f'pool {self.pool}!')
                        target_resources = resources[platform]
                    else:
                        if not all_resources_list:
                            all_resources_list = list(chain.from_iterable(resources.values()))
                        target_resources = all_resources_list
                    for resource in target_resources:
                        result = self._validate_resource(
                            group_task, resource, k8_assertions,
                            platform, default_variables)
                        if not result.passed:
                            failure_reasons.append((resource, result.logs))
                            continue
                        validated_resources_dict[group_task.resources] = True
                        break

                if k8_assertions and not validated_resources_dict[group_task.resources]:
                    logs = f'Resource validation failed for task: {group_task.name}\n'
                    if target_resources:
                        keys = list(filter(lambda x: not x.startswith('nvidia.com/'),
                                    filter(lambda x: x != 'kubernetes.io/arch',
                                    target_resources[0].exposed_fields.keys())))
                        table = common.osmo_table(header=keys + ['reason'])
                        table.set_cols_dtype(['t' for _ in range(len(keys) + 1)])
                        for resource, log in failure_reasons:
                            table.add_row([str(resource.exposed_fields.get(key, '-'))
                                for key in keys] + [log])
                        logs += table.draw()
                    logs += '\nPlease check available resources with "osmo resource list".'
                    raise osmo_errors.OSMOResourceError(logs, workflow_id=self.name)

    def validate_credentials(self, user: str):
        # Whether or not we have validated the user can access datasets
        # We only need to do it once since all datasets are stored in the same location
        # A list of size 1 is used to allow passing by reference instead of by copy
        seen_data_input: Set[str] = set()
        seen_data_output: Set[str] = set()
        seen_bucket_input: Set[str] = set()
        seen_bucket_output: Set[str] = set()
        seen_registries: Dict[str, Any] = {}
        database = connectors.PostgresConnector.get_instance()
        workflow_config = database.get_workflow_configs()
        dataset_config = database.get_dataset_configs()
        image_hash_map: Dict[str, str] = {}
        for group in self.groups:
            for group_task in group.tasks:
                response = self.validate_registry(
                    user, group_task, seen_registries,
                    workflow_config.credential_config.disable_registry_validation)
                if response:
                    if '@sha256' not in group_task.image:
                        if group_task.image not in image_hash_map:
                            try:
                                if response.headers['Content-Type'] == \
                                        common.DOCKER_MANIFEST_LIST_ENCODING:
                                    # Docker multi-arch manifests have a digest
                                    # OCI multi-arch image indices do not have a digest
                                    image_hash_map[group_task.image] = response.json()['digest']
                                else:
                                    # Single-arch image: use content digest
                                    if 'docker-content-digest' in response.headers:
                                        image_hash_map[group_task.image] = \
                                            response.headers['docker-content-digest']
                                    elif 'Docker-Content-Digest' in response.headers:
                                        image_hash_map[group_task.image] = \
                                            response.headers['Docker-Content-Digest']
                            except KeyError as e:
                                logging.warning(
                                    'Missing keys in docker response to retrieve image hash: %s',
                                    str(e))
                        if group_task.image in image_hash_map:
                            group_task.image += \
                                f'@{image_hash_map[group_task.image]}'
                self.validate_data(
                    user, dataset_config, group_task, seen_data_input,
                    seen_data_output, workflow_config.credential_config.disable_data_validation,
                    seen_bucket_input, seen_bucket_output)
                self.validate_generic_cred(user, database, group_task)

    def validate_generic_cred(self, user: str, database: connectors.PostgresConnector,
                              group_task: task.TaskSpec):
        for cred_name, cred_map in group_task.credentials.items():
            payload = database.get_generic_cred(user, cred_name)
            if isinstance(cred_map, str):
                continue
            elif isinstance(cred_map, Dict):
                for cred_key in cred_map.values():
                    if cred_key not in payload.keys():
                        raise osmo_errors.OSMOCredentialError(
                            f'{cred_key} is not a valid credential key ' +
                            f'please choose from {payload.keys()}')
            else:
                raise osmo_errors.OSMOCredentialError(
                    f'{cred_map} is not a valid credential map. ' +
                    'It should be either be a Dict[envirionment_variables:cred_key] ' +
                    'or a mount directory str')

    def validate_registry(self, user: str,
                          group_task: task.TaskSpec, seen_registries: Dict[str, Any],
                          disabled_registries: List[str])\
                          -> Optional[requests.Response]:
        image_info = common.docker_parse(group_task.image)

        # Check if registry needs to be validated
        if image_info.host in disabled_registries:
            return None

        if image_info.manifest_url in seen_registries:
            return seen_registries[image_info.manifest_url]

        # Authenticate with empty credential
        response = common.registry_auth(image_info.manifest_url)
        if response.status_code == 200:
            seen_registries[image_info.manifest_url] = response
            return response

        # Authenticate with user credential
        registry_cred = connectors.PostgresConnector.get_instance()\
            .get_registry_cred(user, image_info.host)

        if registry_cred:
            response = common.registry_auth(image_info.manifest_url,
                                            registry_cred['username'],
                                            registry_cred['auth'])
            if response.status_code == 200:
                seen_registries[image_info.manifest_url] = response
                return response

        error_msgs = f'Unable to authenticate for pulling image {group_task.image}. ' +\
            f'Please create a credential for {image_info.host} ' +\
            'or check if the image exists.'
        raise osmo_errors.OSMOCredentialError(error_msgs)

    def validate_data(self, user: str, dataset_config: connectors.DatasetConfig,
                      group_task: task.TaskSpec, seen_uri_input: Set[str],
                      seen_uri_output: Set[str], disabled_data: List[str],
                      seen_bucket_input: Set[str], seen_bucket_output: Set[str]):

        postgres = connectors.PostgresConnector.get_instance()
        default_user_bucket = connectors.UserProfile.fetch_from_db(postgres, user).bucket
        default_service_bucket = postgres.get_dataset_configs().default_bucket
        user_creds = postgres.get_all_data_creds(user)

        def _validate_input_output(data_spec: Union[task.InputType, task.OutputType, task.TaskKPI],
                                   is_input: bool):

            def _fetch_bucket_info(dataset_info: common.DatasetStructure)\
                -> Tuple[storage.StorageBackend, str]:
                if dataset_info.bucket:
                    bucket = dataset_info.bucket
                elif default_user_bucket:
                    bucket = default_user_bucket
                elif default_service_bucket:
                    bucket = default_service_bucket
                else:
                    raise osmo_errors.OSMOUserError(
                        'No default bucket set. Specify default bucket using the '
                        '"osmo profile set" CLI.')

                return storage.construct_storage_backend(
                    dataset_config.get_bucket_config(bucket).dataset_path), bucket

            bucket_name: Optional[str] = None
            if isinstance(data_spec, task.TaskInputOutput):
                return
            elif isinstance(data_spec, task.DatasetInputOutput):
                try:
                    dataset_info = common.DatasetStructure(data_spec.dataset.name, True)
                except osmo_errors.OSMOUserError as err:
                    raise osmo_errors.OSMOUsageError(str(err))

                bucket_info, bucket_name = _fetch_bucket_info(dataset_info)
            elif isinstance(data_spec, task.UpdateDatasetOutput):
                try:
                    dataset_info = common.DatasetStructure(data_spec.update_dataset.name, True)
                except osmo_errors.OSMOUserError as err:
                    raise osmo_errors.OSMOUsageError(str(err))

                bucket_info, bucket_name = _fetch_bucket_info(dataset_info)
            elif isinstance(data_spec, task.URLInputOutput):
                bucket_info = storage.construct_storage_backend(data_spec.url)
            else:
                raise osmo_errors.OSMOUsageError(
                    'Input/Output spec is not valid.')

            if is_input and bucket_name and bucket_name not in seen_bucket_input:
                dataset_config.get_bucket_config(bucket_name)\
                    .valid_access(bucket_name, connectors.BucketModeAccess.READ)
                seen_bucket_input.add(bucket_name)
            if not is_input and bucket_name and bucket_name not in seen_bucket_output:
                dataset_config.get_bucket_config(bucket_name)\
                    .valid_access(bucket_name, connectors.BucketModeAccess.WRITE)
                seen_bucket_output.add(bucket_name)

            # Check if data needs to be validated
            if bucket_info.scheme in disabled_data:
                return

            data_cred = task.fetch_creds(user, user_creds, bucket_info.uri)

            if data_cred is None:
                # User does not have any credentials, check if the backend
                # supports environment authentication
                if not bucket_info.supports_environment_auth:
                    raise osmo_errors.OSMOCredentialError(
                        f'Could not validate access to {bucket_info.uri} for user {user}.')
            else:
                # Check if user credentials have access to READ
                if is_input and bucket_info.uri not in seen_uri_input:
                    bucket_info.data_auth(data_cred, storage.AccessType.READ)
                    seen_uri_input.add(bucket_info.uri)

                # Check if user credentials have access to WRITE
                if not is_input and bucket_info.uri not in seen_uri_output:
                    bucket_info.data_auth(data_cred, storage.AccessType.WRITE)
                    seen_uri_output.add(bucket_info.uri)

        for input_data_spec in group_task.inputs:
            _validate_input_output(input_data_spec, True)
        for output_data_spec in group_task.outputs:
            _validate_input_output(output_data_spec, False)

    def validate_name_and_inputs(self):
        """
        Ensures that names are valid and input tasks which are from another workflow are COMPLETED
        """
        postgres = connectors.PostgresConnector.get_instance()
        workflow_config = postgres.get_workflow_configs()
        workflow_config.workflow_info.validate_name(self.name)
        for group in self.groups:
            workflow_config.workflow_info.validate_name(group.name)
            for group_task in group.tasks:
                workflow_config.workflow_info.validate_name(group_task.name)
                for task_input in group_task.inputs:
                    if isinstance(task_input, task.TaskInputOutput):
                        first_field, second_field = task_input.parsed_workflow_info()
                        if second_field:
                            previous_task = task.Task.fetch_from_db(
                                postgres, first_field, second_field)
                            if not previous_task.status.finished():
                                raise osmo_errors.OSMOSubmissionError(
                                    'Input tasks from previous workflows must be finished: '
                                    f'Workflow ID {first_field} task {second_field} has status '
                                    f'{previous_task.status}.')

    def get_num_tasks(self):
        """ Return the number of tasks in this workflow. """
        return sum(len(group.tasks) for group in self.groups)

    def saved_spec(self) -> Dict:
        base_spec = {
            'name': self.name,
            'groups': [group.saved_spec() for group in self.groups],
            'resources': {key: resource.dict(exclude_defaults=True)
                          for key, resource in self.resources.items()}
        }
        if 'timeout' in self.dict(exclude_defaults=True):
            base_spec['timeout'] = self.timeout.dict()
        return base_spec


class VersionedWorkflowSpec(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """Control the WorkflowSpec version. """
    version: int = 2  # Default to OSMO workflow spec version 2
    workflow: WorkflowSpec

    @pydantic.validator('version', pre=True, always=True)
    @classmethod
    def validate_version(cls, value: int) -> int:
        """ Validates that the version is supported.  """
        if value !=  2:
            raise ValueError(f'Unsupported workflow version: {value}.')
        return value


class TemplateSpec(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Template Spec. """
    file: str
    set_variables: List[str] = []
    set_string_variables: List[str] = []
    uploaded_templated_spec: str | None = None

    def load_template_with_variables(self) -> str:
        """
        Assigns the set variables to the workflow_file

        Args:
            workflow_file : workflow file path
            set_variables : jinja variables to override

        Raises:
            utils.OSMOUserError: YAML incorrectly configured or variable incorrectly named
            utils.OSMOServerError: Response json missing workflow_id

        Returns:
            str: yaml file
        """
        try:
            file_text, default_values = workflow_utils.parse_workflow_spec(self.file)
            template_data: Dict[str, Any] = {}
            if default_values:
                template_data = default_values

            # Get CLI set values
            for data in self.set_variables:
                if data.count('=') == 0:
                    raise osmo_errors.OSMOUsageError(
                        f'Data {data} is incorrectly formatted')
                data_split = data.split('=', 1)
                try:
                    try:
                        # Try int
                        template_data[data_split[0]] = int(data_split[1])
                    except ValueError:
                        # Try float
                        template_data[data_split[0]] = float(data_split[1])
                except ValueError:
                    # Default string
                    template_data[data_split[0]] = data_split[1]

            for data in self.set_string_variables:
                if data.count('=') == 0:
                    raise osmo_errors.OSMOUsageError(
                        f'Data {data} is incorrectly formatted')
                data_split = data.split('=', 1)
                template_data[data_split[0]] = data_split[1]

            # Assign osmo tokens to unique hash values
            result = re.findall(r'{{(uuid|workflow_id|output|input:[^}]+|host:[^}]+)}}', file_text)
            for field in result:
                field_stripped = field.strip()
                hash_str = 'hash' + \
                    str(int(hashlib.md5(bytes(field_stripped, 'utf-8')).hexdigest(), 16))
                template_data[hash_str] = '{{' + field + '}}'
                file_text = file_text.replace('{{' + field + '}}', '{{' + str(hash_str) + '}}')

            postgres = connectors.PostgresConnector.get_instance()
            workflow_config = postgres.get_workflow_configs()

            updated_workflow = jinja_sandbox.sandboxed_jinja_substitute(
                file_text,
                template_data,
                workflow_config.user_workflow_limits.jinja_sandbox_workers,
                workflow_config.user_workflow_limits.jinja_sandbox_max_time,
                workflow_config.user_workflow_limits.jinja_sandbox_memory_limit)
            return updated_workflow
        except (jinja_sandbox.exceptions.TemplateError, TypeError) as jinja_error:
            raise osmo_errors.OSMOUsageError(f'Jinja Template Error: {jinja_error}')


class LogInfo(pydantic.BaseModel):
    """ Used for printing logs. """
    logs: str
    backend: str

    @classmethod
    def fetch_log_info_from_db(cls, database: connectors.PostgresConnector,
                               workflow_id: task_common.NamePattern) -> 'LogInfo':
        fetch_cmd = '''
            SELECT logs, backend FROM workflows WHERE (workflow_id = %s or workflow_uuid = %s);
        '''
        workflow_rows = database.execute_fetch_command(fetch_cmd, (workflow_id, workflow_id))
        try:
            workflow_row = workflow_rows[0]
        except IndexError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Workflow {workflow_id} is not found.') from err

        return LogInfo(logs=workflow_row.logs, backend=workflow_row.backend)


class Workflow(pydantic.BaseModel):
    """ Represents the workflow object. """
    workflow_name: task_common.NamePattern
    job_id: int | None = None
    workflow_id_internal: task_common.NamePattern | None = None
    workflow_uuid: common.UuidPattern
    groups: List[task.TaskGroup]
    user: str
    logs: str
    database: connectors.PostgresConnector
    submit_time: datetime.datetime | None = None
    start_time: datetime.datetime | None = None
    end_time: datetime.datetime | None = None
    status: WorkflowStatus = WorkflowStatus.PENDING
    timeout: TimeoutSpec = TimeoutSpec()
    priority: wf_priority.WorkflowPriority
    cancelled_by: str | None
    outputs: str = ''
    backend: str
    # TODO make pool not None
    pool: str | None
    version: int | None = 0
    failure_message: str | None = ''
    parent_name: task_common.NamePattern | None = None
    app_uuid: str | None = None
    app_version: int | None = None
    parent_job_id: int | None = None
    plugins: task_common.WorkflowPlugins = task_common.WorkflowPlugins()

    class Config:
        arbitrary_types_allowed = True
        extra = 'forbid'

    def insert_to_db(self, version: int = 2):
        """ Creates an entry in the database for the overall workflow. """
        insert_cmd = '''
            WITH last_job AS (
                SELECT COALESCE(MAX(job_id), 0) AS max_job_id
                FROM workflows
                WHERE workflow_name = %s
            )
            INSERT INTO workflows
            (workflow_name, job_id, workflow_id, workflow_uuid, submitted_by, submit_time,
                start_time, end_time, status, logs, exec_timeout, queue_timeout, backend, pool,
                version, failure_message, parent_name, parent_job_id, app_uuid, app_version,
                plugins, priority)
            SELECT
                %s AS workflow_name,
                (max_job_id + 1) AS job_id,
                CONCAT(%s, '-', (max_job_id + 1)) AS workflow_id,
                %s AS workflow_uuid,
                %s AS submitted_by,
                %s AS submit_time,
                %s AS start_time,
                %s AS end_time,
                %s AS status,
                %s AS logs,
                %s AS exec_timeout,
                %s AS queue_timeout,
                %s AS backend,
                %s AS pool,
                %s AS version,
                %s AS failure_message,
                %s AS parent_name,
                %s AS parent_job_id,
                %s AS app_uuid,
                %s AS app_version,
                %s AS plugins,
                %s AS priority
            FROM last_job
            ON CONFLICT (workflow_uuid) DO NOTHING;
        '''
        exec_timeout, queue_timeout = None, None

        if self.timeout.exec_timeout:
            exec_timeout = self.timeout.exec_timeout.total_seconds()

        if self.timeout.queue_timeout:
            queue_timeout = self.timeout.queue_timeout.total_seconds()

        self.submit_time = common.current_time()
        if self.status == WorkflowStatus.FAILED_SUBMISSION:
            self.start_time = self.submit_time
            self.end_time = self.submit_time

        # There is a race condition that can exist if two of these calls on the same workflow_name
        # occur where they will both try to insert the same workflow_id
        attempt = 0
        while True:
            attempt += 1
            try:
                self.database.execute_commit_command(
                    insert_cmd,
                    (self.workflow_name, self.workflow_name,
                        self.workflow_name, self.workflow_uuid,
                        self.user, self.submit_time, self.start_time, self.end_time,
                        self.status.name, self.logs, exec_timeout, queue_timeout, self.backend,
                        self.pool, version, self.failure_message, self.parent_name,
                        self.parent_job_id, self.app_uuid, self.app_version, self.plugins.json(),
                        self.priority.value))
                break
            except osmo_errors.OSMODatabaseError as err:
                if attempt >= INSERT_RETRY_COUNT:
                    raise err

        workflow_config = self.database.get_workflow_configs()
        self.update_output_path(workflow_config)
        update_cmd = 'UPDATE workflows SET outputs = %s WHERE workflow_uuid = %s'
        self.database.execute_commit_command(update_cmd, (self.outputs, self.workflow_uuid))

    @property
    def workflow_id(self) -> str:
        if self.workflow_id_internal:
            return self.workflow_id_internal

        fetch_cmd = 'SELECT workflow_id FROM workflows where workflow_uuid = %s'
        workflow_info = self.database.execute_fetch_command(fetch_cmd,
                                                            (self.workflow_uuid,), True)
        try:
            fetched_workflow_id: str = workflow_info[0]['workflow_id']
            self.workflow_id_internal = fetched_workflow_id
        except IndexError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Workflow with UUID {self.workflow_uuid} needs to '
                'be inserted in the database first.') from err
        return fetched_workflow_id


    @classmethod
    def from_workflow(
        cls, database: connectors.PostgresConnector, workflow_name: task_common.NamePattern,
        workflow_uuid: str, user: str, backend: str, pool: str, log_url: str = '',
        status: str = WorkflowStatus.FAILED_SUBMISSION,
        failure_message: str = '',
        parent_workflow_id: task_common.NamePattern | None = None,
        app_uuid: str | None = None, app_version: int | None = None,
        priority: wf_priority.WorkflowPriority = wf_priority.WorkflowPriority.NORMAL) -> 'Workflow':
        """ Creates a Workflow instance for FAILED_SUBMISSION record """
        parent_name = None
        parent_job_id = None
        if parent_workflow_id:
            parent_name, parent_job_id = common.deconstruct_workflow_id(parent_workflow_id)
        return Workflow(workflow_name=workflow_name,
                        workflow_uuid=workflow_uuid, user=user,
                        database=database, status=status, backend=backend, pool=pool, logs=log_url,
                        groups=[], failure_message=failure_message, parent_name=parent_name,
                        parent_job_id=parent_job_id, app_uuid=app_uuid, app_version=app_version,
                        priority=priority)

    @classmethod
    def from_workflow_spec(cls, database: connectors.PostgresConnector,
        workflow_name: task_common.NamePattern, workflow_uuid: str,
        user: str, workflow_spec: WorkflowSpec, log_url: str,
        group_and_task_uuids: Dict[str, common.UuidPattern],
        remaining_upstream_groups: Dict,
        downstream_groups: Dict,
        status: str = WorkflowStatus.PENDING,
        failure_message: str = '',
        parent_workflow_id: task_common.NamePattern | None = None,
        app_uuid: str | None = None,
        app_version: int | None = None,
        task_db_keys: Dict[str, str] | None = None,
        priority: wf_priority.WorkflowPriority = wf_priority.WorkflowPriority.NORMAL) \
        -> 'Workflow':
        """ Creates a Workflow instance from a WorkflowSpec instance. """
        task_to_group: Dict[str, str] = {}
        for group_spec in workflow_spec.groups:
            for task_spec in group_spec.tasks:
                task_to_group[task_spec.name] = group_spec.name

        for group_spec in workflow_spec.groups:
            for group_input in group_spec.inputs:
                if isinstance(group_input, task.TaskInputOutput)\
                    and not group_input.is_from_previous_workflow():
                    remaining_upstream_groups[group_spec.name].add(task_to_group[group_input.task])
                    downstream_groups[task_to_group[group_input.task]].add(group_spec.name)

        workflow_config = database.get_workflow_configs()

        backend = workflow_spec.backend

        pool_info = connectors.Pool.fetch_from_db(database, workflow_spec.pool)

        workflow_spec.timeout.fill_defaults(workflow_config, pool_info)

        parent_name = None
        parent_job_id = None
        if parent_workflow_id:
            parent_name, parent_job_id = common.deconstruct_workflow_id(parent_workflow_id)

        new_workflow = Workflow(workflow_name=workflow_name,
                                workflow_uuid=workflow_uuid, user=user,
                                logs=log_url, groups=[], database=database,
                                timeout=workflow_spec.timeout, backend=backend,
                                pool=workflow_spec.pool,
                                outputs='', status=status, failure_message=failure_message,
                                parent_name=parent_name, parent_job_id=parent_job_id,
                                app_uuid=app_uuid, app_version=app_version,
                                plugins=create_workflow_plugins(workflow_config), priority=priority)
        new_workflow.update_groups(workflow_spec, group_and_task_uuids,
                                   remaining_upstream_groups, downstream_groups, task_db_keys)

        return new_workflow

    @classmethod
    def fetch_new_job_id(
        cls, database: connectors.PostgresConnector, workflow_name: task_common.NamePattern) -> int:
        """ Fetches new job_id for a workflow with workflow_name """
        fetch_cmd = '''
            SELECT job_id FROM workflows WHERE workflow_name = %s ORDER BY job_id DESC LIMIT 1;
        '''

        rows = database.execute_fetch_command(fetch_cmd, (workflow_name,))
        if not rows:
            return 1
        return rows[0].job_id + 1

    @classmethod
    def fetch_from_db(cls, database: connectors.PostgresConnector,
                      workflow_id: task_common.NamePattern,
                      fetch_groups: bool = True, verbose: bool = False) -> 'Workflow':
        """
        Creates a Workflow instance from a database workflow entry.

        Args:
            workflow_id (task_common.NamePattern): The workflow id or workflow_uuid.

        Raises:
            OSMODatabaseError: The workflow is not found in the database.

        Returns:
            Workflow: The workflow.
        """
        fetch_cmd = 'SELECT * FROM workflows WHERE (workflow_id = %s or workflow_uuid = %s);'
        workflow_rows = database.execute_fetch_command(fetch_cmd, (workflow_id, workflow_id), True)
        try:
            workflow_row = workflow_rows[0]
        except IndexError as err:
            raise osmo_errors.OSMODatabaseError(
                f'Workflow {workflow_id} is not found.') from err

        exec_timeout, queue_timeout = None, None

        if workflow_row['exec_timeout']:
            exec_timeout = float(workflow_row['exec_timeout'])

        if workflow_row['queue_timeout']:
            queue_timeout = float(workflow_row['queue_timeout'])

        backend = workflow_row['backend']

        groups = []
        if fetch_groups:
            fetch_cmd = 'SELECT * FROM groups WHERE workflow_id = %s order by start_time;'
            group_rows = database.execute_fetch_command(
                fetch_cmd, (workflow_row['workflow_id'],), return_raw=True)
            groups = [
                task.TaskGroup.fetch_from_db(
                    database, workflow_row['workflow_id'], row['name'], verbose)
                for row in group_rows]

        return Workflow(workflow_name=workflow_row['workflow_name'],
                        job_id=workflow_row['job_id'],
                        workflow_id_internal=workflow_row['workflow_id'],
                        workflow_uuid=workflow_row['workflow_uuid'],
                        groups=groups, user=workflow_row['submitted_by'],
                        logs=workflow_row['logs'], submit_time=workflow_row['submit_time'],
                        start_time=workflow_row['start_time'], end_time=workflow_row['end_time'],
                        timeout={'exec_timeout': exec_timeout,
                                 'queue_timeout': queue_timeout},
                        status=WorkflowStatus(workflow_row['status']), database=database,
                        cancelled_by=workflow_row['cancelled_by'],
                        outputs=workflow_row['outputs'],
                        backend=backend,
                        pool=workflow_row['pool'],
                        failure_message=workflow_row['failure_message'],
                        parent_name=workflow_row['parent_name'],
                        parent_job_id=workflow_row['parent_job_id'],
                        app_uuid=workflow_row['app_uuid'],
                        app_version=workflow_row['app_version'],
                        plugins=task_common.WorkflowPlugins(**workflow_row['plugins']),
                        priority=wf_priority.WorkflowPriority(workflow_row['priority']))

    def update_groups(self, workflow_spec: WorkflowSpec, group_and_task_uuids: Dict,
                      remaining_upstream_groups: Dict, downstream_groups: Dict,
                      task_db_keys: Dict[str, str] | None = None):
        if task_db_keys is None:
            task_db_keys = {}
        groups = []
        for group_spec in workflow_spec.groups:
            tasks = []
            for task_spec in group_spec.tasks:
                tasks.append(task.Task(
                    name=task_spec.name,
                    workflow_uuid=self.workflow_uuid,
                    group_name=group_spec.name,
                    task_db_key=task_db_keys.get(task_spec.name, common.generate_unique_id()),
                    task_uuid=group_and_task_uuids[task_spec.name],
                    database=self.database,
                    exit_actions=task_spec.exitActions,
                    lead=task_spec.lead))
            groups.append(task.TaskGroup(
                          name=group_spec.name,
                          group_uuid=group_and_task_uuids[group_spec.name],
                          spec=group_spec,
                          tasks=tasks,
                          remaining_upstream_groups=remaining_upstream_groups[group_spec.name],
                          downstream_groups=downstream_groups[group_spec.name],
                          database=self.database))
        self.groups = groups

    def update_output_path(self, workflow_config):
        base_url = workflow_config.workflow_data.base_url
        self.outputs = f'{base_url}/{self.workflow_id}' if base_url else ''

    def update_log_to_db(self, logs: str):
        """ Updates workflow logs field after logs are moved from Redis to S3. """
        update_cmd = connectors.PostgresUpdateCommand(table='workflows')
        update_cmd.add_condition('workflow_id = %s', [self.workflow_id])
        update_cmd.add_field('logs', logs)
        self.database.execute_commit_command(*update_cmd.get_args())

    def update_events_to_db(self, events: str):
        """ Updates workflow events field after events are moved from Redis to S3. """
        update_cmd = connectors.PostgresUpdateCommand(table='workflows')
        update_cmd.add_condition('workflow_id = %s', [self.workflow_id])
        update_cmd.add_field('events', events)
        self.database.execute_commit_command(*update_cmd.get_args())

    def update_cancelled_by(self, canceled_by: str):
        update_cmd = connectors.PostgresUpdateCommand(table='workflows')
        update_cmd.add_condition('workflow_id = %s', [self.workflow_id])
        update_cmd.add_condition("status IN ('PENDING', 'RUNNING', 'WAITING')", [])
        update_cmd.add_condition('cancelled_by = NULL', [])
        update_cmd.add_field('cancelled_by', canceled_by)
        self.database.execute_commit_command(*update_cmd.get_args())

    def update_status_to_db(self, update_time: datetime.datetime, canceled_by: str = '') \
        -> WorkflowStatus:
        """ Updates workflow status based on the task status. """
        fetch_cmd = 'SELECT status FROM groups WHERE workflow_id = %s;'
        task_rows = self.database.execute_fetch_command(fetch_cmd, (self.workflow_id,))
        task_statuses = [task.TaskGroupStatus(row.status) for row in task_rows]
        workflow_status = self._aggregate_status(task_statuses)
        # If the status hasn't changed, then do nothing
        if workflow_status == self.status:
            return workflow_status

        # New status is either running/waiting or finished
        # Only update start_time when it hasn't started
        if workflow_status in (WorkflowStatus.RUNNING, WorkflowStatus.WAITING):
            update_cmd = connectors.PostgresUpdateCommand(table='workflows')
            update_cmd.add_condition('workflow_id = %s', [self.workflow_id])
            update_cmd.add_condition("status IN ('RUNNING', 'WAITING', 'PENDING')", [])
            # Only update the start_time if it is NULL
            start_time_expression = 'CASE WHEN start_time IS NULL THEN %s ELSE start_time END'
            update_cmd.add_field('start_time', update_time, custom_expression=start_time_expression)
            update_cmd.add_field('status', workflow_status.name)
            self.database.execute_commit_command(*update_cmd.get_args())

        # Only update end_time when it has finished
        if workflow_status.finished():
            update_cmd = connectors.PostgresUpdateCommand(table='workflows')
            update_cmd.add_condition('workflow_id = %s AND end_time IS NULL', [self.workflow_id])
            update_cmd.add_field('status', workflow_status.name)
            update_cmd.add_field('end_time', update_time)

            if canceled_by and \
                any(s == task.TaskGroupStatus.FAILED_CANCELED for s in task_statuses):
                update_cmd.add_field('cancelled_by', canceled_by)
            self.database.execute_commit_command(*update_cmd.get_args())

        return workflow_status

    def send_notification(self, workflow_status: WorkflowStatus):
        # Send notification
        ntf_preference = connectors.UserProfile.fetch_from_db(self.database,
                                                              self.user)
        service_config = self.database.get_service_configs()
        workflow_config = self.database.get_workflow_configs()
        parsed_service_url = urlparse(service_config.service_base_url)
        service_url = f'''{parsed_service_url.scheme}://{parsed_service_url.hostname}'''
        workflow_url = f'{service_url}/workflows/{self.workflow_id}'

        notifier = notify.Notifier(workflow_config.workflow_alerts)
        # Send slack message
        if ntf_preference.slack_notification:
            notifier.send_slack_notification(
                self.user, self.workflow_id, workflow_status.name, workflow_url)

        # Send email
        if ntf_preference.email_notification:
            notifier.send_email_notification(self.user, self.workflow_id,
                                             workflow_status.name, workflow_url)

    def get_group_objs(self) -> List[task.TaskGroup]:
        """ Return task group objects by querying the task database. """

        fetch_cmd = 'SELECT name FROM groups WHERE workflow_id = %s;'
        groups_objs = []
        group_rows = self.database.execute_fetch_command(fetch_cmd, (self.workflow_id,))
        for group_row in group_rows:
            group_obj = task.TaskGroup.fetch_from_db(self.database, self.workflow_id,
                                                     group_row.name)
            groups_objs.append(group_obj)
        return groups_objs

    def _has_running_tasks(self) -> bool:
        """ Returns true if there are any running tasks in the workflow. """
        fetch_cmd = '''
            SELECT t.status FROM tasks t
            WHERE workflow_id = %s
            AND retry_id = (
                SELECT MAX(retry_id) FROM tasks
                WHERE name = t.name AND workflow_id = %s
            );
        '''
        task_rows = self.database.execute_fetch_command(fetch_cmd, (self.workflow_id,
            self.workflow_id), return_raw=True)
        return any(t.get('status') == 'RUNNING' for t in task_rows)

    def _aggregate_status(self, statuses: List[task.TaskGroupStatus]) -> WorkflowStatus:
        """
        Gets the workflow status from task statuses.

        Args:
            statuses (List[task.TaskGroupStatus]): Task statuses.

        Returns:
            WorkflowStatus: New workflow status.
        """
        if any(not s.finished() for s in statuses):
            if any(s == task.TaskGroupStatus.RUNNING for s in statuses):
                # If all tasks in a group are rescheduled, then the group is running.
                # Return WAITING status.
                # TODO Disable WAITING to avoid race in updating RUNNING and WAITING
                # if not self._has_running_tasks():
                #     return WorkflowStatus.WAITING
                return WorkflowStatus.RUNNING
            else:
                # If nothing is RUNNING and the workflow isnt PENDING, then something must have
                # been running previously. Return WAITING status.
                # TODO Disable WAITING to avoid race in updating RUNNING and WAITING
                # if self.status != WorkflowStatus.PENDING:
                #     return WorkflowStatus.WAITING
                return WorkflowStatus.PENDING
        if any(s == task.TaskGroupStatus.FAILED_CANCELED for s in statuses):
            return WorkflowStatus.FAILED_CANCELED
        if any(s == task.TaskGroupStatus.FAILED_SERVER_ERROR for s in statuses):
            return WorkflowStatus.FAILED_SERVER_ERROR
        if any(s == task.TaskGroupStatus.FAILED_EXEC_TIMEOUT for s in statuses):
            return WorkflowStatus.FAILED_EXEC_TIMEOUT
        if any(s == task.TaskGroupStatus.FAILED_QUEUE_TIMEOUT for s in statuses):
            return WorkflowStatus.FAILED_QUEUE_TIMEOUT
        if any(s.failed() for s in statuses):
            # If failed groups are failed for the same reason,
            # then the workflow is failed for that specific reason.
            failed_statuses = [s for s in statuses if s.failed() and s.name != 'FAILED_UPSTREAM']
            if len(set(failed_statuses)) == 1:
                return WorkflowStatus(failed_statuses[0].name)
            return WorkflowStatus.FAILED
        if all(s == task.TaskGroupStatus.COMPLETED for s in statuses):
            return WorkflowStatus.COMPLETED
        return WorkflowStatus.RUNNING

    def mark_groups_as_waiting(self) -> bool:
        """
        Updates group status to scheduling if it hasn't been canceled.
        Returns true if it has NOT been canceled.
        """
        commit_cmd = '''
            UPDATE groups
            SET status = %s
            FROM workflows
            WHERE groups.workflow_id = workflows.workflow_id
            AND workflows.workflow_id = %s
            AND cancelled_by is NULL
            AND groups.status in ('SUBMITTING');
        '''
        self.database.execute_commit_command(commit_cmd,
                                             (task.TaskGroupStatus.WAITING.value,
                                              self.workflow_id,))
        # Check if the status was updated
        fetch_cmd = '''
            SELECT name from groups
            WHERE workflow_id = %s
            AND status = %s;
        '''
        task_rows = self.database.execute_fetch_command(fetch_cmd,
                                                        (self.workflow_id,
                                                         task.TaskGroupStatus.WAITING.value))
        return len(task_rows) > 0

    def get_task_db_keys(self) -> Dict[str, str]:
        """ Get the task db keys for the workflow. """
        task_db_keys = {}
        for group_obj in self.groups:
            for task_obj in group_obj.tasks:
                task_db_keys[task_obj.name] = task_obj.task_db_key
        return task_db_keys


def get_num_workflows_and_tasks(
        database: connectors.PostgresConnector,
        user: str,
        workflow_statuses: List[WorkflowStatus] | None = None,
        task_statuses: List[task.TaskGroupStatus] | None = None,
) -> Tuple[int, int]:
    """ Get the number of workflows and tasks for a user. """
    cmd = '''
        SELECT
            COUNT(DISTINCT w.workflow_uuid) AS workflow_count,
            COUNT(DISTINCT t.task_db_key) AS task_count
        FROM workflows w
        LEFT JOIN tasks t ON w.workflow_id = t.workflow_id
        WHERE w.submitted_by = %s
    '''
    params: List[Any] = [user]

    if workflow_statuses:
        cmd += ' AND w.status = ANY(%s)'
        params.append([status.value for status in workflow_statuses])

    if task_statuses:
        cmd += ' AND t.status = ANY(%s)'
        params.append([status.value for status in task_statuses])

    results = database.execute_fetch_command(
        cmd, tuple(params), return_raw=True)
    return results[0]['workflow_count'], results[0]['task_count']


def create_workflow_plugins(
    workflow_config: connectors.WorkflowConfig,
) -> task_common.WorkflowPlugins:
    """ Creates a workflow plugins object from a workflow config. """
    return task_common.WorkflowPlugins(
        rsync=workflow_config.plugins_config.rsync.enabled,
    )
