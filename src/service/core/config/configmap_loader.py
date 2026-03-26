"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
import logging
from typing import Any, Dict

import yaml

from src.lib.utils import common, osmo_errors
from src.service.core.config import (
    config_service,
    helpers as config_helpers,
    objects as config_objects,
)
from src.utils import connectors


CONFIGMAP_SYNC_USERNAME = 'configmap-sync'
CONFIGMAP_SYNC_TAGS = ['configmap']


class ManagedByMode(str, enum.Enum):
    SEED = 'seed'
    CONFIGMAP = 'configmap'


def load_dynamic_configs(config_file_path: str, postgres: connectors.PostgresConnector) -> None:
    """Load dynamic configs from a YAML file on startup.

    Acquires a PostgreSQL advisory lock to prevent concurrent loading from
    multiple replicas. Applies configs in dependency order and continues
    on per-type errors so the service always starts.
    """
    logging.info('Loading dynamic configs from %s', config_file_path)

    try:
        with open(config_file_path, encoding='utf-8') as config_file:
            raw_config = yaml.safe_load(config_file)
    except (OSError, yaml.YAMLError) as error:
        logging.error('Failed to read dynamic config file %s: %s', config_file_path, error)
        return

    if not raw_config or 'managed_configs' not in raw_config:
        logging.warning('Dynamic config file %s has no managed_configs section', config_file_path)
        return

    managed_configs = raw_config['managed_configs']

    # Acquire advisory lock so only one replica applies configs
    lock_result = postgres.execute_fetch_command(
        "SELECT pg_try_advisory_lock(hashtext('configmap-sync'))", (), return_raw=True)
    if not lock_result or not lock_result[0]['pg_try_advisory_lock']:
        logging.info('Another replica is applying dynamic configs, skipping')
        return

    try:
        _apply_all_configs(managed_configs, postgres)
    finally:
        # Release advisory lock
        postgres.execute_fetch_command(
            "SELECT pg_advisory_unlock(hashtext('configmap-sync'))", (), return_raw=True)

    logging.info('Dynamic config loading complete')


def _apply_all_configs(managed_configs: Dict[str, Any],
                       postgres: connectors.PostgresConnector) -> None:
    """Apply all config types in dependency order."""
    # Phase 1: Templates and validations (no dependencies)
    _safe_apply('resource_validations', managed_configs, postgres, _apply_resource_validations)
    _safe_apply('pod_templates', managed_configs, postgres, _apply_pod_templates)
    _safe_apply('group_templates', managed_configs, postgres, _apply_group_templates)

    # Phase 2: Backends and backend tests (depend on templates)
    _safe_apply('backends', managed_configs, postgres, _apply_backends)
    _safe_apply('backend_tests', managed_configs, postgres, _apply_backend_tests)

    # Phase 3: Pools (depend on backends and templates)
    _safe_apply('pools', managed_configs, postgres, _apply_pools)

    # Phase 4: Roles
    _safe_apply('roles', managed_configs, postgres, _apply_roles)

    # Phase 5: Singleton configs
    _safe_apply('service', managed_configs, postgres, _apply_service_config)
    _safe_apply('workflow', managed_configs, postgres, _apply_workflow_config)
    _safe_apply('dataset', managed_configs, postgres, _apply_dataset_config)


def _safe_apply(config_key: str, managed_configs: Dict[str, Any],
                postgres: connectors.PostgresConnector,
                apply_function) -> None:
    """Call apply_function if config_key is present, catching all errors."""
    if config_key not in managed_configs:
        return
    try:
        apply_function(managed_configs[config_key], postgres)
    except Exception:
        logging.exception('Failed to apply dynamic config for %s', config_key)


def _parse_managed_by(section: Dict[str, Any]) -> ManagedByMode:
    """Extract and validate managed_by from a config section."""
    raw_value = section.get('managed_by', ManagedByMode.SEED.value)
    try:
        return ManagedByMode(raw_value)
    except ValueError:
        raise ValueError(
            f'Invalid managed_by value: {raw_value}. '
            f'Must be one of: {", ".join(m.value for m in ManagedByMode)}')


# ---------------------------------------------------------------------------
# Singleton configs: SERVICE, WORKFLOW, DATASET
# ---------------------------------------------------------------------------

def _singleton_config_exists(config_type: connectors.ConfigType,
                             postgres: connectors.PostgresConnector) -> bool:
    """Check if a singleton config has any non-default values in the DB."""
    try:
        config = postgres.get_configs(config_type)
        # A config "exists" (has been explicitly set) if it has any fields
        # beyond the defaults. We check if any value is actually stored.
        config_dict = config.plaintext_dict(by_alias=True, exclude_unset=True)
        return len(config_dict) > 0
    except osmo_errors.OSMODatabaseError:
        return False


def _apply_service_config(section: Dict[str, Any],
                          postgres: connectors.PostgresConnector) -> None:
    managed_by = _parse_managed_by(section)
    config_data = section.get('config', {})
    if not config_data:
        return

    if managed_by == ManagedByMode.SEED and _singleton_config_exists(
            connectors.ConfigType.SERVICE, postgres):
        logging.info('Service config already exists, skipping (managed_by=seed)')
        return

    logging.info('Applying service config (managed_by=%s)', managed_by.value)
    config_helpers.patch_configs(
        request=config_objects.PatchConfigRequest(
            configs_dict=config_data,
            description=f'Applied from dynamic config (managed_by={managed_by.value})',
            tags=CONFIGMAP_SYNC_TAGS,
        ),
        config_type=connectors.ConfigType.SERVICE,
        username=CONFIGMAP_SYNC_USERNAME,
    )


def _apply_workflow_config(section: Dict[str, Any],
                           postgres: connectors.PostgresConnector) -> None:
    managed_by = _parse_managed_by(section)
    config_data = section.get('config', {})
    if not config_data:
        return

    if managed_by == ManagedByMode.SEED and _singleton_config_exists(
            connectors.ConfigType.WORKFLOW, postgres):
        logging.info('Workflow config already exists, skipping (managed_by=seed)')
        return

    logging.info('Applying workflow config (managed_by=%s)', managed_by.value)
    config_helpers.patch_configs(
        request=config_objects.PatchConfigRequest(
            configs_dict=config_data,
            description=f'Applied from dynamic config (managed_by={managed_by.value})',
            tags=CONFIGMAP_SYNC_TAGS,
        ),
        config_type=connectors.ConfigType.WORKFLOW,
        username=CONFIGMAP_SYNC_USERNAME,
    )


def _apply_dataset_config(section: Dict[str, Any],
                          postgres: connectors.PostgresConnector) -> None:
    managed_by = _parse_managed_by(section)
    config_data = section.get('config', {})
    if not config_data:
        return

    if managed_by == ManagedByMode.SEED and _singleton_config_exists(
            connectors.ConfigType.DATASET, postgres):
        logging.info('Dataset config already exists, skipping (managed_by=seed)')
        return

    # Handle secret_file references in bucket credentials
    _resolve_dataset_secret_files(config_data)

    logging.info('Applying dataset config (managed_by=%s)', managed_by.value)
    config_helpers.patch_configs(
        request=config_objects.PatchConfigRequest(
            configs_dict=config_data,
            description=f'Applied from dynamic config (managed_by={managed_by.value})',
            tags=CONFIGMAP_SYNC_TAGS,
        ),
        config_type=connectors.ConfigType.DATASET,
        username=CONFIGMAP_SYNC_USERNAME,
    )


def _resolve_dataset_secret_files(config_data: Dict[str, Any]) -> None:
    """Replace secret_file references with actual credential values.

    For each bucket's default_credential that has a secret_file key,
    read the YAML file and replace the secret_file reference with the
    actual access_key_id and access_key values.
    """
    buckets = config_data.get('buckets', {})
    for bucket_name, bucket_config in buckets.items():
        if not isinstance(bucket_config, dict):
            continue
        default_credential = bucket_config.get('default_credential')
        if not isinstance(default_credential, dict):
            continue
        secret_file_path = default_credential.pop('secret_file', None)
        if not secret_file_path:
            continue

        try:
            with open(secret_file_path, encoding='utf-8') as secret_file:
                secret_data = yaml.safe_load(secret_file)
            if not isinstance(secret_data, dict):
                logging.error('Secret file %s for bucket %s does not contain a mapping',
                              secret_file_path, bucket_name)
                continue
            default_credential['access_key_id'] = secret_data['access_key_id']
            default_credential['access_key'] = secret_data['access_key']
            # Copy optional fields if present
            for optional_field in ('region', 'endpoint', 'override_url'):
                if optional_field in secret_data:
                    default_credential[optional_field] = secret_data[optional_field]
            logging.info('Loaded credentials for bucket %s from %s',
                         bucket_name, secret_file_path)
        except (OSError, KeyError, yaml.YAMLError) as error:
            logging.error('Failed to read secret file %s for bucket %s: %s',
                          secret_file_path, bucket_name, error)


# ---------------------------------------------------------------------------
# Named configs: POOLS, POD_TEMPLATES, GROUP_TEMPLATES, etc.
# ---------------------------------------------------------------------------

def _apply_resource_validations(section: Dict[str, Any],
                                postgres: connectors.PostgresConnector) -> None:
    managed_by = _parse_managed_by(section)
    items = section.get('items', {})
    if not items:
        return

    items_to_apply = _filter_named_items(
        items, managed_by, connectors.ResourceValidation, postgres)
    if not items_to_apply:
        return

    logging.info('Applying %d resource validations (managed_by=%s)',
                 len(items_to_apply), managed_by.value)
    config_service.put_resource_validations(
        request=config_objects.PutResourceValidationsRequest(
            configs_dict=items_to_apply,
            description=f'Applied from dynamic config (managed_by={managed_by.value})',
            tags=CONFIGMAP_SYNC_TAGS,
        ),
        username=CONFIGMAP_SYNC_USERNAME,
    )


def _apply_pod_templates(section: Dict[str, Any],
                         postgres: connectors.PostgresConnector) -> None:
    managed_by = _parse_managed_by(section)
    items = section.get('items', {})
    if not items:
        return

    items_to_apply = _filter_named_items(
        items, managed_by, connectors.PodTemplate, postgres)
    if not items_to_apply:
        return

    logging.info('Applying %d pod templates (managed_by=%s)',
                 len(items_to_apply), managed_by.value)
    config_service.put_pod_templates(
        request=config_objects.PutPodTemplatesRequest(
            configs=items_to_apply,
            description=f'Applied from dynamic config (managed_by={managed_by.value})',
            tags=CONFIGMAP_SYNC_TAGS,
        ),
        username=CONFIGMAP_SYNC_USERNAME,
    )


def _apply_group_templates(section: Dict[str, Any],
                           postgres: connectors.PostgresConnector) -> None:
    managed_by = _parse_managed_by(section)
    items = section.get('items', {})
    if not items:
        return

    items_to_apply = _filter_named_items(
        items, managed_by, connectors.GroupTemplate, postgres)
    if not items_to_apply:
        return

    logging.info('Applying %d group templates (managed_by=%s)',
                 len(items_to_apply), managed_by.value)
    config_service.put_group_templates(
        request=config_objects.PutGroupTemplatesRequest(
            configs=items_to_apply,
            description=f'Applied from dynamic config (managed_by={managed_by.value})',
            tags=CONFIGMAP_SYNC_TAGS,
        ),
        username=CONFIGMAP_SYNC_USERNAME,
    )


def _apply_backends(section: Dict[str, Any],
                    postgres: connectors.PostgresConnector) -> None:
    managed_by = _parse_managed_by(section)
    items = section.get('items', {})
    if not items:
        return

    for name, backend_data in items.items():
        try:
            backend_exists = _backend_exists(name, postgres)
            if managed_by == ManagedByMode.SEED and backend_exists:
                logging.info('Backend %s already exists, skipping (managed_by=seed)', name)
                continue

            if backend_exists:
                # Update existing backend
                logging.info('Updating backend %s (managed_by=%s)', name, managed_by.value)
                config_helpers.update_backend(
                    name=name,
                    request=config_objects.PostBackendRequest(
                        configs=config_objects.BackendConfig(**backend_data),
                        description=f'Applied from dynamic config (managed_by={managed_by.value})',
                        tags=CONFIGMAP_SYNC_TAGS,
                    ),
                    username=CONFIGMAP_SYNC_USERNAME,
                )
            else:
                # Insert new backend
                logging.info('Creating backend %s (managed_by=%s)', name, managed_by.value)
                _insert_backend(name, backend_data, postgres)
        except Exception:
            logging.exception('Failed to apply backend config for %s', name)


def _backend_exists(name: str, postgres: connectors.PostgresConnector) -> bool:
    """Check if a backend exists in the database."""
    try:
        connectors.Backend.fetch_from_db(postgres, name)
        return True
    except osmo_errors.OSMOBackendError:
        return False


def _insert_backend(name: str, backend_data: Dict[str, Any],
                    postgres: connectors.PostgresConnector) -> None:
    """Insert a new backend into the database with minimal defaults."""
    now = common.current_time()
    description = backend_data.get('description', '')
    scheduler_settings = backend_data.get('scheduler_settings')
    if scheduler_settings:
        scheduler_settings_json = connectors.BackendSchedulerSettings(
            **scheduler_settings).json()
    else:
        scheduler_settings_json = connectors.BackendSchedulerSettings().json()

    node_conditions = backend_data.get('node_conditions')
    if node_conditions:
        node_conditions_json = connectors.BackendNodeConditions(**node_conditions).json()
    else:
        node_conditions_json = connectors.BackendNodeConditions().json()

    router_address = backend_data.get('router_address', '')
    dashboard_url = backend_data.get('dashboard_url', '')
    grafana_url = backend_data.get('grafana_url', '')
    tests = backend_data.get('tests', [])

    insert_cmd = '''
        INSERT INTO backends (name, k8s_uid, k8s_namespace,
            dashboard_url, grafana_url,
            scheduler_settings, node_conditions,
            last_heartbeat, created_date,
            description, router_address, version, tests)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (name) DO NOTHING;
    '''
    postgres.execute_commit_command(
        insert_cmd,
        (name, '', '', dashboard_url, grafana_url,
         scheduler_settings_json, node_conditions_json,
         now, now, description, router_address, '', tests))

    config_helpers.create_backend_config_history_entry(
        postgres=postgres,
        name=name,
        username=CONFIGMAP_SYNC_USERNAME,
        description=f'Created backend {name} from dynamic config',
        tags=CONFIGMAP_SYNC_TAGS,
    )


def _apply_backend_tests(section: Dict[str, Any],
                         postgres: connectors.PostgresConnector) -> None:
    managed_by = _parse_managed_by(section)
    items = section.get('items', {})
    if not items:
        return

    items_to_apply = _filter_named_items(
        items, managed_by, connectors.BackendTests, postgres)
    if not items_to_apply:
        return

    logging.info('Applying %d backend tests (managed_by=%s)',
                 len(items_to_apply), managed_by.value)

    configs = {}
    for name, test_data in items_to_apply.items():
        configs[name] = connectors.BackendTests(**test_data)

    config_service.put_backend_tests(
        request=config_objects.PutBackendTestsRequest(
            configs=configs,
            description=f'Applied from dynamic config (managed_by={managed_by.value})',
            tags=CONFIGMAP_SYNC_TAGS,
        ),
        username=CONFIGMAP_SYNC_USERNAME,
    )


def _apply_pools(section: Dict[str, Any],
                 postgres: connectors.PostgresConnector) -> None:
    managed_by = _parse_managed_by(section)
    items = section.get('items', {})
    if not items:
        return

    items_to_apply = _filter_named_items(
        items, managed_by, connectors.Pool, postgres)
    if not items_to_apply:
        return

    logging.info('Applying %d pools (managed_by=%s)',
                 len(items_to_apply), managed_by.value)

    configs = {}
    for name, pool_data in items_to_apply.items():
        configs[name] = connectors.Pool(**pool_data)

    config_service.put_pools(
        request=config_objects.PutPoolsRequest(
            configs=configs,
            description=f'Applied from dynamic config (managed_by={managed_by.value})',
            tags=CONFIGMAP_SYNC_TAGS,
        ),
        username=CONFIGMAP_SYNC_USERNAME,
    )


def _apply_roles(section: Dict[str, Any],
                 postgres: connectors.PostgresConnector) -> None:
    managed_by = _parse_managed_by(section)
    items = section.get('items', {})
    if not items:
        return

    items_to_apply = _filter_named_items(
        items, managed_by, connectors.Role, postgres)
    if not items_to_apply:
        return

    logging.info('Applying %d roles (managed_by=%s)',
                 len(items_to_apply), managed_by.value)

    configs = []
    for name, role_data in items_to_apply.items():
        configs.append(connectors.Role(name=name, **role_data))

    config_service.put_roles(
        request=config_objects.PutRolesRequest(
            configs=configs,
            description=f'Applied from dynamic config (managed_by={managed_by.value})',
            tags=CONFIGMAP_SYNC_TAGS,
        ),
        username=CONFIGMAP_SYNC_USERNAME,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _filter_named_items(items: Dict[str, Any], managed_by: ManagedByMode,
                        model_class, postgres: connectors.PostgresConnector) -> Dict[str, Any]:
    """Filter named config items based on managed_by mode.

    In 'seed' mode, only return items that don't already exist in the DB.
    In 'configmap' mode, return all items.
    """
    if managed_by == ManagedByMode.CONFIGMAP:
        return items

    # seed mode: only include items that don't exist yet
    filtered = {}
    for name in items:
        if not _named_config_exists(name, model_class, postgres):
            filtered[name] = items[name]
        else:
            logging.info('%s %s already exists, skipping (managed_by=seed)',
                         model_class.__name__, name)
    return filtered


def _named_config_exists(name: str, model_class,
                         postgres: connectors.PostgresConnector) -> bool:
    """Check if a named config item exists in the database."""
    try:
        model_class.fetch_from_db(postgres, name)
        return True
    except (osmo_errors.OSMOUserError, osmo_errors.OSMOBackendError):
        return False
