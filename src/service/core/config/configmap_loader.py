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

import copy
import json
import logging
import os
import threading
from typing import Any, Callable, Dict, List

import yaml
from watchdog import events, observers

from src.lib.utils.common import merge_lists_on_name, recursive_dict_update
from src.service.core.config import configmap_guard
from src.utils import connectors


# ---------------------------------------------------------------------------
# File event handler (watchdog)
# ---------------------------------------------------------------------------

class ConfigFileEventHandler(events.FileSystemEventHandler):
    """Watches for ConfigMap file changes with debounce.

    K8s ConfigMap volume mounts use atomic symlink swaps (..data → timestamped dir).
    We watch the parent directory and filter for events affecting our config file
    or the ..data symlink.
    """

    def __init__(self, config_filename: str, reload_callback: Callable):
        super().__init__()
        self._config_filename = config_filename
        self._reload_callback = reload_callback
        self._debounce_timer: threading.Timer | None = None
        self._debounce_delay = 2.0
        self._lock = threading.Lock()

    def on_any_event(self, event: events.FileSystemEvent) -> None:
        path = str(event.src_path)
        if not (path.endswith(self._config_filename)
                or '..data' in path):
            return
        with self._lock:
            if self._debounce_timer:
                self._debounce_timer.cancel()
            self._debounce_timer = threading.Timer(
                self._debounce_delay, self._reload_callback)
            self._debounce_timer.daemon = True
            self._debounce_timer.start()


# ---------------------------------------------------------------------------
# ConfigMap watcher
# ---------------------------------------------------------------------------

class ConfigMapWatcher:
    """Watches a ConfigMap-mounted YAML file and serves configs from memory.

    On startup: parse file → validate → populate module-level dict → start watchdog.
    On file change: re-parse → validate → atomic swap of dict reference.
    Configs are served from the in-memory dict. DB is only used for
    backend runtime data (agent writes heartbeats to backends table).
    """

    def __init__(self, config_file_path: str,
                 postgres: connectors.PostgresConnector | None = None):
        self._config_file_path = config_file_path
        self._postgres = postgres
        self._watch_directory = os.path.dirname(config_file_path)
        self._config_filename = os.path.basename(config_file_path)
        self._observer: Any = None

    def start(self) -> None:
        """Load configs, activate ConfigMap mode, start file watcher."""
        success = self._load_and_apply()
        if success:
            configmap_guard.set_configmap_mode(True)
            logging.info('ConfigMap mode activated — all config writes via CLI/API are blocked')

        self._observer = observers.Observer()
        self._observer.schedule(
            ConfigFileEventHandler(self._config_filename, self._load_and_apply),
            path=self._watch_directory,
            recursive=False)
        self._observer.daemon = True
        self._observer.start()
        logging.info('Config file watcher started for %s', self._config_file_path)

    def stop(self) -> None:
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)

    def _load_and_apply(self) -> bool:
        """Parse, resolve secrets, validate, and swap the in-memory config dict.

        Returns True if configs were successfully loaded.
        """
        try:
            with open(self._config_file_path, encoding='utf-8') as f:
                raw_config = yaml.safe_load(f)
        except (OSError, yaml.YAMLError) as error:
            logging.error(
                'Failed to read/parse config file %s: %s',
                self._config_file_path, error)
            return False

        if not raw_config or not isinstance(raw_config, dict):
            logging.warning(
                'Config file %s is empty or invalid',
                self._config_file_path)
            return False

        managed_configs = raw_config

        # Resolve secret file references (reads mounted K8s Secret files)
        for section in managed_configs.values():
            if isinstance(section, dict):
                _resolve_secret_file_references(section)

        # Dataset-specific: default endpoint from dataset_path
        dataset_section = managed_configs.get('dataset')
        if isinstance(dataset_section, dict):
            _default_dataset_credential_endpoints(dataset_section)

        # Validate ConfigMap-provided fields BEFORE injecting runtime
        # fields. Runtime fields (service_auth) are already validated
        # by configure_app().
        validation_errors = _validate_configs(managed_configs)
        if validation_errors:
            logging.error(
                'ConfigMap validation failed, keeping previous config: %s',
                validation_errors)
            return False

        # Resolve pool computed fields (parsed_pod_template, etc.) from
        # template/validation name references. This allows compact ConfigMap
        # YAML that only contains reference names, not expanded content.
        _resolve_pool_computed_fields(managed_configs)

        # Inject runtime-generated fields (service_auth, service_base_url)
        # that are not in the ConfigMap but are needed by the service.
        self._inject_runtime_fields(managed_configs)

        # Atomic swap — in-flight requests holding a reference to the old
        # dict continue using it; new requests get the new dict.
        configmap_guard.set_parsed_configs(managed_configs)
        if not configmap_guard.is_configmap_mode():
            configmap_guard.set_configmap_mode(True)
            logging.info(
                'ConfigMap mode activated (deferred) — '
                'all config writes via CLI/API are blocked')
        logging.info(
            'ConfigMap configs loaded from %s', self._config_file_path)

        return True

    def _inject_runtime_fields(
        self, managed_configs: Dict[str, Any],
    ) -> None:
        """Inject runtime-generated fields not present in ConfigMap.

        service_auth and service_base_url are auto-generated by
        configure_app() on startup. On first load we read them from DB;
        on subsequent reloads we carry them forward from the previous
        snapshot so we never need ongoing DB reads.
        """
        previous = configmap_guard.get_snapshot()
        if previous is not None:
            prev_service = previous.get('service', {})
        elif self._postgres is not None:
            db_config = self._postgres.get_service_configs()
            prev_service = db_config.plaintext_dict(
                by_alias=True, exclude_unset=True)
        else:
            prev_service = {}

        service_config = managed_configs.setdefault('service', {})

        for field in ('service_auth', 'service_base_url'):
            if field not in service_config and field in prev_service:
                service_config[field] = prev_service[field]


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

_EXPECTED_CONFIG_KEYS = {
    'service', 'workflow', 'dataset', 'resource_validations', 'pod_templates',
    'group_templates', 'backends', 'backend_tests', 'pools', 'roles',
}


def _validate_configs(managed_configs: Dict[str, Any]) -> List[str]:
    """Validate ConfigMap data by constructing typed Pydantic models.

    Returns a list of error strings. Empty list means all valid.
    """
    errors: List[str] = []

    unknown_keys = set(managed_configs.keys()) - _EXPECTED_CONFIG_KEYS
    for key in unknown_keys:
        logging.warning('Unknown config key: %s (expected one of: %s)',
                        key, ', '.join(sorted(_EXPECTED_CONFIG_KEYS)))

    # Validate singleton configs by constructing Pydantic models
    for config_key, config_class in [
        ('service', connectors.ServiceConfig),
        ('workflow', connectors.WorkflowConfig),
        ('dataset', connectors.DatasetConfig),
    ]:
        section = managed_configs.get(config_key)
        if not section:
            continue
        try:
            config_class(**section)
        except Exception as error:  # pylint: disable=broad-exception-caught
            errors.append(f'{config_key}: {error}')

    # Validate named config sections are dicts
    for config_key in ['resource_validations', 'pod_templates', 'group_templates',
                       'backends', 'backend_tests', 'pools', 'roles']:
        section = managed_configs.get(config_key)
        if section is not None and not isinstance(section, dict):
            errors.append(
                f'{config_key}: must be a dict, got {type(section).__name__}')

    return errors


# ---------------------------------------------------------------------------
# Pool computed field resolution
# ---------------------------------------------------------------------------

def _resolve_pool_computed_fields(managed_configs: Dict[str, Any]) -> None:
    """Compute parsed_pod_template, parsed_resource_validations for pools.

    Pools reference pod templates and resource validations by name
    (common_pod_template, override_pod_template, common_resource_validations,
    resource_validations). This function resolves those references into the
    parsed_* fields that the service uses at runtime.

    This allows the ConfigMap YAML to contain only template/validation names
    (compact) instead of the full expanded content (bloated). The resolution
    uses the same merge logic as Pool.calculate_pod_template() and
    Pool.calculate_resource_validations() in postgres.py.
    """
    pools = managed_configs.get('pools', {})
    if not pools:
        return

    pod_templates = managed_configs.get('pod_templates', {})
    resource_validations = managed_configs.get('resource_validations', {})
    group_templates = managed_configs.get('group_templates', {})

    for pool_data in pools.values():
        if not isinstance(pool_data, dict):
            continue
        _resolve_single_pool(
            pool_data, pod_templates, resource_validations, group_templates)


def _resolve_single_pool(
    pool_data: Dict[str, Any],
    pod_templates: Dict[str, Any],
    resource_validations: Dict[str, Any],
    group_templates: Dict[str, Any],
) -> None:
    """Resolve computed fields for a single pool and its platforms."""
    # Resolve common pod template (pool-level base)
    common_pod_template_names = pool_data.get('common_pod_template', [])
    base_pod_template: Dict[str, Any] = {}
    for template_name in common_pod_template_names:
        if template_name in pod_templates:
            base_pod_template = recursive_dict_update(
                base_pod_template,
                copy.deepcopy(pod_templates[template_name]),
                merge_lists_on_name)
    pool_data['parsed_pod_template'] = base_pod_template

    # Resolve common resource validations (pool-level base)
    common_resource_validation_names = pool_data.get(
        'common_resource_validations', [])
    base_resource_validations: List[Any] = []
    for validation_name in common_resource_validation_names:
        if validation_name in resource_validations:
            base_resource_validations.extend(
                copy.deepcopy(resource_validations[validation_name]))
    pool_data['parsed_resource_validations'] = base_resource_validations

    # Resolve common group templates (pool-level).
    # Matches Pool.calculate_group_templates(): merges templates with
    # the same (apiVersion, kind, metadata.name) key.
    common_group_template_names = pool_data.get(
        'common_group_templates', [])
    merged_by_key: Dict[tuple, Dict[str, Any]] = {}
    for template_name in common_group_template_names:
        if template_name not in group_templates:
            continue
        template = group_templates[template_name]
        api_version = template.get('apiVersion', '')
        kind = template.get('kind', '')
        resource_name = template.get('metadata', {}).get('name', '')
        key = (api_version, kind, resource_name)
        if key in merged_by_key:
            merged_by_key[key] = recursive_dict_update(
                merged_by_key[key], template, merge_lists_on_name)
        else:
            merged_by_key[key] = copy.deepcopy(template)
    pool_data['parsed_group_templates'] = list(merged_by_key.values())

    # Resolve per-platform computed fields
    platforms = pool_data.get('platforms', {})
    for platform_data in platforms.values():
        if not isinstance(platform_data, dict):
            continue
        _resolve_platform_fields(
            platform_data, base_pod_template, base_resource_validations,
            pod_templates, resource_validations)


def _get_default_mounts(pod_template: Dict[str, Any]) -> List[str]:
    """Extract default mount paths from a resolved pod template.

    Matches Pool.get_default_mounts(): collects mountPath from all
    non-osmo-ctrl containers.
    """
    default_mounts: List[str] = []
    spec = pod_template.get('spec', {})
    for container in spec.get('containers', []):
        if container.get('name', '') == 'osmo-ctrl':
            continue
        for mount in container.get('volumeMounts', []):
            mount_path = mount.get('mountPath')
            if mount_path:
                default_mounts.append(mount_path)
    return default_mounts


def _resolve_platform_fields(
    platform_data: Dict[str, Any],
    base_pod_template: Dict[str, Any],
    base_resource_validations: List[Any],
    pod_templates: Dict[str, Any],
    resource_validations: Dict[str, Any],
) -> None:
    """Resolve computed fields for a single platform within a pool.

    Always resolves from source-of-truth references (template names),
    overwriting any pre-existing parsed_* fields.
    """
    # Pod template: start from pool common, merge platform overrides
    platform_pod_template = copy.deepcopy(base_pod_template)
    for template_name in platform_data.get('override_pod_template', []):
        if template_name in pod_templates:
            platform_pod_template = recursive_dict_update(
                platform_pod_template,
                copy.deepcopy(pod_templates[template_name]),
                merge_lists_on_name)
    platform_data['parsed_pod_template'] = platform_pod_template

    # Derive tolerations, labels, default_mounts from resolved template
    spec = platform_pod_template.get('spec', {})
    platform_data.setdefault('tolerations',
                             spec.get('tolerations', []))
    platform_data.setdefault('labels',
                             spec.get('nodeSelector', {}))
    platform_data.setdefault('default_mounts',
                             _get_default_mounts(platform_pod_template))

    # Resource validations: start from pool common, extend with platform
    platform_resource_validations = copy.deepcopy(base_resource_validations)
    for validation_name in platform_data.get('resource_validations', []):
        if validation_name in resource_validations:
            platform_resource_validations.extend(
                copy.deepcopy(resource_validations[validation_name]))
    platform_data['parsed_resource_validations'] = \
        platform_resource_validations


# ---------------------------------------------------------------------------
# Secret resolution
# ---------------------------------------------------------------------------

def _resolve_secret_file_references(config_data: Dict[str, Any],
                                     parent_key: str = '') -> None:
    """Recursively resolve secret_file / secretName references in a config dict.

    Walks the dict tree. When it finds a dict with 'secret_file' or 'secretName':
    - Reads the YAML file from the mounted K8s Secret path
    - If the file contains a dict: merges the file contents into the parent dict
    - If the file contains a 'value' key: replaces the entire dict with that value
    """
    if not isinstance(config_data, dict):
        return

    keys_to_process = list(config_data.keys())
    for key in keys_to_process:
        value = config_data[key]
        if not isinstance(value, dict):
            continue

        secret_file_path = value.get('secret_file')
        if not secret_file_path:
            secret_name = value.get('secretName')
            if secret_name:
                secret_key = value.get('secretKey', 'cred.yaml')
                secret_file_path = f'/etc/osmo/secrets/{secret_name}/{secret_key}'

        if secret_file_path:
            _resolve_single_secret(config_data, key, value, secret_file_path,
                                   f'{parent_key}.{key}' if parent_key else key)
        else:
            _resolve_secret_file_references(value, f'{parent_key}.{key}' if parent_key else key)


def _resolve_single_secret(parent_dict: Dict[str, Any], key: str,
                           current_value: Dict[str, Any],
                           secret_file_path: str, path_label: str) -> None:
    """Read a secret file and replace the reference with actual values.

    Supports three formats:
    1. Simple string: {value: "..."} -> replaces dict with the string
    2. Docker registry: {auths: {registry: {username, password, auth}}}
    3. YAML dict: merges all keys into the current dict
    """
    try:
        with open(secret_file_path, encoding='utf-8') as secret_file:
            content = secret_file.read()
    except OSError as error:
        logging.error('Failed to read secret file %s for %s: %s',
                      secret_file_path, path_label, error)
        return

    try:
        secret_data = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        try:
            secret_data = yaml.safe_load(content)
        except yaml.YAMLError as error:
            logging.error('Failed to parse secret file %s for %s: %s',
                          secret_file_path, path_label, error)
            return

    if not isinstance(secret_data, dict):
        logging.error('Secret file %s for %s does not contain a mapping',
                      secret_file_path, path_label)
        return

    if 'value' in secret_data and len(secret_data) == 1:
        parent_dict[key] = secret_data['value']
        logging.info('Loaded secret for %s from secret file', path_label)
        return

    if 'auths' in secret_data:
        auths = secret_data['auths']
        if isinstance(auths, dict) and auths:
            registry_url = next(iter(auths))
            registry_data = auths[registry_url]
            extracted = {
                'registry': registry_url,
                'username': registry_data.get('username', ''),
                'auth': registry_data.get('auth', ''),
            }
            current_value.pop('secret_file', None)
            current_value.pop('secretName', None)
            current_value.pop('secretKey', None)
            current_value.update(extracted)
            logging.info('Loaded Docker registry credentials for %s from %s',
                         path_label, registry_url)
            return

    current_value.pop('secret_file', None)
    current_value.pop('secretName', None)
    current_value.pop('secretKey', None)
    current_value.update(secret_data)
    logging.info('Loaded credentials for %s from secret file', path_label)


def _default_dataset_credential_endpoints(config_data: Dict[str, Any]) -> None:
    """Dataset-specific: default 'endpoint' from 'dataset_path' for each bucket credential."""
    buckets = config_data.get('buckets', {})
    for bucket_config in buckets.values():
        if not isinstance(bucket_config, dict):
            continue
        credential = bucket_config.get('default_credential')
        if isinstance(credential, dict) and 'endpoint' not in credential:
            credential['endpoint'] = bucket_config.get('dataset_path', '')
