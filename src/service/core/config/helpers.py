"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
import logging
from typing import Any, Dict, List

from src.lib.utils import osmo_errors
from src.service.core.config import configmap_guard
from src.utils.job import backend_jobs, kb_objects, workflow
from src.service.core.config import objects as configs_objects
from src.service.core.workflow import objects
from src.utils import connectors


def update_backend_queues(current_backend: connectors.Backend,
    prev_backend: connectors.Backend | None = None,
    job_id: str | None = None) -> bool:
    """
    Update the k8s scheduler objects (queues, topologies, etc.) in the backend

    Args:
        current_backend: The current configuration of the backend to update objects for
        prev_backend: The previous configuration of the backend to delete objects for
    """
    # Lookup all pools for the backend
    pool_rows = connectors.Pool.fetch_rows_from_configmap(
        backend=current_backend.name)
    pools = [connectors.Pool(**row) for row in pool_rows]

    return update_backend_queues_from_configmap(
        current_backend, pools, prev_backend=prev_backend, job_id=job_id)


def update_backend_queues_from_configmap(
    current_backend: connectors.Backend,
    pools: List[connectors.Pool],
    prev_backend: connectors.Backend | None = None,
    job_id: str | None = None,
) -> bool:
    """Update backend scheduler objects using ConfigMap-derived pool configs."""

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

    if not cleanup_specs:
        return True

    job = backend_jobs.BackendSynchronizeQueues(
        backend=current_backend.name,
        job_id=job_id,
        k8s_resources=objects_list,  # Contains both Queue and Topology CRDs
        # Specs for both object types (including old scheduler if switching)
        cleanup_specs=cleanup_specs,
        immutable_kinds=kb_factory.list_immutable_scheduler_resources()
    )
    job.send_job_to_queue()
    return True


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

    Raises:
        OSMOUserError(409): If the config is managed by ConfigMap in configmap mode.

    Returns:
        Dict containing the updated configuration
    """
    del request, config_type, should_serialize
    configmap_guard.reject_if_configmap_mode(username)


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
        name: The name of the config to patch.

    Returns:
        Dict containing the updated configuration fields.

    Raises:
        OSMOUserError(409): If the config is managed by ConfigMap in configmap mode.
    """
    del request, config_type, name
    configmap_guard.reject_if_configmap_mode(username)


def update_backend_last_heartbeat(name: str, last_heartbeat: datetime):
    """
    Update the last heartbeat for a backend.
    """
    postgres = connectors.PostgresConnector.get_instance()
    postgres.execute_commit_command(
        'UPDATE backends SET last_heartbeat = %s WHERE name = %s', (last_heartbeat, name))


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
    pool_info = connectors.Pool.fetch_from_configmap(pool)
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
                                 node_condition_prefix: str,
                                 job_id: str | None = None) -> bool:
    """
    Update CronJobs for backend tests by sending test configurations directly to the job.
    The job will handle creating ConfigMaps and CronJob specs internally.

    Args:
        backend_name: Name of the backend
        current_tests: Current list of test names in backend configuration
        node_condition_prefix: Prefix for node conditions/labels
    """
    postgres = connectors.PostgresConnector.get_instance()

    try:
        # Fetch test configurations directly
        test_configs = {}
        for test_name in current_tests:
            try:
                test_config = connectors.BackendTests.fetch_from_db(postgres, test_name)
                test_configs[test_name] = test_config.model_dump(by_alias=True, exclude_unset=True)
            except osmo_errors.OSMOError as error:
                logging.error('Failed to fetch test config for test %s: %s', test_name, error)
                continue

        return update_backend_tests_cronjobs_from_configmap(
            backend_name, test_configs, node_condition_prefix, job_id=job_id)

    except osmo_errors.OSMOError as error:
        logging.error('Failed to queue SynchronizeBackendTest job for backend %s: %s',
                      backend_name, error)
        return False


def update_backend_tests_cronjobs_from_configmap(
    backend_name: str,
    test_configs: Dict[str, Any],
    node_condition_prefix: str,
    job_id: str | None = None,
) -> bool:
    """Update backend test CronJobs using ConfigMap-derived test configs."""
    context = objects.WorkflowServiceContext.get()
    try:
        logging.info('Using %d ConfigMap test configs for backend %s',
                     len(test_configs), backend_name,
                     extra={'workflow_uuid': getattr(context, 'workflow_uuid', None)})
        sync_job = backend_jobs.BackendSynchronizeBackendTest(
            backend=backend_name,
            job_id=job_id,
            test_configs=test_configs,
            node_condition_prefix=node_condition_prefix
        )
        sync_job.send_job_to_queue()
        logging.info('Queued SynchronizeBackendTest job for backend %s with %d test configs',
                     backend_name, len(test_configs))
        return True
    except osmo_errors.OSMOError as error:
        logging.error('Failed to queue SynchronizeBackendTest job for backend %s: %s',
                      backend_name, error)
        return False


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
