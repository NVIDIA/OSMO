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

import base64
import copy
import datetime
import enum
import hashlib
import json
import logging
import os
import time
from typing import Any, Callable, Dict, List

import pydantic
import yaml

from src.lib.utils import jinja_sandbox, osmo_errors
from src.lib.utils.common import merge_lists_on_name, recursive_dict_update
from src.service.core.config import configmap_events, configmap_guard
from src.utils import auth, connectors


# Cold-start retry: kubelet may take up to ~60s to project a freshly-created
# ConfigMap volume on a new pod, so we retry the initial load before giving up.
_STARTUP_RETRY_DEADLINE_S = 30.0
_STARTUP_RETRY_INTERVAL_S = 1.0


class LoadResult(enum.Enum):
    """Outcome of a ConfigMapWatcher load attempt.

    TRANSIENT means retrying may succeed (file isn't readable yet —
    kubelet projection in progress). PERMANENT means the file is there
    but malformed or invalid; retrying won't help so cold-start fails
    fast and operators see the bad ConfigMap immediately.
    """
    SUCCESS = 'success'
    TRANSIENT_FAILURE = 'transient'
    PERMANENT_FAILURE = 'permanent'


class ConfigSnapshotValidationError(ValueError):
    """Safe-to-report structural validation error without config values."""


class ConfigFileMixin(pydantic.BaseModel):
    """Pydantic mixin adding `--config_file` to a service config class.

    Inherited by every service binary that wants ConfigMap mode (api,
    worker, logger, and the WorkflowServiceConfig that the agent loads
    alongside its BackendServiceConfig). Centralizing the field keeps
    the flag name (`--config_file`) and env var (`OSMO_CONFIG_FILE`)
    consistent and avoids argparse divergence.
    """
    config_file: str | None = pydantic.Field(
        default=None,
        description='Path to ConfigMap YAML file to load configs from.',
        json_schema_extra={
            'command_line': 'config_file',
            'env': 'OSMO_CONFIG_FILE',
        })


class ConfigMapWatcher:
    """Loads one immutable ConfigMap snapshot during process startup."""

    def __init__(
        self,
        config_file_path: str,
        postgres: connectors.PostgresConnector | None = None,
        *,
        event_recorder: configmap_events.EventRecorder | None = None,
        reconciliation_state_store: (
            configmap_events.ReconciliationStateStore | None) = None,
        enable_reconciliation: bool = False,
        backend_queue_updater: Callable[..., bool] | None = None,
        backend_test_updater: Callable[..., bool] | None = None,
    ):
        self._config_file_path = config_file_path
        self._postgres = postgres
        self._stable_service_auth: auth.AuthenticationConfig | None = None
        self._event_recorder = event_recorder
        self._reconciliation_state_store = reconciliation_state_store
        self._enable_reconciliation = enable_reconciliation
        self._backend_queue_updater = backend_queue_updater
        self._backend_test_updater = backend_test_updater
        self._last_reconciled_snapshot: Dict[str, Any] | None = None
        # Only emit "reload succeeded" events when recovering from a
        # previous failure — successful reloads on their own are noise.
        self._last_reload_failed = False

    def start(self) -> None:
        """Load configs and activate immutable ConfigMap mode.

        Retries the initial load on transient failures (file missing
        because kubelet hasn't finished projecting the ConfigMap volume)
        for up to _STARTUP_RETRY_DEADLINE_S. Permanent failures (bad
        YAML / failed validation) fail fast — operator gets the signal
        immediately and old pods keep serving via the rolling-update
        stall.
        """
        deadline = time.monotonic() + _STARTUP_RETRY_DEADLINE_S
        while True:
            result = self._load_and_apply()
            if result == LoadResult.SUCCESS:
                break
            if result == LoadResult.PERMANENT_FAILURE:
                raise RuntimeError(
                    f'ConfigMap load failed at startup '
                    f'({self._config_file_path}): malformed or invalid '
                    f'config file. Refusing to serve.')
            if time.monotonic() >= deadline:
                raise RuntimeError(
                    f'ConfigMap load failed at startup after '
                    f'{_STARTUP_RETRY_DEADLINE_S:.0f}s '
                    f'({self._config_file_path}): a required startup '
                    f'dependency never became ready. Refusing to serve.')
            time.sleep(_STARTUP_RETRY_INTERVAL_S)

        configmap_guard.set_configmap_mode(True)
        logging.info(
            'ConfigMap mode activated — '
            'all config writes via CLI/API are blocked')

        logging.info(
            'Immutable ConfigMap snapshot loaded from %s; changes require a pod restart',
            self._config_file_path)

    def stop(self) -> None:
        """Compatibility no-op; immutable snapshots have no background watcher."""

    def _record_failure(self, message: str) -> None:
        """Log + emit a K8s Warning event for a reload failure."""
        logging.error(message)
        if self._event_recorder is not None:
            self._event_recorder.emit_reload_failed(message)
        self._last_reload_failed = True

    def _record_success(self) -> None:
        """Emit a Normal event only if we just recovered from a failure."""
        if self._last_reload_failed and self._event_recorder is not None:
            self._event_recorder.emit_reload_succeeded(
                'ConfigMap reload succeeded after previous failure')
        self._last_reload_failed = False

    def _load_and_apply(self) -> LoadResult:
        """Parse, resolve secrets, validate, and swap the in-memory config dict.

        TRANSIENT_FAILURE means retrying may succeed (file not yet
        readable). PERMANENT_FAILURE means the file exists but is
        unparseable / invalid; retrying won't help.
        """
        reconciliation_baseline = self._last_reconciled_snapshot
        if self._enable_reconciliation and reconciliation_baseline is None:
            if self._reconciliation_state_store is None:
                self._record_failure(
                    'ConfigMap backend reconciliation has no durable state store')
                return LoadResult.PERMANENT_FAILURE
            try:
                reconciliation_baseline = (
                    self._reconciliation_state_store.load_reconciliation_state())
            except Exception as error:  # pylint: disable=broad-exception-caught
                self._record_failure(
                    f'Failed to load backend reconciliation checkpoint: {error}')
                return LoadResult.TRANSIENT_FAILURE
        try:
            with open(self._config_file_path, encoding='utf-8') as f:
                raw_config = yaml.safe_load(f)
        except OSError as error:
            self._record_failure(
                f'Failed to read config file '
                f'{self._config_file_path}: {error}')
            return LoadResult.TRANSIENT_FAILURE
        except yaml.YAMLError as error:
            self._record_failure(
                f'Failed to parse config file '
                f'{self._config_file_path}: {error}')
            return LoadResult.PERMANENT_FAILURE

        if not raw_config or not isinstance(raw_config, dict):
            self._record_failure(
                f'Config file {self._config_file_path} is empty or invalid')
            return LoadResult.PERMANENT_FAILURE

        managed_configs = raw_config

        # JWT signing identity is externally owned. Discard ConfigMap input before
        # resolving secret references so it is never interpreted as runtime auth.
        service_config = managed_configs.get('service')
        if isinstance(service_config, dict):
            service_config.pop('service_auth', None)

        # Resolve mounted Secret references. Any missing, malformed, or
        # out-of-root reference is a permanent startup error; serving with
        # partially resolved credentials is never safe.
        try:
            for section in managed_configs.values():
                if isinstance(section, dict):
                    _resolve_secret_file_references(section)
        except (TypeError, ValueError) as error:
            self._record_failure(f'ConfigMap Secret resolution failed: {error}')
            return LoadResult.PERMANENT_FAILURE

        self._hydrate_service_auth(managed_configs)

        validation_errors = validate_configmap_snapshot(
            managed_configs, postgres=self._postgres)
        if validation_errors:
            joined_errors = '; '.join(validation_errors)
            self._record_failure(
                f'ConfigMap validation failed, keeping previous config: '
                f'{joined_errors}')
            return LoadResult.PERMANENT_FAILURE

        # Resolve backend test computed fields and pool computed fields
        # (parsed_pod_template, etc.) from
        # template/validation name references. This allows compact ConfigMap
        # YAML that only contains reference names, not expanded content.
        _resolve_backend_test_computed_fields(managed_configs)
        _resolve_pool_computed_fields(managed_configs)

        if self._enable_reconciliation:
            try:
                backends_reconciled = _reconcile_backend_side_effects(
                    reconciliation_baseline, managed_configs,
                    self._backend_queue_updater, self._backend_test_updater)
                if not backends_reconciled:
                    self._record_failure(
                        'ConfigMap backend side-effect reconciliation did not '
                        'durably queue all required work')
                    return LoadResult.TRANSIENT_FAILURE
                checkpoint = _build_reconciliation_state(managed_configs)
                if self._reconciliation_state_store is None:
                    raise RuntimeError(
                        'backend reconciliation has no durable state store')
                self._reconciliation_state_store.save_reconciliation_state(
                    checkpoint)
                self._last_reconciled_snapshot = checkpoint
                # Clean assignment state only after all other reconciliation
                # work is durable. A transient backend failure must not revoke
                # roles for a snapshot that was not accepted.
                _reconcile_user_role_assignments(
                    managed_configs, self._postgres)
            except Exception as error:  # pylint: disable=broad-exception-caught
                self._record_failure(
                    f'ConfigMap backend side-effect reconciliation failed: {error}')
                return LoadResult.TRANSIENT_FAILURE

        # Publish the validated snapshot only after every required backend side
        # effect is durably queued and its cleanup checkpoint is persisted.
        configmap_guard.set_parsed_configs(managed_configs)
        if not configmap_guard.is_configmap_mode():
            configmap_guard.set_configmap_mode(True)
            logging.info(
                'ConfigMap mode activated (deferred) — '
                'all config writes via CLI/API are blocked')
        logging.info(
            'ConfigMap configs loaded from %s', self._config_file_path)
        self._record_success()

        return LoadResult.SUCCESS

    def _hydrate_service_auth(
        self, managed_configs: Dict[str, Any],
    ) -> None:
        """Hydrate the stable JWT signing identity from its configured source."""
        service_config = managed_configs.get('service')
        if not isinstance(service_config, dict):
            return

        if self._stable_service_auth is None and self._postgres is not None:
            self._stable_service_auth = self._postgres.get_service_auth().model_copy(
                deep=True)

        if self._stable_service_auth is not None:
            service_config['service_auth'] = (
                self._stable_service_auth.plaintext_dict())


def start_config_watcher(
    config_file: str | None,
    postgres: connectors.PostgresConnector | None = None,
    *,
    is_api_service: bool = False,
    backend_queue_updater: Callable[..., bool] | None = None,
    backend_test_updater: Callable[..., bool] | None = None,
) -> 'ConfigMapWatcher':
    """Load an immutable ConfigMap snapshot when `config_file` is set.

    ConfigMap mode is authoritative for managed config except service auth.
    ConfigMap-supplied service auth is ignored. On the first load, the watcher
    obtains the stable signing identity from its configured source; reloads
    preserve that watcher-local identity.
    """
    if not config_file:
        raise RuntimeError(
            'OSMO_CONFIG_FILE is required; PostgreSQL-managed service '
            'configuration is not supported in 6.4.')

    event_recorder: configmap_events.EventRecorder | None = None
    reconciliation_state_store: (
        configmap_events.ReconciliationStateStore | None) = None
    if is_api_service:
        pod_namespace = os.environ.get('POD_NAMESPACE')
        configmap_name = os.environ.get('OSMO_CONFIGMAP_NAME')
        if pod_namespace and configmap_name:
            event_recorder = configmap_events.ConfigMapEventRecorder(
                namespace=pod_namespace, configmap_name=configmap_name)
            reconciliation_state_store = event_recorder
        elif os.environ.get('KUBERNETES_SERVICE_HOST'):
            raise RuntimeError(
                'POD_NAMESPACE and OSMO_CONFIGMAP_NAME are required for '
                'in-cluster API backend reconciliation.')
        else:
            reconciliation_state_file = os.environ.get(
                'OSMO_RECONCILIATION_STATE_FILE')
            if not reconciliation_state_file:
                raise RuntimeError(
                    'OSMO_RECONCILIATION_STATE_FILE is required when the API '
                    'runs outside Kubernetes.')
            reconciliation_state_store = (
                configmap_events.FileReconciliationStateStore(
                    reconciliation_state_file))

    watcher = ConfigMapWatcher(
        config_file, postgres,
        event_recorder=event_recorder,
        reconciliation_state_store=reconciliation_state_store,
        enable_reconciliation=is_api_service,
        backend_queue_updater=backend_queue_updater,
        backend_test_updater=backend_test_updater,
    )
    watcher.start()
    return watcher


# ---------------------------------------------------------------------------
# Backend side-effect reconciliation
# ---------------------------------------------------------------------------

def _config_digest(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def _stable_config_hash(payload: Any) -> str:
    """Return a short, deterministic suffix suitable for Kubernetes job IDs."""
    return _config_digest(payload)[:12]


_RECONCILIATION_STATE_VERSION = 1


def _build_reconciliation_state(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """Build the non-secret checkpoint needed for cleanup after a restart."""
    state_backends: Dict[str, Any] = {}
    backends = snapshot.get('backends', {})
    pools = snapshot.get('pools', {})
    backend_tests = snapshot.get('backend_tests', {})
    for backend_name, backend_config in backends.items():
        if not isinstance(backend_config, dict):
            continue
        tests = backend_config.get('tests', [])
        if not isinstance(tests, list):
            tests = []
        queue_payload = {
            'scheduler_settings': _normalized_scheduler_settings(backend_config),
            'pools': {
                pool_name: pool_config
                for pool_name, pool_config in pools.items()
                if _pool_backend(pool_config) == backend_name
            },
        }
        test_payload = {
            'node_condition_prefix': backend_config.get(
                'node_conditions', {}).get('prefix', 'osmo.nvidia.com/'),
            'backend_tests': {
                test_name: backend_tests.get(test_name)
                for test_name in tests
            },
        }
        state_backends[backend_name] = {
            'k8s_namespace': backend_config.get('k8s_namespace', ''),
            'scheduler_settings': backend_config.get('scheduler_settings', {}),
            'node_conditions': {
                'prefix': test_payload['node_condition_prefix'],
            },
            'queue_hash': _config_digest(queue_payload),
            'test_hash': _config_digest(test_payload),
        }
    return {
        'format_version': _RECONCILIATION_STATE_VERSION,
        'backends': state_backends,
    }


def _as_reconciliation_state(snapshot: Dict[str, Any] | None) -> Dict[str, Any]:
    if snapshot is None:
        return {
            'format_version': _RECONCILIATION_STATE_VERSION,
            'backends': {},
        }
    if snapshot.get('format_version') == _RECONCILIATION_STATE_VERSION:
        backends = snapshot.get('backends')
        if not isinstance(backends, dict):
            raise ValueError('reconciliation checkpoint has invalid backends')
        return snapshot
    # Compatibility for same-process tests and a pre-checkpoint first load.
    return _build_reconciliation_state(snapshot)


def _backend_config_from_snapshot(
    snapshot: Dict[str, Any] | None, backend_name: str,
) -> Dict[str, Any] | None:
    if snapshot is None:
        return None
    backend = snapshot.get('backends', {}).get(backend_name)
    return backend if isinstance(backend, dict) else None


def _backend_from_snapshot(
    snapshot: Dict[str, Any] | None,
    backend_name: str,
) -> connectors.Backend | None:
    config = _backend_config_from_snapshot(snapshot, backend_name)
    if config is None:
        return None
    now = datetime.datetime.now(datetime.timezone.utc)
    return connectors.Backend(
        name=backend_name,
        description=config.get('description', ''),
        version=config.get('version', ''),
        k8s_uid=config.get('k8s_uid', ''),
        k8s_namespace=config['k8s_namespace'],
        dashboard_url=config.get('dashboard_url', ''),
        grafana_url=config.get('grafana_url', ''),
        tests=config.get('tests', []),
        scheduler_settings=config.get('scheduler_settings', {}),
        node_conditions=config.get('node_conditions', {}),
        last_heartbeat=config.get('last_heartbeat', now),
        created_date=config.get('created_date', now),
        router_address=config.get('router_address', ''),
        online=False,
    )


def _pool_backend(pool_config: Any) -> str | None:
    if isinstance(pool_config, dict):
        backend = pool_config.get('backend')
        if isinstance(backend, str) and backend:
            return backend
    return None


def _pools_from_snapshot(
    snapshot: Dict[str, Any],
    backend_name: str,
) -> List[connectors.Pool]:
    pools: List[connectors.Pool] = []
    for pool_name, pool_config in snapshot.get('pools', {}).items():
        if not isinstance(pool_config, dict):
            continue
        if _pool_backend(pool_config) != backend_name:
            continue
        pool_payload = {
            **pool_config,
            'name': pool_config.get('name', pool_name),
        }
        try:
            pools.append(connectors.Pool(**pool_payload))
        except pydantic.ValidationError as error:
            logging.error(
                'Skipping invalid ConfigMap pool %s for backend %s: %s',
                pool_name, backend_name, _format_validation_error(error))
    return pools


def _normalized_scheduler_settings(backend_config: Dict[str, Any]) -> Dict[str, Any]:
    return connectors.BackendSchedulerSettings(
        **backend_config.get('scheduler_settings', {})
    ).model_dump(mode='json')


def _affected_backends_for_queue_sync(
    previous: Dict[str, Any] | None,
    current: Dict[str, Any],
) -> set[str]:
    old_backends = _as_reconciliation_state(previous)['backends']
    new_backends = _build_reconciliation_state(current)['backends']
    return {
        backend_name
        for backend_name in set(old_backends) | set(new_backends)
        if old_backends.get(backend_name, {}).get('queue_hash')
        != new_backends.get(backend_name, {}).get('queue_hash')
    }


def _affected_backends_for_test_sync(
    previous: Dict[str, Any] | None,
    current: Dict[str, Any],
) -> set[str]:
    old_backends = _as_reconciliation_state(previous)['backends']
    new_backends = _build_reconciliation_state(current)['backends']
    return {
        backend_name
        for backend_name in set(old_backends) | set(new_backends)
        if old_backends.get(backend_name, {}).get('test_hash')
        != new_backends.get(backend_name, {}).get('test_hash')
    }


def _reconcile_backend_side_effects(
    previous: Dict[str, Any] | None,
    current: Dict[str, Any],
    backend_queue_updater: Callable[..., bool] | None,
    backend_test_updater: Callable[..., bool] | None,
) -> bool:
    """Queue backend sync jobs for ConfigMap-driven config changes."""
    if backend_queue_updater is None or backend_test_updater is None:
        logging.warning(
            'ConfigMap backend reconciliation enabled without enqueue callbacks')
        return False

    queue_backends = _affected_backends_for_queue_sync(previous, current)
    test_backends = _affected_backends_for_test_sync(previous, current)
    success = True

    for backend_name in sorted(queue_backends):
        current_backend = _backend_from_snapshot(current, backend_name)
        if current_backend is None:
            current_backend = _backend_from_snapshot(previous, backend_name)
        if current_backend is None:
            continue
        previous_backend = _backend_from_snapshot(previous, backend_name)
        backend_payload = (
            _backend_config_from_snapshot(current, backend_name)
            or _backend_config_from_snapshot(previous, backend_name)
        )
        operation = (
            'apply'
            if _backend_config_from_snapshot(current, backend_name) is not None
            else 'delete'
        )
        payload = {
            'operation': operation,
            'backend': backend_payload,
            'pools': {
                pool_name: pool_config
                for pool_name, pool_config in current.get('pools', {}).items()
                if _pool_backend(pool_config) == backend_name
            },
        }
        job_id = (
            f'{backend_name}-modify-queues-configmap-'
            f'{_stable_config_hash(payload)}'
        )
        try:
            queued = backend_queue_updater(
                current_backend, _pools_from_snapshot(current, backend_name),
                prev_backend=previous_backend, job_id=job_id)
            success = success and queued
        except Exception:  # pylint: disable=broad-exception-caught
            success = False
            logging.exception(
                'Failed to queue ConfigMap backend queue sync for %s',
                backend_name)

    for backend_name in sorted(test_backends):
        current_config = _backend_config_from_snapshot(current, backend_name)
        previous_config = _backend_config_from_snapshot(previous, backend_name)
        backend_config = current_config
        if backend_config is None:
            if previous_config is None:
                continue
            backend_config = {
                **previous_config,
                'tests': [],
            }
        previous_prefix = (
            previous_config.get('node_conditions', {}).get(
                'prefix', 'osmo.nvidia.com/')
            if previous_config is not None else None
        )
        tests = backend_config.get('tests', [])
        if not isinstance(tests, list):
            tests = []
        node_condition_prefix = (
            backend_config.get('node_conditions', {}).get(
                'prefix', 'osmo.nvidia.com/')
        )
        if (current_config is not None and previous_prefix is not None
                and previous_prefix != node_condition_prefix):
            cleanup_payload = {
                'backend': backend_name,
                'node_condition_prefix': previous_prefix,
                'backend_tests': {},
            }
            cleanup_job_id = (
                f'{backend_name}-cleanup-tests-configmap-'
                f'{_stable_config_hash(cleanup_payload)}'
            )
            try:
                cleanup_queued = backend_test_updater(
                    backend_name, {}, previous_prefix,
                    job_id=cleanup_job_id)
                success = success and cleanup_queued
            except Exception:  # pylint: disable=broad-exception-caught
                success = False
                logging.exception(
                    'Failed to queue old-prefix backend test cleanup for %s',
                    backend_name)
        payload = {
            'backend': backend_config,
            'backend_tests': {
                test_name: current.get('backend_tests', {}).get(test_name)
                for test_name in tests
            },
        }
        job_id = (
            f'{backend_name}-sync-tests-configmap-'
            f'{_stable_config_hash(payload)}'
        )
        try:
            backend_test_configs = {
                test_name: current.get('backend_tests', {}).get(test_name)
                for test_name in tests
                if current.get('backend_tests', {}).get(test_name) is not None
            }
            queued = backend_test_updater(
                backend_name, backend_test_configs, node_condition_prefix,
                job_id=job_id)
            success = success and queued
        except Exception:  # pylint: disable=broad-exception-caught
            success = False
            logging.exception(
                'Failed to queue ConfigMap backend test sync for %s',
                backend_name)

    return success


def _reconcile_user_role_assignments(
    current: Dict[str, Any], postgres: connectors.PostgresConnector | None,
) -> None:
    """Remove assignments whose ConfigMap-owned role no longer exists."""
    if postgres is None:
        raise RuntimeError(
            'ConfigMap role assignment reconciliation requires PostgreSQL')
    roles = current.get('roles')
    if not isinstance(roles, dict) or not roles:
        raise RuntimeError(
            'ConfigMap role assignment reconciliation requires non-empty roles')
    role_names = sorted(
        role_name for role_name in roles
        if isinstance(role_name, str) and role_name)
    postgres.execute_commit_command(
        'DELETE FROM user_roles WHERE NOT (role_name = ANY(%s::text[]));',
        (role_names,))


def _resolve_backend_test_computed_fields(managed_configs: Dict[str, Any]) -> None:
    """Compute parsed_pod_template for backend tests from pod template names."""
    backend_tests = managed_configs.get('backend_tests', {})
    if not isinstance(backend_tests, dict):
        return
    pod_templates = managed_configs.get('pod_templates', {})
    if not isinstance(pod_templates, dict):
        pod_templates = {}

    for test_name, test_config in backend_tests.items():
        if not isinstance(test_config, dict):
            continue
        common_pod_template = test_config.get('common_pod_template', [])
        if not isinstance(common_pod_template, list):
            common_pod_template = []
            test_config['common_pod_template'] = common_pod_template

        test_config['parsed_pod_template'] = _merge_pod_template_refs(
            common_pod_template, pod_templates, f'backend test {test_name}')


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

_EXPECTED_CONFIG_KEYS = {
    'service', 'workflow', 'resource_validations', 'pod_templates',
    'group_templates', 'backends', 'backend_tests', 'pools', 'roles',
}


def _format_validation_error(error: pydantic.ValidationError) -> str:
    """Format a Pydantic error as `<path>: <reason> (input_type=<type>)`.

    Never echoes submitted values — they can be resolved secrets.
    """
    parts: List[str] = []
    for err in error.errors():
        loc_parts = tuple(str(p) for p in err.get('loc', ()))
        loc = '.'.join(loc_parts) if loc_parts else '<root>'
        msg = err.get('msg', '')
        if 'input' in err:
            input_type = type(err['input']).__name__
            parts.append(f'{loc}: {msg} (input_type={input_type})')
        else:
            parts.append(f'{loc}: {msg}')
    return '; '.join(parts)


def _validate_configs(managed_configs: Dict[str, Any]) -> List[str]:
    """Validate ConfigMap data by constructing typed Pydantic models.

    Returns a list of error strings. Empty list means all valid.
    """
    errors: List[str] = []

    unknown_keys = set(managed_configs.keys()) - _EXPECTED_CONFIG_KEYS
    expected_keys = ', '.join(sorted(_EXPECTED_CONFIG_KEYS))
    for key in unknown_keys:
        errors.append(
            f'{key}: unknown config section; expected one of '
            f'{expected_keys}')

    # Validate singleton configs by constructing Pydantic models
    for config_key, config_class in [
        ('service', connectors.ServiceConfig),
        ('workflow', connectors.WorkflowConfig),
    ]:
        section = managed_configs.get(config_key)
        if not section:
            continue
        try:
            config_class(**section)
        except pydantic.ValidationError as error:
            errors.append(
                f'{config_key}: {_format_validation_error(error)}')
        except Exception as error:  # pylint: disable=broad-exception-caught
            errors.append(f'{config_key}: {error}')

    # Validate every named entry through the same production models used by
    # config APIs and runtime hydration.
    validators: Dict[str, Callable[[str, Any], Any]] = {
        'resource_validations': lambda _name, value: connectors.ResourceValidation(
            resource_validations=value),
        'pod_templates': lambda _name, value: connectors.PodTemplate(
            pod_template=value),
        'group_templates': lambda name, value: _validate_group_template_entry(
            name, value),
        'backends': lambda name, value: _validate_backend_entry(name, value),
        'backend_tests': lambda name, value: connectors.BackendTests(
            **{**value, 'name': name}),
        'pools': lambda name, value: connectors.PoolEditable(name=name, **value),
        'roles': lambda name, value: _validate_role_entry(name, value),
    }
    for config_key, validator in validators.items():
        section = managed_configs.get(config_key)
        if section is not None and not isinstance(section, dict):
            errors.append(
                f'{config_key}: must be a dict, got {type(section).__name__}')
            continue
        if not isinstance(section, dict):
            continue
        for name, value in section.items():
            if not isinstance(name, str) or not name:
                errors.append(f'{config_key}: every entry must have a non-empty string name')
                continue
            try:
                validator(name, value)
            except pydantic.ValidationError as error:
                errors.append(
                    f'{config_key}.{name}: {_format_validation_error(error)}')
            except ConfigSnapshotValidationError as error:
                errors.append(f'{config_key}.{name}: {error}')
            except Exception as error:  # pylint: disable=broad-exception-caught
                errors.append(f'{config_key}.{name}: {type(error).__name__}')

    return errors


def _validate_required_sections(managed_configs: Dict[str, Any]) -> List[str]:
    """Require the exact nine-section 6.4 runtime document."""
    errors = [
        f'{key}: required 6.4 config section is missing'
        for key in sorted(_EXPECTED_CONFIG_KEYS - set(managed_configs))
    ]
    roles = managed_configs.get('roles')
    if isinstance(roles, dict) and not roles:
        errors.append('roles: required 6.4 config section must not be empty')
    return errors


def _validate_role_entry(name: str, value: Any) -> connectors.Role:
    """Validate a ConfigMap-owned role definition.

    ``sync_mode`` controls the legacy PostgreSQL assignment synchronizer and
    is deliberately not part of the file-backed authorization contract.
    """
    if not isinstance(value, dict):
        raise ConfigSnapshotValidationError('role entry must be a mapping')
    if 'sync_mode' in value:
        raise ConfigSnapshotValidationError(
            'sync_mode is not used by ConfigMap-backed authorization')
    return connectors.Role(name=name, **value)


def _validate_backend_entry(name: str, value: Any) -> connectors.Backend:
    if not isinstance(value, dict):
        raise ConfigSnapshotValidationError(
            'backend entry must be a mapping')
    now = datetime.datetime.now(datetime.timezone.utc)
    return connectors.Backend(
        name=name,
        description=value.get('description', ''),
        version='',
        k8s_uid='',
        k8s_namespace=value.get('k8s_namespace', ''),
        dashboard_url=value.get('dashboard_url', ''),
        grafana_url=value.get('grafana_url', ''),
        tests=value.get('tests', []),
        scheduler_settings=value.get('scheduler_settings', {}),
        node_conditions=value.get('node_conditions', {}),
        last_heartbeat=now,
        created_date=now,
        router_address=value.get('router_address', ''),
        online=False,
    )


def _validate_group_template_entry(
    name: str, value: Any,
) -> connectors.GroupTemplate:
    """Validate the runtime invariants formerly enforced on DB insertion."""
    if not isinstance(value, dict):
        raise ConfigSnapshotValidationError(
            'group template entry must be a mapping')
    for required_field in ('apiVersion', 'kind'):
        if not isinstance(value.get(required_field), str) or not value[required_field]:
            raise ConfigSnapshotValidationError(
                f'group template {name} requires a non-empty {required_field}')
    metadata = value.get('metadata')
    if (not isinstance(metadata, dict)
            or not isinstance(metadata.get('name'), str)
            or not metadata['name']):
        raise ConfigSnapshotValidationError(
            f'group template {name} requires a non-empty metadata.name')
    if 'namespace' in metadata:
        raise ConfigSnapshotValidationError(
            f'group template {name} must not set metadata.namespace; '
            'OSMO assigns it at runtime')
    return connectors.GroupTemplate(group_template=value)


def _validate_cross_references(managed_configs: Dict[str, Any]) -> List[str]:
    """Reject dangling ConfigMap references instead of silently skipping them."""
    errors: List[str] = []
    backends = managed_configs.get('backends', {})
    pools = managed_configs.get('pools', {})
    pod_templates = managed_configs.get('pod_templates', {})
    resource_validations = managed_configs.get('resource_validations', {})
    group_templates = managed_configs.get('group_templates', {})
    backend_tests = managed_configs.get('backend_tests', {})
    sections = (backends, pools, pod_templates, resource_validations,
                group_templates, backend_tests)
    if not all(isinstance(section, dict) for section in sections):
        return errors

    def require_names(
        owner: str, raw_names: Any, available: Dict[str, Any], target: str,
    ) -> None:
        if not isinstance(raw_names, list):
            return
        for name in raw_names:
            if isinstance(name, str) and name not in available:
                errors.append(f'{owner}: references missing {target} {name}')

    for backend_name, backend in backends.items():
        if isinstance(backend, dict):
            require_names(
                f'backends.{backend_name}.tests', backend.get('tests', []),
                backend_tests, 'backend test')
    for test_name, test in backend_tests.items():
        if isinstance(test, dict):
            require_names(
                f'backend_tests.{test_name}.common_pod_template',
                test.get('common_pod_template', []), pod_templates,
                'pod template')
    for pool_name, pool in pools.items():
        if not isinstance(pool, dict):
            continue
        backend = pool.get('backend')
        if isinstance(backend, str) and backend not in backends:
            errors.append(f'pools.{pool_name}.backend: references missing backend {backend}')
        for field, available, label in (
            ('common_pod_template', pod_templates, 'pod template'),
            ('common_resource_validations', resource_validations, 'resource validation'),
            ('common_group_templates', group_templates, 'group template'),
        ):
            require_names(f'pools.{pool_name}.{field}', pool.get(field, []),
                          available, label)
        platforms = pool.get('platforms', {})
        if isinstance(platforms, dict):
            default_platform = pool.get('default_platform')
            if (isinstance(default_platform, str) and default_platform
                    and default_platform not in platforms):
                errors.append(
                    f'pools.{pool_name}.default_platform: references missing '
                    f'platform {default_platform}')
            for platform_name, platform in platforms.items():
                if not isinstance(platform, dict):
                    continue
                require_names(
                    f'pools.{pool_name}.platforms.{platform_name}.override_pod_template',
                    platform.get('override_pod_template', []), pod_templates,
                    'pod template')
                require_names(
                    f'pools.{pool_name}.platforms.{platform_name}.resource_validations',
                    platform.get('resource_validations', []), resource_validations,
                    'resource validation')
    return errors


def _validate_active_workflow_references(
    postgres: connectors.PostgresConnector | None,
    managed_configs: Dict[str, Any],
) -> List[str]:
    """Reject a snapshot that removes authority needed by alive workflows."""
    if postgres is None:
        return []
    rows = postgres.execute_fetch_command(
        'SELECT workflow_id, pool, backend FROM workflows '
        'WHERE status IN (\'PENDING\', \'RUNNING\', \'WAITING\') '
        'ORDER BY workflow_id;', (), True)
    pools = managed_configs.get('pools', {})
    backends = managed_configs.get('backends', {})
    errors: List[str] = []
    for row in rows or []:
        workflow_id = row['workflow_id']
        pool_name = row['pool']
        backend_name = row['backend']
        pool = pools.get(pool_name) if isinstance(pools, dict) else None
        if not isinstance(pool, dict):
            errors.append(
                f'active workflow {workflow_id}: pool {pool_name} is missing')
            continue
        if not isinstance(backends, dict) or backend_name not in backends:
            errors.append(
                f'active workflow {workflow_id}: backend {backend_name} is missing')
        if pool.get('backend') != backend_name:
            errors.append(
                f'active workflow {workflow_id}: pool {pool_name} no longer '
                f'references backend {backend_name}')
    return errors


def _validate_configmap_runtime_contract(
    managed_configs: Dict[str, Any],
    *,
    require_service_auth: bool = True,
) -> List[str]:
    """Validate runtime fields that ConfigMap mode must own.

    Runtime fields must be present after explicit secret resolution and
    PostgreSQL auth hydration.
    """
    errors: List[str] = []

    service_config = managed_configs.get('service')
    if (require_service_auth and (
            not isinstance(service_config, dict)
            or 'service_auth' not in service_config)):
        errors.append(
            'service.service_auth: required from the configured auth source')

    backends = managed_configs.get('backends', {})
    if isinstance(backends, dict):
        for backend_name, backend_config in backends.items():
            if not isinstance(backend_config, dict):
                continue
            if not backend_config.get('k8s_namespace'):
                errors.append(
                    f'backends.{backend_name}.k8s_namespace: required in '
                    'ConfigMap mode because backend queue names include the '
                    'backend Kubernetes namespace')

    return errors


def validate_configmap_snapshot(
    managed_configs: Dict[str, Any],
    *,
    postgres: connectors.PostgresConnector | None = None,
    require_service_auth: bool = True,
) -> List[str]:
    """Run the complete pure snapshot contract plus optional live checks.

    The offline rendered-config verifier uses the same entry point as runtime but
    omits service-auth, which is mounted separately from config.yaml, and the
    live-workflow query, which is only available to running services.
    """
    errors = _validate_required_sections(managed_configs)
    errors.extend(_validate_configmap_runtime_contract(
        managed_configs, require_service_auth=require_service_auth))
    errors.extend(_validate_configs(managed_configs))
    errors.extend(_validate_cross_references(managed_configs))
    errors.extend(_validate_active_workflow_references(
        postgres, managed_configs))
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


def _merge_pod_template_refs(
    template_names: List[Any],
    pod_templates: Dict[str, Any],
    reference_context: str,
) -> Dict[str, Any]:
    """Merge named pod templates the same way DB-backed config writes do."""
    merged_template: Dict[str, Any] = {}
    for template_name in template_names:
        if not isinstance(template_name, str):
            logging.warning(
                'Ignoring non-string pod template reference %r in %s',
                template_name, reference_context)
            continue
        if template_name in pod_templates:
            merged_template = recursive_dict_update(
                merged_template,
                copy.deepcopy(pod_templates[template_name]),
                merge_lists_on_name)
        else:
            logging.warning(
                'Pod template %r referenced by %s not found',
                template_name, reference_context)
    return merged_template


def _render_pod_template_for_accounting(
    pod_template: Dict[str, Any],
    default_variables: Dict[str, Any],
) -> Dict[str, Any]:
    """Return a copy of `pod_template` with Jinja in osmo-ctrl resources
    rendered using `default_variables` as sentinel inputs.

    Pool-quota math reads osmo-ctrl request/limit fields as numeric K8s
    resource values, but those fields can be Jinja templates that depend
    on per-workflow variables (e.g. `{% if USER_CPU > 2 %}2{% else %}{{USER_CPU}}{% endif %}`).
    Without rendering, the accounting code can't parse the value and
    silently treats it as zero. Pre-rendering with the pool's defaults
    gives an exact value for workflows that don't override these vars
    and a representative one for those that do — close enough for the
    capacity-vs-overhead estimate this feeds into.
    """
    # Always return a standalone dict — callers store this alongside
    # parsed_pod_template, and the templated copy is mutated at workflow
    # render time by substitute_pod_template_tokens. Aliasing would let
    # those mutations corrupt the accounting copy.
    rendered = copy.deepcopy(pod_template)
    if not default_variables:
        return rendered
    containers = rendered.get('spec', {}).get('containers', [])
    for container in containers:
        if container.get('name') != 'osmo-ctrl':
            continue
        resources = container.get('resources')
        if not isinstance(resources, dict):
            continue
        for kind in ('requests', 'limits'):
            fields = resources.get(kind)
            if not isinstance(fields, dict):
                continue
            for key, value in fields.items():
                if not isinstance(value, str) or '{' not in value:
                    continue
                try:
                    fields[key] = jinja_sandbox.sandboxed_jinja_substitute(
                        value, default_variables)
                except osmo_errors.OSMOUsageError as exc:
                    # Leave the original template in place; accounting
                    # falls back to convert_cpu_unit's zero-on-parse
                    # path. Log so operators see the bad template rather
                    # than silently undercounting pool overhead.
                    logging.warning(
                        'Failed to pre-render osmo-ctrl %s.%s for '
                        'accounting (template kept as-is): %s',
                        kind, key, exc)
    return rendered


def _resolve_single_pool(
    pool_data: Dict[str, Any],
    pod_templates: Dict[str, Any],
    resource_validations: Dict[str, Any],
    group_templates: Dict[str, Any],
) -> None:
    """Resolve computed fields for a single pool and its platforms."""
    # Normalize list/dict fields to prevent crashes on null/wrong types
    for list_field in ('common_pod_template', 'common_resource_validations',
                       'common_group_templates'):
        if not isinstance(pool_data.get(list_field), list):
            pool_data[list_field] = []
    if not isinstance(pool_data.get('platforms'), dict):
        pool_data['platforms'] = {}
    if not isinstance(pool_data.get('common_default_variables'), dict):
        pool_data['common_default_variables'] = {}

    # Resolve common pod template (pool-level base)
    common_pod_template_names = pool_data.get('common_pod_template', [])
    base_pod_template = _merge_pod_template_refs(
        common_pod_template_names, pod_templates, 'pool')
    pool_data['parsed_pod_template'] = base_pod_template
    pool_data['parsed_pod_template_for_accounting'] = (
        _render_pod_template_for_accounting(
            base_pod_template,
            pool_data['common_default_variables']))

    # Resolve common resource validations (pool-level base)
    common_resource_validation_names = pool_data.get(
        'common_resource_validations', [])
    base_resource_validations: List[Any] = []
    for validation_name in common_resource_validation_names:
        if validation_name in resource_validations:
            base_resource_validations.extend(
                copy.deepcopy(resource_validations[validation_name]))
        else:
            logging.warning(
                'Resource validation %r referenced by pool not found',
                validation_name)
    pool_data['parsed_resource_validations'] = base_resource_validations

    # Resolve common group templates (pool-level).
    # Matches Pool.calculate_group_templates(): merges templates with
    # the same (apiVersion, kind, metadata.name) key.
    common_group_template_names = pool_data.get(
        'common_group_templates', [])
    merged_by_key: Dict[tuple, Dict[str, Any]] = {}
    for template_name in common_group_template_names:
        if template_name not in group_templates:
            logging.warning(
                'Group template %r referenced by pool not found',
                template_name)
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
    pool_defaults = pool_data['common_default_variables']
    for platform_data in platforms.values():
        if not isinstance(platform_data, dict):
            continue
        _resolve_platform_fields(
            platform_data, base_pod_template, base_resource_validations,
            pod_templates, resource_validations, pool_defaults)


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
    pool_default_variables: Dict[str, Any],
) -> None:
    """Resolve computed fields for a single platform within a pool.

    Always resolves from source-of-truth references (template names),
    overwriting any pre-existing parsed_* fields.
    """
    # Normalize list/dict fields to prevent crashes on null/wrong types
    for list_field in ('override_pod_template', 'resource_validations'):
        if not isinstance(platform_data.get(list_field), list):
            platform_data[list_field] = []
    if not isinstance(platform_data.get('default_variables'), dict):
        platform_data['default_variables'] = {}

    # Pod template: start from pool common, merge platform overrides
    platform_pod_template = recursive_dict_update(
        copy.deepcopy(base_pod_template),
        _merge_pod_template_refs(
            platform_data.get('override_pod_template', []),
            pod_templates,
            'platform'),
        merge_lists_on_name)
    platform_data['parsed_pod_template'] = platform_pod_template

    # Accounting copy: render Jinja in osmo-ctrl resources using pool
    # defaults overlaid by platform-specific defaults so the values are
    # numeric for pool-quota math.
    platform_defaults = {
        **pool_default_variables,
        **platform_data['default_variables'],
    }
    platform_data['parsed_pod_template_for_accounting'] = (
        _render_pod_template_for_accounting(
            platform_pod_template, platform_defaults))

    # Derive tolerations, labels, default_mounts from resolved template.
    # Unconditional assignment — always recompute from the resolved template
    # rather than preserving potentially stale values from the YAML.
    spec = platform_pod_template.get('spec', {})
    platform_data['tolerations'] = spec.get('tolerations', [])
    platform_data['labels'] = spec.get('nodeSelector', {})
    platform_data['default_mounts'] = _get_default_mounts(
        platform_pod_template)

    # Resource validations: start from pool common, extend with platform
    platform_resource_validations = copy.deepcopy(base_resource_validations)
    for validation_name in platform_data.get('resource_validations', []):
        if validation_name in resource_validations:
            platform_resource_validations.extend(
                copy.deepcopy(resource_validations[validation_name]))
        else:
            logging.warning(
                'Resource validation %r referenced by platform not found',
                validation_name)
    platform_data['parsed_resource_validations'] = \
        platform_resource_validations


# ---------------------------------------------------------------------------
# Secret resolution
# ---------------------------------------------------------------------------

# Root directory where K8s Secrets are mounted by the chart. Overridable
# for unit tests that don't run against a real pod.
SECRETS_ROOT = '/etc/osmo/secrets'


def _decode_dockerconfig_identity(
    auth_b64: str, username: str,
) -> tuple[str, str]:
    """Recover the username and raw password from a Docker `auth` field.

    The `auth` field is base64(`username:password`). Docker config files may
    omit the redundant `username` field, so preserve an explicit username or
    recover it from the decoded composite. Returns the supplied username and
    an empty password on decode failure.
    """
    if not auth_b64:
        return username, ''
    try:
        decoded = base64.b64decode(auth_b64).decode('utf-8')
    except (ValueError, UnicodeDecodeError):
        logging.warning(
            'Could not base64-decode dockerconfigjson auth field; '
            'returning empty password')
        return username, ''
    prefix = f'{username}:'
    if username and decoded.startswith(prefix):
        return username, decoded[len(prefix):]
    decoded_username, separator, password = decoded.partition(':')
    if not separator:
        return username, ''
    return username or decoded_username, password


def _resolve_secret_file_references(config_data: Dict[str, Any],
                                     parent_key: str = '') -> None:
    """Resolve explicit OSMO config Secret references without touching pod specs.

    Walks the dict tree. A Kubernetes Secret reference is recognized only when
    both ``secretName`` and ``secretKey`` are present. Requiring the pair keeps
    workload constructs such as ``volumes[].secret.secretName`` unchanged.

    When it finds a dict with ``secret_file`` or the explicit key pair:
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

        label = f'{parent_key}.{key}' if parent_key else key

        if 'secret_file' in value:
            secret_file_path = value['secret_file']
            if (not isinstance(secret_file_path, str)
                    or not secret_file_path.strip()):
                raise ValueError(
                    f'{label}: secret_file must be a non-empty string')
            real_root = os.path.realpath(SECRETS_ROOT)
            real_path = os.path.realpath(secret_file_path)
            if os.path.commonpath((real_root, real_path)) != real_root:
                raise ValueError(
                    f'{label}: secret_file must resolve below the mounted '
                    'Kubernetes Secret root')
            _resolve_single_secret(
                config_data, key, value, secret_file_path, label)
            continue

        if 'secretName' in value and 'secretKey' in value:
            secret_name = value['secretName']
            if not isinstance(secret_name, str) or not secret_name.strip():
                raise ValueError(
                    f'{label}: secretName must be a non-empty string')
            secret_dir = os.path.join(SECRETS_ROOT, secret_name)
            explicit_key = value['secretKey']
            if (not isinstance(explicit_key, str)
                    or not explicit_key.strip()):
                raise ValueError(
                    f'{label}: secretKey must be a non-empty string')
            real_root = os.path.realpath(SECRETS_ROOT)
            candidate = os.path.join(secret_dir, explicit_key)
            if os.path.commonpath((real_root, os.path.realpath(candidate))) != real_root:
                raise ValueError(
                    f'{label}: Secret reference must resolve below the mounted '
                    'Kubernetes Secret root')
            _resolve_single_secret(
                config_data, key, value,
                os.path.join(secret_dir, explicit_key), label)
            continue

        _resolve_secret_file_references(value, label)


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
        raise ValueError(f'{path_label}: mounted Secret file is unreadable') from error

    try:
        secret_data = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        try:
            secret_data = yaml.safe_load(content)
        except yaml.YAMLError as error:
            problem_mark = getattr(error, 'problem_mark', None)
            location = ''
            if problem_mark is not None:
                location = (
                    f' at line {problem_mark.line + 1}, '
                    f'column {problem_mark.column + 1}')
            raise ValueError(
                f'{path_label}: mounted Secret file contains invalid YAML{location}') from error

    if not isinstance(secret_data, dict):
        raise ValueError(
            f'{path_label}: mounted Secret file must contain a mapping')
    _validate_non_empty_secret_payload(secret_data, path_label)

    if 'value' in secret_data and len(secret_data) == 1:
        parent_dict[key] = secret_data['value']
        logging.info('Loaded secret for %s from secret file', path_label)
        return

    if 'auths' in secret_data:
        auths = secret_data['auths']
        if isinstance(auths, dict) and auths:
            registry_url = next(iter(auths))
            registry_data = auths[registry_url]
            # RegistryCredential.auth is the raw password/token; the worker
            # base64s `username:auth` to build the dockerconfigjson auth
            # header at pod-creation time. Source files store either
            # `password` (raw, what we want) or `auth` (already
            # base64(username:password)). Prefer password; fall back to
            # decoding auth and stripping the username prefix so we always
            # land in the model with a raw token.
            username = registry_data.get('username', '')
            decoded_username, decoded_password = _decode_dockerconfig_identity(
                registry_data.get('auth', ''), username)
            username = username or decoded_username
            password = registry_data.get('password') or decoded_password
            extracted = {
                'registry': registry_url,
                'username': username,
                'auth': password,
            }
            _validate_non_empty_secret_payload(extracted, path_label)
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


def _validate_non_empty_secret_payload(
    value: Any, path_label: str, *, root: bool = True,
) -> None:
    """Reject empty material supplied by an explicit Secret reference."""
    if value is None:
        raise ValueError(f'{path_label}: mounted Secret value is empty')
    if isinstance(value, str):
        if not value.strip():
            raise ValueError(f'{path_label}: mounted Secret value is empty')
        return
    if isinstance(value, dict):
        if not value and root:
            raise ValueError(f'{path_label}: mounted Secret mapping is empty')
        for child_key, child_value in value.items():
            _validate_non_empty_secret_payload(
                child_value, f'{path_label}.{child_key}', root=False)
        return
    if isinstance(value, list):
        if not value and root:
            raise ValueError(f'{path_label}: mounted Secret list is empty')
        for index, child_value in enumerate(value):
            _validate_non_empty_secret_payload(
                child_value, f'{path_label}[{index}]', root=False)
