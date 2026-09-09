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

from typing import Annotated, Any, Dict, List, Mapping, NoReturn

import fastapi
from fastapi import encoders, responses
from src.lib.utils import osmo_errors
from src.service.core.config import (
    configmap_guard, helpers, objects
)
from src.utils import connectors


router = fastapi.APIRouter(
    tags=['Config API']
)

@router.get(
    '/api/configs/service',
    response_model=connectors.ServiceConfig,
)
def read_service_configs() -> responses.JSONResponse:
    """Read all the service configurations"""
    postgres = connectors.PostgresConnector.get_instance()
    service_configs = postgres.get_service_configs()
    return responses.JSONResponse(content=encoders.jsonable_encoder(
        service_configs, exclude={'service_auth'}))


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


@router.get(
    '/api/configs/workflow',
    response_model=connectors.WorkflowConfig,
)
def read_workflow_configs() -> connectors.WorkflowConfig:
    """Read all the workflow configurations"""
    postgres = connectors.PostgresConnector.get_instance()
    return postgres.get_workflow_configs()


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


@router.get(
    '/api/configs/backend',
    response_model=objects.ListBackendsResponse,
)
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
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.get(
    '/api/configs/backend/{name}',
    response_model=connectors.Backend,
)
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
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.get(
    '/api/configs/pool',
    response_model=connectors.VerbosePoolConfig | connectors.EditablePoolConfig,
)
def list_pools(verbose: bool = False, backend: str | None = None) -> \
        connectors.VerbosePoolConfig | connectors.EditablePoolConfig:
    """ List all Pools """
    postgres = connectors.PostgresConnector.get_instance()
    pool_type = connectors.PoolType.VERBOSE if verbose else connectors.PoolType.EDITABLE
    if pool_type == connectors.PoolType.VERBOSE:
        return connectors.fetch_verbose_pool_config(postgres, backend)
    else:
        return connectors.fetch_editable_pool_config(postgres, backend)


@router.put('/api/configs/pool')
def put_pools(
    request: objects.PutPoolsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Put Pool configurations """
    del request
    configmap_guard.reject_if_configmap_mode(username)


@router.get(
    '/api/configs/pool/{name}',
    response_model=connectors.Pool | connectors.PoolEditable,
)
def read_pool(
    name: str,
    verbose: bool = False,
) -> connectors.Pool | connectors.PoolEditable:
    """
    Read Pool configuration

    Return type Any to prevent unwanted artifacts between Pool and PoolEditable outputs
    Should return Pool or PoolEditable objects
    """
    postgres = connectors.PostgresConnector.get_instance()
    pool_info = connectors.Pool.fetch_runtime_from_configmap(postgres, name)
    return pool_info if verbose else connectors.PoolEditable(**pool_info.model_dump())


@router.put('/api/configs/pool/{name}')
def put_pool(
    name: str,
    request: objects.PutPoolRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Put Pool configurations """
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.patch('/api/configs/pool/{name}')
def patch_pool(
    name: str,
    request: objects.PatchPoolRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Patch Pool configurations """
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.put('/api/configs/pool/{name}/rename')
def rename_pool(
    name: str,
    request: objects.RenamePoolRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Rename Pool """
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.delete('/api/configs/pool/{name}')
def delete_pool(
    name: str,
    request: objects.ConfigsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Delete Pool configurations """
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.get(
    '/api/configs/pool/{name}/platform',
    response_model=dict[
        str,
        connectors.PlatformMinimal | connectors.PlatformEditable | connectors.Platform,
    ],
)
def list_platforms_in_pool(
    name: str,
    verbose: bool = False,
) -> Mapping[str, connectors.PlatformMinimal | connectors.PlatformEditable | connectors.Platform]:
    """List all Platforms"""
    pool_type = connectors.PoolType.VERBOSE if verbose else connectors.PoolType.EDITABLE
    return connectors.fetch_platform_config(name, pool_type)


@router.get(
    '/api/configs/pool/{name}/platform/{platform_name}',
    response_model=connectors.PlatformMinimal | connectors.PlatformEditable | connectors.Platform,
)
def read_platform_in_pool(
    name: str,
    platform_name: str,
    verbose: bool = False,
) -> connectors.PlatformMinimal | connectors.PlatformEditable | connectors.Platform:
    """Read Platform"""
    pool_type = connectors.PoolType.VERBOSE if verbose else connectors.PoolType.EDITABLE
    platforms = connectors.fetch_platform_config(name, pool_type)
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
    del name, platform_name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.put('/api/configs/pool/{name}/platform/{platform_name}/rename')
def rename_platform_in_pool(name: str, platform_name: str,
                            request: objects.RenamePoolPlatformRequest,
                            username: str = fastapi.Depends(connectors.parse_username)):
    """ Rename Platform """
    del name, platform_name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.get(
    '/api/configs/pod_template',
    response_model=Dict[str, Any],
)
def list_pod_templates() -> Dict[str, Any]:
    """ List all Pod Template configurations """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.PodTemplate.list_from_db(postgres)


@router.get(
    '/api/configs/pod_template/{name}',
    response_model=Dict[str, Any],
)
def read_pod_template(name: str) -> Dict[str, Any]:
    """ Read Pod Template configurations """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.PodTemplate.fetch_from_db(postgres, name)


@router.put('/api/configs/pod_template')
def put_pod_templates(request: objects.PutPodTemplatesRequest,
                      username: str = fastapi.Depends(connectors.parse_username)):
    """ Set Dict of Pod Templates configurations """
    del request
    configmap_guard.reject_if_configmap_mode(username)


@router.put('/api/configs/pod_template/{name}')
def put_pod_template(name: str,
                     request: objects.PutPodTemplateRequest,
                     username: str = fastapi.Depends(connectors.parse_username)):
    """ Put Pod Template configurations """
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.delete('/api/configs/pod_template/{name}')
def delete_pod_template(
    name: str,
    request: objects.ConfigsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Delete Pod Template configurations """
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.get(
    '/api/configs/group_template',
    response_model=Dict[str, Dict[str, Any]],
)
def list_group_templates() -> Dict[str, Dict[str, Any]]:
    """ List all Group Template configurations """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.GroupTemplate.list_from_db(postgres)


@router.get(
    '/api/configs/group_template/{name}',
    response_model=Dict[str, Any],
)
def read_group_template(name: str) -> Dict[str, Any]:
    """ Read Group Template configurations """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.GroupTemplate.fetch_from_db(postgres, name)


@router.put('/api/configs/group_template')
def put_group_templates(request: objects.PutGroupTemplatesRequest,
                        username: str = fastapi.Depends(connectors.parse_username)):
    """ Set Dict of Group Templates configurations """
    del request
    configmap_guard.reject_if_configmap_mode(username)


@router.put('/api/configs/group_template/{name}')
def put_group_template(name: str,
                       request: objects.PutGroupTemplateRequest,
                       username: str = fastapi.Depends(connectors.parse_username)):
    """ Put Group Template configurations """
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.delete('/api/configs/group_template/{name}')
def delete_group_template(
    name: str,
    request: objects.ConfigsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Delete Group Template configurations """
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.get(
    '/api/configs/resource_validation',
    response_model=Dict[str, List[connectors.ResourceAssertion]],
)
def list_resource_validations() -> Dict[str, List[connectors.ResourceAssertion]]:
    """ List all Resource Validation configurations """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.ResourceValidation.list_from_db(postgres)


@router.get(
    '/api/configs/resource_validation/{name}',
    response_model=List[connectors.ResourceAssertion],
)
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
    del request
    configmap_guard.reject_if_configmap_mode(username)


@router.put('/api/configs/resource_validation/{name}')
def put_resource_validation(
    name: str,
    request: objects.PutResourceValidationRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Put Resource Validation configurations """
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.delete('/api/configs/resource_validation/{name}')
def delete_resource_validation(
    name: str,
    request: objects.ConfigsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """Delete Resource Validation configurations"""
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.get(
    '/api/configs/role',
    response_model=List[connectors.Role],
)
def list_roles() -> List[connectors.Role]:
    """ List all Roles """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.Role.list_from_db(postgres)


@router.get(
    '/api/configs/role/{name}',
    response_model=connectors.Role,
)
def read_role(name: str) -> connectors.Role:
    """ Read Role """
    postgres = connectors.PostgresConnector.get_instance()
    return connectors.Role.fetch_from_db(postgres, name)


@router.put('/api/configs/role')
def put_roles(request: objects.PutRolesRequest,
              username: str = fastapi.Depends(connectors.parse_username)):
    """Reject role writes because role definitions are ConfigMap-owned."""
    del request
    configmap_guard.reject_if_configmap_mode(username)


@router.put('/api/configs/role/{name}')
def put_role(name: str,
             request: objects.PutRoleRequest,
             username: str = fastapi.Depends(connectors.parse_username)):
    """Reject role writes because role definitions are ConfigMap-owned."""
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.delete('/api/configs/role/{name}')
def delete_role(name: str,
                request: objects.ConfigsRequest,
                username: str = fastapi.Depends(connectors.parse_username)):
    """Reject role writes because role definitions are ConfigMap-owned."""
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.get(
    '/api/configs/backend_test',
    response_model=Dict[str, connectors.BackendTests],
)
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
    del request
    configmap_guard.reject_if_configmap_mode(username)


@router.get(
    '/api/configs/backend_test/{name}',
    response_model=connectors.BackendTests,
)
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
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.patch('/api/configs/backend_test/{name}')
def patch_backend_test(
    name: str,
    request: objects.PatchBackendTestRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Patch backend test configuration """
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


@router.delete('/api/configs/backend_test/{name}')
def delete_backend_test(
    name: str,
    request: objects.ConfigsRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """ Delete test configuration """
    del name, request
    configmap_guard.reject_if_configmap_mode(username)


def _reject_config_history() -> NoReturn:
    """Reject obsolete database configuration-history operations."""
    raise osmo_errors.OSMOUserError(
        'Configuration history is managed through GitOps in 6.4.',
        status_code=409,
    )


@router.get('/api/configs/history')
def get_configs_history(
    query_params: Annotated[objects.ConfigHistoryQueryParams, fastapi.Query()],
) -> objects.GetConfigsHistoryResponse:
    """Reject the retired database-backed configuration history API."""
    del query_params
    _reject_config_history()


@router.post('/api/configs/history/rollback')
def rollback_config(
    request: objects.RollbackConfigRequest,
    username: str = fastapi.Depends(connectors.parse_username),
):
    """Reject the retired database-backed configuration rollback API."""
    del request, username
    _reject_config_history()


@router.delete('/api/configs/history/{config_type}/revision/{revision}')
def delete_config_history_revision(
    config_type: str,
    revision: Annotated[int, fastapi.Path(gt=0)],
    username: str = fastapi.Depends(connectors.parse_username),
):
    """Reject the retired database-backed history deletion API."""
    del config_type, revision, username
    _reject_config_history()


@router.post('/api/configs/history/{config_type}/revision/{revision}/tags')
def update_config_history_tags(
    config_type: str,
    revision: Annotated[int, fastapi.Path(gt=0)],
    request: objects.UpdateConfigTagsRequest,
):
    """Reject the retired database-backed history tagging API."""
    del config_type, revision, request
    _reject_config_history()


@router.get(
    '/api/configs/diff',
    response_model=objects.ConfigDiffResponse,
)
def get_config_diff(
    request: Annotated[objects.ConfigDiffRequest, fastapi.Query()],
) -> objects.ConfigDiffResponse:
    """Reject the retired database-backed configuration diff API."""
    del request
    _reject_config_history()
