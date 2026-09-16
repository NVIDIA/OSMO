#!/usr/bin/env python3
"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

Convert legacy deployments/charts/service values to unified-chart values.

The converter is deliberately strict. It emits no YAML when a setting cannot
be translated without operator input, unless --allow-partial is supplied.
Diagnostics never include values, which makes the report suitable for CI logs.
"""

import argparse
import copy
import dataclasses
import pathlib
import sys
from typing import Any, Callable, Sequence
import urllib.parse

import yaml


MISSING = object()
YamlObject = dict[str, Any]


@dataclasses.dataclass(frozen=True)
class ConversionIssue:
    """One legacy setting that needs operator attention."""

    path: str
    message: str


@dataclasses.dataclass(frozen=True)
class ConversionResult:
    """Converted values and all non-lossless conversion findings."""

    values: YamlObject
    issues: list[ConversionIssue]


def _deep_merge(base: Any, override: Any) -> Any:
    """Apply Helm's map-merge/list-replace behavior."""
    if isinstance(base, dict) and isinstance(override, dict):
        result = copy.deepcopy(base)
        for key, value in override.items():
            if key in result:
                result[key] = _deep_merge(result[key], value)
            else:
                result[key] = copy.deepcopy(value)
        return result
    return copy.deepcopy(override)


def _pop(source: YamlObject, path: str) -> Any:
    keys = path.split('.')
    current: Any = source
    for key in keys[:-1]:
        if not isinstance(current, dict) or key not in current:
            return MISSING
        current = current[key]
    if not isinstance(current, dict):
        return MISSING
    return current.pop(keys[-1], MISSING)


def _set(destination: YamlObject, path: str, value: Any) -> None:
    keys = path.split('.')
    current = destination
    for key in keys[:-1]:
        child = current.setdefault(key, {})
        if not isinstance(child, dict):
            raise ValueError(f'cannot merge converted value at {path}')
        current = child
    current[keys[-1]] = copy.deepcopy(value)


def _move(source: YamlObject, destination: YamlObject, old_path: str,
          new_path: str,
          transform: Callable[[Any], Any] | None = None) -> Any:
    value = _pop(source, old_path)
    if value is MISSING:
        return MISSING
    _set(destination, new_path, transform(value) if transform else value)
    return value


def _prune_empty(value: Any) -> Any:
    if isinstance(value, dict):
        result = {
            key: _prune_empty(child)
            for key, child in value.items()
        }
        return {key: child for key, child in result.items() if child != {}}
    return value


def _leaf_paths(value: Any, prefix: str = '') -> list[str]:
    if isinstance(value, dict):
        paths: list[str] = []
        for key, child in value.items():
            child_prefix = f'{prefix}.{key}' if prefix else str(key)
            paths.extend(_leaf_paths(child, child_prefix))
        return paths
    if isinstance(value, list):
        return [f'{prefix}[]']
    return [prefix]


def _image(value: Any) -> YamlObject:
    if not isinstance(value, str) or not value:
        raise ValueError('image reference must be a non-empty string')
    reference = value
    digest = ''
    if '@' in reference:
        reference, digest = reference.rsplit('@', 1)
    tag = ''
    slash = reference.rfind('/')
    colon = reference.rfind(':')
    if colon > slash:
        reference, tag = reference[:colon], reference[colon + 1:]
    parts = reference.split('/')
    result: YamlObject = {}
    if len(parts) > 1 and ('.' in parts[0] or ':' in parts[0]
                           or parts[0] == 'localhost'):
        result['registry'] = parts.pop(0)
    else:
        # Legacy full-image fields use Docker's unqualified-name semantics.
        # Set this explicitly so the unified image helper does not inherit
        # the OSMO image registry for third-party images.
        result['registry'] = 'docker.io'
    result['repository'] = '/'.join(parts)
    if tag:
        result['tag'] = tag
    if digest:
        result['digest'] = digest
    return result


def _repository(value: Any) -> tuple[str, str]:
    image = _image(str(value))
    registry = image.get('registry', '')
    repository = image['repository']
    return registry, repository


def _autoscaling(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    result = copy.deepcopy(value)
    if 'hpaTarget' in result:
        result['hpaCpuTarget'] = result.pop('hpaTarget')
    return result


def _probe(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    probe = copy.deepcopy(value)
    enabled = probe.pop('enabled', True)
    return {'enabled': enabled, 'spec': probe}


def _service_account(value: Any) -> YamlObject:
    return {
        'name': value,
        'create': False,
    }


def _component(source: YamlObject, destination: YamlObject,
               old_name: str, new_name: str,
               direct_fields: Sequence[str] = ()) -> None:
    old_root = f'services.{old_name}'
    new_root = f'services.{new_name}'
    common_direct = (
        'enabled', 'replicas', 'resources', 'extraArgs', 'extraVolumeMounts',
        'envFrom', 'extraPorts', 'command', 'args', 'containerPort',
        'maxHttpHeaderSizeKb', 'portForwardEnabled', 'nextjsSslEnabled',
        'docsBaseUrl', 'cliInstallScriptUrl', 'apiHostname',
        'webserverEnabled', 'disableTaskMetrics', 'clientInstallUrl', 'envoy',
        'resourceUrl', 'requestTimeoutSeconds', 'authorizationServers',
        'scopes', 'allowedOrigins', 'grpcPort', 'httpPort', 'metricsPort',
        'provider', 'oidcIssuerUrl', 'clientId', 'cookieName', 'cookieSecure',
        'cookieDomain', 'cookieExpire', 'cookieRefresh', 'scope',
        'passAccessToken', 'redisSessionStore', 'cache', 'postgres', 'config',
    )
    for field in dict.fromkeys((*common_direct, *direct_fields)):
        _move(source, destination, f'{old_root}.{field}',
              f'{new_root}.{field}')
    _move(source, destination, f'{old_root}.scaling',
          f'{new_root}.autoscaling', _autoscaling)
    for old_field, new_field in (
            ('nodeSelector', 'pod.nodeSelector'),
            ('tolerations', 'pod.tolerations'),
            ('topologySpreadConstraints', 'pod.topologySpreadConstraints'),
            ('hostAliases', 'pod.hostAliases'),
            ('extraPodAnnotations', 'pod.annotations'),
            ('extraPodLabels', 'pod.labels'),
            ('podLabels', 'pod.labels'),
            ('extraVolumes', 'pod.extraVolumes'),
            ('extraContainers', 'pod.extraContainers'),
            ('extraSidecars', 'pod.extraContainers'),
            ('initContainers', 'pod.initContainers'),
            ('securityContext', 'pod.containerSecurityContext'),
            ('extraEnv', 'extraEnv'),
            ('extraEnvs', 'extraEnv'),
    ):
        _move(source, destination, f'{old_root}.{old_field}',
              f'{new_root}.{new_field}')
    _move(source, destination, f'{old_root}.serviceAccountName',
          f'{new_root}.serviceAccount', _service_account)
    for probe_name in ('livenessProbe', 'readinessProbe', 'startupProbe'):
        _move(source, destination, f'{old_root}.{probe_name}',
              f'{new_root}.{probe_name}', _probe)
    image_name = _pop(source, f'{old_root}.imageName')
    if image_name is not MISSING:
        _set(destination, f'{new_root}.image.name', image_name)
    _move(source, destination, f'{old_root}.imageTag',
          f'{new_root}.image.tag')
    _move(source, destination, f'{old_root}.imagePullPolicy',
          f'{new_root}.image.pullPolicy')


class _Converter:
    """Stateful implementation used by convert_values."""

    def __init__(self, values: YamlObject):
        self.source = copy.deepcopy(values)
        self.output: YamlObject = {
            'planes': {
                'control': {'enabled': True},
                'compute': {'enabled': False},
            },
            'embeddedDependencies': {
                'dex': {'enabled': False},
                'postgresql': {'enabled': False},
                'valkey': {'enabled': False},
                'objectStorage': {'enabled': False},
            },
            'authentication': {
                'provider': 'externalOidc',
                'bootstrap': {
                    'identities': {
                        'admin': {'enabled': False},
                        'backend-operator-default': {'enabled': False},
                    },
                },
            },
            # The legacy chart hard-codes the osmo-* resource prefix. The
            # control profile clears this value, so restore it explicitly.
            'fullnameOverride': 'osmo',
            # The service chart defaults Redis TLS on. The unified profile
            # defaults it off and additionally requires an explicit CA Secret.
            'externalDependencies': {
                'valkey': {'tls': {'enabled': True}},
            },
            'configuration': {
                # This template is new in the unified defaults. Suppress it
                # so converting a legacy override does not add configuration.
                'podTemplates': {'default_gpu_user': None},
            },
            'secrets': {
                'valkey': {'generate': False},
                # Existing releases must preserve their signing identity.
                'serviceAuth': {
                    'managementMode': 'external',
                    'bootstrap': {'enabled': False},
                },
            },
        }
        self.issues: list[ConversionIssue] = []
        self.service_account_create = True

    def issue(self, path: str, message: str) -> None:
        self.issues.append(ConversionIssue(path, message))

    def unsupported(self, path: str, message: str) -> None:
        value = _pop(self.source, path)
        if value is MISSING:
            return
        if isinstance(value, (dict, list)) and not value:
            return
        self.issue(path, message)

    def convert_global(self) -> None:
        location = _pop(self.source, 'global.osmoImageLocation')
        if location is not MISSING:
            try:
                registry, repository = _repository(location)
                if registry:
                    _set(self.output, 'imageRegistry', registry)
                _set(self.output, 'imageRepository', repository)
            except ValueError as error:
                self.issue('global.osmoImageLocation', str(error))
        _move(self.source, self.output, 'global.osmoImageTag', 'imageTag')
        image_pull_secret = _pop(self.source, 'global.imagePullSecret')
        if image_pull_secret is not MISSING:
            _set(self.output, 'imagePullSecrets',
                 [{'name': image_pull_secret}] if image_pull_secret else [])
        _move(self.source, self.output, 'global.nodeSelector',
              'podDefaults.nodeSelector')
        _move(self.source, self.output, 'global.logs', 'logging')
        hostname = _pop(self.source, 'global.hostname')
        if hostname is not MISSING and hostname:
            external_url = (hostname if '://' in hostname
                            else f'https://{hostname}')
            _set(self.output, 'externalUrl', external_url)
            _set(self.output, 'ingress.hostname',
                 external_url.split('://', 1)[-1].rstrip('/'))
        common_account = _pop(self.source, 'global.serviceAccountName')
        if common_account is MISSING:
            common_account = 'osmo'
        if common_account:
            for component in (
                    'mcp', 'ui', 'delayedJobMonitor', 'worker', 'api',
                    'router', 'logger', 'agent'):
                _set(self.output, f'services.{component}.serviceAccount',
                     _service_account(common_account))
            for component in ('envoy', 'oauth2Proxy', 'authz', 'rateLimit'):
                _set(self.output, f'gateway.{component}.serviceAccount',
                     _service_account(common_account))
            # The legacy chart owns one shared ServiceAccount. Render it once
            # through the API component so a deployment-controller prune
            # cannot delete it while every other component still references it.
            _set(self.output, 'services.api.serviceAccount.create', True)
        legacy_account = _pop(self.source, 'serviceAccount')
        if isinstance(legacy_account, dict):
            name = legacy_account.pop('name', '')
            if name:
                for component in (
                        'mcp', 'ui', 'delayedJobMonitor', 'worker', 'api',
                        'router', 'logger', 'agent'):
                    _set(self.output, f'services.{component}.serviceAccount.name',
                         name)
                for component in ('envoy', 'oauth2Proxy', 'authz', 'rateLimit'):
                    _set(self.output,
                         f'gateway.{component}.serviceAccount.name', name)
            if 'create' in legacy_account:
                self.service_account_create = legacy_account.pop('create')
                _set(self.output, 'services.api.serviceAccount.create',
                     self.service_account_create)
            if 'annotations' in legacy_account:
                _set(self.output, 'services.api.serviceAccount.annotations',
                     legacy_account.pop('annotations'))
            for path in _leaf_paths(legacy_account, 'serviceAccount'):
                self.issue(path, 'no unified-chart mapping')

    def convert_dependencies(self) -> None:
        postgres_enabled = _pop(self.source, 'services.postgres.enabled')
        if postgres_enabled is True:
            self.issue(
                'services.postgres.enabled',
                'legacy in-chart PostgreSQL cannot be upgraded in place to '
                'embedded CloudNativePG; migrate or externalize its data and '
                'configure the destination manually')
        elif postgres_enabled not in (MISSING, False):
            self.issue('services.postgres.enabled', 'expected a boolean')
        _move(self.source, self.output, 'services.postgres.serviceName',
              'externalDependencies.postgresql.host')
        _move(self.source, self.output, 'services.postgres.port',
              'externalDependencies.postgresql.port')
        _move(self.source, self.output, 'services.postgres.db',
              'externalDependencies.postgresql.database')
        _move(self.source, self.output, 'services.postgres.user',
              'externalDependencies.postgresql.username')
        _move(self.source, self.output, 'services.postgres.passwordSecretName',
              'secrets.postgresql.existingSecret')
        _move(self.source, self.output, 'services.postgres.passwordSecretKey',
              'secrets.postgresql.keys.password')
        if postgres_enabled is False and _pop(
                self.source, 'services.postgres.password') is not MISSING:
            self.issue('services.postgres.password',
                       'inline database passwords are not converted; create a '
                       'Kubernetes Secret and set secrets.postgresql')

        valkey_enabled = _pop(self.source, 'services.redis.enabled')
        if valkey_enabled is True:
            self.issue(
                'services.redis.enabled',
                'legacy in-chart Redis cannot be upgraded in place to '
                'embedded Valkey; migrate or externalize its data and '
                'configure the destination manually')
        elif valkey_enabled not in (MISSING, False):
            self.issue('services.redis.enabled', 'expected a boolean')
        _move(self.source, self.output, 'services.redis.serviceName',
              'externalDependencies.valkey.host')
        _move(self.source, self.output, 'services.redis.port',
              'externalDependencies.valkey.port')
        _move(self.source, self.output, 'services.redis.dbNumber',
              'externalDependencies.valkey.database')
        _move(self.source, self.output, 'services.redis.tlsEnabled',
              'externalDependencies.valkey.tls.enabled')
        _move(self.source, self.output, 'services.redis.passwordSecretName',
              'secrets.valkey.existingSecret')
        _move(self.source, self.output, 'services.redis.passwordSecretKey',
              'secrets.valkey.keys.password')

        localstack_enabled = _pop(self.source, 'services.localstackS3.enabled')
        if localstack_enabled is not MISSING:
            _set(self.output, 'embeddedDependencies.objectStorage.enabled',
                 False)
            if localstack_enabled:
                self.issue('services.localstackS3.enabled',
                           'LocalStack has no unified-chart equivalent; '
                           'choose external storage or embedded RustFS')
        self.unsupported(
            'services.localstackS3',
            'LocalStack settings cannot be translated to RustFS losslessly')

        if postgres_enabled is not True and not _get(
                self.output, 'secrets.postgresql.existingSecret'):
            self.issue('secrets.postgresql.existingSecret',
                       'required for external PostgreSQL; the legacy values '
                       'do not identify a compatible Kubernetes Secret')
        if valkey_enabled is not True and not _get(
                self.output, 'secrets.valkey.existingSecret'):
            self.issue('secrets.valkey.existingSecret',
                       'required for external Valkey; the legacy values do '
                       'not identify a compatible Kubernetes Secret')
    def convert_configuration(self) -> None:
        configs = _pop(self.source, 'services.configs')
        if configs is not MISSING:
            if not isinstance(configs, dict):
                self.issue('services.configs', 'expected a mapping')
            else:
                configs = copy.deepcopy(configs)
                for key in (
                        'enabled', 'extraAnnotations', 'service', 'workflow',
                        'podTemplates', 'resourceValidations', 'roles',
                        'backends', 'pools', 'backendTests', 'groupTemplates'):
                    if key in configs:
                        converted_config = configs.pop(key)
                        if (key == 'podTemplates'
                                and isinstance(converted_config, dict)
                                and 'default_gpu_user' not in converted_config):
                            converted_config['default_gpu_user'] = None
                        _set(self.output, f'configuration.{key}',
                             converted_config)
                if configs.pop('secretRefs', []):
                    self.issue(
                        'services.configs.secretRefs',
                        'arbitrary configuration Secret mounts are not '
                        'supported; migrate storage credentials to '
                        'secrets.objectStorage and review other references')
                if 'dataset' in configs:
                    configs.pop('dataset')
                    self.issue('services.configs.dataset',
                               'dataset configuration is not rendered by the '
                               'unified chart')
                for path in _leaf_paths(configs, 'services.configs'):
                    self.issue(path, 'no unified-chart mapping')
        _move(self.source, self.output, 'extraConfigMaps',
              'configuration.extraConfigMaps')
        self._convert_storage_configuration()

    def _convert_storage_configuration(self) -> None:
        workflow = _get(self.output, 'configuration.workflow')
        if not isinstance(workflow, dict):
            self.issue('externalDependencies.objectStorage.locations',
                       'required object-storage locations are not present in '
                       'the legacy values')
            return
        credentials: dict[str, Any] = {}
        _set(self.output, 'embeddedDependencies.objectStorage.enabled', False)
        _set(self.output, 'secrets.objectStorage.generate', False)
        for old_name, new_name in (
                ('workflow_data', 'workflows'),
                ('workflow_log', 'logs'),
                ('workflow_app', 'apps')):
            section = workflow.pop(old_name, MISSING)
            if section is MISSING:
                self.issue(f'configuration.workflow.{old_name}',
                           'required to derive an object-storage location')
                continue
            if not isinstance(section, dict):
                self.issue(f'configuration.workflow.{old_name}',
                           'expected a mapping')
                continue
            credential = section.pop('credential', MISSING)
            if section:
                _set(self.output,
                     f'configuration.workflow.{old_name}', section)
            if not isinstance(credential, dict):
                self.issue(f'configuration.workflow.{old_name}.credential',
                           'expected a mapping')
                continue
            credentials[new_name] = credential
            endpoint = credential.get('endpoint')
            if endpoint:
                _set(self.output,
                     f'externalDependencies.objectStorage.locations.{new_name}',
                     endpoint)
            secret_name = credential.get('secretName')
            if secret_name:
                _set(
                    self.output,
                    f'secrets.objectStorage.credentialSecretRefs.{new_name}',
                    {'name': secret_name, 'key': 'credential.json'})
            supported_credential_keys = {
                'endpoint', 'secretName', 'region', 'override_url',
            }
            residual = {
                key: value for key, value in credential.items()
                if key not in supported_credential_keys
            }
            for path in _leaf_paths(
                    residual,
                    f'configuration.workflow.{old_name}.credential'):
                self.issue(
                    path,
                    'inline or unsupported credential data is not converted; '
                    'move it to a Kubernetes Secret and reference it with '
                    'secretName')
        has_all_secret_references = (
            len(credentials) == 3
            and all(credential.get('secretName')
                    for credential in credentials.values()))
        if not has_all_secret_references:
            for old_name, new_name in (
                    ('workflow_data', 'workflows'),
                    ('workflow_log', 'logs'),
                    ('workflow_app', 'apps')):
                credential = credentials.get(new_name)
                if isinstance(credential, dict) and not credential.get(
                        'endpoint'):
                    self.issue(
                        f'configuration.workflow.{old_name}.credential.endpoint',
                        'endpoint is absent and all three per-location Secret '
                        'references are not configured')
        endpoints = [credential.get('endpoint', '')
                     for credential in credentials.values()]
        schemes = {str(endpoint).split('://', 1)[0]
                   for endpoint in endpoints if endpoint}
        if schemes and not schemes <= {'s3', 'azure', 'swift'}:
            scheme_list = ', '.join(sorted(schemes))
            self.issue('externalDependencies.objectStorage.locations',
                       'the unified chart supports only s3://, azure://, or '
                       'swift://; '
                       f'found {scheme_list}')
        static_credential_keys = {
            'access_key', 'access_key_id', 'account_key', 'secret_access_key',
            'secretName', 'secret_key', 'token',
        }
        uses_static_credentials = any(
            static_credential_keys.intersection(credential)
            for credential in credentials.values())
        _set(self.output,
             'externalDependencies.objectStorage.authentication.type',
             'static' if uses_static_credentials else 'sdkDefault')
        if not uses_static_credentials:
            _set(self.output, 'secrets.objectStorage.existingSecret', '')
        if schemes == {'s3'}:
            for old_key, new_path in (
                    ('region', 'externalDependencies.objectStorage.s3.region'),
                    ('override_url',
                     'externalDependencies.objectStorage.s3.overrideUrl')):
                values = {
                    credential.get(old_key)
                    for credential in credentials.values()
                    if credential.get(old_key) not in (None, '')
                }
                if len(values) == 1:
                    _set(self.output, new_path, values.pop())
                elif len(values) > 1:
                    self.issue(
                        f'configuration.workflow.*.credential.{old_key}',
                        'values differ between storage locations')

    def convert_authentication(self) -> None:
        auth = _pop(self.source, 'services.service.auth')
        if not isinstance(auth, dict):
            self.issue('services.service.auth',
                       'required to configure 6.4 external OIDC')
            return
        auth = copy.deepcopy(auth)
        if auth.pop('enabled', False) is not True:
            self.issue('services.service.auth.enabled',
                       '6.4 control-plane authentication is mandatory')

        oauth_root = 'gateway.oauth2Proxy'
        provider = _pop(self.source, f'{oauth_root}.provider')
        if provider not in (MISSING, 'oidc'):
            self.issue(f'{oauth_root}.provider',
                       '6.4 external authentication requires OIDC')
        issuer = _pop(self.source, f'{oauth_root}.oidcIssuerUrl')
        oauth_client_id = _pop(self.source, f'{oauth_root}.clientId')
        browser_client_id = auth.pop('browser_client_id', MISSING)
        if (oauth_client_id is not MISSING
                and browser_client_id is not MISSING
                and oauth_client_id != browser_client_id):
            self.issue(f'{oauth_root}.clientId',
                       'does not match services.service.auth.browser_client_id')
        if browser_client_id is MISSING:
            browser_client_id = oauth_client_id

        external: YamlObject = {
            'issuer': '' if issuer is MISSING else issuer,
            'browserClientId': (
                '' if browser_client_id is MISSING else browser_client_id),
            'cliClientId': auth.pop('device_client_id', ''),
            'authorizationEndpoint': auth.pop('browser_endpoint', ''),
            'tokenEndpoint': auth.pop('token_endpoint', ''),
            'deviceEndpoint': auth.pop('device_endpoint', ''),
            'logoutEndpoint': auth.pop('logout_endpoint', ''),
            'rolesClaim': 'roles',
        }
        for path in _leaf_paths(auth, 'services.service.auth'):
            self.issue(path, 'no 6.4 authentication mapping')

        scope = _pop(self.source, f'{oauth_root}.scope')
        if scope is MISSING:
            scope = 'openid email profile'
        if isinstance(scope, str):
            external['scopes'] = scope.split()
            _set(self.output, f'{oauth_root}.scope', scope)
        else:
            self.issue(f'{oauth_root}.scope',
                       'expected a space-separated string')

        jwt = _pop(self.source, 'gateway.envoy.jwt')
        matching_providers: list[YamlObject] = []
        remaining_providers: list[Any] = []
        if isinstance(jwt, dict):
            jwt = copy.deepcopy(jwt)
            user_header = jwt.pop('user_header', jwt.pop('userHeader', MISSING))
            if user_header not in (MISSING, 'x-osmo-user'):
                self.issue('gateway.envoy.jwt.user_header',
                           '6.4 fixes the user header to x-osmo-user')
            providers = jwt.pop('providers', [])
            if isinstance(providers, list):
                for candidate in providers:
                    audience = candidate.get('audience') if isinstance(
                        candidate, dict) else None
                    if (isinstance(candidate, dict)
                            and isinstance(issuer, str)
                            and candidate.get('issuer', '').rstrip('/')
                            == issuer.rstrip('/')
                            and audience in {
                                external['browserClientId'],
                                external['cliClientId'],
                            }):
                        matching_providers.append(candidate)
                    else:
                        if (isinstance(candidate, dict)
                                and candidate.get('cluster')
                                == 'osmo-service-jwks'):
                            jwks_uri = candidate.get('jwks_uri')
                            if isinstance(jwks_uri, str):
                                parsed_uri = urllib.parse.urlsplit(jwks_uri)
                                if parsed_uri.path == '/api/auth/keys':
                                    candidate['cluster'] = 'osmo-api-jwks'
                                    if (isinstance(parsed_uri.hostname, str)
                                            and (parsed_uri.hostname
                                                 == 'osmo-service'
                                                 or parsed_uri.hostname.startswith(
                                                     'osmo-service.'))):
                                        candidate['jwks_uri'] = jwks_uri.replace(
                                            'osmo-service', 'osmo-api', 1)
                        remaining_providers.append(candidate)
            else:
                self.issue('gateway.envoy.jwt.providers', 'expected a list')
            for path in _leaf_paths(jwt, 'gateway.envoy.jwt'):
                self.issue(path, 'no 6.4 authentication mapping')
        elif jwt is not MISSING:
            self.issue('gateway.envoy.jwt', 'expected a mapping')

        if matching_providers:
            jwks_values = {item.get('jwks_uri') for item in matching_providers}
            user_claims = {item.get('user_claim') for item in matching_providers}
            roles_claims = {
                item.get('roles_claim', 'roles')
                for item in matching_providers
            }
            if len(jwks_values) == len(user_claims) == len(roles_claims) == 1:
                external['jwksUri'] = jwks_values.pop()
                external['userClaim'] = user_claims.pop()
                external['rolesClaim'] = roles_claims.pop()
            else:
                self.issue('gateway.envoy.jwt.providers',
                           'matching OIDC providers disagree on claims or JWKS')
        else:
            self.issue('gateway.envoy.jwt.providers',
                       'no provider matches the OIDC issuer and client IDs')
        if remaining_providers:
            _set(self.output, 'gateway.envoy.jwt.providers',
                 remaining_providers)
        if isinstance(external.get('jwksUri'), str):
            external['jwksHost'] = urllib.parse.urlsplit(
                external['jwksUri']).hostname or ''

        extra_skip_paths = _pop(
            self.source, 'gateway.envoy.extraSkipAuthPaths')
        if isinstance(extra_skip_paths, list):
            if any(path not in ('/cli', '/pypi') for path in extra_skip_paths):
                self.issue('gateway.envoy.extraSkipAuthPaths',
                           '6.4 authentication bypass paths are chart-managed')
        elif extra_skip_paths is not MISSING:
            self.issue('gateway.envoy.extraSkipAuthPaths', 'expected a list')

        use_kubernetes_secrets = _pop(
            self.source, f'{oauth_root}.useKubernetesSecrets')
        secret_name = _pop(self.source, f'{oauth_root}.secretName')
        client_key = _pop(self.source, f'{oauth_root}.clientSecretKey')
        cookie_key = _pop(self.source, f'{oauth_root}.cookieSecretKey')
        secret_paths = _pop(self.source, f'{oauth_root}.secretPaths')
        if use_kubernetes_secrets is True:
            if secret_name is MISSING:
                secret_name = 'oauth2-proxy-secrets'
            external['browserClientSecret'] = {
                'existingSecret': secret_name,
                'key': ('client_secret' if client_key is MISSING
                        else client_key),
            }
            external['cookieSecret'] = {
                'existingSecret': secret_name,
                'key': ('cookie_secret' if cookie_key is MISSING
                        else cookie_key),
            }
        else:
            if secret_paths not in (MISSING, None, {}):
                self.issue(
                    f'{oauth_root}.secretPaths',
                    'file paths cannot be converted to Kubernetes Secret '
                    'references; configure authentication.externalOidc')
            self.issue('authentication.externalOidc.browserClientSecret',
                       'existing Kubernetes Secret reference is required')
            self.issue('authentication.externalOidc.cookieSecret',
                       'existing Kubernetes Secret reference is required')
        for field in (
                'issuer', 'browserClientId', 'cliClientId',
                'authorizationEndpoint', 'tokenEndpoint', 'deviceEndpoint',
                'jwksUri', 'jwksHost', 'userClaim', 'rolesClaim', 'scopes',
                'logoutEndpoint'):
            if external.get(field) in (None, '', []):
                self.issue(f'authentication.externalOidc.{field}',
                           'required value is missing from legacy OIDC values')
        _set(self.output, 'authentication.externalOidc', external)

    def convert_services(self) -> None:
        for old_name, new_name in (
                ('mcp', 'mcp'), ('ui', 'ui'),
                ('delayedJobMonitor', 'delayedJobMonitor'),
                ('worker', 'worker'), ('service', 'api'),
                ('router', 'router'), ('logger', 'logger'), ('agent', 'agent')):
            _component(self.source, self.output, old_name, new_name)
        for component in ('worker', 'api', 'router', 'logger', 'agent'):
            autoscaling = _get(
                self.output, f'services.{component}.autoscaling')
            if (not isinstance(autoscaling, dict)
                    or 'enabled' not in autoscaling):
                _set(self.output,
                     f'services.{component}.autoscaling.enabled', True)
        _set(self.output, 'services.api.serviceAccount.create',
             self.service_account_create)
        for component in ('worker', 'api', 'router', 'logger'):
            _set(self.output,
                 f'services.{component}.podDisruptionBudget.enabled', False)
        self.unsupported(
            'services.service.ingress',
            'the API-specific Ingress was removed; configure the root ingress')
        self.unsupported(
            'services.mcp.oidcProxy',
            'the unified chart does not include the legacy MCP OIDC proxy')
        self._convert_database_migration()
        self.unsupported(
            'services.configFile',
            'an injected whole-service config file cannot be translated; use '
            'configuration and explicit Secret values')

    def _convert_database_migration(self) -> None:
        migration = _pop(self.source, 'services.migration')
        if migration is MISSING:
            return
        if not isinstance(migration, dict):
            self.issue('services.migration', 'expected a mapping')
            return
        migration = copy.deepcopy(migration)
        for field in ('enabled', 'targetSchema', 'pgrollVersion', 'resources'):
            if field in migration:
                _set(self.output, f'databaseMigration.{field}',
                     migration.pop(field))
        image = migration.pop('image', MISSING)
        if image is not MISSING:
            try:
                _set(self.output, 'databaseMigration.image', _image(image))
            except ValueError as error:
                self.issue('services.migration.image', str(error))
        for field in ('nodeSelector', 'tolerations'):
            if field in migration:
                _set(self.output, f'databaseMigration.pod.{field}',
                     migration.pop(field))
        for field in (
                'serviceAccountName', 'extraAnnotations',
                'extraPodAnnotations', 'extraEnv', 'extraVolumeMounts',
                'extraVolumes', 'initContainers'):
            value = migration.pop(field, MISSING)
            if value is MISSING or value in ('', [], {}):
                continue
            for path in _leaf_paths(value, f'services.migration.{field}'):
                self.issue(
                    path,
                    'not converted; review against the unified migration Job '
                    'and configure an environment-specific override if needed')
        for path in _leaf_paths(migration, 'services.migration'):
            self.issue(path, 'no unified-chart mapping')

    def convert_secrets(self) -> None:
        master_key = _pop(self.source, 'services.masterEncryptionKey')
        if master_key is MISSING:
            master_key = {
                'managementMode': 'external',
                'existingSecret': {'name': 'osmo-mek', 'key': 'mek.yaml'},
                'bootstrap': {'enabled': False},
            }
        _set(self.output, 'secrets.masterEncryptionKey', master_key)
        backend_tokens = _pop(self.source, 'services.backendApiTokens')
        if isinstance(backend_tokens, dict):
            converted = copy.deepcopy(backend_tokens)
            enabled = converted.pop('enabled', False)
            converted.pop('bootstrap', None)
            if converted.pop('rolloutNonce', ''):
                self.issue('services.backendApiTokens.rolloutNonce',
                           'has no 6.4 bootstrap-identity equivalent')
            credentials = converted.pop('credentials', [])
            tokens: YamlObject = {}
            if enabled and isinstance(credentials, list):
                for index, credential in enumerate(credentials):
                    if not isinstance(credential, dict):
                        self.issue(
                            f'services.backendApiTokens.credentials[{index}]',
                            'expected a mapping')
                        continue
                    credential = copy.deepcopy(credential)
                    name = credential.pop('name', '')
                    if 'secretName' in credential:
                        credential['existingSecret'] = {
                            'name': credential.pop('secretName')}
                    if name and len(credential) == 1:
                        tokens[name] = credential
                    else:
                        self.issue(
                            f'services.backendApiTokens.credentials[{index}]',
                            'requires a name and exactly one Secret reference')
                if tokens:
                    _set(
                        self.output,
                        'authentication.bootstrap.identities.'
                        'legacy-backend-operator', {
                            'enabled': True,
                            'username': 'osmo-backend',
                            'roles': ['osmo-backend'],
                            'tokens': tokens,
                        })
            elif enabled:
                self.issue('services.backendApiTokens.credentials',
                           'enabled credentials must be a list')
            for path in _leaf_paths(converted, 'services.backendApiTokens'):
                self.issue(path, 'no 6.4 bootstrap-identity mapping')
        default_admin = _pop(self.source, 'services.defaultAdmin')
        if isinstance(default_admin, dict):
            enabled = default_admin.pop('enabled', False)
            username = default_admin.pop('username', 'admin')
            secret_name = default_admin.pop('passwordSecretName', '')
            secret_key = default_admin.pop('passwordSecretKey', 'password')
            if enabled and secret_name:
                _set(
                    self.output,
                    'authentication.bootstrap.identities.legacy-admin', {
                        'enabled': True,
                        'username': username,
                        'roles': ['osmo-admin'],
                        'tokens': {
                            'primary': {
                                'existingSecret': {
                                    'name': secret_name,
                                    'key': secret_key,
                                },
                            },
                        },
                    })
            elif enabled:
                self.issue('services.defaultAdmin.passwordSecretName',
                           'required to preserve the existing admin token')
            for path in _leaf_paths(default_admin, 'services.defaultAdmin'):
                self.issue(path, 'no unified-chart mapping')

    def convert_gateway(self) -> None:
        for component in ('envoy', 'oauth2Proxy', 'authz', 'rateLimit'):
            self._gateway_component(component)
        internal_jwks = _get(self.output, 'gateway.envoy.internalJwks')
        if (isinstance(internal_jwks, dict)
                and internal_jwks.get('cluster') == 'osmo-service-jwks'):
            internal_jwks['cluster'] = 'osmo-api-jwks'
            host = internal_jwks.get('host')
            if isinstance(host, str) and (host == 'osmo-service'
                                          or host.startswith('osmo-service.')):
                internal_jwks['host'] = host.replace(
                    'osmo-service', 'osmo-api', 1)
        upstreams = _pop(self.source, 'gateway.upstreams')
        if isinstance(upstreams, dict):
            for old_name, values in upstreams.items():
                new_name = 'api' if old_name == 'service' else old_name
                if isinstance(values, dict):
                    values = copy.deepcopy(values)
                    enabled = values.pop('enabled', True)
                    if old_name == 'service' and not enabled:
                        self.issue('gateway.upstreams.service.enabled',
                                   'the API upstream cannot be disabled')
                    if old_name != 'service':
                        values['enabled'] = enabled
                    elif values.get('host') == 'osmo-service':
                        # The unified chart renames this Service to osmo-api.
                        # Empty selects the correctly derived release name.
                        values['host'] = ''
                _set(self.output, f'gateway.upstreams.{new_name}', values)
        self._convert_network_policies()
        tls = _pop(self.source, 'gateway.tls')
        if isinstance(tls, dict):
            tls = copy.deepcopy(tls)
            certs = tls.get('upstreamCerts')
            if isinstance(certs, dict) and 'service' in certs:
                certs['api'] = certs.pop('service')
            _set(self.output, 'gateway.tls', tls)

    def _convert_network_policies(self) -> None:
        policies = _pop(self.source, 'gateway.networkPolicies')
        if not isinstance(policies, dict):
            return
        converted: YamlObject = {}
        if 'enabled' in policies:
            converted['enabled'] = policies.pop('enabled')
        upstreams = policies.pop('upstreams', [])
        converted_upstreams = []
        name_map = {
            'osmo-service': 'api',
            'osmo-router': 'router',
            'osmo-ui': 'ui',
        }
        for index, upstream in enumerate(upstreams):
            if not isinstance(upstream, dict):
                self.issue(f'gateway.networkPolicies.upstreams[{index}]',
                           'expected a mapping')
                continue
            upstream = copy.deepcopy(upstream)
            old_name = upstream.pop('name', '')
            component = name_map.get(old_name)
            if not component:
                self.issue(f'gateway.networkPolicies.upstreams[{index}].name',
                           'cannot identify the release-relative component')
                continue
            converted_upstreams.append({
                'name': component,
                'component': component,
                'port': upstream.pop('port', 8000),
            })
            # The unified chart derives a release-scoped selector from the
            # component. Retaining the legacy app-only selector would allow
            # cross-release matches in a shared namespace.
            upstream.pop('podSelector', None)
            for path in _leaf_paths(
                    upstream,
                    f'gateway.networkPolicies.upstreams[{index}]'):
                self.issue(path, 'no unified-chart mapping')
        converted['upstreams'] = converted_upstreams
        _set(self.output, 'gateway.networkPolicies', converted)
        for path in _leaf_paths(policies, 'gateway.networkPolicies'):
            self.issue(path, 'no unified-chart mapping')

    def _gateway_component(self, name: str) -> None:
        old_root = f'gateway.{name}'
        new_root = f'gateway.{name}'
        direct = (
            'enabled', 'replicas', 'resources', 'extraArgs', 'extraEnv',
            'extraVolumeMounts', 'logLevel', 'listenerPort', 'maxHeadersSizeKb',
            'blockedIPs', 'hostname', 'defaultIdentity', 'ssl', 'idp',
            'internalJwks', 'extraSkipAuthPaths', 'routerRoute', 'serviceRoutes',
            'extraRoutes', 'extraClusters', 'maxRequests', 'provider',
            'oidcIssuerUrl', 'clientId', 'cookieName', 'cookieSecure',
            'cookieDomain', 'cookieExpire', 'cookieRefresh', 'scope',
            'passAccessToken', 'redisSessionStore', 'grpcPort', 'httpPort',
            'metricsPort', 'postgres', 'cache', 'command', 'args', 'config')
        for field in direct:
            _move(self.source, self.output, f'{old_root}.{field}',
                  f'{new_root}.{field}')
        _move(self.source, self.output, f'{old_root}.scaling',
              f'{new_root}.autoscaling', _autoscaling)
        if name in ('envoy', 'oauth2Proxy', 'authz'):
            autoscaling = _get(self.output, f'{new_root}.autoscaling')
            if (not isinstance(autoscaling, dict)
                    or 'enabled' not in autoscaling):
                _set(self.output, f'{new_root}.autoscaling.enabled', True)
        if name == 'envoy':
            _set(self.output, f'{new_root}.podDisruptionBudget.enabled', False)
        for old_field, new_field in (
                ('nodeSelector', 'pod.nodeSelector'),
                ('tolerations', 'pod.tolerations'),
                ('extraPodAnnotations', 'pod.annotations'),
                ('extraPodLabels', 'pod.labels'),
                ('extraVolumes', 'pod.extraVolumes'),
                ('serviceAccountName', 'serviceAccount'),
                ('securityContext', 'pod.containerSecurityContext')):
            transform = _service_account if old_field == 'serviceAccountName' else None
            _move(self.source, self.output, f'{old_root}.{old_field}',
                  f'{new_root}.{new_field}', transform)
        image = _pop(self.source, f'{old_root}.image')
        if image is not MISSING:
            try:
                _set(self.output, f'{new_root}.image', _image(image))
            except ValueError as error:
                self.issue(f'{old_root}.image', str(error))
        _move(self.source, self.output, f'{old_root}.imageName',
              f'{new_root}.image.name')
        _move(self.source, self.output, f'{old_root}.imageTag',
              f'{new_root}.image.tag')
        _move(self.source, self.output, f'{old_root}.imagePullPolicy',
              f'{new_root}.image.pullPolicy')
        for probe_name in ('livenessProbe', 'readinessProbe', 'startupProbe'):
            _move(self.source, self.output, f'{old_root}.{probe_name}',
                  f'{new_root}.{probe_name}', _probe)
        if name == 'envoy':
            self._convert_gateway_service()
            self._convert_ingress()
            jwt = _pop(self.source, f'{old_root}.jwt')
            if isinstance(jwt, dict):
                jwt = copy.deepcopy(jwt)
                if 'user_header' in jwt:
                    jwt['userHeader'] = jwt.pop('user_header')
                _set(self.output, f'{new_root}.jwt', jwt)
        if name == 'oauth2Proxy':
            self.unsupported(
                f'{old_root}.secretPaths',
                'Vault file paths are unsupported; configure '
                'secrets.oauthClientSecret and secrets.oauthCookieSecret')
            self._convert_oauth_redis(old_root, new_root)
        if name == 'rateLimit':
            self.unsupported(
                f'{old_root}.redis',
                'the unified rate limiter shares externalDependencies.valkey')
        if name != 'envoy':
            _move(self.source, self.output, f'{old_root}.service',
                  f'{new_root}.service')

    def _convert_oauth_redis(self, old_root: str, new_root: str) -> None:
        redis = _pop(self.source, f'{old_root}.redis')
        if redis is MISSING:
            return
        if not isinstance(redis, dict):
            self.issue(f'{old_root}.redis', 'expected a mapping')
            return
        redis = copy.deepcopy(redis)
        comparisons = (
            ('serviceName', 'externalDependencies.valkey.host', None),
            ('port', 'externalDependencies.valkey.port', 6379),
            ('tlsEnabled', 'externalDependencies.valkey.tls.enabled', True),
        )
        for old_key, shared_path, default_value in comparisons:
            value = redis.pop(old_key, MISSING)
            if value is MISSING:
                continue
            shared_value = _get(self.output, shared_path)
            if shared_value is None:
                shared_value = default_value
            if value != shared_value:
                self.issue(
                    f'{old_root}.redis.{old_key}',
                    'does not match the shared unified-chart Valkey connection')
        database = redis.pop('dbNumber', MISSING)
        if database is not MISSING:
            _set(self.output, f'{new_root}.redisDatabase', database)
        if redis.pop('passwordFile', MISSING) is not MISSING:
            self.issue(
                f'{old_root}.redis.passwordFile',
                'Vault file paths are unsupported; configure secrets.valkey')
        for path in _leaf_paths(redis, f'{old_root}.redis'):
            self.issue(path, 'no unified-chart mapping')

    def _convert_gateway_service(self) -> None:
        service = _pop(self.source, 'gateway.envoy.service')
        if not isinstance(service, dict):
            return
        service = copy.deepcopy(service)
        converted: YamlObject = {}
        for key in (
                'type', 'port', 'nodePort', 'labels', 'annotations',
                'extraPorts', 'loadBalancerClass', 'loadBalancerSourceRanges',
                'externalTrafficPolicy'):
            if key in service:
                converted[key] = service.pop(key)
        if 'httpsPort' in service:
            https_port = service.pop('httpsPort')
            if https_port:
                converted.setdefault('extraPorts', []).append({
                    'name': 'https',
                    'port': https_port,
                    'targetPort': 'envoy-http',
                    'protocol': 'TCP',
                })
        _set(self.output, 'gateway.envoy.service', converted)
        for path in _leaf_paths(service, 'gateway.envoy.service'):
            self.issue(path, 'no unified-chart mapping')

    def _convert_ingress(self) -> None:
        ingress = _pop(self.source, 'gateway.envoy.ingress')
        if not isinstance(ingress, dict):
            return
        ingress = copy.deepcopy(ingress)
        for key in ('enabled', 'annotations'):
            if key in ingress:
                _set(self.output, f'ingress.{key}', ingress.pop(key))
        if 'ingressClass' in ingress:
            _set(self.output, 'ingress.ingressClassName',
                 ingress.pop('ingressClass'))
        ssl_enabled = ingress.pop('sslEnabled', MISSING)
        if ssl_enabled is not MISSING:
            _set(self.output, 'ingress.tls.enabled', ssl_enabled)
        if 'sslSecret' in ingress:
            _set(self.output, 'ingress.tls.secretName',
                 ingress.pop('sslSecret'))
        alb = ingress.pop('albAnnotations', {})
        if isinstance(alb, dict) and alb.pop('enabled', False):
            annotations = _get(self.output, 'ingress.annotations')
            if not isinstance(annotations, dict):
                annotations = {}
                _set(self.output, 'ingress.annotations', annotations)
            annotations.setdefault('alb.ingress.kubernetes.io/target-type', 'ip')
            annotations.setdefault('alb.ingress.kubernetes.io/healthcheck-path',
                                   '/api/version')
            annotations.setdefault('alb.ingress.kubernetes.io/group.name',
                                   alb.pop('groupName', 'osmo'))
            annotations.setdefault('alb.ingress.kubernetes.io/group.order',
                                   str(alb.pop('groupOrder', '10')))
            certificate_arn = alb.pop('sslCertArn', '')
            if certificate_arn:
                annotations.setdefault(
                    'alb.ingress.kubernetes.io/certificate-arn',
                    certificate_arn)
            _set(self.output, 'ingress.annotations', annotations)
        for path in _leaf_paths(alb, 'gateway.envoy.ingress.albAnnotations'):
            self.issue(path, 'no unified-chart mapping')
        for path in _leaf_paths(ingress, 'gateway.envoy.ingress'):
            self.issue(path, 'no unified-chart mapping')

    def finish(self) -> ConversionResult:
        _move(self.source, self.output, 'podMonitor.enabled',
              'monitoring.podMonitor.control.enabled')
        remaining = _prune_empty(self.source)
        for path in _leaf_paths(remaining):
            self.issue(path, 'no unified-chart mapping')
        unique_issues = sorted(set(self.issues), key=lambda issue: issue.path)
        return ConversionResult(_prune_empty(self.output), unique_issues)


def _get(source: YamlObject, path: str) -> Any:
    current: Any = source
    for key in path.split('.'):
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def convert_values(values: YamlObject) -> ConversionResult:
    """Convert merged legacy values without silently discarding a key."""
    converter = _Converter(values)
    converter.convert_global()
    converter.convert_dependencies()
    converter.convert_configuration()
    converter.convert_authentication()
    converter.convert_services()
    converter.convert_secrets()
    converter.convert_gateway()
    return converter.finish()


def _load(path: pathlib.Path) -> YamlObject:
    with path.open(encoding='utf-8') as values_file:
        value = yaml.safe_load(values_file)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f'{path}: top-level YAML value must be a mapping')
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            'Convert legacy service-chart values to unified osmo-chart '
            'values. Multiple inputs are merged left-to-right like Helm.'),
        epilog=(
            'By default, any unsupported or ambiguous input suppresses YAML '
            'output and exits 2. Use --allow-partial to emit the safe partial '
            'conversion; diagnostics are always written to stderr and never '
            'include secret values.'),
    )
    parser.add_argument('values', nargs='+', type=pathlib.Path,
                        help='legacy values YAML file (repeat to merge)')
    parser.add_argument('-o', '--output', type=pathlib.Path,
                        help='write converted YAML here instead of stdout')
    parser.add_argument(
        '--allow-partial', action='store_true',
        help='emit safe partial output even when manual follow-up is required')
    return parser


def main() -> int:
    parser = _parser()
    arguments = parser.parse_args()
    try:
        merged: YamlObject = {}
        for path in arguments.values:
            merged = _deep_merge(merged, _load(path))
        result = convert_values(merged)
    except (OSError, ValueError, yaml.YAMLError) as error:
        parser.error(str(error))
    if result.issues:
        print(f'conversion requires {len(result.issues)} manual follow-up(s):',
              file=sys.stderr)
        for issue in result.issues:
            print(f'- {issue.path}: {issue.message}', file=sys.stderr)
        if not arguments.allow_partial:
            print('no YAML emitted; rerun with --allow-partial to inspect the '
                  'safe partial conversion', file=sys.stderr)
            return 2
    rendered = yaml.safe_dump(result.values, sort_keys=False)
    if arguments.output:
        arguments.output.write_text(rendered, encoding='utf-8')
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == '__main__':
    sys.exit(main())
