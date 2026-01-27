"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES.
All rights reserved.

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

from collections import abc
from datetime import datetime
import json
import logging
from typing import Any, Dict, List

import pydantic
import yaml

from src.lib.utils import common, osmo_errors
from src.utils.job import backend_jobs, kb_objects, workflow
from src.service.core.config import objects as configs_objects
from src.service.core.workflow import objects
from src.utils import connectors


def update_backend_queues(current_backend: connectors.Backend,
    prev_backend: connectors.Backend | None = None):
    """
    Update the k8s scheduler objects (queues, topologies, etc.) in the backend

    Args:
        current_backend: The current configuration of the backend to update objects for
        prev_backend: The previous configuration of the backend to delete objects for
    """
    # Lookup all pools for the backend
    postgres = connectors.PostgresConnector.get_instance()
    pool_rows = connectors.Pool.fetch_rows_from_db(postgres, backend=current_backend.name)
    pools = [connectors.Pool(**row) for row in pool_rows]

    # Get all scheduler objects (queues, topologies, etc.) for the backend
    kb_factory = kb_objects.get_k8s_object_factory(current_backend)
    cleanup_specs = kb_factory.list_scheduler_resources_spec(current_backend)
    objects_list = kb_factory.get_scheduler_resources_spec(current_backend, pools)

    # If we are switching scheduler types, also include cleanup specs from old scheduler
    # so those objects get deleted
    if (prev_backend is not None and
        prev_backend.scheduler_settings.scheduler_type !=
            current_backend.scheduler_settings.scheduler_type):
        prev_kb_factory = kb_objects.get_k8s_object_factory(prev_backend)
        prev_cleanup_specs = prev_kb_factory.list_scheduler_resources_spec(prev_backend)
        if prev_cleanup_specs:
            # Deduplicate cleanup_specs to avoid processing the same resource type twice
            # if both old and new schedulers use the same resource types with same labels
            seen_specs = set()
            deduped_specs = []
            for spec in cleanup_specs + prev_cleanup_specs:
                # Create a hashable key from the spec's key fields
                key = (
                    spec.resource_type,
                    tuple(sorted(spec.labels.items())),
                    (spec.custom_api.api_major, spec.custom_api.api_minor,
                     spec.custom_api.path) if spec.custom_api else None
                )
                if key not in seen_specs:
                    seen_specs.add(key)
                    deduped_specs.append(spec)
            cleanup_specs = deduped_specs

    if not cleanup_specs or not objects_list:
        return

    job = backend_jobs.BackendSynchronizeQueues(
        backend=current_backend.name,
        k8s_resources=objects_list,  # Contains both Queue and Topology CRDs
        # Specs for both object types (including old scheduler if switching)
        cleanup_specs=cleanup_specs
    )
    job.send_job_to_queue()


def put_configs(
    request: configs_objects.PutConfigsRequest,
    config_type: connectors.ConfigType,
    username: str,
    should_serialize: bool = True,
) -> Dict:
    """Update configuration and create a history entry.

    Args:
        configs: The new configuration to apply
        config_type: Type of configuration being updated
        history_metadata: Metadata for history entry (osmo_user, description, and tags)
        should_serialize: Whether to serialize the config before storing.
                            Skip serialization when rolling back a config.

    Returns:
        Dict containing the updated configuration
    """
    postgres = connectors.PostgresConnector.get_instance()
    if should_serialize:
        updated_configs = request.configs.serialize(postgres)
    else:
        updated_configs = request.configs.plaintext_dict(by_alias=True, exclude_unset=True)
        # Convert dict and list values to JSON strings
        for key, value in updated_configs.items():
            if isinstance(value, (dict, list)):
                updated_configs[key] = json.dumps(value)

    for key, value in updated_configs.items():
        postgres.set_config(key, value, config_type)
    configs_dict = postgres.get_configs(config_type).plaintext_dict(
        exclude_unset=True, by_alias=True
    )
    postgres.create_config_history_entry(
        config_type=config_type,
        name='',
        username=username,
        data=configs_dict,
        description=request.description
        or f'Set complete {config_type.value.lower()} configuration',
        tags=request.tags,
    )
    return configs_dict


def patch_configs(
    request: configs_objects.PatchConfigRequest,
    config_type: connectors.ConfigType,
    username: str,
    name: str = '',
) -> Dict:
    """
    Patch configuration values for the given config type.

    Args:
        request: The request object containing the config values to patch.
        config_type: The type of configuration to update.
        username: The username of the user updating the config.
        name: The name of the config to patch. Used for updating a specific bucket in a dataset.

    Returns:
        Dict containing the updated configuration fields.
    """
    postgres = connectors.PostgresConnector.get_instance()
    current_configs_dict = postgres.get_configs(config_type).plaintext_dict(
        by_alias=True, exclude_unset=True)

    updated_configs = common.strategic_merge_patch(
        current_configs_dict, request.configs_dict
    )
    updated_configs_fields = {}

    for key, value in updated_configs.items():
        if value != current_configs_dict.get(key):
            updated_configs_fields[key] = value

    try:
        if postgres.get_method() != 'dev':
            connectors.ExtraArgBaseModel.set_extra(connectors.ExtraType.FORBID)

        configs: connectors.DynamicConfig
        if config_type == connectors.ConfigType.SERVICE:
            configs = connectors.ServiceConfig(**updated_configs_fields)
        elif config_type == connectors.ConfigType.WORKFLOW:
            configs = connectors.WorkflowConfig(**updated_configs_fields)
        elif config_type == connectors.ConfigType.DATASET:
            configs = connectors.DatasetConfig(**updated_configs_fields)
            try:
                for _, bucket_config in configs.buckets.items():
                    connectors.BucketMode(bucket_config.mode.lower())
                    bucket_config.mode = bucket_config.mode.lower()
            except ValueError as _:
                raise osmo_errors.OSMOUserError(
                    f'Bucket mode {bucket_config.mode} is not valid. Valid modes are '
                    f'{", ".join([member.value for member in connectors.BucketMode])}')

        else:
            raise osmo_errors.OSMOServerError(f'Config type: {config_type.value} unknown')

        if postgres.get_method() != 'dev':
            connectors.ExtraArgBaseModel.set_extra(connectors.ExtraType.IGNORE)
        updated_configs = configs.serialize(postgres)
        for key, value in updated_configs.items():
            postgres.set_config(key, value, config_type)
    except pydantic.ValidationError as err:
        raise osmo_errors.OSMOUsageError(f'{err}')

    postgres.create_config_history_entry(
        config_type=config_type,
        name=name,
        username=username,
        data=postgres.get_configs(config_type).plaintext_dict(
            by_alias=True, exclude_unset=True
        ),
        description=request.description
        or f'Patched {config_type.value.lower()} configuration',
        tags=request.tags,
    )

    new_configs_dict = postgres.get_configs(config_type).dict(by_alias=True, exclude_unset=True)
    return {key: value for key, value in new_configs_dict.items() if key in request.configs_dict}

def backend_action_request_helper(payload: Dict[str, Any], name: str):

    """ Helper function that implements support for exec and portforward. """
    redis_client = connectors.RedisConnector.get_instance().client

    action_attributes: Dict[str, Any] = {**payload}
    # Store action_attributes directly in the queue
    redis_queue_name = connectors.backend_action_queue_name(name)
    # logging.info('Send action attributes %s to queue %s', action_attributes, redis_queue_name)
    redis_client.lpush(redis_queue_name, json.dumps(action_attributes))

def _update_backend_helper(
    postgres: connectors.PostgresConnector,
    backend: configs_objects.BackendConfigWithName
):
    """
    Updates the given backend in the database.
    """
    configs = backend.plaintext_dict(by_alias=True, exclude_unset=True)

    values: List[str] = []
    params: List[Any] = []
    send_update = False

    for key, value in configs.items():
        if value is not None:
            values.append(f'{key} = %s')
            params.append(value)
        if key == 'node_conditions' and value:
            send_update = True
        if key == 'tests' and value:
            # Check for duplicates in the original list
            if len(value) != len(set(value)):
                raise osmo_errors.OSMOUserError('Backend tests list contains duplicates')
            # Verify tests exist in backend_tests table
            for test in value:
                try:
                    connectors.BackendTests.fetch_from_db(postgres, test)
                except osmo_errors.OSMOUserError as e:
                    raise osmo_errors.OSMOUserError(
                        f'Backend test with name {test} not found') from e
    params.append(configs['name'])

    update_cmd = (
        f'UPDATE backends SET {", ".join(values)} WHERE name = %s RETURNING name;'
    )
    result = postgres.execute_fetch_command(update_cmd, tuple(params))
    if not result:
        raise osmo_errors.OSMOBackendError(f"Backend '{configs['name']}' not found")

    # Check if the backend node_conditions has changed
    if send_update:
        backend_action_request_helper(
            payload=yaml.safe_load(configs['node_conditions']),
            name=configs['name'],
        )

def create_backend_config_history_entry(
    postgres: connectors.PostgresConnector,
    name: str,
    username: str,
    description: str,
    tags: List[str] | None,
):
    """
    Create a history entry for a backend config.
    """
    backends = connectors.Backend.list_from_db(postgres)

    backends_list = [
        backend.dict(by_alias=True, exclude_unset=True)
        for backend in backends
    ]

    postgres.create_config_history_entry(
        config_type=connectors.ConfigHistoryType.BACKEND,
        name=name,
        username=username,
        data=backends_list,
        description=description or f'Set backend \'{name}\' configuration',
        tags=tags,
    )

def update_backend(
    name: str,
    request: configs_objects.PostBackendRequest,
    username: str,
):
    """
    Updates the backend configuration in the database.
    Updates the CronJobs for the backend tests.
    Updates sync queues for the backend


    Args:
        name: The name of the backend to update.
        request: The request object containing the backend configuration.
        username: The username of the user updating the backend.
    """
    postgres = connectors.PostgresConnector.get_instance()
    try:
        old_backend = connectors.Backend.fetch_from_db(postgres, name)
    except pydantic.error_wrappers.ValidationError as e:
        logging.warning('Failed to get previous backend %s: %s', name, e)
        old_backend = None
    _update_backend_helper(postgres, configs_objects.BackendConfigWithName(
        **request.configs.dict(), name=name))

    create_backend_config_history_entry(
        postgres, name, username, request.description or f"Updated backend \'{name}\'", request.tags
    )

    new_backend = connectors.Backend.fetch_from_db(postgres, name)

    if new_backend is None:
        raise osmo_errors.OSMOBackendError(f"Backend '{name}' not found after update")

    # Update backend queues
    update_backend_queues(new_backend, old_backend)

    # Update backend test CronJobs if tests configuration changed
    old_tests = old_backend.tests if old_backend else None
    new_tests = new_backend.tests
    if old_tests != new_tests:
        logging.info('Backend tests changed for %s: %s -> %s', name, old_tests, new_tests)
        update_backend_tests_cronjobs(name, new_tests or [], new_backend.node_conditions.prefix)


def update_backends(
    request: configs_objects.UpdateBackends,
    username: str,
):
    """
    Update multiple backend configurations in the database.

    Args:
        request: The request object containing backend configurations and metadata.
        username: The username of the user updating the backends.
    """
    postgres = connectors.PostgresConnector.get_instance()

    previous_backends = {
        backend.name: backend
        for backend in connectors.Backend.list_from_db(postgres)
    }

    for backend in request.backends:
        _update_backend_helper(postgres, backend)

    create_backend_config_history_entry(
        postgres,
        '',
        username,
        request.description or 'Updated all backend configurations',
        request.tags,
    )

    backends = connectors.Backend.list_from_db(postgres)
    for new_backend in backends:
        prev_backend = previous_backends.get(new_backend.name, None)
        update_backend_queues(new_backend, prev_backend)
        update_backend_tests_cronjobs(new_backend.name, new_backend.tests or [],
                                      new_backend.node_conditions.prefix)


def update_backend_last_heartbeat(name: str, last_heartbeat: datetime):
    """
    Update the last heartbeat for a backend.
    """
    postgres = connectors.PostgresConnector.get_instance()
    postgres.execute_commit_command(
        'UPDATE backends SET last_heartbeat = %s WHERE name = %s', (last_heartbeat, name))


def delete_backend(
    name: str, request: configs_objects.DeleteBackendRequest, username: str
):
    """
    Delete the backend configuration from the database.

    Args:
        request: The request object containing the backend name.
        username: The username of the user deleting the backend.
    """
    postgres = connectors.PostgresConnector.get_instance()
    delete_cmd = '''
        DELETE from backends where name = %s
    '''
    postgres.execute_commit_command(delete_cmd, (name,))
    delete_resource_cmd = 'DELETE FROM resources WHERE backend = %s'
    postgres.execute_commit_command(delete_resource_cmd, (name,))

    backends = [
        backend.dict(by_alias=True, exclude_unset=True)
        for backend in connectors.Backend.list_from_db(postgres)
    ]

    postgres.create_config_history_entry(
        config_type=connectors.ConfigHistoryType.BACKEND,
        name=name,
        username=username,
        data=backends,
        description=request.description or f'Deleted backend \'{name}\'',
        tags=request.tags,
    )


def create_pool_config_history_entry(
    name: str,
    username: str,
    description: str,
    tags: List[str] | None,
):
    """
    Add a history entry for a pool config.
    """
    postgres = connectors.PostgresConnector.get_instance()
    pools = connectors.fetch_editable_pool_config(postgres).dict(
        by_alias=True, exclude_unset=True
    )
    postgres.create_config_history_entry(
        config_type=connectors.ConfigHistoryType.POOL,
        name=name,
        username=username,
        data=pools,
        description=description,
        tags=tags,
    )


def create_dataset_config_history_entry(
    name: str,
    username: str,
    description: str,
    tags: List[str] | None,
):
    """
    Add a history entry for a dataset config.
    """
    postgres = connectors.PostgresConnector.get_instance()
    dataset_configs = postgres.get_dataset_configs().dict(
        by_alias=True, exclude_unset=True
    )
    postgres.create_config_history_entry(
        config_type=connectors.ConfigHistoryType.DATASET,
        name=name,
        username=username,
        data=dataset_configs,
        description=description,
        tags=tags,
    )


def create_pod_template_config_history_entry(
    name: str,
    username: str,
    description: str,
    tags: List[str] | None,
):
    """
    Add a history entry for a pod template config.
    """
    postgres = connectors.PostgresConnector.get_instance()
    pod_templates = connectors.PodTemplate.list_from_db(postgres)
    postgres.create_config_history_entry(
        config_type=connectors.ConfigHistoryType.POD_TEMPLATE,
        name=name,
        username=username,
        data=pod_templates,
        description=description,
        tags=tags,
    )


def create_resource_validation_config_history_entry(
    name: str,
    username: str,
    description: str,
    tags: List[str] | None,
):
    """
    Add a history entry for a resource validation config.
    """
    postgres = connectors.PostgresConnector.get_instance()
    resource_validations = connectors.ResourceValidation.list_from_db(postgres)
    postgres.create_config_history_entry(
        config_type=connectors.ConfigHistoryType.RESOURCE_VALIDATION,
        name=name,
        username=username,
        data=resource_validations,
        description=description,
        tags=tags,
    )


def create_backend_test_config_history_entry(
    name: str,
    username: str,
    description: str,
    tags: List[str] | None,
):
    """
    Add a history entry for a test config.
    """
    postgres = connectors.PostgresConnector.get_instance()
    tests = connectors.BackendTests.list_from_db(postgres)
    postgres.create_config_history_entry(
        config_type=connectors.ConfigHistoryType.BACKEND_TEST,
        name=name,
        username=username,
        data=tests,
        description=description,
        tags=tags,
    )


def create_role_config_history_entry(
    name: str,
    username: str,
    description: str,
    tags: List[str] | None,
):
    """
    Add a history entry for a role config.
    """
    postgres = connectors.PostgresConnector.get_instance()
    roles = connectors.Role.list_from_db(postgres)
    postgres.create_config_history_entry(
        config_type=connectors.ConfigHistoryType.ROLE,
        name=name,
        username=username,
        data=roles,
        description=description,
        tags=tags,
    )


def tolerations_satisfy_taints(tolerations: List[connectors.Toleration], taints: List[dict]):
    """
    Given the tolerations of a platform and the taints of a node, return True
    if this platform matches this node - a pod with the platform's tolerations
    satisfies the taints on this node. Otherwise, return False.

    Note: Taints with effect "PreferNoSchedule" are ignored as they are soft requirements.
    """
    for taint in taints:
        taint_key = taint.get('key')
        taint_value = taint.get('value')
        taint_effect = taint.get('effect')

        # Skip taints with PreferNoSchedule effect
        if taint_effect == 'PreferNoSchedule':
            continue

        tolerated = False
        for toleration in tolerations:
            if toleration.effect and toleration.effect != taint_effect:
                continue

            if toleration.key != taint_key:
                continue

            if toleration.operator == 'Exists':
                tolerated = True
                break
            elif toleration.operator == 'Equal':
                if toleration.value == taint_value:
                    tolerated = True
                    break

        if not tolerated:
            return False
    return True


def update_node_pool_platform(
        resource: workflow.ResourcesEntry,
        backend: str, pool_config: connectors.VerbosePoolConfig,
        pool_name: str | None = None, platform_name: str | None = None):
    """
    Match against all the pool config passed into the function.
    If nothing is passed to platform, this function will try to match against
    all platforms in the pool defined in the parameter.
    """
    context = objects.WorkflowServiceContext.get()
    matched_platforms: list[tuple] = []
    if pool_name and pool_name not in pool_config.pools:
        raise osmo_errors.OSMOBackendError(
            f'Pool config does not contain config for pool {pool_name}')

    def match(pool_name: str, platform_name: str,
              platform_labels: abc.ItemsView, tolerations: List[connectors.Toleration]):
        if resource.label_fields and platform_labels <= resource.label_fields.items() and \
           tolerations_satisfy_taints(tolerations, resource.taints):
            matched_platforms.append(
                (resource.hostname, backend, pool_name, platform_name))

    if pool_name and platform_name:
        pool_match = pool_config.pools.get(pool_name, None)
        platform_match = None if not pool_match else pool_match.platforms.get(platform_name, None)
        if platform_match:
            match(pool_name, platform_name,
                  platform_match.labels.items(),
                  platform_match.tolerations)
    else:
        for curr_pool_name, curr_pool_attr in pool_config.pools.items():
            # Check to skip the pools that do not correspond to pool_name.
            # When calling this function while specifying pool_name, user
            # should only pass a pool config with only that pool for efficiency.
            if pool_name and curr_pool_name != pool_name:
                continue
            for curr_platform_name, curr_platform_attr in curr_pool_attr.platforms.items():
                match(curr_pool_name, curr_platform_name,
                      curr_platform_attr.labels.items(),
                      curr_platform_attr.tolerations)

    query_params = [resource.hostname, backend]
    conditions = ['resource_name = %s', 'backend = %s']
    if pool_name:
        conditions.append('pool = %s')
        query_params.append(pool_name)
        if platform_name:
            conditions.append('platform = %s')
            query_params.append(platform_name)
    condition_clause = ' AND '.join(conditions)

    update_cmd = f'DELETE FROM resource_platforms WHERE {condition_clause};'
    if matched_platforms:
        # Update pool and platform information for the node in one query command to
        # prevent race conditions
        update_cmd = f'''
            BEGIN;
            DELETE FROM resource_platforms WHERE {condition_clause};
            INSERT INTO resource_platforms (resource_name, backend, pool, platform)
                VALUES {context.database.mogrify(matched_platforms)}
                ON CONFLICT DO NOTHING;
            COMMIT;
        '''
    context.database.execute_commit_command(
        update_cmd,
        tuple(query_params)
    )


def update_backend_node_pool_platform(pool: str, platform: str | None = None):
    """
    Update the pool and platform matching for all nodes in the pool's backend.
    """
    postgres = connectors.PostgresConnector.get_instance()
    pool_info = connectors.Pool.fetch_from_db(postgres, pool)
    # Update all the pool and platforms per node in the backend
    resources = objects.get_resources(backends=[pool_info.backend], verbose=True).resources
    pool_config = connectors.VerbosePoolConfig(pools={pool: pool_info})
    for resource in resources:
        update_node_pool_platform(
            resource, pool_info.backend, pool_config,
            pool_name=pool, platform_name=platform
        )


def pod_labels_and_tolerations_equal(t1: Dict, t2: Dict) -> bool:
    """
    Check to see if two pod specs have the same node selectors and tolerations.
    Return true if the pod specs have the same node selectors and tolerations,
    otherwise return false.
    """
    t1_spec = t1.get('spec', {})
    t2_spec = t2.get('spec', {})
    return t1_spec.get('nodeSelector', {}) == t2_spec.get('nodeSelector', {}) and \
        t1_spec.get('tolerations', {}) == t2_spec.get('tolerations', {})




def update_backend_tests_cronjobs(backend_name: str, current_tests: List[str],
                                 node_condition_prefix: str):
    """
    Update CronJobs for backend tests by sending test configurations directly to the job.
    The job will handle creating ConfigMaps and CronJob specs internally.

    Args:
        backend_name: Name of the backend
        current_tests: Current list of test names in backend configuration
        node_condition_prefix: Prefix for node conditions/labels
    """
    context = objects.WorkflowServiceContext.get()
    postgres = connectors.PostgresConnector.get_instance()

    try:
        # Fetch test configurations directly
        test_configs = {}
        for test_name in current_tests:
            try:
                test_config = connectors.BackendTests.fetch_from_db(postgres, test_name)
                test_configs[test_name] = test_config.dict(by_alias=True, exclude_unset=True)
            except osmo_errors.OSMOError as error:
                logging.error('Failed to fetch test config for test %s: %s', test_name, error)
                continue

        logging.info('Fetched %d test configs for backend %s', len(test_configs), backend_name,
                     extra={'workflow_uuid': getattr(context, 'workflow_uuid', None)})
        print(test_configs)
        # Create SynchronizeBackendTest job with test configurations
        sync_job = backend_jobs.BackendSynchronizeBackendTest(
            backend=backend_name,
            test_configs=test_configs,
            node_condition_prefix=node_condition_prefix
        )
        sync_job.send_job_to_queue()
        logging.info('Queued SynchronizeBackendTest job for backend %s with %d test configs',
                     backend_name, len(test_configs))

    except osmo_errors.OSMOError as error:
        logging.error('Failed to queue SynchronizeBackendTest job for backend %s: %s',
                      backend_name, error)


def notify_backends_of_test_update(test_name: str):
    """
    Notify all backends that use a specific test when the test is updated.

    Args:
        test_name: Name of the test that was updated
    """
    postgres = connectors.PostgresConnector.get_instance()

    try:
        backends_using_test = connectors.BackendTests.get_backends(postgres, test_name)
        for backend_info in backends_using_test:
            backend_name = backend_info['name']
            backend = connectors.Backend.fetch_from_db(postgres, backend_name)
            if test_name in backend.tests:
                update_backend_tests_cronjobs(backend_name, backend.tests or [],
                                              backend.node_conditions.prefix)
                logging.info('Queued SynchronizeBackendTest job for backend %s ' \
                             'due to test %s', backend_name, test_name)
    except osmo_errors.OSMOError as error:
        logging.error('Failed to queue backend test jobs for test %s: %s',
                      test_name, error)
