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
from typing import Dict, List, Any
import sys
from kubernetes import client as k8s_client

from src.lib.utils import logging as logging_utils
from src.operator.utils.node_validation_test import test_base


class LFSTestConfig(test_base.NodeTestConfig):
    """Configuration for LFS validation tests."""

    condition_name: str = pydantic.Field(
        command_line='condition_name',
        default='LFSMountFailure',
        description='Condition name for LFS mount failure')

    # Mount configs
    volume_type: str = pydantic.Field(
        command_line='volume_type',
        default='pvc',
        description='Type of volume (pvc or csi)')
    volume_names: List[str] = pydantic.Field(
        command_line='volume_names',
        description='LFS volume names')
    mount_paths: List[str] = pydantic.Field(
        command_line='mount_paths',
        description='Mount paths of the LFS volumemount')
    # PVC configs
    claim_names: List[str] = pydantic.Field(
        command_line='claim_names',
        default=[],
        description='Claim names of the LFS volume')
    sub_paths: List[str] = pydantic.Field(
        command_line='sub_paths',
        default=[],
        description='Sub paths of the LFS volumemount')
    # CSI configs
    lustre_drivers: List[str] = pydantic.Field(
        command_line='lustre_drivers',
        default=[],
        description='Lustre driver names for CSI volumes')
    lustre_shares: List[str] = pydantic.Field(
        command_line='lustre_shares',
        default=[],
        description='Lustre share paths for CSI volumes')
    lustre_servers: List[str] = pydantic.Field(
        command_line='lustre_servers',
        default=[],
        description='Lustre server addresses for CSI volumes. Use ";" to separate multiple servers')
    lustre_mount_options: List[str] = pydantic.Field(
        command_line='lustre_mount_options',
        default=[],
        description='Lustre mount options for CSI volumes')

    # Test Pod Configs
    pod_namespace: str = pydantic.Field(
        command_line='pod_namespace',
        env='OSMO_POD_NAMESPACE',
        description='Namespace of the pod to create')
    pod_image: str = pydantic.Field(
        command_line='pod_image',
        default='nvcr.io/nvidian/osmo/alpine:latest',
        description='Image for the test pod')
    image_pull_secret: str = pydantic.Field(
        command_line='image_pull_secret',
        default='nvcr-secret',
        description='Secret name for pulling the container image')
    pod_succeeded_timeout: int = pydantic.Field(
        command_line='pod_succeeded_timeout',
        default=120,
        description='Timeout in seconds for the pod to be succeeded')

    @pydantic.root_validator()
    @classmethod
    def validate_mount_configs(cls, values):
        def _check_length(required_fields):
            length = len(values.get(required_fields[0], {}))
            if all(len(values.get(field, {})) == length for field in required_fields):
                return values
            else:
                raise ValueError(
                    f'All mount-related configs ({str(required_fields)}) must have the same length'
                )

        if values.get('volume_type', '') == 'pvc':
            required_fields = ['volume_names', 'mount_paths', 'claim_names', 'sub_paths']
            return _check_length(required_fields)
        elif values.get('volume_type', '') == 'csi':
            required_fields = ['volume_names', 'mount_paths', 'lustre_drivers', 'lustre_shares',
                               'lustre_servers', 'lustre_mount_options']
            return _check_length(required_fields)
        else:
            raise ValueError('Invalid volume type')


class LFSValidator(test_base.NodeTestBase):
    """A class for validating lfs mount in a Kubernetes cluster."""

    def __init__(self, config: LFSTestConfig):
        """Initialize the LFSTestConfig."""
        super().__init__(config.node_name, config.node_condition_prefix)
        self.config = config

    def _create_volume_spec(self):
        """
        Creates volumes and volume mounts.
        """
        volumes = []
        volume_mounts = []
        for i in range(len(self.config.volume_names)):
            volume: Dict[str, Any] = {'name': self.config.volume_names[i]}
            volume_mount: Dict[str, Any] = {
                'name': self.config.volume_names[i],
                'mountPath': self.config.mount_paths[i]
            }
            if self.config.volume_type == 'pvc':
                volume['persistentVolumeClaim'] = {
                    'claimName': self.config.claim_names[i]
                }
                volume_mount['subPath'] = self.config.sub_paths[i]
            else:
                volume['csi'] = {
                    'driver': self.config.lustre_drivers[i],
                    'volumeAttributes': {
                        'share': self.config.lustre_shares[i],
                        'server': self.config.lustre_servers[i].replace(';', ','),
                        'mountOptions': self.config.lustre_mount_options[i]
                    }
                }
            volumes.append(volume)
            volume_mounts.append(volume_mount)

        return volumes, volume_mounts

    def _create_pod_spec(self):
        """
        Creates a mount lfs pod on the same node.
        """
        volumes, volume_mounts = self._create_volume_spec()
        pod = {
            'apiVersion': 'v1',
            'kind': 'Pod',
            'metadata': {
                'name': f'lfs-test-{self.config.node_name}',
                'namespace': self.config.pod_namespace,
            },
            'spec': {
                'nodeSelector': {
                    'kubernetes.io/hostname': self.config.node_name
                },
                'restartPolicy': 'Never',
                'imagePullSecrets': [{'name': self.config.image_pull_secret}],
                'containers': [
                    {
                        'name': 'lfs-test',
                        'image': self.config.pod_image,
                        'command': [
                            'sh',
                            '-c',
                            ' && '.join([f'echo "Checking {path}" && ls -la {path}'
                                         for path in self.config.mount_paths])
                        ],
                        'imagePullPolicy': 'IfNotPresent',
                        'volumeMounts': volume_mounts
                    }
                ],
                'volumes': volumes
            }
        }
        return pod

    def _create_pod(self):
        """
        Creates a mount lfs pod on the same node.
        """
        logging.info('Creating LFS test pod "lfs-test-%s".', self.config.node_name)
        pod = self._create_pod_spec()
        self.v1.create_namespaced_pod(
            namespace=self.config.pod_namespace,
            body=pod
        )

    def _get_pod(self):
        """Get the LFS test pod."""
        return self.v1.read_namespaced_pod(
            name=f'lfs-test-{self.config.node_name}',
            namespace=self.config.pod_namespace
        )

    def _delete_pod(self):
        """Delete the LFS test pod."""
        logging.info('Deleting LFS test pod %s.', f'lfs-test-{self.config.node_name}')
        try:
            self.v1.delete_namespaced_pod(
                name=f'lfs-test-{self.config.node_name}',
                namespace=self.config.pod_namespace,
                grace_period_seconds=0,
                propagation_policy='Background'
            )
        except k8s_client.exceptions.ApiException as e:
            logging.error('Error deleting LFS test pod: %s', e)

    def _is_pod_succeeded(self, pod) -> bool:
        """
        Checks if the pod is in the succeeded state.
        """
        return pod.status.phase == 'Succeeded'

    @test_base.NodeTestBase.retry_with_backoff()
    def _mount_test(self) -> test_base.NodeCondition | None:
        """
        Runs the mount test.

        Returns:
            test_base.NodeCondition if the test succeeds, None otherwise.
        """
        condition = None
        try:
            self._create_pod()
            time.sleep(self.config.pod_succeeded_timeout)
            if self._is_pod_succeeded(self._get_pod()):
                condition = test_base.NodeCondition(
                    type=self.config.condition_name,
                    status='False',
                    reason='LFSMountSuccess',
                    message=f'LFS mount test completed for volumes: {str(self.config.volume_names)}'
                )
            else:
                logging.error('LFS mount test pod is not completed in %s seconds.',
                              self.config.pod_succeeded_timeout)
        finally:
            self._delete_pod()
        return condition

    def mount_test(self):
        condition = self._mount_test()
        if not condition:
            condition = test_base.NodeCondition(
                type=self.config.condition_name,
                status='True',
                reason='LFSMountFailure',
                message=f'LFS mount test failed for volumes: {str(self.config.volume_names)}'
            )
        self.update_node(conditions=[condition])


def main():
    """Main function to run the LFS validator."""

    try:
        test_config = LFSTestConfig.load()
        logging_utils.init_logger('lfs_validator', test_config)
        validator = LFSValidator(config=test_config)
        validator.mount_test()

        logging.info('LFS validation completed for node %s', test_config.node_name)
        while True:
            if test_config.exit_after_validation:
                sys.exit()
            time.sleep(30)

    except Exception as e:
        logging.error('Error during LFS validation: %s', e)
        raise

if __name__ == '__main__':
    main()
