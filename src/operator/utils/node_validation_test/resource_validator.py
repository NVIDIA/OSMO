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

import logging
import pydantic
import time
import sys
from kubernetes import client as k8s_client

from src.lib.utils import common as common_utils, logging as logging_utils
from src.operator.utils.node_validation_test import test_base


class ResourceTestConfig(test_base.NodeTestConfig):
    """Configuration for resource validation tests."""
    # label keys
    gpu_type_label: str = pydantic.Field(
        command_line='gpu_type_label',
        default='nvidia.com/gpu',
        description='GPU resource type')
    nic_type_label: str = pydantic.Field(
        command_line='nic_type_label',
        default='nvidia.com/mlnxnics',
        description='NIC resource type')
    # resource counts
    gpu_count: int = pydantic.Field(
        command_line='gpu_count',
        default=8,
        description='Minimum number of GPUs required')
    nic_count: int = pydantic.Field(
        command_line='nic_count',
        default=8,
        description='Minimum number of NICs required')
    min_memory: str = pydantic.Field(
        command_line='min_memory',
        default='1850Gi',
        description='Minimum required memory')
    min_storage: str = pydantic.Field(
        command_line='min_storage',
        default='10Gi',
        description='Minimum required storage')
    gpu_mode_label: str = pydantic.Field(
        command_line='gpu_mode_label',
        default='nvidia.com/gpu.mode',
        description='GPU mode label')
    gpu_mode: str = pydantic.Field(
        command_line='gpu_mode',
        default='compute',
        description='Expected GPU mode')
    gpu_product_label: str = pydantic.Field(
        command_line='gpu_product_label',
        default='nvidia.com/gpu.product',
        description='GPU product label')
    gpu_product: str = pydantic.Field(
        command_line='gpu_product',
        default='NVIDIA-H100-80GB-HBM3',
        description='Expected GPU product')

    # Add condition names
    gpu_less_than_total_condition: str = pydantic.Field(
        command_line='gpu_less_than_total_condition',
        default='GpuLessThanTotal',
        description='Condition name for insufficient GPU count')
    nics_less_than_total_condition: str = pydantic.Field(
        command_line='nics_less_than_total_condition',
        default='NicsLessThanTotal',
        description='Condition name for insufficient NIC count')
    memory_less_than_total_condition: str = pydantic.Field(
        command_line='memory_less_than_total_condition',
        default='MemoryLessThanTotal',
        description='Condition name for insufficient memory')
    storage_less_than_total_condition: str = pydantic.Field(
        command_line='storage_less_than_total_condition',
        default='StorageLessThanTotal',
        description='Condition name for insufficient storage')
    gpu_incorrect_mode_condition: str = pydantic.Field(
        command_line='gpu_incorrect_mode_condition',
        default='GpuIncorrectMode',
        description='Condition name for incorrect GPU mode')
    gpu_incorrect_product_condition: str = pydantic.Field(
        command_line='gpu_incorrect_product_condition',
        default='GpuIncorrectProduct',
        description='Condition name for incorrect GPU product')


class ResourceValidator(test_base.NodeTestBase):
    """A class for validating node resources in a Kubernetes cluster."""

    def __init__(self, config: ResourceTestConfig):
        """Initialize the ResourceValidator.

        Args:
            node_name: Name of the node to validate resources for
            config: Optional ResourceTestConfig object
        """
        super().__init__(config.node_name, config.node_condition_prefix)
        self._v1 = k8s_client.CoreV1Api()
        self.config = config

    def check_node_resources(self) -> None:
        """Check all required resources and their labels, then patch node conditions once."""
        conditions = []

        try:
            node = self._get_node()  # Use the correct method name from NodeTestBase
            allocatable = node.status.allocatable
            labels = node.metadata.labels

            # Check GPU count
            available_gpus = int(allocatable.get(self.config.gpu_type_label, '0'))
            conditions.append(test_base.NodeCondition(
                type=self.config.gpu_less_than_total_condition,
                status='True' if available_gpus < self.config.gpu_count else 'False',
                reason='InsufficientGPU' if available_gpus < self.config.gpu_count \
                                        else 'SufficientGPU',
                message=f'Available GPUs: {available_gpus}, Required: {self.config.gpu_count}'
            ))

            # Check NIC count
            available_nics = int(allocatable.get(self.config.nic_type_label, '0'))
            conditions.append(test_base.NodeCondition(
                type=self.config.nics_less_than_total_condition,
                status='True' if available_nics < self.config.nic_count else 'False',
                reason='InsufficientNIC' if available_nics < self.config.nic_count \
                                        else 'SufficientNIC',
                message=f'Available NICs: {available_nics}, Required: {self.config.nic_count}'
            ))

            # Check memory
            available_memory = allocatable.get('memory', '0')
            memory_valid = self._compare_resource_values(available_memory, self.config.min_memory)
            conditions.append(test_base.NodeCondition(
                type=self.config.memory_less_than_total_condition,
                status='True' if not memory_valid else 'False',
                reason='InsufficientMemory' if not memory_valid else 'SufficientMemory',
                message=f'Available Memory: {available_memory}, Required: {self.config.min_memory}'
            ))

            # Check storage
            available_storage = allocatable.get('ephemeral-storage', '0')
            storage_valid = self._compare_resource_values(available_storage,
                                                          self.config.min_storage)
            conditions.append(test_base.NodeCondition(
                type=self.config.storage_less_than_total_condition,
                status='True' if not storage_valid else 'False',
                reason='InsufficientStorage' if not storage_valid else 'SufficientStorage',
                message= \
                f'Available Storage: {available_storage}, Required: {self.config.min_storage}'
            ))

            # Check GPU mode
            gpu_mode = labels.get(self.config.gpu_mode_label)
            gpu_mode_valid = gpu_mode == self.config.gpu_mode
            conditions.append(test_base.NodeCondition(
                type=self.config.gpu_incorrect_mode_condition,
                status='True' if not gpu_mode_valid else 'False',
                reason='InvalidGpuMode' if not gpu_mode_valid else 'ValidGpuMode',
                message=f'GPU Mode: {gpu_mode}, Expected: {self.config.gpu_mode}'
            ))

            # Check GPU product
            gpu_product = labels.get(self.config.gpu_product_label)
            gpu_product_valid = gpu_product == self.config.gpu_product
            conditions.append(test_base.NodeCondition(
                type=self.config.gpu_incorrect_product_condition,
                status='True' if not gpu_product_valid else 'False',
                reason='InvalidGpuProduct' if not gpu_product_valid else 'ValidGpuProduct',
                message=f'GPU Product: {gpu_product}, Expected: {self.config.gpu_product}'
            ))

            # Apply all conditions at once with current timestamp
            self.update_node(conditions=conditions)
        except k8s_client.rest.ApiException as e:
            logging.error('Failed to check resources for node %s: %s', self.node_name, e)
            raise

    def _compare_resource_values(self, available: str, required: str) -> bool:
        """Compare two resource values with units.

        Args:
            available: Available resource value with unit (e.g., "16Gi")
            required: Required resource value with unit (e.g., "8Gi")

        Returns:
            bool: True if available >= required
        """
        return common_utils.convert_resource_value_str(available, target='B') >= \
            common_utils.convert_resource_value_str(required, target='B')

def main():
    """Main function to run the resource validator."""

    try:
        test_config = ResourceTestConfig.load()
        # Initialize the validator
        logging_utils.init_logger('resource_validator', test_config)
        validator = ResourceValidator(config=test_config)
        # Run the resource checks
        validator.check_node_resources()

        logging.info('Resource validation completed for node %s', test_config.node_name)
        while True:
            if test_config.exit_after_validation:
                sys.exit()
            time.sleep(30)

    except Exception as e:
        logging.error('Error during resource validation: %s', e)
        raise

if __name__ == '__main__':
    main()
