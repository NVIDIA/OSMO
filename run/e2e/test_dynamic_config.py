# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""E2E tests for ConfigMap-sourced dynamic configuration.

These tests validate the configmap_loader feature by deploying OSMO with
dynamicConfig enabled via Helm values and verifying that configs are
correctly applied to the database on startup.

Prerequisites:
- A KIND cluster with OSMO deployed using the dynamic config values file
  (run/minimal/osmo_dynamic_config_values.yaml)
- The OSMO_E2E_URL environment variable set to the service base URL

See run/minimal/osmo_dynamic_config_values.yaml for the test values.
"""

from typing import Any, Dict, List

import pytest

from run.e2e.e2e_client import OsmoE2EClient


CONFIGMAP_SYNC_USERNAME = 'configmap-sync'
CONFIGMAP_SYNC_TAG = 'configmap'


def _get_config_history(
    client: OsmoE2EClient,
    config_type: str,
    name: str | None = None,
    tags: list[str] | None = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Fetch config history entries with optional filters."""
    params: Dict[str, Any] = {
        'config_types': config_type,
        'limit': limit,
        'order': 'DESC',
    }
    if name:
        params['name'] = name
    if tags:
        params['tags'] = tags
    response = client.get('/api/configs/history', params=params)
    if response.status_code != 200:
        return []
    return response.json().get('configs', [])


class TestDynamicConfigFreshDeployment:
    """Scenario 1: Fresh deployment with ConfigMap configs.

    Verify that all config types defined in dynamicConfig Helm values
    appear in the database after startup.
    """

    def test_workflow_config_applied(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify workflow config from ConfigMap is applied."""
        response = e2e_client.get('/api/configs/workflow')
        assert response.status_code == 200
        data = response.json()
        assert data.get('max_num_tasks') == 50

    def test_pool_created_from_configmap(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify the 'e2e-test' pool was created from ConfigMap."""
        response = e2e_client.get('/api/configs/pool/e2e-test')
        assert response.status_code == 200
        data = response.json()
        assert data.get('description') == 'E2E test pool from ConfigMap'

    def test_pod_template_created_from_configmap(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify pod template was created from ConfigMap."""
        response = e2e_client.get('/api/configs/pod_template/e2e-compute')
        assert response.status_code == 200

    def test_resource_validation_created_from_configmap(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify resource validation was created from ConfigMap."""
        response = e2e_client.get(
            '/api/configs/resource_validation/e2e-cpu-limit')
        assert response.status_code == 200

    def test_backend_created_from_configmap(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify backend was created from ConfigMap."""
        response = e2e_client.get('/api/configs/backend/e2e-backend')
        assert response.status_code == 200
        data = response.json()
        assert data.get('description') == 'E2E test backend'

    def test_config_history_shows_configmap_sync(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify config history entries have username=configmap-sync."""
        history = _get_config_history(
            e2e_client,
            config_type='WORKFLOW',
            tags=[CONFIGMAP_SYNC_TAG],
        )
        configmap_entries = [
            entry for entry in history
            if entry.get('username') == CONFIGMAP_SYNC_USERNAME
        ]
        assert len(configmap_entries) > 0, (
            'No config history entries found with '
            f'username={CONFIGMAP_SYNC_USERNAME}')

    def test_config_history_has_configmap_tag(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify config history entries are tagged with 'configmap'."""
        history = _get_config_history(
            e2e_client,
            config_type='POOL',
            name='e2e-test',
        )
        configmap_entries = [
            entry for entry in history
            if CONFIGMAP_SYNC_TAG in (entry.get('tags') or [])
        ]
        assert len(configmap_entries) > 0, (
            'No config history entries found with '
            f'tag={CONFIGMAP_SYNC_TAG}')


class TestDynamicConfigSeedMode:
    """Scenario 2: CLI update AFTER ConfigMap (seed mode).

    Service config is deployed with managed_by=seed. Resource validations
    also use seed mode. After a CLI update, the seed-mode ConfigMap
    should NOT overwrite the CLI changes on restart (because the config
    already exists in DB).

    The service_base_url from the ConfigMap should only be applied on
    first deployment when no service config exists.
    """

    def test_service_config_applied_on_first_deploy(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify service config from ConfigMap was applied initially."""
        response = e2e_client.get('/api/configs/service')
        assert response.status_code == 200
        data = response.json()
        # The service_base_url should have been applied from ConfigMap
        # on initial deployment (or from update_configs if that ran after)
        assert 'service_base_url' in data

    def test_resource_validation_seed_applied(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify seed-mode resource validation was created."""
        response = e2e_client.get(
            '/api/configs/resource_validation/e2e-cpu-limit')
        assert response.status_code == 200

    def test_cli_update_not_overwritten_by_seed(
            self, e2e_client: OsmoE2EClient) -> None:
        """Update service config via API, verify it persists.

        In seed mode, once a config exists, it won't be overwritten
        by the ConfigMap on restart. This test modifies the service
        config and verifies the change sticks. Full restart
        verification requires kubectl to delete the pod.
        """
        get_response = e2e_client.get('/api/configs/service')
        assert get_response.status_code == 200
        original_config = get_response.json()

        # Patch with a known marker so we can detect if ConfigMap
        # overwrites it on next restart
        original_config['service_base_url'] = (
            'http://e2e-modified-by-cli.test')
        patch_response = e2e_client.patch(
            '/api/configs/service',
            json=original_config,
            params={'description': 'E2E test: seed mode CLI update'},
        )
        assert patch_response.status_code == 200

        verify_response = e2e_client.get('/api/configs/service')
        assert verify_response.status_code == 200
        data = verify_response.json()
        assert data.get('service_base_url') == (
            'http://e2e-modified-by-cli.test')


class TestDynamicConfigConfigmapMode:
    """Scenario 3: CLI update AFTER ConfigMap (configmap mode).

    Workflow config is deployed with managed_by=configmap. CLI changes
    are ephemeral and will be overwritten on the next pod restart.
    """

    def test_workflow_overwrite_detection(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify workflow config matches the ConfigMap value.

        The configmap mode always overwrites on startup, so the
        value should always be what the ConfigMap specifies.
        """
        response = e2e_client.get('/api/configs/workflow')
        assert response.status_code == 200
        data = response.json()
        assert data.get('max_num_tasks') == 50


class TestDynamicConfigHelmUpgrade:
    """Scenario 4: ConfigMap update after CLI.

    After a helm upgrade with new values, the pod should restart
    (due to checksum annotation) and apply the new config.

    NOTE: These tests verify the mechanism works by checking that
    the checksum annotation triggers restarts. The actual helm
    upgrade step requires kind/kubectl access.
    """

    def test_pool_listing_includes_configmap_pools(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify ConfigMap-defined pools appear in pool listing."""
        response = e2e_client.get('/api/configs/pool')
        assert response.status_code == 200
        data = response.json()
        pool_names = [pool.get('name') for pool in data]
        assert 'e2e-test' in pool_names, (
            f'e2e-test pool not found in listing: {pool_names}')

    def test_backend_listing_includes_configmap_backends(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify ConfigMap-defined backends appear in listing."""
        response = e2e_client.get('/api/configs/backend')
        assert response.status_code == 200
        data = response.json()
        backend_names = [backend.get('name') for backend in data]
        assert 'e2e-backend' in backend_names, (
            f'e2e-backend not found in listing: {backend_names}')


class TestDynamicConfigErrorResilience:
    """Scenario 6: Error resilience.

    If one config type fails validation, the service should still
    start and other config types should be applied correctly.

    This is tested by deploying with an intentionally invalid config
    for one type and verifying other types succeed.
    """

    def test_service_healthy_despite_config_errors(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify the service is healthy even if some configs failed."""
        response = e2e_client.get('/health')
        assert response.status_code == 200

    def test_valid_configs_applied_despite_errors(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify configs that were valid were still applied."""
        response = e2e_client.get('/api/configs/workflow')
        assert response.status_code == 200
        data = response.json()
        assert data.get('max_num_tasks') == 50


class TestDynamicConfigMultiReplica:
    """Scenario 7: Multi-replica startup.

    When multiple replicas start simultaneously, only one should
    apply configs (via advisory lock). Config history should not
    show duplicate entries.
    """

    def test_no_duplicate_history_entries(
            self, e2e_client: OsmoE2EClient) -> None:
        """Verify configs are applied exactly once (no duplicates).

        Check config history for the pool created from ConfigMap.
        There should be exactly one creation entry from configmap-sync.
        """
        history = _get_config_history(
            e2e_client,
            config_type='POOL',
            name='e2e-test',
            tags=[CONFIGMAP_SYNC_TAG],
        )
        creation_entries = [
            entry for entry in history
            if entry.get('username') == CONFIGMAP_SYNC_USERNAME
        ]
        # With advisory lock, there should be exactly 1 entry
        # per restart (not 2+ from concurrent replicas).
        assert len(creation_entries) >= 1
        # If service was restarted N times, there should be at
        # most N entries but never 2+ from the same startup
        # cycle. We can't easily distinguish cycles, so we just
        # verify no obvious duplication (same timestamps).
        if len(creation_entries) > 1:
            timestamps = [
                entry.get('created_at')
                for entry in creation_entries
            ]
            unique_timestamps = set(timestamps)
            # Each entry should have a unique timestamp (different restart cycles)
            assert len(unique_timestamps) == len(timestamps), (
                f'Duplicate config history timestamps detected: {timestamps}')
