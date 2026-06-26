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
import threading
import time
from typing import Any, Callable, Dict, List

import pydantic
import yaml
from watchdog import events, observers

from src.lib.utils import jinja_sandbox, osmo_errors
from src.lib.utils.common import merge_lists_on_name, recursive_dict_update
from src.service.core.config import configmap_events, configmap_guard
from src.utils import connectors


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

    def __init__(
        self,
        config_file_path: str,
        postgres: connectors.PostgresConnector | None = None,
        *,
        event_recorder: configmap_events.EventRecorder | None = None,
        enable_reconciliation: bool = False,
        backend_queue_updater: Callable[..., bool] | None = None,
        backend_test_updater: Callable[..., bool] | None = None,
    ):
        self._config_file_path = config_file_path
        self._postgres = postgres
        self._event_recorder = event_recorder
        self._enable_reconciliation = enable_reconciliation
        self._backend_queue_updater = backend_queue_updater
        self._backend_test_updater = backend_test_updater
        self._watch_directory = os.path.dirname(config_file_path)
        self._config_filename = os.path.basename(config_file_path)
        self._observer: Any = None
        self._last_reconciled_snapshot: Dict[str, Any] | None = None
        # Only emit "reload succeeded" events when recovering from a
        # previous failure — successful reloads on their own are noise.
        self._last_reload_failed = False

    def start(self) -> None:
        """Load configs, activate ConfigMap mode, start file watcher.

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
                    f'({self._config_file_path}): file never became '
                    f'readable. Refusing to serve.')
            time.sleep(_STARTUP_RETRY_INTERVAL_S)

        configmap_guard.set_configmap_mode(True)
        logging.info(
            'ConfigMap mode activated — '
            'all config writes via CLI/API are blocked')

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
        # Dataset config is deprecated; tolerate stale ConfigMap blocks without loading them.
        managed_configs.pop('dataset', None)

        # Resolve secret file references (reads mounted K8s Secret files)
        for section in managed_configs.values():
            if isinstance(section, dict):
                _resolve_secret_file_references(section)

        # Validate ConfigMap-provided fields BEFORE injecting runtime
        # fields. Runtime fields (service_auth) are already validated
        # by configure_app().
        validation_errors = _validate_configs(managed_configs)
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

        # Inject runtime-generated fields (service_auth, service_base_url)
        # that are not in the ConfigMap but are needed by every service.
        # service_auth in particular has a default_factory that mints a
        # fresh RSA keypair when missing, so without this injection the
        # worker would sign workflow JWTs with keys the API/authz_sidecar
        # don't have. First load reads from DB; subsequent reloads carry
        # forward from the previous snapshot.
        self._inject_runtime_fields(managed_configs)

        configmap_guard.set_parsed_configs(managed_configs)
        if not configmap_guard.is_configmap_mode():
            configmap_guard.set_configmap_mode(True)
            logging.info(
                'ConfigMap mode activated (deferred) — '
                'all config writes via CLI/API are blocked')
        logging.info(
            'ConfigMap configs loaded from %s', self._config_file_path)
        if self._enable_reconciliation:
            try:
                reconciled = _reconcile_backend_side_effects(
                    reconciliation_baseline, managed_configs, self._postgres,
                    self._backend_queue_updater, self._backend_test_updater)
                if reconciled:
                    self._last_reconciled_snapshot = copy.deepcopy(managed_configs)
            except Exception:  # pylint: disable=broad-exception-caught
                logging.exception(
                    'ConfigMap backend side-effect reconciliation failed')
        self._record_success()

        return LoadResult.SUCCESS

    def _inject_runtime_fields(
        self, managed_configs: Dict[str, Any],
    ) -> None:
        """Inject service_auth — the one runtime-generated field.

        service_auth (RSA signing keys) is generated on first API
        startup and never appears in the ConfigMap; without injecting
        it, ServiceConfig's default_factory would mint a fresh keypair
        in every consumer process and the API/authz_sidecar wouldn't
        be able to validate JWTs minted by the worker. First load
        reads from DB; subsequent reloads carry forward from the
        previous snapshot.

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

        if 'service_auth' not in service_config and 'service_auth' in prev_service:
            service_config['service_auth'] = prev_service['service_auth']


def start_config_watcher(
    config_file: str | None,
    postgres: connectors.PostgresConnector,
    *,
    is_api_service: bool = False,
    backend_queue_updater: Callable[..., bool] | None = None,
    backend_test_updater: Callable[..., bool] | None = None,
) -> 'ConfigMapWatcher | None':
    """Initialize and start a ConfigMapWatcher when `config_file` is set.

    Returns the watcher so the caller can keep a reference (the watchdog
    Observer thread is daemonic; without a live reference the watcher may
    be GC'd while the process is still alive).

    Only the API service emits K8s Events on reload failures. All four
    services watch the same ConfigMap and all reload on the same file
    change; emitting from each would multiply the same logical event.
    The API is the natural single emitter — operators look there first.
    (Replica-level races on the same Event object exist regardless and
    are handled defensively by configmap_events; this gate just avoids
    cross-service duplication.)

    Runtime field injection (service_auth) runs in every service so the
    worker's JWT-minting path doesn't fall through to ServiceConfig's
    default_factory and generate a fresh RSA keypair the API/authz_sidecar
    can't validate against.
    """
    if not config_file:
        return None

    event_recorder: configmap_events.EventRecorder | None = None
    if is_api_service:
        pod_namespace = os.environ.get('POD_NAMESPACE')
        configmap_name = os.environ.get('OSMO_CONFIGMAP_NAME')
        if pod_namespace and configmap_name:
            event_recorder = configmap_events.ConfigMapEventRecorder(
                namespace=pod_namespace, configmap_name=configmap_name)
        else:
            logging.warning(
                'POD_NAMESPACE or OSMO_CONFIGMAP_NAME unset; '
                'ConfigMap reload events will not be emitted')

    watcher = ConfigMapWatcher(
        config_file, postgres,
        event_recorder=event_recorder,
        enable_reconciliation=is_api_service,
        backend_queue_updater=backend_queue_updater,
        backend_test_updater=backend_test_updater,
    )
    watcher.start()
    return watcher


# ---------------------------------------------------------------------------
# Backend side-effect reconciliation
# ---------------------------------------------------------------------------

def _stable_config_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()[:12]


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
    postgres: connectors.PostgresConnector | None,
) -> connectors.Backend | None:
    config = _backend_config_from_snapshot(snapshot, backend_name)
    if config is None:
        return None
    runtime = _backend_runtime_fields(postgres, backend_name)
    return connectors.Backend(
        name=backend_name,
        description=config.get('description', ''),
        version=runtime['version'],
        k8s_uid=runtime['k8s_uid'],
        k8s_namespace=runtime['k8s_namespace'],
        dashboard_url=config.get('dashboard_url', ''),
        grafana_url=config.get('grafana_url', ''),
        tests=config.get('tests', []),
        scheduler_settings=config.get('scheduler_settings', {}),
        node_conditions=config.get('node_conditions', {}),
        last_heartbeat=runtime['last_heartbeat'],
        created_date=runtime['created_date'],
        router_address=config.get('router_address', ''),
        online=False,
    )


def _backend_runtime_fields(
    postgres: connectors.PostgresConnector | None,
    backend_name: str,
) -> Dict[str, Any]:
    now = datetime.datetime.now(datetime.timezone.utc)
    runtime = {
        'k8s_uid': '',
        'k8s_namespace': '',
        'version': '',
        'last_heartbeat': now,
        'created_date': now,
    }
    if postgres is None:
        return runtime
    try:
        rows = postgres.execute_fetch_command(
            'SELECT k8s_uid, k8s_namespace, version, '
            'last_heartbeat, created_date '
            'FROM backends WHERE name = %s;',
            (backend_name,),
            True)
    except Exception:  # pylint: disable=broad-exception-caught
        logging.exception(
            'Failed to fetch runtime fields for backend %s', backend_name)
        return runtime
    if isinstance(rows, list) and rows:
        row = rows[0]
        for key in runtime:
            if isinstance(row, dict) and row.get(key) is not None:
                runtime[key] = row[key]
    return runtime


def _pool_backend(pool_config: Any) -> str | None:
    if isinstance(pool_config, dict):
        backend = pool_config.get('backend')
        if isinstance(backend, str) and backend:
            return backend
    return None


def _normalized_scheduler_settings(backend_config: Dict[str, Any]) -> Dict[str, Any]:
    return connectors.BackendSchedulerSettings(
        **backend_config.get('scheduler_settings', {})
    ).model_dump(mode='json')


def _affected_backends_for_queue_sync(
    previous: Dict[str, Any] | None,
    current: Dict[str, Any],
) -> set[str]:
    affected: set[str] = set()
    old_backends = previous.get('backends', {}) if previous else {}
    new_backends = current.get('backends', {})

    for backend_name in set(old_backends) | set(new_backends):
        if backend_name not in old_backends or backend_name not in new_backends:
            affected.add(backend_name)
            continue
        old_backend = old_backends.get(backend_name, {})
        new_backend = new_backends.get(backend_name, {})
        if not isinstance(old_backend, dict) or not isinstance(new_backend, dict):
            continue
        old_scheduler = _normalized_scheduler_settings(old_backend)
        new_scheduler = _normalized_scheduler_settings(new_backend)
        if old_scheduler != new_scheduler:
            affected.add(backend_name)

    old_pools = previous.get('pools', {}) if previous else {}
    new_pools = current.get('pools', {})
    for pool_name in set(old_pools) | set(new_pools):
        old_pool = old_pools.get(pool_name)
        new_pool = new_pools.get(pool_name)
        if old_pool == new_pool:
            continue
        old_backend = _pool_backend(old_pool)
        new_backend = _pool_backend(new_pool)
        if old_backend:
            affected.add(old_backend)
        if new_backend:
            affected.add(new_backend)

    return affected


def _backend_test_template_names(test_config: Any) -> set[str]:
    if not isinstance(test_config, dict):
        return set()
    templates = test_config.get('common_pod_template', [])
    if not isinstance(templates, list):
        return set()
    return {template for template in templates if isinstance(template, str)}


def _backends_referencing_tests(
    snapshot: Dict[str, Any] | None, test_names: set[str],
) -> set[str]:
    if not snapshot or not test_names:
        return set()
    affected: set[str] = set()
    for backend_name, backend_config in snapshot.get('backends', {}).items():
        if not isinstance(backend_config, dict):
            continue
        tests = backend_config.get('tests', [])
        if isinstance(tests, list) and test_names.intersection(tests):
            affected.add(backend_name)
    return affected


def _affected_backends_for_test_sync(
    previous: Dict[str, Any] | None,
    current: Dict[str, Any],
) -> set[str]:
    affected: set[str] = set()
    old_backends = previous.get('backends', {}) if previous else {}
    new_backends = current.get('backends', {})
    if previous is None:
        return {
            backend_name for backend_name, backend_config in new_backends.items()
            if isinstance(backend_config, dict)
        }

    for backend_name in set(old_backends) | set(new_backends):
        old_backend = old_backends.get(backend_name, {})
        new_backend = new_backends.get(backend_name, {})
        if not isinstance(old_backend, dict) or not isinstance(new_backend, dict):
            continue
        old_prefix = old_backend.get('node_conditions', {}).get('prefix')
        new_prefix = new_backend.get('node_conditions', {}).get('prefix')
        if old_backend.get('tests', []) != new_backend.get('tests', []):
            affected.add(backend_name)
        elif old_prefix != new_prefix:
            affected.add(backend_name)

    old_tests = previous.get('backend_tests', {}) if previous else {}
    new_tests = current.get('backend_tests', {})
    changed_tests = {
        test_name for test_name in set(old_tests) | set(new_tests)
        if old_tests.get(test_name) != new_tests.get(test_name)
    }
    affected.update(_backends_referencing_tests(previous, changed_tests))
    affected.update(_backends_referencing_tests(current, changed_tests))

    old_templates = previous.get('pod_templates', {}) if previous else {}
    new_templates = current.get('pod_templates', {})
    changed_templates = {
        template_name for template_name in set(old_templates) | set(new_templates)
        if old_templates.get(template_name) != new_templates.get(template_name)
    }
    if changed_templates:
        template_affected_tests = {
            test_name for test_name, test_config in {**old_tests, **new_tests}.items()
            if _backend_test_template_names(test_config).intersection(changed_templates)
        }
        affected.update(_backends_referencing_tests(previous, template_affected_tests))
        affected.update(_backends_referencing_tests(current, template_affected_tests))

    return affected


def _reconcile_backend_side_effects(
    previous: Dict[str, Any] | None,
    current: Dict[str, Any],
    postgres: connectors.PostgresConnector | None,
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
        current_backend = _backend_from_snapshot(current, backend_name, postgres)
        if current_backend is None:
            current_backend = _backend_from_snapshot(previous, backend_name, postgres)
        if current_backend is None:
            continue
        previous_backend = _backend_from_snapshot(previous, backend_name, postgres)
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
                current_backend, previous_backend, job_id=job_id)
            success = success and queued
        except Exception:  # pylint: disable=broad-exception-caught
            success = False
            logging.exception(
                'Failed to queue ConfigMap backend queue sync for %s',
                backend_name)

    for backend_name in sorted(test_backends):
        backend_config = _backend_config_from_snapshot(current, backend_name)
        if backend_config is None:
            previous_config = _backend_config_from_snapshot(previous, backend_name)
            if previous_config is None:
                continue
            backend_config = {
                **previous_config,
                'tests': [],
            }
        tests = backend_config.get('tests', [])
        if not isinstance(tests, list):
            tests = []
        node_condition_prefix = (
            backend_config.get('node_conditions', {}).get(
                'prefix', 'osmo.nvidia.com/')
        )
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
            queued = backend_test_updater(
                backend_name, tests, node_condition_prefix, job_id=job_id)
            success = success and queued
        except Exception:  # pylint: disable=broad-exception-caught
            success = False
            logging.exception(
                'Failed to queue ConfigMap backend test sync for %s',
                backend_name)

    return success


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

        parsed_pod_template: Dict[str, Any] = {}
        for template_name in common_pod_template:
            if template_name in pod_templates:
                parsed_pod_template = recursive_dict_update(
                    parsed_pod_template,
                    copy.deepcopy(pod_templates[template_name]),
                    merge_lists_on_name)
            else:
                logging.warning(
                    'Pod template %r referenced by backend test %s not found',
                    template_name, test_name)
        test_config['parsed_pod_template'] = parsed_pod_template


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
    for key in unknown_keys:
        logging.warning('Unknown config key: %s (expected one of: %s)',
                        key, ', '.join(sorted(_EXPECTED_CONFIG_KEYS)))

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
    base_pod_template: Dict[str, Any] = {}
    for template_name in common_pod_template_names:
        if template_name in pod_templates:
            base_pod_template = recursive_dict_update(
                base_pod_template,
                copy.deepcopy(pod_templates[template_name]),
                merge_lists_on_name)
        else:
            logging.warning(
                'Pod template %r referenced by pool not found', template_name)
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
    platform_pod_template = copy.deepcopy(base_pod_template)
    for template_name in platform_data.get('override_pod_template', []):
        if template_name in pod_templates:
            platform_pod_template = recursive_dict_update(
                platform_pod_template,
                copy.deepcopy(pod_templates[template_name]),
                merge_lists_on_name)
        else:
            logging.warning(
                'Pod template %r referenced by platform not found',
                template_name)
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


def _decode_dockerconfig_auth(auth_b64: str, username: str) -> str:
    """Recover the raw password from a `.dockerconfigjson` `auth` field.

    The `auth` field is base64(`username:password`); strip the username
    prefix and a single ':' to get the password back. Returns '' on any
    decode failure — caller logs and proceeds with empty credentials.
    """
    if not auth_b64:
        return ''
    try:
        decoded = base64.b64decode(auth_b64).decode('utf-8')
    except (ValueError, UnicodeDecodeError):
        logging.warning(
            'Could not base64-decode dockerconfigjson auth field; '
            'returning empty password')
        return ''
    prefix = f'{username}:'
    if username and decoded.startswith(prefix):
        return decoded[len(prefix):]
    # No username, or auth doesn't start with username: — just split on
    # first ':' as a best effort.
    _, sep, password = decoded.partition(':')
    return password if sep else ''


def _resolve_secret_file_references(config_data: Dict[str, Any],
                                     parent_key: str = '') -> None:
    """Recursively resolve secret_file / secretName references in a config dict.

    Walks the dict tree. When it finds a dict with 'secret_file' or 'secretName':
    - Reads the YAML file from the mounted K8s Secret path
    - If the file contains a dict: merges the file contents into the parent dict
    - If the file contains a 'value' key: replaces the entire dict with that value

    For secretName references without an explicit secretKey, supports two
    K8s Secret creation styles:
    - Single-file (`--from-file=cred.yaml=...`): reads `cred.yaml` from the mount
    - Per-field (`--from-literal=access_key_id=... --from-literal=access_key=...`):
      reads each file in the mount directory as a key-value pair
    """
    if not isinstance(config_data, dict):
        return

    keys_to_process = list(config_data.keys())
    for key in keys_to_process:
        value = config_data[key]
        if not isinstance(value, dict):
            continue

        label = f'{parent_key}.{key}' if parent_key else key

        secret_file_path = value.get('secret_file')
        if secret_file_path:
            _resolve_single_secret(
                config_data, key, value, secret_file_path, label)
            continue

        secret_name = value.get('secretName')
        if secret_name:
            secret_dir = os.path.join(SECRETS_ROOT, secret_name)
            explicit_key = value.get('secretKey')
            if explicit_key:
                _resolve_single_secret(
                    config_data, key, value,
                    os.path.join(secret_dir, explicit_key), label)
            else:
                # Backward compatible: prefer cred.yaml if present,
                # otherwise treat the mount as --from-literal fields.
                default_path = os.path.join(secret_dir, 'cred.yaml')
                if os.path.isfile(default_path):
                    _resolve_single_secret(
                        config_data, key, value, default_path, label)
                else:
                    _resolve_secret_directory(value, secret_dir, label)
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
            # RegistryCredential.auth is the raw password/token; the worker
            # base64s `username:auth` to build the dockerconfigjson auth
            # header at pod-creation time. Source files store either
            # `password` (raw, what we want) or `auth` (already
            # base64(username:password)). Prefer password; fall back to
            # decoding auth and stripping the username prefix so we always
            # land in the model with a raw token.
            password = registry_data.get('password')
            if not password:
                password = _decode_dockerconfig_auth(
                    registry_data.get('auth', ''),
                    registry_data.get('username', ''))
            extracted = {
                'registry': registry_url,
                'username': registry_data.get('username', ''),
                'auth': password,
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


def _resolve_secret_directory(current_value: Dict[str, Any],
                              dir_path: str, path_label: str) -> None:
    """Load each file in a Secret mount directory as a credential field.

    Used when a K8s Secret was created with `--from-literal` (one file per
    field) rather than `--from-file=cred.yaml=...` (a single YAML file).
    Skips kubelet internals (`..data` symlink and the timestamped directory
    it points to) and strips trailing newlines from each value.
    """
    fields: Dict[str, str] = {}
    try:
        for entry in os.listdir(dir_path):
            if entry.startswith('..'):
                continue
            file_path = os.path.join(dir_path, entry)
            if not os.path.isfile(file_path):
                continue
            with open(file_path, encoding='utf-8') as field_file:
                fields[entry] = field_file.read().rstrip('\n')
    except OSError as error:
        logging.error('Failed to read secret directory %s for %s: %s',
                      dir_path, path_label, error)
        return

    if not fields:
        logging.error('No secret fields found in %s for %s',
                      dir_path, path_label)
        return

    current_value.pop('secret_file', None)
    current_value.pop('secretName', None)
    current_value.pop('secretKey', None)
    current_value.update(fields)
    logging.info('Loaded %d secret fields for %s from %s',
                 len(fields), path_label, dir_path)
