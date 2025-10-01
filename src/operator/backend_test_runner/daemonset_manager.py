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
import time
from typing import Dict, List, Any, Callable, Tuple

from kubernetes import client as kb_client, config as kb_config

from src.operator.utils.node_validation_test import test_base


DEFAULT_TEST_PREFIX = 'test'


def retry_with_backoff(max_retries: int = 3, base_wait_seconds: int = 10):
    """Decorator that implements retry logic with exponential backoff.

    Args:
        max_retries: Maximum number of retry attempts
        base_wait_seconds: Initial wait time for exponential backoff
    """
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        def wrapper(self, *args: Any, **kwargs: Any) -> Any:
            retries = 0
            while retries < max_retries:
                wait_time = base_wait_seconds * (2 ** retries)

                try:
                    result = func(self, *args, **kwargs)
                    if result:
                        return result
                except kb_client.rest.ApiException as e:
                    logging.error('Attempt %d/%d failed: %s', retries + 1, max_retries, str(e))

                logging.info('Retrying in %d seconds...', wait_time)
                time.sleep(wait_time)
                retries += 1

            logging.error('Max retries (%d) reached', max_retries)
            return None  # type: ignore
        return wrapper
    return decorator


class DaemonSetManager:
    """Manages deployment and cleanup of daemonsets based on node conditions."""

    def __init__(self,
                 backend_test_name: str,
                 parsed_pod_template: Dict[str, Any],
                 conditions: List[str],
                 node_condition_prefix: str = test_base.DEFAULT_NODE_CONDITION_PREFIX,
                 namespace: str = 'osmo',
                 prefix: str = DEFAULT_TEST_PREFIX,
                 timeout: int = 300,
                 service_account: str|None = None):
        """Initialize DaemonSetManager.

        Args:
            backend_test_name: Name of the backend test
            namespace: Kubernetes namespace to deploy daemonset in
            parsed_pod_template: Template for pod configuration
            conditions: List of conditions to check for
            node_condition_prefix: Prefix for node conditions
            prefix: Prefix for daemonset name
            timeout: Timeout in seconds for operations
            service_account: Service account name to use for the daemonset pods
        """
        try:
            kb_config.load_incluster_config()
        except kb_config.config_exception.ConfigException:
            kb_config.load_kube_config()

        self.apps_v1 = kb_client.AppsV1Api()
        self.core_v1 = kb_client.CoreV1Api()
        self.namespace = namespace
        self.parsed_pod_template: Dict[str, Any] = parsed_pod_template
        self.node_condition_prefix = node_condition_prefix
        self.conditions = [f'{self.node_condition_prefix}{condition}' \
                           for condition in conditions] if conditions else []
        self.timeout = timeout
        self.name = f'{prefix}-{backend_test_name}'
        self.service_account = service_account
        self.start_time = time.time()
        self.count = 0

    def create_daemonset(self) -> None:
        """Create a daemonset that will run on nodes with the specified condition.

        Args:
            name: Name of the daemonset
        """
        # Get the pod spec and add service account if specified
        pod_spec = self.parsed_pod_template.get('spec', {}).copy()
        if self.service_account:
            pod_spec['serviceAccountName'] = self.service_account

        # Create daemonset spec
        daemonset_dict = {
            'apiVersion': 'apps/v1',
            'kind': 'DaemonSet',
            'metadata': {
                'name': self.name,
                'labels': {
                    'app': self.name
                },
                'namespace': self.namespace
            },
            'spec': {
                'selector': {
                    'matchLabels': {
                        'app': self.name
                    }
                },
                'template': {
                    'metadata': {
                        'labels': {
                            'app': self.name
                        },
                        'namespace': self.namespace
                    },
                    'spec': pod_spec
                }
            }
        }
        try:
            self.apps_v1.create_namespaced_daemon_set(
                namespace=self.namespace,
                body=daemonset_dict
            )
            logging.info('Created daemonset %s with service account %s', self.name,
                         self.service_account or 'default')
        except kb_client.rest.ApiException as e:
            logging.error('Error creating daemonset: %s', e)
            raise

    def _is_pod_ready(self, pod) -> bool:
        """Checks if the pod is in the Ready state.

        Args:
            pod: The pod to be checked.

        Returns:
            bool: True if the pod is ready, False otherwise.
        """
        for condition in pod.status.conditions:
            if condition.type == 'Ready' and condition.status == 'True':
                return True
        return False

    def _wait_for_daemonset_and_conditions(self) -> bool:
        """Wait for daemonset to be ready and check node conditions.

        Returns:
            bool: True if daemonset is ready and all nodes have required conditions,
                  False if timeout or error occurs.
        """
        nodes_with_issues: List[Tuple[str, List[str]]] = []
        start_time = time.time()
        is_daemonset_ready = False
        while time.time() - start_time < self.timeout:
            try:
                # Check daemonset status
                if not is_daemonset_ready:
                    daemonset = self.apps_v1.read_namespaced_daemon_set(
                        name=self.name,
                        namespace=self.namespace
                    )
                    status = daemonset.status
                    desired_number_scheduled = status.desired_number_scheduled or 0
                    number_ready = status.number_ready or 0

                    # If daemonset is not ready yet, continue waiting
                    if desired_number_scheduled == 0 or desired_number_scheduled != number_ready:
                        time.sleep(5)
                        continue
                    else:
                        is_daemonset_ready = True
                        logging.info('Daemonset %s is ready', self.name)

                # Check node conditions using check_node_conditions_after_pod_ready
                nodes_with_issues = self.check_node_conditions_after_pod_ready()

                if not nodes_with_issues:
                    logging.info('All nodes have all required conditions: %s', self.conditions)
                    return True

                time.sleep(5)

            except kb_client.rest.ApiException as e:
                logging.error('Error checking status: %s', e)
                return False

        # Timeout reached - mark unknown conditions
        logging.warning('Timeout waiting for conditions %s on all nodes', self.conditions)
        try:
            # Get nodes with issues at timeout
            if not nodes_with_issues:
                nodes_with_issues = self.check_node_conditions_after_pod_ready()

            # Mark conditions as unknown for nodes with issues
            for node_name, missing_conditions in nodes_with_issues:
                node_test_base = test_base.NodeTestBase(
                    node_name=node_name,
                    node_condition_prefix=self.node_condition_prefix
                )
                conditions = [
                    test_base.NodeCondition(
                        type=condition_type,
                        status='Unknown',
                        reason='DaemonSetTimeout',
                        message=f'Condition status unknown due to timeout on {self.name}'
                    ) for condition_type in missing_conditions
                ]
                node_test_base.update_node(conditions=conditions)
            return False
        except kb_client.rest.ApiException as e:
            logging.error('Error marking unknown conditions: %s', e)
            return False

    def delete_daemonset(self) -> None:
        """Delete a daemonset and its associated pods.

        Args:
            name: Name of the daemonset to delete
        """
        try:
            # Try to delete the daemonset
            try:
                self.apps_v1.delete_namespaced_daemon_set(
                    name=self.name,
                    namespace=self.namespace,
                    body=kb_client.V1DeleteOptions(
                        propagation_policy='Foreground'
                    )
                )
                logging.info('Deleted daemonset %s', self.name)
            except kb_client.rest.ApiException as e:
                if e.status == 404:  # Ignore if daemonset doesn't exist
                    logging.info('daemonset %s already deleted', self.name)
                else:
                    logging.error('Error deleting daemonset %s: %s', self.name, e)
            finally:
                # List and delete pods with the specific app label
                pods = self.core_v1.list_namespaced_pod(
                    namespace=self.namespace,
                    label_selector=f'app={self.name}'
                )

                for pod in pods.items:
                    try:
                        self.core_v1.delete_namespaced_pod(
                            name=pod.metadata.name,
                            namespace=self.namespace,
                            body=kb_client.V1DeleteOptions(
                                grace_period_seconds=0,
                                propagation_policy='Background'
                            )
                        )
                        logging.info('Deleted pod %s', pod.metadata.name)
                    except kb_client.rest.ApiException as e:
                        logging.error('Error deleting pod %s: %s', pod.metadata.name, e)

        except kb_client.rest.ApiException as e:
            logging.error('Error during cleanup: %s', e)
            raise

    def deploy_and_wait(self) -> bool:
        """Deploy daemonset and wait for condition on all nodes.

        Returns:
            bool: True if deployment was successful and condition was met, False otherwise
        """
        status = False
        try:
            # Clean up any existing resources with this name if exists
            self.delete_daemonset()
            # Create daemonset
            self.create_daemonset()
            logging.info('Waiting for daemonset and conditions at %s', time.time())
            # Wait for daemonset and conditions
            if self._wait_for_daemonset_and_conditions():
                # Condition was met, return success
                status = True

        except kb_client.rest.ApiException as e:
            logging.error('Error in deploy_and_wait: %s', e)
            raise
        finally:
            # Clean up resources
            self.delete_daemonset()
        return status

    def check_node_conditions_after_pod_ready(self) -> List[Tuple[str, List[str]]]:
        """
        For each pod:
          - Get the node it is running on.
          - Get all node conditions for that node which are in self.conditions.
          - Check that all node conditions have a lastHeartbeatTime after the test runner starts
            the test.
        Return a list of (node_name, [missing_or_not_updated_conditions]) for nodes
            that do not have all conditions updated.
        """
        self.count += 1
        logging.info('Checking node conditions after pod ready at %s', self.count)
        pods = self.core_v1.list_namespaced_pod(namespace=self.namespace,
                                                label_selector=f'app={self.name}')
        nodes_with_issues = []

        for pod in pods.items:
            node_name = pod.spec.node_name
            node = self.core_v1.read_node(node_name)
            node_conditions = {cond.type: cond for cond in node.status.conditions
                               if cond.type in self.conditions} \
                if node.status.conditions else {}
            missing_or_not_updated = []
            for condition_type in self.conditions:
                cond = node_conditions.get(condition_type)
                if not cond:
                    logging.info('Node %s missing condition %s for pod %s.',
                                 node_name, condition_type, pod.metadata.name)
                    missing_or_not_updated.append(condition_type)
                    continue
                if not cond.last_heartbeat_time or \
                    cond.last_heartbeat_time.timestamp() < self.start_time:
                    logging.info(
                        'Node %s condition %s heartbeat time %s not updated after ' \
                        'start time %s for pod %s.',
                        node_name, condition_type, cond.last_heartbeat_time,
                        self.start_time, pod.metadata.name
                    )
                    missing_or_not_updated.append(condition_type)
            if missing_or_not_updated:
                nodes_with_issues.append((node_name, missing_or_not_updated))
                logging.info('Node %s has missing or not updated conditions: %s',
                             node_name, missing_or_not_updated)
            else:
                logging.info('All conditions for node %s updated after pod %s ready time.',
                             node_name, pod.metadata.name)
        logging.info('Nodes with issues: %s', nodes_with_issues)
        return nodes_with_issues
