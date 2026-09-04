#!/usr/bin/env python3
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

Export OSMO configs from a running instance to Helm values YAML format and
verify the complete ConfigMap before the 6.4 DB-config cutover.

This script connects to an OSMO instance via its API and exports all
configuration into the unified chart's `configuration` section. SecretStr
values returned by the API are masked, so every masked path must be mapped to
an existing Kubernetes Secret rather than copied into Helm values.

Usage:
    export OSMO_URL=https://osmo.example.com
    export OSMO_TOKEN=<access-token>
    python3 export_configs_to_helm.py \
        --secret-mappings secret-mappings.yaml > my-configs.yaml

    # Or with osmo CLI auth:
    python3 export_configs_to_helm.py --url https://osmo.example.com

Environment variables:
    OSMO_URL      Base URL of the OSMO service (required)
    OSMO_TOKEN    Access token for authentication (optional if using
                  --header for custom auth)
"""

import argparse
import copy
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

import yaml

from src.service.core.config import configmap_loader

MASKED_SECRET = '**********'
SECRET_NAME_PATTERN = re.compile(
    r'^[a-z0-9]([-a-z0-9]*[a-z0-9])?'
    r'(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$')
SECRET_KEY_PATTERN = re.compile(r'^[A-Za-z0-9._-]+$')
SECRET_REFERENCE_KEYS = {'secretName', 'secretKey', 'secret_file'}
MAX_CONFIGMAP_DATA_BYTES = 1024 * 1024

RUNTIME_SECTION_NAMES = {
    'service': 'service',
    'workflow': 'workflow',
    'backends': 'backends',
    'pools': 'pools',
    'podTemplates': 'pod_templates',
    'resourceValidations': 'resource_validations',
    'groupTemplates': 'group_templates',
    'backendTests': 'backend_tests',
    'roles': 'roles',
}


def _is_valid_secret_name(value):
    return (isinstance(value, str)
            and len(value) <= 253
            and SECRET_NAME_PATTERN.fullmatch(value) is not None
            and all(len(label) <= 63 for label in value.split('.')))


# Externally owned identity material that must not be exported into config.
# service_base_url remains in the comparison because the unified chart derives
# it from externalUrl and rendered-config verification must catch a wrong URL.
SERVICE_EXCLUDED_FIELDS = {
    'service_auth',
}

# Runtime fields on backends written by the agent, not by config. Keep
# k8s_namespace: ConfigMap mode needs it for backend queue reconciliation.
BACKEND_RUNTIME_FIELDS = {
    'k8s_uid',
    'version',
    'last_heartbeat',
    'created_date',
    'online',
}

# Computed fields on pools that are derived, not configured.
POOL_COMPUTED_FIELDS = {
    'status',
    'last_heartbeat',
    'parsed_resource_validations',
    'parsed_pod_template',
    'parsed_group_templates',
}

# Computed fields on platforms within pools. These are resolved at runtime
# from template/validation name references (override_pod_template,
# resource_validations, common_pod_template, common_resource_validations).
PLATFORM_COMPUTED_FIELDS = {
    'parsed_resource_validations',
    'parsed_pod_template',
    'parsed_group_templates',
    'tolerations',
    'labels',
    'default_mounts',
}

ROLE_INTERNAL_FIELDS = {'sync_mode'}

def fetch(base_url, path, headers):
    """Fetch JSON from the OSMO API."""
    url = f'{base_url}{path}'
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http', 'https'):
        print(f'Error: URL must use http or https scheme: {url}',
              file=sys.stderr)
        return None
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as error:
        print(f'Error fetching {path}: HTTP {error.code}', file=sys.stderr)
        try:
            body = error.read().decode()
            print(f'  {body[:200]}', file=sys.stderr)
        except (OSError, UnicodeDecodeError) as read_error:
            print(f'  (Could not read error body: {read_error})',
                  file=sys.stderr)
        return None
    except urllib.error.URLError as error:
        print(f'Error connecting to {url}: {error.reason}', file=sys.stderr)
        return None


def strip_fields(data, fields):
    """Remove specified keys from a dict."""
    if not isinstance(data, dict):
        return data
    return {k: v for k, v in data.items() if k not in fields}


def export_singleton(base_url, headers, config_type, strip):
    """Export a singleton config (service or workflow)."""
    data = fetch(base_url, f'/api/configs/{config_type}', headers)
    if not isinstance(data, dict):
        return None
    data = strip_fields(data, strip)
    # Remove _configmap_mode flag if present
    data.pop('_configmap_mode', None)
    return data


def export_backends(base_url, headers):
    """Export backends, stripping runtime fields."""
    data = fetch(base_url, '/api/configs/backend', headers)
    if data is None:
        return None

    backends_list = data.get('backends', data) if isinstance(data, dict) else data
    if isinstance(backends_list, list):
        items = {}
        for backend in backends_list:
            if not isinstance(backend, dict):
                return None
            name = backend.get('name')
            if name:
                items[name] = strip_fields(
                    backend, BACKEND_RUNTIME_FIELDS | {'name'})
        return items
    return None


def strip_platform_computed_fields(pool):
    """Strip computed fields from each platform within a pool."""
    platforms = pool.get('platforms')
    if not isinstance(platforms, dict):
        return
    for platform_data in platforms.values():
        if isinstance(platform_data, dict):
            for field in PLATFORM_COMPUTED_FIELDS:
                platform_data.pop(field, None)


def export_pools(base_url, headers):
    """Export pools in editable format, stripping computed fields."""
    data = fetch(base_url, '/api/configs/pool?verbose=true', headers)
    if data is None:
        return None

    if not isinstance(data, dict):
        return None
    pools_data = data.get('pools', data)
    if isinstance(pools_data, dict):
        items = {}
        for name, pool in pools_data.items():
            if isinstance(pool, dict):
                clean = strip_fields(pool, POOL_COMPUTED_FIELDS | {'name'})
                strip_platform_computed_fields(clean)
                items[name] = clean
            elif isinstance(pool, list):
                for pool_item in pool:
                    if not isinstance(pool_item, dict):
                        return None
                    pool_name = pool_item.get('name', name)
                    clean = strip_fields(
                        pool_item, POOL_COMPUTED_FIELDS | {'name'})
                    strip_platform_computed_fields(clean)
                    items[pool_name] = clean
        return items
    return None


def export_named_configs(base_url, headers, path):
    """Export named configs (pod_templates, resource_validations, etc.)."""
    data = fetch(base_url, f'/api/configs/{path}', headers)
    if not isinstance(data, dict):
        return None
    return data


def export_roles(base_url, headers):
    """Export ConfigMap role definitions without DB synchronization state."""
    data = fetch(base_url, '/api/configs/role', headers)
    if not isinstance(data, list):
        return None
    roles = {}
    for role_config in data:
        if not isinstance(role_config, dict):
            return None
        name = role_config.get('name')
        if not isinstance(name, str) or not name:
            return None
        roles[name] = strip_fields(
            role_config, ROLE_INTERNAL_FIELDS | {'name'})
    return roles


def _walk_masked_secret_paths(value, path=()):
    """Return dotted paths whose API value is a masked SecretStr."""
    paths = []
    if isinstance(value, dict):
        for key, child in value.items():
            paths.extend(_walk_masked_secret_paths(child, (*path, str(key))))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            paths.extend(_walk_masked_secret_paths(child, (*path, str(index))))
    elif value == MASKED_SECRET:
        paths.append(path)
    return paths


def _parse_mapping_path(path):
    parts = tuple(path.split('.'))
    if not parts or any(not part for part in parts):
        raise ValueError(
            'Secret mapping path must be a non-empty dotted path.')
    return parts


def _format_mapping_path(path):
    return '.'.join(path)


def load_secret_mappings(path):
    """Load and validate operator-provided config path -> Secret mappings."""
    if not path:
        return []
    with open(path, encoding='utf-8') as mapping_file:
        payload = yaml.safe_load(mapping_file)
    entries = payload.get('secretMappings') if isinstance(payload, dict) else payload
    if not isinstance(entries, list):
        raise ValueError(
            'Secret mappings must be a list or a secretMappings list.')

    mappings = []
    seen_paths: set[tuple[str, ...]] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f'Secret mapping {index} must be an object.')
        unexpected_keys = set(entry) - {'path', 'secretName', 'secretKey'}
        if unexpected_keys:
            raise ValueError(
                f'Secret mapping {index} has unsupported keys: '
                + ', '.join(sorted(unexpected_keys)) + '.')
        path_value = entry.get('path')
        secret_name = entry.get('secretName')
        if not isinstance(path_value, str) or not path_value:
            raise ValueError(f'Secret mapping {index}.path is required.')
        if not isinstance(secret_name, str) or not secret_name:
            raise ValueError(f'Secret mapping {index}.secretName is required.')
        if not _is_valid_secret_name(secret_name):
            raise ValueError(
                f'Secret mapping {index}.secretName is not a valid '
                'Kubernetes Secret name.')
        mapping_path = _parse_mapping_path(path_value)
        for seen_path in seen_paths:
            shared_length = min(len(mapping_path), len(seen_path))
            if mapping_path[:shared_length] == seen_path[:shared_length]:
                raise ValueError(
                    'Secret mapping paths must not duplicate or overlap: '
                    f'{_format_mapping_path(seen_path)} and {path_value}.')
        seen_paths.add(mapping_path)
        secret_key = entry.get('secretKey')
        if not isinstance(secret_key, str) or not secret_key:
            raise ValueError(
                f'Secret mapping {index}.secretKey is required.')
        if (len(secret_key) > 253
                or not SECRET_KEY_PATTERN.fullmatch(secret_key)):
            raise ValueError(
                f'Secret mapping {index}.secretKey is not a valid '
                'Kubernetes Secret key.')
        reference = {'secretName': secret_name, 'secretKey': secret_key}
        mappings.append((mapping_path, reference))
    return mappings


def _validate_secret_name(secret_name, path):
    if not _is_valid_secret_name(secret_name):
        raise ValueError(
            f'{_format_mapping_path(path)}.secretName is not a valid '
            'Kubernetes Secret name.')


def _validate_secret_key(secret_key, path):
    if (not isinstance(secret_key, str)
            or len(secret_key) > 253
            or not SECRET_KEY_PATTERN.fullmatch(secret_key)):
        raise ValueError(
            f'{_format_mapping_path(path)}.secretKey is not a valid '
            'Kubernetes Secret key.')


def validate_secret_references(value, path=(), secrets_root=None):
    """Validate every final Secret reference before resolving or exporting."""
    if isinstance(value, list):
        for index, child in enumerate(value):
            validate_secret_references(
                child, (*path, str(index)), secrets_root)
        return
    if not isinstance(value, dict):
        return

    reference_keys = SECRET_REFERENCE_KEYS.intersection(value)
    is_named_reference = {'secretName', 'secretKey'}.issubset(reference_keys)
    if 'secret_file' in reference_keys:
        raise ValueError(
            f'{_format_mapping_path(path)}.secret_file is not supported for '
            'ConfigMap configuration; use secretName and secretKey.')
    if is_named_reference:
        secret_name = value['secretName']
        _validate_secret_name(secret_name, path)
        secret_key = value['secretKey']
        _validate_secret_key(secret_key, path)
        if secrets_root:
            root_path = os.path.abspath(secrets_root)
            secret_directory = os.path.abspath(
                os.path.join(root_path, secret_name))
            resolved_path = os.path.abspath(os.path.join(
                secret_directory, secret_key))
            if (os.path.commonpath((root_path, secret_directory)) != root_path
                    or os.path.commonpath(
                        (secret_directory, resolved_path)) != secret_directory):
                raise ValueError(
                    f'{_format_mapping_path(path)} resolves outside the '
                    'mounted Secret root.')

    for key, child in value.items():
        if key not in SECRET_REFERENCE_KEYS:
            validate_secret_references(
                child, (*path, str(key)), secrets_root)


def _walk_unresolved_secret_references(value, path=()):
    paths = []
    if isinstance(value, list):
        for index, child in enumerate(value):
            paths.extend(
                _walk_unresolved_secret_references(child, (*path, str(index))))
    elif isinstance(value, dict):
        reference_keys = SECRET_REFERENCE_KEYS.intersection(value)
        if ('secret_file' in reference_keys or
                {'secretName', 'secretKey'}.issubset(reference_keys)):
            paths.append(path)
        for key, child in value.items():
            paths.extend(
                _walk_unresolved_secret_references(child, (*path, str(key))))
    return paths


def _path_exists(value, path):
    current = value
    for part in path:
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif (isinstance(current, list) and part.isdigit()
              and int(part) < len(current)):
            current = current[int(part)]
        else:
            return False
    return True


def _get_parent_for_path(configs, path):
    current = configs
    for part in path[:-1]:
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit() \
                and int(part) < len(current):
            current = current[int(part)]
        else:
            raise ValueError(
                f'Secret mapping path does not exist: '
                f'{_format_mapping_path(path)}.')
    return current, path[-1]


def _remove_masked_values(value):
    if isinstance(value, dict):
        return {
            key: _remove_masked_values(child)
            for key, child in value.items()
            if child != MASKED_SECRET
        }
    if isinstance(value, list):
        return [
            _remove_masked_values(child)
            for child in value
            if child != MASKED_SECRET
        ]
    return value


def apply_secret_mappings(configs, mappings):
    """Replace masked API values with Secret references, failing on gaps."""
    masked_paths = set(_walk_masked_secret_paths(configs))
    required_resolved_paths = set(masked_paths)
    for mapping_path, reference in mappings:
        covered = {
            path for path in masked_paths
            if path[:len(mapping_path)] == mapping_path
        }
        if not covered:
            raise ValueError(
                f'Secret mapping path does not cover a masked value: '
                f'{_format_mapping_path(mapping_path)}.')

        parent, leaf = _get_parent_for_path(configs, mapping_path)
        if isinstance(parent, dict):
            target = parent[leaf]
        elif isinstance(parent, list) and leaf.isdigit() \
                and int(leaf) < len(parent):
            target = parent[int(leaf)]
        else:
            raise ValueError(
                f'Secret mapping path does not exist: '
                f'{_format_mapping_path(mapping_path)}.')

        replacement = dict(reference)
        if isinstance(target, dict):
            replacement = {**_remove_masked_values(target), **reference}
        if isinstance(parent, dict):
            parent[leaf] = replacement
        else:
            parent[int(leaf)] = replacement
        masked_paths.difference_update(covered)

    remaining_masked_paths = set(_walk_masked_secret_paths(configs))
    if remaining_masked_paths:
        formatted = ', '.join(
            _format_mapping_path(path)
            for path in sorted(remaining_masked_paths)
        )
        raise ValueError(
            'Every masked SecretStr must be externalized; missing mappings for: '
            f'{formatted}.')
    return required_resolved_paths


def to_runtime_config(configs):
    """Convert Helm section names to the keys rendered in config.yaml."""
    return {
        RUNTIME_SECTION_NAMES[key]: copy.deepcopy(value)
        for key, value in configs.items()
    }


def load_rendered_config(path):
    """Extract the unique OSMO config.yaml payload from Helm output."""
    with open(path, encoding='utf-8') as rendered_file:
        documents = list(yaml.safe_load_all(rendered_file))
    candidates = []
    for document in documents:
        if not isinstance(document, dict) or document.get('kind') != 'ConfigMap':
            continue
        metadata = document.get('metadata')
        configmap_name = (
            metadata.get('name') if isinstance(metadata, dict) else None)
        if (not isinstance(configmap_name, str)
                or not configmap_name.endswith('-api-config')):
            continue
        data = document.get('data')
        if isinstance(data, dict) and isinstance(data.get('config.yaml'), str):
            payload = data['config.yaml']
            if len(payload.encode('utf-8')) > MAX_CONFIGMAP_DATA_BYTES:
                raise ValueError(
                    'Rendered config.yaml exceeds the Kubernetes ConfigMap '
                    '1 MiB size limit.')
            candidates.append(yaml.safe_load(payload))
    if len(candidates) != 1 or not isinstance(candidates[0], dict):
        raise ValueError(
            'Rendered manifests must contain exactly one OSMO API '
            'ConfigMap named *-api-config with config.yaml.')
    return candidates[0]


def _strip_runtime_fields(runtime_config):
    normalized = copy.deepcopy(runtime_config)
    service = normalized.get('service')
    if isinstance(service, dict):
        for field in SERVICE_EXCLUDED_FIELDS:
            service.pop(field, None)
    backends = normalized.get('backends')
    if isinstance(backends, dict):
        for backend in backends.values():
            if isinstance(backend, dict):
                for field in BACKEND_RUNTIME_FIELDS:
                    backend.pop(field, None)
    pools = normalized.get('pools')
    if isinstance(pools, dict):
        for pool in pools.values():
            if isinstance(pool, dict):
                for field in POOL_COMPUTED_FIELDS:
                    pool.pop(field, None)
                strip_platform_computed_fields(pool)
    return normalized


def verify_rendered_config(
    configs, rendered_path, secrets_root, required_secret_paths=(),
):
    """Compare exported config to Helm output and run production validation."""
    expected = _strip_runtime_fields(to_runtime_config(configs))
    rendered = _strip_runtime_fields(load_rendered_config(rendered_path))
    expected_sections = set(RUNTIME_SECTION_NAMES.values())
    if set(expected) != expected_sections:
        raise ValueError(
            'Exported configuration must contain exactly the nine 6.4 '
            'runtime sections.')
    if set(rendered) != expected_sections:
        raise ValueError(
            'Rendered ConfigMap must contain exactly the nine 6.4 runtime '
            'sections.')
    if expected != rendered:
        raise ValueError(
            'Rendered ConfigMap does not match the normalized exported configuration.')
    validate_secret_references(rendered, secrets_root=secrets_root)

    resolved = copy.deepcopy(rendered)
    previous_root = configmap_loader.SECRETS_ROOT
    configmap_loader.SECRETS_ROOT = secrets_root
    try:
        for section in resolved.values():
            if isinstance(section, dict):
                configmap_loader._resolve_secret_file_references(section)  # pylint: disable=protected-access
        errors = configmap_loader.validate_configmap_snapshot(
            resolved, require_service_auth=False)
    finally:
        configmap_loader.SECRETS_ROOT = previous_root
    unresolved = _walk_unresolved_secret_references(resolved)
    if unresolved:
        formatted = ', '.join(
            _format_mapping_path(path) for path in sorted(unresolved))
        raise ValueError(
            'Mapped Secrets did not resolve completely at: ' + formatted + '.')
    missing_secret_paths = [
        path for path in required_secret_paths
        if not _path_exists(
            resolved,
            (RUNTIME_SECTION_NAMES.get(path[0], path[0]), *path[1:]),
        )
    ]
    if missing_secret_paths:
        formatted = ', '.join(
            _format_mapping_path(path)
            for path in sorted(missing_secret_paths)
        )
        raise ValueError(
            'Mapped Secrets did not provide required fields at: '
            + formatted + '.')
    if errors:
        raise ValueError(
            'Rendered ConfigMap or mapped Secrets failed production validation: '
            + '; '.join(errors))


def collect_configs(base_url, headers):
    """Fetch all nine ConfigMap-owned sections; partial export is unsafe."""
    configs = {}
    print('Exporting service config...', file=sys.stderr)
    service = export_singleton(
        base_url, headers, 'service', SERVICE_EXCLUDED_FIELDS)
    configs['service'] = service

    print('Exporting workflow config...', file=sys.stderr)
    workflow = export_singleton(base_url, headers, 'workflow', set())
    configs['workflow'] = workflow

    print('Exporting backends...', file=sys.stderr)
    configs['backends'] = export_backends(base_url, headers)

    print('Exporting pools...', file=sys.stderr)
    configs['pools'] = export_pools(base_url, headers)

    print('Exporting pod templates...', file=sys.stderr)
    configs['podTemplates'] = export_named_configs(
        base_url, headers, 'pod_template')

    print('Exporting resource validations...', file=sys.stderr)
    configs['resourceValidations'] = export_named_configs(
        base_url, headers, 'resource_validation')

    print('Exporting group templates...', file=sys.stderr)
    configs['groupTemplates'] = export_named_configs(
        base_url, headers, 'group_template')

    print('Exporting backend tests...', file=sys.stderr)
    configs['backendTests'] = export_named_configs(
        base_url, headers, 'backend_test')

    print('Exporting roles...', file=sys.stderr)
    configs['roles'] = export_roles(base_url, headers)

    failed_sections = [key for key, value in configs.items() if value is None]
    if failed_sections:
        raise ValueError(
            'Refusing partial export; failed sections: '
            + ', '.join(failed_sections) + '.')
    return configs


def build_helm_values(configs, chart, mapped_secret_names):
    """Build unified values by default, with explicit 6.3 legacy output."""
    secret_refs = [
        {'secretName': name} for name in sorted(set(mapped_secret_names))
    ]
    if chart == 'legacy':
        managed = {
            'enabled': True,
            **({'secretRefs': secret_refs} if secret_refs else {}),
            **configs,
        }
        return {'services': {'configs': managed}}
    return {
        'configuration': {
            'enabled': True,
            **({'secretRefs': secret_refs} if secret_refs else {}),
            'snapshot': configs,
        },
    }


def main():
    parser = argparse.ArgumentParser(
        description='Export and verify OSMO ConfigMap configuration.',
        epilog='Unified-chart output is emitted under configuration.',
    )
    parser.add_argument(
        '--url', default=os.environ.get('OSMO_URL', ''),
        help='OSMO service base URL (or set OSMO_URL env var)')
    parser.add_argument(
        '--token', default=os.environ.get('OSMO_TOKEN', ''),
        help='Access token (or set OSMO_TOKEN env var)')
    parser.add_argument(
        '--header', action='append', default=[],
        help='Custom header (e.g., "x-osmo-user: admin"). Can be repeated.')
    parser.add_argument(
        '--chart', choices=('unified', 'legacy'), default='unified',
        help='Output schema. legacy is for the DB-compatible 6.3 chart only.')
    parser.add_argument(
        '--secret-mappings', default='',
        help='YAML mappings from masked config paths to existing Secrets.')
    parser.add_argument(
        '--verify-rendered', default='', metavar='HELM_MANIFESTS',
        help='Verify a rendered unified-chart manifest against the live export.')
    parser.add_argument(
        '--secrets-root', default='',
        help='Root containing mounted Secret directories for verification.')
    args = parser.parse_args()

    if not args.url:
        parser.error('OSMO_URL or --url is required')
    if args.verify_rendered and args.chart != 'unified':
        parser.error('--verify-rendered supports only --chart unified')
    if args.verify_rendered and not args.secrets_root:
        parser.error('--secrets-root is required with --verify-rendered')

    base_url = args.url.rstrip('/')
    headers = {}
    if args.token:
        headers['Authorization'] = f'Bearer {args.token}'
    for header in args.header:
        key, separator, value = header.partition(':')
        if not separator or not key.strip():
            parser.error(f'Invalid --header value: {header!r}')
        headers[key.strip()] = value.strip()

    print(f'# Exported from {base_url}', file=sys.stderr)
    target = 'configuration' if args.chart == 'unified' else 'services.configs'
    print(f'# Generated Helm values contain {target}.\n', file=sys.stderr)

    try:
        configs = collect_configs(base_url, headers)
        mappings = load_secret_mappings(args.secret_mappings)
        required_secret_paths = apply_secret_mappings(configs, mappings)
        validate_secret_references(configs)
        if args.verify_rendered:
            verify_rendered_config(
                configs, args.verify_rendered, args.secrets_root,
                required_secret_paths)
            print('ConfigMap verification passed.', file=sys.stderr)
    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 2

    mapped_secret_names = [
        reference['secretName'] for _, reference in mappings
    ]
    output = build_helm_values(
        configs, args.chart, mapped_secret_names=mapped_secret_names)

    yaml.dump(output, sys.stdout, default_flow_style=False, sort_keys=False)

    print(f'\nExported {len(configs)} config sections.', file=sys.stderr)
    secret_refs = output[target.split('.', maxsplit=1)[0]]
    if args.chart == 'legacy':
        secret_refs = secret_refs['configs']
    secret_refs = secret_refs.get('secretRefs', [])
    if secret_refs:
        secret_names = [secret_ref['secretName'] for secret_ref in secret_refs]
        print(f'Found {len(secret_refs)} secret references: '
              f'{secret_names}', file=sys.stderr)
        print('Ensure these K8s Secrets exist in your namespace.',
              file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
