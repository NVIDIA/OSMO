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


from datetime import datetime
import logging
import time
from typing import Any, Dict, List, Optional

import pydantic
from kubernetes import client, config as kb_config

from src.lib.utils import logging as logging_utils, osmo_errors
from src.utils import static_config

DEFAULT_NODE_CONDITION_PREFIX = 'osmo.nvidia.com/'


class NodeTestConfig(static_config.StaticConfig, logging_utils.LoggingConfig):
    """Configuration for node validation tests."""
    exit_after_validation: bool = pydantic.Field(
        command_line='exit_after_validation',
        default=False,
        description='Flag to exit after validation')

    # Node/Pod infomation
    node_name: str = pydantic.Field(
        command_line='node_name',
        env='OSMO_NODE_NAME',
        description='Name of the node to validate')
    node_condition_prefix: str = pydantic.Field(
        command_line='node_condition_prefix',
        env='OSMO_NODE_CONDITION_PREFIX',
        default=DEFAULT_NODE_CONDITION_PREFIX,
        description='Prefix for node conditions')

    # Stability
    max_retries: int = pydantic.Field(
        command_line='max_retries',
        default=3,
        description='Maximum number of retries for the LFS mount test')
    base_wait_seconds: int = pydantic.Field(
        command_line='base_wait_seconds',
        default=10,
        description='Base wait time in seconds between retries')

    @pydantic.validator('node_condition_prefix')
    @classmethod
    def validate_node_condition_prefix(cls, v: str) -> str:
        """Validate that node_condition_prefix ends with 'osmo.nvidia.com/'.

        Args:
            v: The value to validate

        Returns:
            The validated value

        Raises:
            ValueError: If the prefix doesn't end with DEFAULT_NODE_CONDITION_PREFIX
        """
        if not v.endswith(DEFAULT_NODE_CONDITION_PREFIX):
            raise ValueError(
                f"node_condition_prefix must end with '{DEFAULT_NODE_CONDITION_PREFIX}'")
        return v


class NodeCondition(pydantic.BaseModel):
    """Node condition model"""
    type: str
    status: str
    reason: Optional[str] = None
    message: Optional[str] = None
    last_heartbeat_time: Optional[str] = pydantic.Field(None, alias='lastHeartbeatTime')
    last_transition_time: Optional[str] = pydantic.Field(None, alias='lastTransitionTime')

    class Config:
        allow_population_by_field_name = True
        populate_by_name = True

    @pydantic.validator('last_heartbeat_time', 'last_transition_time')
    @classmethod
    def validate_rfc3339_timestamp(cls, v):
        """Validate RFC3339 timestamp format if value is provided.

        Args:
            v: Current value of the field

        Returns:
            Validated RFC3339 formatted timestamp string or None
        """
        if v is None:
            return None
        try:
            # Try to parse the input as datetime
            dt = datetime.fromisoformat(v.replace('Z', '+00:00'))
            return dt.strftime('%Y-%m-%dT%H:%M:%SZ''')
        except ValueError as error:
            raise osmo_errors.OSMOUserError(
                f'Timestamp must be in RFC3339 format like \'2024-03-21T15:30:00Z\', Error {error}')


class Taint(pydantic.BaseModel):
    """Node taint model"""
    key: str
    value: str
    effect: str = 'NoSchedule'


class NodeTestBase:
    """Class for handling Kubernetes node operations in OSM tests.

    This class provides functionality to:
    - Load Kubernetes in-cluster configuration
    - Get node allocatable resources
    - Patch node with custom configurations
    - Manage node labels, taints, and conditions
    """

    def __init__(self, node_name: str,
                 node_condition_prefix: str):
        """Initialize NodeTestBase.

        Args:
            node_name: Optional node name. If not provided, will be read from NODE_NAME env var.
        """
        # Load in-cluster config
        try:
            kb_config.load_incluster_config()
        except kb_config.config_exception.ConfigException:
            kb_config.load_kube_config()
        self.v1 = client.CoreV1Api()

        # Get node name from environment or constructor
        self.node_name = node_name
        # Get test prefix from environment
        self.test_prefix: str = node_condition_prefix
        # Initialize node cache
        self._node_cache = None

    def _get_node(self, force_refresh: bool = False) -> Any:
        """Get node information, using cache if available.

        Args:
            force_refresh: If True, force a refresh of the node information

        Returns:
            Node object
        """
        if force_refresh or self._node_cache is None:
            self._node_cache = self.v1.read_node(self.node_name)
        return self._node_cache

    def _add_prefix(self, key: str) -> str:
        """Add test prefix to a key if it doesn't already have it.

        Args:
            key: The key to add prefix to

        Returns:
            Key with prefix added if needed
        """
        if not key.startswith(self.test_prefix):
            return f'{self.test_prefix}{key}'
        return key

    def update_node(self,
                   conditions: Optional[List[NodeCondition]] = None,
                   labels: Optional[Dict[str, str]] = None,
                   taints: Optional[List[Taint]] = None):
        """Update node metadata, spec, and status.

        Args:
            conditions: List of node conditions to set
            labels: Dictionary of labels to set
            taints: List of taints to set
        """
        patch: Dict[str, Any] = {}
        if labels is not None:
            patch['metadata'] = {'labels': labels}
        if taints is not None:
            patch['spec'] = {'taints': [t.dict() for t in taints]}

        # Update metadata and spec if needed
        if patch:
            self.v1.patch_node(self.node_name, patch)

        # Update conditions separately using patch_node_status
        if conditions:
            # Force refresh the node cache to get latest conditions
            current_node = self._get_node(force_refresh=True)

            # Get current conditions from node
            current_conditions = current_node.status.conditions or []

            # Process each new condition
            for c in conditions:
                prefixed_type = self._add_prefix(c.type)
                current_time = datetime.now().strftime('%Y-%m-%dT%H:%M:%SZ')

                # Create new V1NodeCondition
                new_condition = client.V1NodeCondition(
                    type=prefixed_type,
                    status=c.status,
                    reason=c.reason,
                    message=c.message,
                    last_heartbeat_time=current_time,
                    last_transition_time=current_time
                )

                # Replace if exists, else append
                for idx, cond in enumerate(current_conditions):
                    if cond.type == prefixed_type:
                        # Keep original last_transition_time if status hasn't changed
                        if cond.status == c.status:
                            new_condition.last_transition_time = cond.last_transition_time
                        current_conditions[idx] = new_condition
                        break
                else:
                    current_conditions.append(new_condition)

            # Create patch with all conditions
            status_patch = {
                'status': {
                    'conditions': current_conditions
                }
            }

            # Use strategic merge patch to ensure we're not losing any conditions
            self.v1.patch_node_status(
                self.node_name,
                status_patch,
                field_manager=self.test_prefix
            )

            # Force refresh the node cache after update
            self._get_node(force_refresh=True)

    @staticmethod
    def retry_with_backoff():
        """
        Decorator that implements retry logic with exponential backoff.
        Retry when the function raises an exception or returns None.
        """
        def decorator(func):
            def wrapper(self, *args, **kwargs):
                max_retries = self.config.max_retries
                base_wait_seconds = self.config.base_wait_seconds
                retries = 0

                while retries < max_retries:
                    wait_time = base_wait_seconds * (2 ** retries)

                    try:
                        result = func(self, *args, **kwargs)
                        if result:
                            return result
                    except client.exceptions.ApiException as e:
                        logging.error('Attempt %d/%d failed: %s', retries + 1, max_retries, str(e))

                    logging.info('Retrying in %d seconds...', wait_time)
                    time.sleep(wait_time)
                    retries += 1

                logging.error('Max retries (%d) reached', max_retries)
                return None
            return wrapper
        return decorator
