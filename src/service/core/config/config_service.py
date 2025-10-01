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

import enum
import re
from typing import Annotated, Any, Dict, List

import fastapi
import pydantic

from src.lib.utils import common, osmo_errors
from src.utils.job import workflow
from src.service.core.config import config_history_helpers, helpers, objects
from src.service.core.workflow import (
    helpers as workflow_helpers, objects as workflow_objects
)
from src.utils import connectors


router = fastapi.APIRouter(
    tags=['Config API']
)

class ConfigNameType(enum.Enum):
    """ Represents the config type for checking name. """
    POD_TEMPLATE = 'Pod template'
    POOL = 'Pool'
    RESOURCE_VALIDATON = 'Resource validation'
    PLATFORM = 'Platform'
    BACKEND_TEST = 'Backend test'


def _check_config_name(name: str, name_type: ConfigNameType):
    """ Check config name, and raise an error if the name is invalid. """
    if not re.fullmatch(common.CONFIG_NAME_REGEX, name):
        raise osmo_errors.OSMOUserError(
            f'{name_type.value} name "{name}" is not valid! Name can only '
             'be alphanumeric and contain dash or underscore.'
        )

@router.get('/api/configs/service', response_class=common.PrettyJSONResponse)
def read_service_configs() -> Dict:
    """Read all the service configurations"""
    postgres = connectors.PostgresConnector.get_instance()
    return postgres.get_service_configs().dict(by_alias=True)


@router.put('/api/configs/service')
def put_service_configs(
    request: objects.PutServiceRequest,
    username: str = fastapi.Depends(connectors.parse_username),
) -> Dict:
    """Put service configurations"""

    return helpers.put_configs(request, connectors.ConfigType.SERVICE, username)


@router.patch('/api/configs/service')
def patch_service_configs(
    request: objects.PatchConfigRequest,
    username: str = fastapi.Depends(connectors.parse_username),
) -> Dict:
    """Patch service configurations"""
    return helpers.patch_configs(request, connectors.ConfigType.SERVICE, username)


@router.get('/api/configs/workflow', response_class=common.PrettyJSONResponse)
def read_workflow_configs() -> Dict:
    """Read all the workflow configurations"""
    postgres = connectors.PostgresConnector.get_instance()
    return postgres.get_workflow_configs().dict(by_alias=True)


@router.put('/api/configs/workflow')
def put_workflow_configs(
    request: objects.PutWorkflowRequest,
    username: str = fastapi.Depends(connectors.parse_username),
) -> Dict:
    """Put workflow configurations"""
    return helpers.put_configs(request, connectors.ConfigType.WORKFLOW, username)


@router.patch('/api/configs/workflow')
def patch_workflow_configs(
    request: objects.PatchConfigRequest,
    username: str = fastapi.Depends(connectors.parse_username),
) -> Dict:
    """Patch workflow configurations"""
    return helpers.patch_configs(request, connectors.ConfigType.WORKFLOW, username)


@router.get('/api/configs/dataset', response_class=common.PrettyJSONResponse)
def read_dataset_configs() -> Dict:
    """Read all the dataset configurations"""
    postgres = connectors.PostgresConnector.get_instance()
    return postgres.get_dataset_configs().dict(by_alias=True)


@router.put('/api/configs/dataset')
def put_dataset_configs(
    request: objects.PutDatasetRequest,
    username: str = fastapi.Depends(connectors.parse_username),
) -> Dict:
    """Put dataset configurations"""
    return helpers.put_configs(request, connectors.ConfigType.DATASET, username)


@router.patch('/api/configs/dataset')
def patch_dataset_configs(
    request: objects.PatchConfigRequest,
    username: str = fastapi.Depends(connectors.parse_username),
) -> Dict:
    """Patch dataset configurations"""
    return helpers.patch_configs(request, connectors.ConfigType.DATASET, username)


@router.patch('/api/configs/dataset/{name}')
def patch_dataset(
    name: str,
    request: objects.PatchDatasetRequest,
    username: str = fastapi.Depends(connectors.parse_username),
) -> Dict:
    """Patch dataset configuration for a specific bucket"""
    patch_config_request = objects.PatchConfigRequest(
        configs_dict={'buckets': {name: request.configs_dict}},
        description=request.description or f'Patch dataset bucket {name}',
        tags=request.tags,
    )
    return helpers.patch_configs(
        patch_config_request, connectors.ConfigType.DATASET, username, name
    )


@router.delete('/api/configs/dataset/{name}')
def delete_dataset(
    name: str,
    request: objects.ConfigsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """Delete dataset configuration for a specific bucket"""
    postgres = connectors.PostgresConnector.get_instance()

    try:
        current_dataset_config = postgres.get_dataset_configs()
    except osmo_errors.OSMOUserError:
        current_dataset_config = None

    # Check if the bucket exists
    if current_dataset_config and name not in current_dataset_config.buckets:
        raise osmo_errors.OSMOUserError(f'Bucket {name} not found in dataset configuration')

    # Remove the bucket from the dataset configuration
    if current_dataset_config:
        del current_dataset_config.buckets[name]

        # Serialize and save the updated configuration
        updated_configs = current_dataset_config.serialize(postgres)
        for key, value in updated_configs.items():
            postgres.set_config(key, value, connectors.ConfigType.DATASET)

    # Record the change in the config history
    helpers.create_dataset_config_history_entry(
        name,
        username,
        request.description or f'Delete dataset bucket {name}',
        tags=request.tags,
    )


# API is only used in dev mode
def create_clean_config_api(app: fastapi.FastAPI):
    def clean_configs() -> Dict:
        postgres = connectors.PostgresConnector.get_instance()
        # TODO: Make this clean all the configs
        service_configs_dict = postgres.get_service_configs().plaintext_dict(
            by_alias=True, exclude_unset=True)

        try:
            connectors.ExtraArgBaseModel.set_extra(connectors.ExtraType.IGNORE)
            configs = connectors.ServiceConfig(**service_configs_dict)
            connectors.ExtraArgBaseModel.set_extra(connectors.ExtraType.ALLOW)
            updated_configs = configs.serialize(postgres)
            for key, value in updated_configs.items():
                postgres.set_config(key, value)
        except pydantic.ValidationError as err:
            raise osmo_errors.OSMOUsageError(f'{err}')
        return postgres.get_service_configs().dict(by_alias=True,
                                                                        exclude_unset=True)

    app.add_api_route('/api/configs/service/clean', clean_configs, # type: ignore
                      description='Clean service configurations',
                      response_model=Dict, methods=['POST'], tags=['Config API'])


@router.get('/api/configs/backend', response_class=common.PrettyJSONResponse)
def list_backends() -> objects.ListBackendsResponse:
    """ List all backends. """
    postgres = connectors.PostgresConnector.get_instance()
    return objects.ListBackendsResponse(backends=connectors.Backend.list_from_db(postgres))


@router.post('/api/configs/backend/{name}')
def update_backend(
    name: str,
    request: objects.PostBackendRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Override the config for a specific backend. """
    helpers.update_backend(name, request, username)


@router.get('/api/configs/backend/{name}', response_class=common.PrettyJSONResponse)
def get_backend(name: str) -> connectors.Backend:
    """ Get info for a specific backend. """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.Backend.fetch_from_db(postgres, name)


@router.delete('/api/configs/backend/{name}')
def delete_backend(
    name: str,
    request: objects.DeleteBackendRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """Remove a backend."""
    # TODO: Resolve race condition where a workflow is submitted between checking for
    # running workflow and deleting backend
    if not request.force:
        alive_workflows = workflow_helpers.get_workflows(
            None, None, workflow.WorkflowStatus.get_alive_statuses(),
            [name], 1)
        if alive_workflows:
            raise osmo_errors.OSMOBackendError(
                f'Backend {name} is not finished running workflows. Alive workflows: ' +\
                f'{", ".join(wf.workflow_id for wf in alive_workflows)}')
    connectors.delete_redis_backend(name, workflow_objects.WorkflowServiceContext.get().config)
    helpers.delete_backend(name, request, username)


@router.get('/api/configs/pool', response_class=common.PrettyJSONResponse)
def list_pools(verbose: bool = False, backend: str | None = None) -> \
    connectors.VerbosePoolConfig | connectors.EditablePoolConfig:
    """ List all Pools """
    postgres = connectors.PostgresConnector.get_instance()
    pool_type = connectors.PoolType.VERBOSE if verbose else connectors.PoolType.EDITABLE
    if pool_type == connectors.PoolType.VERBOSE:
        return connectors.fetch_verbose_pool_config(postgres, backend)
    else:
        return connectors.fetch_editable_pool_config(postgres, backend)


def _check_platform_changes(old_pool: connectors.Pool, new_pool: connectors.Pool) -> bool:
    """
    Check if there are changes in platforms between old and new pool configurations.

    Args:
        old_pool: The original pool configuration
        new_pool: The new pool configuration

    Returns:
        bool: True if there are platform changes, False otherwise
    """
    old_platforms = set(old_pool.platforms.keys())
    new_platforms = set(new_pool.platforms.keys())

    # Platform name mismatch indicates changes
    if old_platforms != new_platforms:
        return True

    # Check platforms that exist in both old and new configs
    for platform_name in old_platforms & new_platforms:
        if not helpers.pod_labels_and_tolerations_equal(
            old_pool.platforms[platform_name].parsed_pod_template,
            new_pool.platforms[platform_name].parsed_pod_template):
            return True

    return False


def _check_pool_changes(old_pool: connectors.Pool | None, new_pool: connectors.Pool) -> bool:
    """
    Check if there are changes between old and new pool configurations.

    Args:
        old_pool: The original pool configuration
        new_pool: The new pool configuration

    Returns:
        bool: True if there are changes requiring backend update, False otherwise
    """
    # If no old pool (new pool being created), update is needed
    if not old_pool:
        return True

    # Check if backend changed
    if old_pool.backend != new_pool.backend:
        return True

    # Check if pod template changed
    if not helpers.pod_labels_and_tolerations_equal(
        old_pool.parsed_pod_template,
        new_pool.parsed_pod_template):
        return True

    # Check if platforms changed
    if _check_platform_changes(old_pool, new_pool):
        return True

    return False


@router.put('/api/configs/pool')
def put_pools(
    request: objects.PutPoolsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Put Pool configurations """
    postgres = connectors.PostgresConnector.get_instance()

    # Check all pool names in response before inserting any pool into the database
    for name, pool_config in request.configs.items():
        _check_config_name(name, ConfigNameType.POOL)
        for platform_name in pool_config.platforms.keys():
            _check_config_name(platform_name, ConfigNameType.PLATFORM)

    for name, pool in request.configs.items():
        old_pool = None
        try:
            old_pool = connectors.Pool.fetch_from_db(postgres, name)
        except osmo_errors.OSMOUserError:
            pass

        pool.insert_into_db(postgres, name)
        # Check if pool changes require backend update
        update_pool = _check_pool_changes(old_pool, pool)

        if update_pool:
            helpers.update_backend_node_pool_platform(pool=name, platform=None)

    # Record the change in the config history
    helpers.create_pool_config_history_entry(
        '',
        username,
        request.description or 'Set all pool configurations',
        tags=request.tags,
    )

    # Update the queues in all backends
    for backend in connectors.Backend.list_from_db(postgres):
        helpers.update_backend_queues(backend)


@router.get('/api/configs/pool/{name}', response_class=common.PrettyJSONResponse)
def read_pool(name: str,
              verbose: bool = False) -> Any:
    """
    Read Pool configuration

    Return type Any to prevent unwanted artifacts between Pool and PoolEditable outputs
    Should return Pool or PoolEditable objects
    """
    postgres = connectors.PostgresConnector.get_instance()
    pool_info = connectors.Pool.fetch_from_db(postgres, name)
    return pool_info if verbose else connectors.PoolEditable(**pool_info.dict())


@router.put('/api/configs/pool/{name}')
def put_pool(
    name: str,
    request: objects.PutPoolRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Put Pool configurations """
    _check_config_name(name, ConfigNameType.POOL)
    for platform_name in request.configs.platforms.keys():
        _check_config_name(platform_name, ConfigNameType.PLATFORM)

    postgres = connectors.PostgresConnector.get_instance()
    old_pool = None
    try:
        old_pool = connectors.Pool.fetch_from_db(postgres, name)
    except osmo_errors.OSMOUserError:
        pass

    request.configs.insert_into_db(postgres, name)
    # Check if pool changes require backend update
    update_pool = _check_pool_changes(old_pool, request.configs)

    # Updating contents of existing pool OR a new pool
    if update_pool:
        helpers.update_backend_node_pool_platform(pool=name, platform=None)

    # Record the change in the config history
    helpers.create_pool_config_history_entry(
        name,
        username,
        request.description or f'Put complete pool {name}',
        tags=request.tags,
    )

    # Update the queues in the backend
    backend = connectors.Backend.fetch_from_db(postgres, request.configs.backend)
    helpers.update_backend_queues(backend)


@router.patch('/api/configs/pool/{name}')
def patch_pool(
    name: str,
    request: objects.PatchPoolRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Patch Pool configurations """
    postgres = connectors.PostgresConnector.get_instance()
    # Check platform names if they exist in the patch
    if 'platforms' in request.configs_dict:
        for platform_name in request.configs_dict['platforms'].keys():
            _check_config_name(platform_name, ConfigNameType.PLATFORM)

    # Fetch the current pool configuration
    try:
        current_pool = connectors.Pool.fetch_from_db(postgres, name)
    except osmo_errors.OSMOUserError as e:
        raise osmo_errors.OSMOUserError(f'Pool {name} not found') from e

    # Apply the strategic merge patch to create the updated pool configuration
    current_pool_dict = current_pool.dict()
    updated_pool_dict = common.strategic_merge_patch(
        current_pool_dict, request.configs_dict
    )

    # Create a new Pool object with the updated configuration
    updated_pool = connectors.Pool(**updated_pool_dict)
    updated_pool.insert_into_db(postgres, name)

    # Check if pool changes require backend update
    update_pool = _check_pool_changes(current_pool, updated_pool)

    if update_pool:
        helpers.update_backend_node_pool_platform(pool=name, platform=None)

    # Record the change in the config history
    helpers.create_pool_config_history_entry(
        name,
        username,
        request.description or f'Patch pool {name}',
        tags=request.tags,
    )

    # Update the queues in the backend
    backend = connectors.Backend.fetch_from_db(postgres, updated_pool.backend)
    helpers.update_backend_queues(backend)

    return updated_pool


@router.put('/api/configs/pool/{name}/rename')
def rename_pool(
    name: str,
    request: objects.RenamePoolRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Rename Pool """
    _check_config_name(request.new_name, ConfigNameType.POOL)
    postgres = connectors.PostgresConnector.get_instance()
    connectors.Pool.rename(postgres, name, request.new_name)

    # Record the change in the config history
    helpers.create_pool_config_history_entry(
        name,
        username,
        request.description or f'Rename pool {name} to {request.new_name}',
        tags=request.tags,
    )

    # Update the queues in the backend
    pool = connectors.Pool.fetch_from_db(postgres, request.new_name)
    backend = connectors.Backend.fetch_from_db(postgres, pool.backend)
    helpers.update_backend_queues(backend)


@router.delete('/api/configs/pool/{name}')
def delete_pool(
    name: str,
    request: objects.ConfigsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Delete Pool configurations """
    postgres = connectors.PostgresConnector.get_instance()
    try:
        pool = connectors.Pool.fetch_from_db(postgres, name)
    except osmo_errors.OSMOUserError:
        pool = None

    connectors.Pool.delete_from_db(postgres, name)

    # Record the change in the config history
    helpers.create_pool_config_history_entry(
        name, username, request.description or f'Delete pool {name}', tags=request.tags
    )

    # Update the queues in the backend
    if pool is not None:
        backend = connectors.Backend.fetch_from_db(postgres, pool.backend)
        helpers.update_backend_queues(backend)


@router.get('/api/configs/pool/{name}/platform', response_class=common.PrettyJSONResponse)
def list_platforms_in_pool(name: str,
                           verbose: bool = False) -> Dict[str, Any]:
    """
    List all Platforms

    Return type Any to prevent unwanted artifacts between verbose and editable outputs
    Should return Dict[str, Platform] or Dict[str, PlatformEditable] objects
    """
    postgres = connectors.PostgresConnector.get_instance()
    pool_type = connectors.PoolType.VERBOSE if verbose else connectors.PoolType.EDITABLE
    return connectors.fetch_platform_config(name, pool_type, postgres)


@router.get('/api/configs/pool/{name}/platform/{platform_name}',
            response_class=common.PrettyJSONResponse)
def read_platform_in_pool(name: str,
                          platform_name: str,
                          verbose: bool = False) -> Any:
    """
    Read Platform

    Return type Any to prevent unwanted artifacts between verbose and editable outputs
    Should return Platform or PlatformEditable objects
    """
    postgres = connectors.PostgresConnector.get_instance()
    pool_type = connectors.PoolType.VERBOSE if verbose else connectors.PoolType.EDITABLE
    platforms = connectors.fetch_platform_config(name, pool_type, postgres)
    if platform_name not in platforms:
        raise osmo_errors.OSMOUserError(
            f'Platform name {platform_name} not found in pool {name}.')
    return platforms[platform_name]


@router.put('/api/configs/pool/{name}/platform/{platform_name}')
def put_platform_in_pool(
    name: str,
    platform_name: str,
    request: objects.PutPoolPlatformRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Put Platform configurations """
    _check_config_name(platform_name, ConfigNameType.PLATFORM)
    postgres = connectors.PostgresConnector.get_instance()
    old_platform: connectors.Platform | None = None
    try:
        pool = connectors.Pool.fetch_from_db(postgres, name)
        old_platform = pool.platforms.get(platform_name, None)
    except osmo_errors.OSMOUserError:
        pass
    request.configs.insert_into_db(postgres, name, platform_name)
    updating_platform = old_platform and not helpers.pod_labels_and_tolerations_equal(
        request.configs.parsed_pod_template, old_platform.parsed_pod_template
    )
    # Updating contents of existing pool OR a new platform
    if updating_platform or not old_platform:
        helpers.update_backend_node_pool_platform(pool=name, platform=platform_name)

    helpers.create_pool_config_history_entry(
        name,
        username,
        request.description or f'Put complete platform {platform_name} in pool {name}',
        tags=request.tags,
    )


@router.put('/api/configs/pool/{name}/platform/{platform_name}/rename')
def rename_platform_in_pool(name: str, platform_name: str,
                            request: objects.RenamePoolPlatformRequest,
                            username: str = fastapi.Depends(connectors.parse_username)):
    """ Rename Platform """
    _check_config_name(request.new_name, ConfigNameType.PLATFORM)
    postgres = connectors.PostgresConnector.get_instance()
    connectors.Pool.rename_platform(postgres, name, platform_name, request.new_name)

    helpers.create_pool_config_history_entry(
        name,
        username,
        request.description
        or f'Rename platform {platform_name} in pool {name} to {request.new_name}',
        tags=request.tags,
    )


@router.get('/api/configs/pod_template', response_class=common.PrettyJSONResponse)
def list_pod_templates() -> Dict[str, Dict]:
    """ List all Pod Template configurations """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.PodTemplate.list_from_db(postgres)


@router.get('/api/configs/pod_template/{name}', response_class=common.PrettyJSONResponse)
def read_pod_template(name: str) -> Dict:
    """ Read Pod Template configurations """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.PodTemplate.fetch_from_db(postgres, name)


@router.put('/api/configs/pod_template')
def put_pod_templates(request: objects.PutPodTemplatesRequest,
                      username: str = fastapi.Depends(connectors.parse_username)):
    """ Set Dict of Pod Templates configurations """
    for name in request.configs.keys():
        _check_config_name(name, ConfigNameType.POD_TEMPLATE)

    postgres = connectors.PostgresConnector.get_instance()
    for name, pod_template_dict in request.configs.items():
        old_pod_template = None
        try:
            old_pod_template = connectors.PodTemplate.fetch_from_db(postgres, name)
        except osmo_errors.OSMOUserError:
            pass
        pod_template = connectors.PodTemplate(pod_template=pod_template_dict)
        pod_template.insert_into_db(postgres, name)
        if old_pod_template and \
            not helpers.pod_labels_and_tolerations_equal(old_pod_template, pod_template_dict):
            pool_list = connectors.PodTemplate.get_pools(postgres, name)
            for pool in pool_list:
                helpers.update_backend_node_pool_platform(pool=pool['name'], platform=None)
        if old_pod_template:
            for test in connectors.PodTemplate.get_tests(postgres, name):
                helpers.notify_backends_of_test_update(test['name'])

    helpers.create_pod_template_config_history_entry(
        '',
        username,
        request.description or 'Put complete pod template',
        tags=request.tags,
    )


@router.put('/api/configs/pod_template/{name}')
def put_pod_template(name: str,
                     request: objects.PutPodTemplateRequest,
                     username: str = fastapi.Depends(connectors.parse_username)):
    """ Put Pod Template configurations """
    _check_config_name(name, ConfigNameType.POD_TEMPLATE)
    postgres = connectors.PostgresConnector.get_instance()
    old_pod_template = None
    try:
        old_pod_template = connectors.PodTemplate.fetch_from_db(postgres, name)
    except osmo_errors.OSMOUserError:
        pass
    pod_template = connectors.PodTemplate(pod_template=request.configs)
    pod_template.insert_into_db(postgres, name)
    if old_pod_template and \
        not helpers.pod_labels_and_tolerations_equal(old_pod_template, request.configs):
        pool_list = connectors.PodTemplate.get_pools(postgres, name)
        for pool in pool_list:
            helpers.update_backend_node_pool_platform(pool=pool['name'], platform=None)
    #  This is a added to update when pod template is changed thats is part of test config
    if old_pod_template:
        for test in connectors.PodTemplate.get_tests(postgres, name):
            helpers.notify_backends_of_test_update(test['name'])

    helpers.create_pod_template_config_history_entry(
        name,
        username,
        request.description or f'Put complete pod template {name}',
        tags=request.tags,
    )


@router.delete('/api/configs/pod_template/{name}')
def delete_pod_template(
    name: str,
    request: objects.ConfigsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Delete Pod Template configurations """
    postgres = connectors.PostgresConnector.get_instance()
    connectors.PodTemplate.delete_from_db(postgres, name)

    helpers.create_pod_template_config_history_entry(
        name,
        username,
        request.description or f'Delete pod template {name}',
        tags=request.tags,
    )


@router.get('/api/configs/resource_validation', response_class=common.PrettyJSONResponse)
def list_resource_validations() -> Dict[str, List[connectors.ResourceAssertion]]:
    """ List all Resource Validation configurations """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.ResourceValidation.list_from_db(postgres)


@router.get('/api/configs/resource_validation/{name}', response_class=common.PrettyJSONResponse)
def read_resource_validation(name: str) -> List[connectors.ResourceAssertion]:
    """ Read Resource Validation configurations """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.ResourceValidation.fetch_from_db(postgres, name)


@router.put('/api/configs/resource_validation')
def put_resource_validations(
    request: objects.PutResourceValidationsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Put Resource Validation configurations """
    for name in request.configs_dict.keys():
        _check_config_name(name, ConfigNameType.RESOURCE_VALIDATON)

    postgres = connectors.PostgresConnector.get_instance()
    for name, resource_validation_list in request.configs_dict.items():
        resource_validation = connectors.ResourceValidation(
            resource_validations=resource_validation_list)
        resource_validation.insert_into_db(postgres, name)

    helpers.create_resource_validation_config_history_entry(
        '',
        username,
        request.description or f'Put complete resource validation {name}',
        tags=request.tags,
    )


@router.put('/api/configs/resource_validation/{name}')
def put_resource_validation(
    name: str,
    request: objects.PutResourceValidationRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Put Resource Validation configurations """
    _check_config_name(name, ConfigNameType.RESOURCE_VALIDATON)
    postgres = connectors.PostgresConnector.get_instance()
    resource_validation = connectors.ResourceValidation(
        resource_validations=request.configs)
    resource_validation.insert_into_db(postgres, name)

    helpers.create_resource_validation_config_history_entry(
        name,
        username,
        request.description or f'Put complete resource validation {name}',
        tags=request.tags,
    )


@router.delete('/api/configs/resource_validation/{name}')
def delete_resource_validation(
    name: str,
    request: objects.ConfigsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """Delete Resource Validation configurations"""
    postgres = connectors.PostgresConnector.get_instance()
    connectors.ResourceValidation.delete_from_db(postgres, name)
    helpers.create_resource_validation_config_history_entry(
        name,
        username,
        request.description or f'Delete resource validation {name}',
        tags=request.tags,
    )


@router.get('/api/configs/role', response_class=common.PrettyJSONResponse)
def list_roles() -> List[connectors.Role]:
    """ List all Roles """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.Role.list_from_db(postgres)


@router.get('/api/configs/role/{name}', response_class=common.PrettyJSONResponse)
def read_role(name: str) -> connectors.Role:
    """ Read Role """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.Role.fetch_from_db(postgres, name)


@router.put('/api/configs/role')
def put_roles(request: objects.PutRolesRequest,
              username: str = fastapi.Depends(connectors.parse_username)):
    """ Put Roles """
    postgres = connectors.PostgresConnector.get_instance()
    for role in request.configs:
        role.insert_into_db(postgres)

    helpers.create_role_config_history_entry(
        '',
        username,
        request.description or 'Put complete roles',
        tags=request.tags,
    )


@router.put('/api/configs/role/{name}')
def put_role(name: str,
             request: objects.PutRoleRequest,
             username: str = fastapi.Depends(connectors.parse_username)):
    """ Patch Role configurations """
    postgres = connectors.PostgresConnector.get_instance()
    request.configs.insert_into_db(postgres)

    helpers.create_role_config_history_entry(
        name,
        username,
        request.description or f'Put complete role {name}',
        tags=request.tags,
    )


@router.delete('/api/configs/role/{name}')
def delete_role(name: str,
                request: objects.ConfigsRequest,
                username: str = fastapi.Depends(connectors.parse_username)):
    """ Delete Role """
    postgres = connectors.PostgresConnector.get_instance()
    connectors.Role.delete_from_db(postgres, name)

    helpers.create_role_config_history_entry(
        name,
        username,
        request.description or f'Delete role {name}',
        tags=request.tags,
    )


@router.get('/api/configs/backend_test', response_class=common.PrettyJSONResponse)
def list_backend_tests() -> Dict[str, Dict]:
    """ List all backend test configurations """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.BackendTests.list_from_db(postgres)


@router.put('/api/configs/backend_test')
def put_backend_tests(
    request: objects.PutBackendTestsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Put backend test configurations """
    for name in request.configs.keys():
        _check_config_name(name, ConfigNameType.BACKEND_TEST)

    postgres = connectors.PostgresConnector.get_instance()

    for name, test_config in request.configs.items():
        test_config.insert_into_db(postgres, name)
        helpers.notify_backends_of_test_update(name)

    helpers.create_backend_test_config_history_entry(
        '',
        username,
        request.description or 'Set all backend test configurations',
        tags=request.tags,
    )


@router.get('/api/configs/backend_test/{name}', response_class=common.PrettyJSONResponse)
def read_backend_test(name: str) -> connectors.BackendTests:
    """ Read backend test configuration """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.BackendTests.fetch_from_db(postgres, name)


@router.put('/api/configs/backend_test/{name}')
def put_backend_test(
    name: str,
    request: objects.PutBackendTestRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Put backend test configuration """
    _check_config_name(name, ConfigNameType.BACKEND_TEST)
    postgres = connectors.PostgresConnector.get_instance()
    request.configs.insert_into_db(postgres, name)
    # Send syn_backend_test job for all backends that use this test
    helpers.notify_backends_of_test_update(name)

    helpers.create_backend_test_config_history_entry(
        name,
        username,
        request.description or f'Put complete backend test {name}',
        tags=request.tags,
    )


@router.patch('/api/configs/backend_test/{name}')
def patch_backend_test(
    name: str,
    request: objects.PatchBackendTestRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Patch backend test configuration """
    postgres = connectors.PostgresConnector.get_instance()
    try:
        current_test = connectors.BackendTests.fetch_from_db(postgres, name)
    except osmo_errors.OSMOUserError as e:
        raise osmo_errors.OSMOUserError(f'Backend test {name} not found') from e

    # Apply the strategic merge patch
    current_test_dict = current_test.dict()
    updated_test_dict = common.strategic_merge_patch(
        current_test_dict, request.configs_dict
    )

    # Create a new TestConfig object with the updated configuration
    updated_test = connectors.BackendTests(**updated_test_dict)
    updated_test.insert_into_db(postgres, name)
    # Send syn_backend_test job for all backends that use this test
    helpers.notify_backends_of_test_update(name)

    helpers.create_backend_test_config_history_entry(
        name,
        username,
        request.description or f'Patch backend test {name}',
        tags=request.tags,
    )

    return updated_test


@router.delete('/api/configs/backend_test/{name}')
def delete_backend_test(
    name: str,
    request: objects.ConfigsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Delete test configuration """
    postgres = connectors.PostgresConnector.get_instance()
    connectors.BackendTests.delete_from_db(postgres, name)

    helpers.create_backend_test_config_history_entry(
        name,
        username,
        request.description or f'Delete test {name}',
        tags=request.tags,
    )


@router.get('/api/configs/history')
def get_configs_history(
    query_params: Annotated[objects.ConfigHistoryQueryParams, fastapi.Query()],
) -> objects.GetConfigsHistoryResponse:
    """List history of all configs"""
    query, params = config_history_helpers.build_get_configs_history_query(query_params)

    postgres = connectors.PostgresConnector.get_instance()
    results = postgres.execute_fetch_command(query, params, return_raw=True)
    configs = [
        objects.ConfigHistory(
            config_type=row['config_type'].upper(),
            name=row['name'],
            revision=row['revision'],
            username=row['username'],
            created_at=row['created_at'],
            description=row['description'],
            tags=row['tags'],
            data=config_history_helpers.transform_config_data(
                postgres, row['config_type'], row['data']
            ) if not query_params.omit_data else None,
        )
        for row in results
    ]

    return objects.GetConfigsHistoryResponse(configs=configs)


@router.post('/api/configs/history/rollback')
def rollback_config(
    request: objects.RollbackConfigRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """Roll back a config to a particular revision."""
    postgres = connectors.PostgresConnector.get_instance()

    # Get the config history entry for the specified revision
    query = """
        SELECT config_type, name, revision, username, created_at, tags, description, data,
        deleted_at, deleted_by
        FROM config_history
        WHERE config_type = %s AND revision = %s
    """
    results = postgres.execute_fetch_command(
        query, (request.config_type.value.lower(), request.revision), return_raw=True)
    if not results:
        raise osmo_errors.OSMOUserError(
            f'No config history entry found for type {request.config_type.value} '
            f'at revision {request.revision}'
        )
    if results[0]['deleted_at'] is not None:
        raise osmo_errors.OSMOUserError(
            f'Cannot roll back to revision {request.revision} for config type '
            f'{request.config_type.value} as it was deleted by {results[0]["deleted_by"]}'
        )
    history_entry = results[0]

    description_base = f'Roll back {request.config_type.value} to r{request.revision}'
    description = (
        f'{description_base}: {request.description}'
        if request.description else description_base
    )

    if request.config_type == connectors.ConfigHistoryType.SERVICE:
        helpers.put_configs(
            objects.PutConfigsRequest(
                configs=connectors.ServiceConfig(**history_entry['data']),
                description=description,
                tags=request.tags
            ),
            connectors.ConfigType.SERVICE,
            username,
            # The config from history is already serialized, so we don't need to serialize it again
            should_serialize=False
        )
    elif request.config_type == connectors.ConfigHistoryType.WORKFLOW:
        helpers.put_configs(
            objects.PutConfigsRequest(
                configs=connectors.WorkflowConfig(**history_entry['data']),
                description=description,
                tags=request.tags
            ),
            connectors.ConfigType.WORKFLOW,
            username,
            # The config from history is already serialized, so we don't need to serialize it again
            should_serialize=False
        )
    elif request.config_type == connectors.ConfigHistoryType.DATASET:
        helpers.put_configs(
            objects.PutConfigsRequest(
                configs=connectors.DatasetConfig(**history_entry['data']),
                description=description,
                tags=request.tags
            ),
            connectors.ConfigType.DATASET,
            username,
            # The config from history is already serialized, so we don't need to serialize it again
            should_serialize=False
        )
    elif request.config_type == connectors.ConfigHistoryType.BACKEND:
        # Delete all existing backends
        existing_backends = connectors.Backend.list_from_db(postgres)
        next_backends = [backend['name'] for backend in history_entry['data']]
        backends_to_remove = [
            backend.name for backend in existing_backends if backend.name not in next_backends]
        for backend in backends_to_remove:
            delete_cmd = '''
                DELETE from backends where name = %s
            '''
            postgres.execute_commit_command(delete_cmd, (backend,))

        # Replace with backend configs from history
        helpers.update_backends(
            objects.UpdateBackends(
                backends=history_entry['data'],
                description=description,
                tags=request.tags
            ),
            username
        )
    elif request.config_type == connectors.ConfigHistoryType.POOL:
        # Delete all existing pools
        existing_pools = connectors.fetch_editable_pool_config(postgres)
        pools_to_remove = [
            pool for pool in existing_pools.pools if pool not in history_entry['data'].keys()]
        for pool in pools_to_remove:
            connectors.Pool.delete_from_db(postgres, pool)

        # Replace with pool configs from history
        put_pools(
            objects.PutPoolsRequest(
                configs=history_entry['data']['pools'],
                description=description,
                tags=request.tags
            ),
            username
        )
    elif request.config_type == connectors.ConfigHistoryType.POD_TEMPLATE:
        # Delete all existing pod templates
        existing_pod_templates = connectors.PodTemplate.list_from_db(postgres)
        pod_templates_to_remove = [
            pod_template for pod_template in existing_pod_templates
            if pod_template not in history_entry['data'].keys()
        ]
        for pod_template in pod_templates_to_remove:
            connectors.PodTemplate.delete_from_db(postgres, pod_template)

        # Replace with pod template configs from history
        put_pod_templates(
            objects.PutPodTemplatesRequest(
                configs=history_entry['data'],
                description=description,
                tags=request.tags
            ),
            username
        )
    elif request.config_type == connectors.ConfigHistoryType.RESOURCE_VALIDATION:
        # Delete all existing resource validations
        existing_resource_validations = connectors.ResourceValidation.list_from_db(postgres)
        resource_validations_to_remove = [
            resource_validation for resource_validation in existing_resource_validations
            if resource_validation not in history_entry['data'].keys()
        ]
        for resource_validation in resource_validations_to_remove:
            connectors.ResourceValidation.delete_from_db(postgres, resource_validation)

        # Replace with resource validation configs from history
        put_resource_validations(
            objects.PutResourceValidationsRequest(
                configs_dict=history_entry['data'],
                description=description,
                tags=request.tags
            ),
            username
        )
    elif request.config_type == connectors.ConfigHistoryType.BACKEND_TEST:
        # Delete all existing backend tests
        existing_backend_tests = connectors.BackendTests.list_from_db(postgres)
        backend_tests_to_remove = [
            backend_test for backend_test in existing_backend_tests
            if backend_test not in history_entry['data'].keys()
        ]
        for backend_test in backend_tests_to_remove:
            connectors.BackendTests.delete_from_db(postgres, backend_test)

        # Replace with backend test configs from history
        put_backend_tests(
            objects.PutBackendTestsRequest(
                configs=history_entry['data'],
                description=description,
                tags=request.tags
            ),
            username
        )
    elif request.config_type == connectors.ConfigHistoryType.ROLE:
        # Delete all existing roles
        existing_roles = connectors.Role.list_from_db(postgres)
        next_roles= [role['name'] for role in history_entry['data']]
        roles_to_remove = [
            role.name for role in existing_roles if role.name not in next_roles
        ]
        for role in roles_to_remove:
            connectors.Role.delete_from_db(postgres, role)

        # Replace with role configs from history
        put_roles(
            objects.PutRolesRequest(
                configs=history_entry['data'],
                description=description,
                tags=request.tags
            ),
            username
        )
    else:
        raise osmo_errors.OSMOUserError(f'Unsupported config type: {request.config_type.value}')

@router.delete('/api/configs/history/{config_type}/revision/{revision}')
def delete_config_history_revision(
    config_type: str,
    revision: Annotated[int, fastapi.Path(gt=0)],
    username: str = fastapi.Depends(connectors.parse_username),
):
    """Delete a specific config history revision. This performs a soft delete of the revision.

    Args:
        config_type: Type of config to delete
        revision: Revision number to delete (must be greater than 0)
        username: Username of the person performing the delete

    Raises:
        OSMOUserError: If the revision doesn't exist or is the current revision
    """
    try:
        config_type_enum = connectors.ConfigHistoryType[config_type.upper()]
    except KeyError as e:
        raise osmo_errors.OSMOUserError(f'Invalid config type "{config_type}"') from e
    postgres = connectors.PostgresConnector.get_instance()

    # Soft delete the revision if it exists and is not the current revision
    query = """
        WITH latest_revision AS (
            SELECT MAX(revision) as max_revision
            FROM config_history
            WHERE config_type = %s
            AND deleted_at IS NULL
        ),
        updated_revision AS (
            UPDATE config_history ch
            SET deleted_by = %s,
                deleted_at = NOW()
            WHERE ch.config_type = %s
            AND ch.revision = %s
            AND ch.revision < (SELECT max_revision FROM latest_revision)
            AND ch.deleted_at IS NULL
            RETURNING ch.revision
        )
        SELECT ur.revision as deleted_revision, lr.max_revision
        FROM latest_revision lr
        LEFT JOIN updated_revision ur ON true
    """
    results = postgres.execute_fetch_command(
        query, (config_type_enum.value.lower(), username,
                config_type_enum.value.lower(), revision), return_raw=True)

    if not results or not results[0]['deleted_revision']:
        if not results or results[0]['max_revision'] != revision:
            raise osmo_errors.OSMOUserError(
                f'No config history entry found for type {config_type_enum.value} '
                f'at revision {revision}'
            )
        else:
            raise osmo_errors.OSMOUserError(
                f'Cannot delete the current revision {revision} for config type '
                f'{config_type_enum.value}'
            )


@router.post('/api/configs/history/{config_type}/revision/{revision}/tags')
def update_config_history_tags(
    config_type: str,
    revision: Annotated[int, fastapi.Path(gt=0)],
    request: objects.UpdateConfigTagsRequest,
):
    """Update tags for a specific config history revision.

    Args:
        config_type: Type of config to update
        revision: Revision number to update (must be greater than 0)
        request: Request containing tags to add and delete
        username: Username of the person performing the update

    Raises:
        OSMOUserError: If the revision doesn't exist or is invalid
    """
    try:
        config_type_enum = connectors.ConfigHistoryType[config_type.upper()]
    except KeyError as e:
        raise osmo_errors.OSMOUserError(f'Invalid config type "{config_type}"') from e
    postgres = connectors.PostgresConnector.get_instance()

    # Get current tags and update them
    query = """
        WITH current_tags AS (
            SELECT tags
            FROM config_history
            WHERE config_type = %s
            AND revision = %s
            AND deleted_at IS NULL
        )
        UPDATE config_history ch
        SET tags = (
            SELECT array(
                SELECT DISTINCT unnest(
                    CASE
                        WHEN %s::text[] IS NULL THEN tags
                        ELSE tags || %s::text[]
                    END
                ) EXCEPT SELECT unnest(%s::text[])
            )
            FROM current_tags
        )
        WHERE ch.config_type = %s
        AND ch.revision = %s
        RETURNING ch.revision
    """
    results = postgres.execute_fetch_command(
        query, (
            config_type_enum.value.lower(),
            revision,
            request.set_tags,
            request.set_tags,
            request.delete_tags or [],
            config_type_enum.value.lower(),
            revision
        ),
        return_raw=True
    )

    if not results or not results[0]['revision']:
        raise osmo_errors.OSMOUserError(
            f'No config history entry found for type {config_type_enum.value} '
            f'at revision {revision}'
        )


def diff_secret_strs(first_data: Any, second_data: Any, second_revision: int) -> Any:
    """
    Traverse first_data and second_data. Recursively replace SecretStr values with a string that
    says if the secret string is changed only if the secret is present in both revisions and
    changed in the second revision.

    The SecretStr is replaced in second_data with a string in the format:
      "********** <secret changed in r{second_revision}>"
    """
    if isinstance(first_data, dict) and isinstance(second_data, dict):
        dict_result: Dict[str, Any] = {}
        for key in second_data:
            if key in first_data:
                dict_result[key] = diff_secret_strs(
                    first_data[key], second_data[key], second_revision)
            else:
                dict_result[key] = second_data[key]
        return dict_result
    elif isinstance(first_data, list) and isinstance(second_data, list):
        list_result: List[Any] = []
        for i, second_item in enumerate(second_data):
            if i < len(first_data):
                list_result.append(diff_secret_strs(first_data[i], second_item, second_revision))
            else:
                list_result.append(second_item)
        return list_result
    elif isinstance(first_data, pydantic.SecretStr) and isinstance(second_data, pydantic.SecretStr):
        if first_data.get_secret_value() != second_data.get_secret_value():
            return f'********** <secret changed in r{second_revision}>'
        else:
            return second_data
    elif isinstance(first_data, pydantic.BaseModel) and \
        isinstance(second_data, pydantic.BaseModel) and \
        isinstance(first_data, type(second_data)):
        result = {}
        for key in second_data.__dict__:
            if key in first_data.__dict__:
                result[key] = diff_secret_strs(
                    first_data.__dict__[key], second_data.__dict__[key], second_revision)
            else:
                result[key] = second_data.__dict__[key]
        return result
    else:
        return second_data


@router.get('/api/configs/diff', response_class=common.PrettyJSONResponse)
def get_config_diff(
    request: Annotated[objects.ConfigDiffRequest, fastapi.Query()],
) -> objects.ConfigDiffResponse:
    """
    Returns two config revisions, similar to
    GET /api/configs/history/{config_type}/revision/{revision}, but with obfuscated secret strings
    that say if a secret string is changed. Intended for use with the `diff` command.

    Args:
        request: Request containing config type and revisions to compare

    Returns:
        ConfigDiffResponse containing the two revisions

    Raises:
        OSMOUserError: If either revision doesn't exist or is invalid
    """
    postgres = connectors.PostgresConnector.get_instance()

    # Get the first revision's data
    query = """
        SELECT revision, data
        FROM config_history
        WHERE config_type = %s
        AND revision = %s
        AND deleted_at IS NULL
    """
    results = postgres.execute_fetch_command(
        query, (request.config_type.value.lower(), request.first_revision),
        return_raw=True
    )
    if not results:
        raise osmo_errors.OSMOUserError(
            f'No config history entry found for type {request.config_type.value} '
            f'at revision {request.first_revision}'
        )
    first_data = results[0]['data']

    # Get the second revision's data
    query = """
        SELECT revision, data
        FROM config_history
        WHERE config_type = %s
        AND revision = %s
        AND deleted_at IS NULL
    """
    results = postgres.execute_fetch_command(
        query, (request.config_type.value.lower(), request.second_revision),
        return_raw=True
    )
    if not results:
        raise osmo_errors.OSMOUserError(
            f'No config history entry found for type {request.config_type.value} '
            f'at revision {request.second_revision}'
        )
    second_data = results[0]['data']

    # Transform the data if needed (similar to config history)
    first_data = config_history_helpers.transform_config_data(
        postgres, request.config_type.value.lower(), first_data
    )
    second_data = config_history_helpers.transform_config_data(
        postgres, request.config_type.value.lower(), second_data
    )

    updated_second_data = diff_secret_strs(first_data, second_data, request.second_revision)

    return objects.ConfigDiffResponse(first_data=first_data, second_data=updated_second_data)
