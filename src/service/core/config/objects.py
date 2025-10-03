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

import datetime
import enum
from typing import Any, Dict, List

import pydantic

from src.lib.utils import config_history
from src.utils import connectors
from src.utils.connectors.postgres import ListOrder

DEFAULT_POD_TEMPLATES : dict[str, dict] = {
    'default_ctrl': {
        'spec': {
            'containers': [
                {
                    'name': 'osmo-ctrl',
                    'resources': {
                        'limits': {
                            'cpu': '{{USER_CPU}}',
                            'memory': '{{USER_MEMORY}}',
                            'ephemeral-storage': '{{USER_STORAGE}}'
                        },
                        'requests': {
                            'cpu': '1',
                            'memory': '1Gi',
                            'ephemeral-storage': '1Gi'
                        }
                    }
                }
            ]
        }
    },
    'default_user': {
        'spec': {
            'containers': [
                {
                    'name': '{{USER_CONTAINER_NAME}}',
                    'resources': {
                        'limits': {
                            'cpu': '{{USER_CPU}}',
                            'memory': '{{USER_MEMORY}}',
                            'nvidia.com/gpu': '{{USER_GPU}}',
                            'ephemeral-storage': '{{USER_STORAGE}}'
                        },
                        'requests': {
                            'cpu': '{{USER_CPU}}',
                            'memory': '{{USER_MEMORY}}',
                            'nvidia.com/gpu': '{{USER_GPU}}',
                            'ephemeral-storage': '{{USER_STORAGE}}'
                        }
                    }
                }
            ]
        }
    },
    'default_amd64': {
        'spec': {
            'nodeSelector': {
                'kubernetes.io/arch': 'amd64'
            }
        }
    }
}

DEFAULT_RESOURCE_CHECKS = {
    'default_cpu': [
        {
            'operator': 'LE',
            'left_operand': '{{USER_CPU}}',
            'right_operand': '{{K8_CPU}}',
            'assert_message': 'Value {{USER_CPU}} too high for CPU'
        },
        {
            'operator': 'GT',
            'left_operand': '{{USER_CPU}}',
            'right_operand': '0',
            'assert_message': 'Value {{USER_CPU}} needs to be greater than 0 for CPU'
        }
    ],
    'default_memory': [
        {
            'operator': 'LE',
            'left_operand': '{{USER_MEMORY}}',
            'right_operand': '{{K8_MEMORY}}',
            'assert_message': 'Value {{USER_MEMORY}} too high for memory'
        },
        {
            'operator': 'GT',
            'left_operand': '{{USER_MEMORY}}',
            'right_operand': '0',
            'assert_message': 'Value {{USER_MEMORY}} needs to be greater than 0 for memory'
        }
    ],
    'default_storage': [
        {
            'operator': 'LT',
            'left_operand': '{{USER_STORAGE}}',
            'right_operand': '{{K8_STORAGE}}',
            'assert_message': 'Value {{USER_STORAGE}} too high for storage'
        },
        {
            'operator': 'GT',
            'left_operand': '{{USER_STORAGE}}',
            'right_operand': '0',
            'assert_message': 'Value {{USER_STORAGE}} needs to be greater than 0 for storage'
        }
    ]
}


DEFAULT_VARIABLES = {
    'USER_CPU': 1,
    'USER_GPU': 0,
    'USER_MEMORY': '1Gi',
    'USER_STORAGE': '1Gi'
}


class ListBackendsResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing info for all backends. """
    backends: List[connectors.Backend]

class NodeUpdateType(enum.Enum):
    INSERT = 'INSERT' # Finish any workflows
    UPDATE = 'UPDATE' # Cancel all workflows
    DELETE = 'DELETE' # Delete the backend without waiting for workflows


class ConfigsRequest(pydantic.BaseModel):
    """Request body for updating configurations with history tracking metadata."""

    description: str | None = None
    tags: List[str] | None = None


class PutConfigsRequest(ConfigsRequest):
    """Request body for updating configurations with history tracking metadata."""

    configs: connectors.DynamicConfig


# pylint: disable=too-few-public-methods
class PutServiceRequest(PutConfigsRequest):
    """Request body for updating service configurations with history tracking metadata."""

    configs: connectors.ServiceConfig


class PutWorkflowRequest(PutConfigsRequest):
    """Request body for updating workflow configurations with history tracking metadata."""

    configs: connectors.WorkflowConfig


class PutDatasetRequest(PutConfigsRequest):
    """Request body for updating dataset configurations with history tracking metadata."""

    configs: connectors.DatasetConfig


class PatchDatasetRequest(ConfigsRequest):
    """Request body for patching a dataset bucket configuration with history tracking metadata."""

    configs_dict: Dict[str, Any]


class PatchConfigRequest(ConfigsRequest):
    """Request body for patching configurations with history tracking metadata."""

    configs_dict: Dict[str, Any]


class BackendConfig(pydantic.BaseModel):
    """Similar to connectors.Backend, but with optional fields."""

    description: str | None = None
    k8s_uid: str | None = None
    dashboard_url: str | None = None
    grafana_url: str | None = None
    tests: List[str] | None = None
    scheduler_settings: connectors.BackendSchedulerSettings | None = None
    node_conditions: connectors.BackendNodeConditions | None = None
    router_address: str | None = None

    def plaintext_dict(self, *args, **kwargs):
        """Convert the BackendConfig to a dictionary."""
        dict_data = super().dict(*args, **kwargs)
        dict_data['scheduler_settings'] = (
            None
            if not self.scheduler_settings
            else str(self.scheduler_settings.json())
        )

        dict_data['node_conditions'] = (
            None if not self.node_conditions else str(self.node_conditions.json())
        )
        return dict_data


class BackendConfigWithName(BackendConfig):
    """Similar to BackendConfig, but with a name field. Used for updating all backends."""

    name: str


class PostBackendRequest(ConfigsRequest):
    """Request body for creating a new backend with history tracking metadata."""

    configs: BackendConfig


class UpdateBackends(ConfigsRequest):
    """Request body for updating multiple backends with history tracking metadata."""

    backends: List[BackendConfigWithName]


class DeleteBackendRequest(ConfigsRequest):
    """Request body for deleting a backend with history tracking metadata."""

    force: bool = False


class PutPoolsRequest(ConfigsRequest):
    """Request body for updating pools with history tracking metadata."""

    configs: Dict[str, connectors.Pool]


class PutPoolRequest(ConfigsRequest):
    """Request body for updating a pool with history tracking metadata."""

    configs: connectors.Pool


class PatchPoolRequest(ConfigsRequest):
    """Request body for patching a pool with history tracking metadata."""

    configs_dict: Dict[str, Any]


class RenamePoolRequest(ConfigsRequest):
    """Request body for renaming a pool with history tracking metadata."""

    new_name: str


class PutPoolPlatformRequest(ConfigsRequest):
    """Request body for updating a platform in a pool with history tracking metadata."""

    configs: connectors.Platform


class RenamePoolPlatformRequest(ConfigsRequest):
    """Request body for renaming a platform in a pool with history tracking metadata."""

    new_name: str


class PutPodTemplatesRequest(ConfigsRequest):
    """Request body for updating pod templates with history tracking metadata."""

    configs: Dict[str, Dict]


class PutPodTemplateRequest(ConfigsRequest):
    """Request body for updating a pod template with history tracking metadata."""

    configs: Dict


class PutResourceValidationsRequest(ConfigsRequest):
    """Request body for updating resource validations with history tracking metadata."""

    configs_dict: Dict[str, List[Dict]]


class PutResourceValidationRequest(ConfigsRequest):
    """Request body for updating a resource validation with history tracking metadata."""

    configs: List[Dict]

class PutBackendTestRequest(ConfigsRequest):
    """Request body for updating a test with history tracking metadata."""

    configs: connectors.BackendTests

class PutBackendTestsRequest(ConfigsRequest):
    """Request body for updating a test with history tracking metadata."""

    configs: Dict[str, connectors.BackendTests]

class PatchBackendTestRequest(ConfigsRequest):
    """Request body for patching a test with history tracking metadata."""

    configs_dict: Dict[str, Any]


class PutRoleRequest(ConfigsRequest):
    """Request body for updating a role with history tracking metadata."""

    configs: connectors.Role


class PutRolesRequest(ConfigsRequest):
    """Request body for updating a test with history tracking metadata."""

    configs: List[connectors.Role]


class ConfigHistoryQueryParams(pydantic.BaseModel):
    """Query parameters for config history endpoint."""

    offset: int | None = pydantic.Field(default=0, ge=0, description='Number of records to skip')
    limit: int | None = pydantic.Field(
        default=20, gt=0, le=1000, description='Maximum number of records to return'
    )
    order: ListOrder = pydantic.Field(
        default=ListOrder.ASC, description='Sort order by creation time'
    )
    config_types: List[config_history.ConfigHistoryType] | None = pydantic.Field(
        default=None, description='Filter by config types'
    )
    name: str | None = pydantic.Field(default=None, description='Filter by config name')
    revision: int | None = pydantic.Field(default=None, gt=0, description='Filter by revision')
    tags: List[str] | None = pydantic.Field(default=None, description='Filter by tags')
    created_before: datetime.datetime | None = pydantic.Field(
        default=None, description='Filter by creation time before'
    )
    created_after: datetime.datetime | None = pydantic.Field(
        default=None, description='Filter by creation time after'
    )
    at_timestamp: datetime.datetime | None = pydantic.Field(
        default=None, description='Get config state at specific timestamp'
    )
    omit_data: bool = pydantic.Field(
        default=False, description='Whether to omit data from the response'
    )

    @pydantic.validator('config_types')
    @classmethod
    def validate_config_types(cls, v):
        if v is not None:
            valid_types = [t.value.lower() for t in config_history.ConfigHistoryType]
            invalid_types = [t for t in v if t.value.lower() not in valid_types]
            if invalid_types:
                raise ValueError(
                    f'Invalid config types: {invalid_types}. Valid types are: {valid_types}'
                )
        return v

    @pydantic.validator('at_timestamp')
    @classmethod
    def validate_at_timestamp(cls, v, values):
        if v is not None:
            if 'created_before' in values and values['created_before'] is not None:
                raise ValueError('Cannot specify both at_timestamp and created_before')
            if 'created_after' in values and values['created_after'] is not None:
                raise ValueError('Cannot specify both at_timestamp and created_after')
        return v


class ConfigHistory(pydantic.BaseModel):
    """Object storing config history."""

    config_type: config_history.ConfigHistoryType
    name: str
    revision: int
    username: str
    created_at: datetime.datetime
    description: str
    tags: List[str] | None
    data: Any


class GetConfigsHistoryResponse(pydantic.BaseModel):
    """Response body for config history endpoint."""

    configs: List[ConfigHistory]


class RollbackConfigRequest(ConfigsRequest):
    """Request body for config rollback endpoint."""

    config_type: connectors.ConfigHistoryType
    revision: int = pydantic.Field(gt=0, description='Revision to roll back to')


class UpdateConfigTagsRequest(pydantic.BaseModel):
    """Request body for updating config tags endpoint."""

    set_tags: List[str] | None = pydantic.Field(
        default=None,
        description='Tags to add to the config'
    )
    delete_tags: List[str] | None = pydantic.Field(
        default=None,
        description='Tags to remove from the config'
    )

    @pydantic.validator('set_tags', 'delete_tags')
    @classmethod
    def validate_tags(cls, v):
        if v is not None and not v:
            raise ValueError('Tags list cannot be empty')
        return v

    @pydantic.root_validator
    @classmethod
    def validate_at_least_one_tag_operation(cls, values):
        if not values.get('set_tags') and not values.get('delete_tags'):
            raise ValueError('At least one of set_tags or delete_tags must be provided')
        return values


class ConfigDiffRequest(pydantic.BaseModel):
    """Request body for config diff endpoint."""

    config_type: connectors.ConfigHistoryType
    first_revision: int = pydantic.Field(gt=0, description='First revision to compare')
    second_revision: int = pydantic.Field(gt=0, description='Second revision to compare')


class ConfigDiffResponse(pydantic.BaseModel):
    """Response body for config diff endpoint."""

    first_data: Any
    second_data: Any
