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

Convert legacy backend-operator values to compute-only umbrella-chart values.
"""

import argparse
import copy
import dataclasses
import pathlib
import sys
from typing import Any, Callable

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
        result['registry'] = 'docker.io'
    result['repository'] = '/'.join(parts)
    if tag:
        result['tag'] = tag
    if digest:
        result['digest'] = digest
    return result


def _repository(value: Any) -> tuple[str, str]:
    image = _image(value)
    return image.get('registry', ''), image['repository']


def _argument(name: str, value: Any) -> str:
    if isinstance(value, bool):
        rendered = str(value).lower()
    elif isinstance(value, list):
        rendered = ','.join(str(item) for item in value)
    else:
        rendered = str(value)
    return f'--{name}={rendered}'


class _Converter:
    """Stateful backend values converter."""

    def __init__(self, values: YamlObject, release_namespace: str,
                 release_name: str | None):
        self.source = copy.deepcopy(values)
        self.release_namespace = release_namespace
        self.legacy_base_name = release_name
        self.output: YamlObject = {
            'planes': {
                'control': {'enabled': False},
                'compute': {'enabled': True},
            },
            'embeddedDependencies': {
                'postgresql': {'enabled': False},
                'valkey': {'enabled': False},
                'objectStorage': {'enabled': False},
            },
            # Retain the legacy release prefix when the Helm release name
            # contains "backend-operator". global.name replaces it when set.
            'nameOverride': 'backend-operator',
            'fullnameOverride': '',
            'compute': {
                'workloadNamespace': {'create': False},
            },
            'logging': {
                'enabled': True,
                'logLevel': 'DEBUG',
                'k8sLogLevel': 'WARNING',
                'logFormat': 'text',
            },
            'podDefaults': {
                'tolerations': [{
                    'key': 'ops',
                    'operator': 'Exists',
                    'effect': 'NoSchedule',
                }],
            },
            'secrets': {
                'valkey': {'generate': False},
                'objectStorage': {'generate': False},
                'backendApiTokens': {
                    'enabled': False,
                    'credentials': [],
                },
                'masterEncryptionKey': {
                    'managementMode': 'external',
                    'existingSecret': {'name': ''},
                    'bootstrap': {'enabled': False},
                },
                'serviceAuth': {
                    'managementMode': 'external',
                    'bootstrap': {'enabled': False},
                },
            },
            'services': {
                'backendListener': {
                    'image': {'pullPolicy': 'Always'},
                    'resources': {
                        'requests': {'cpu': '1', 'memory': '2Gi'},
                        'limits': {'memory': '2Gi'},
                    },
                },
                'backendWorker': {
                    'image': {'pullPolicy': 'Always'},
                    'resources': {
                        'requests': {'cpu': '1', 'memory': '1Gi'},
                        'limits': {'memory': '1Gi'},
                    },
                },
                # The legacy backend chart enables its test runner by default.
                'backendTestRunner': {
                    'enabled': True,
                    'image': {'pullPolicy': 'Always'},
                    'extraArgs': ['--prefix', 'osmo'],
                    'labels': {'managed-by': 'backend-operator'},
                },
            },
        }
        self.include_namespace_usage: Any = MISSING
        self.issues: list[ConversionIssue] = []

    def issue(self, path: str, message: str) -> None:
        self.issues.append(ConversionIssue(path, message))

    def convert_global(self) -> None:
        location = _pop(self.source, 'global.osmoImageLocation')
        if location is not MISSING:
            try:
                registry, repository = _repository(location)
                _set(self.output, 'imageRegistry', registry)
                _set(self.output, 'imageRepository', repository)
            except ValueError as error:
                self.issue('global.osmoImageLocation', str(error))
        _move(self.source, self.output, 'global.osmoImageTag', 'imageTag')
        image_pull_secret = _pop(self.source, 'global.imagePullSecret')
        if image_pull_secret is not MISSING:
            _set(self.output, 'imagePullSecrets',
                 [{'name': image_pull_secret}] if image_pull_secret else [])
        name = _pop(self.source, 'global.name')
        if name not in (MISSING, None, ''):
            _set(self.output, 'fullnameOverride', name)
            self.legacy_base_name = str(name)
        if self.legacy_base_name:
            _set(self.output,
                 'services.backendTestRunner.serviceAccount.name',
                 f'{self.legacy_base_name}-test-runner')
        _move(self.source, self.output, 'global.serviceUrl', 'externalUrl')
        _move(self.source, self.output, 'global.backendName',
              'compute.backendName')
        _move(self.source, self.output, 'global.backendNamespace',
              'compute.workloadNamespace.name')
        _move(self.source, self.output, 'global.backendTestNamespace',
              'compute.backendTestNamespace')
        _move(self.source, self.output, 'global.nodeConditionPrefix',
              'compute.nodeConditionPrefix')
        _move(self.source, self.output, 'global.nodeSelector',
              'podDefaults.nodeSelector')
        _move(self.source, self.output, 'global.tolerations',
              'podDefaults.tolerations')
        _move(self.source, self.output, 'global.logs', 'logging')
        _move(self.source, self.output, 'global.enableNonClusterRoles',
              'compute.rbac.create')
        _move(self.source, self.output, 'global.enableClusterRoles',
              'compute.rbac.clusterRoles.create')

        login_method = _pop(self.source, 'global.loginMethod')
        if login_method is MISSING:
            login_method = 'password'
        if login_method != 'token':
            self.issue('global.loginMethod',
                       'the umbrella compute plane supports token '
                       'authentication only')
        _move(self.source, self.output, 'global.accountTokenSecret',
              'compute.authentication.existingSecret')
        _move(self.source, self.output, 'global.accountTokenSecretKey',
              'compute.authentication.tokenKey')
        for inactive_path in (
                'global.accountUsername', 'global.accountPasswordSecret',
                'global.accountPasswordSecretKey',
                # This legacy global is not consumed by backend templates;
                # service-specific serviceAccount fields control their names.
                'global.serviceAccountName'):
            _pop(self.source, inactive_path)

        agent_namespace = _pop(self.source, 'global.agentNamespace')
        if agent_namespace is MISSING:
            agent_namespace = 'osmo'
        if agent_namespace != self.release_namespace:
            self.issue(
                'global.agentNamespace',
                'the umbrella chart uses the Helm release namespace for '
                'backend agents; set --release-namespace to the legacy '
                'agent namespace and install the unified release there')

        include_namespaces = _pop(
            self.source, 'global.includeNamespaceUsage')
        if include_namespaces is MISSING:
            self.issue(
                'global.includeNamespaceUsage',
                'set the workflow namespaces whose usage the backend '
                'listener should monitor')
        else:
            self.include_namespace_usage = include_namespaces

        priority_classes = _pop(self.source, 'global.priorityClasses')
        if isinstance(priority_classes, dict):
            priority_classes = copy.deepcopy(priority_classes)
            if 'enabled' in priority_classes:
                _set(self.output, 'compute.priorityClasses.create',
                     priority_classes.pop('enabled'))
            if 'classes' in priority_classes:
                _set(self.output, 'compute.priorityClasses.classes',
                     priority_classes.pop('classes'))
            for path in _leaf_paths(priority_classes,
                                    'global.priorityClasses'):
                self.issue(path, 'no umbrella-chart mapping')
        elif priority_classes is not MISSING:
            self.issue('global.priorityClasses', 'expected a mapping')

        network_policy = _pop(self.source, 'global.networkPolicy')
        if network_policy is not MISSING:
            _set(self.output, 'compute.workflowNetworkPolicy', network_policy)

    def _append_argument(self, component: str, argument: str) -> None:
        service = self.output['services'].setdefault(component, {})
        arguments = service.setdefault('extraArgs', [])
        if not isinstance(arguments, list):
            raise ValueError(f'services.{component}.extraArgs must be a list')
        arguments.append(argument)

    def convert_services(self) -> None:
        for component in ('backendListener', 'backendWorker'):
            self._convert_component(component)

    def _convert_component(self, component: str) -> None:
        root = f'services.{component}'
        direct_fields = ['enabled', 'replicas', 'resources']
        if component == 'backendListener':
            direct_fields.append('enableNodeLabelUpdate')
        if component == 'backendWorker':
            direct_fields.append('extraRBACRules')
        for field in direct_fields:
            _move(self.source, self.output, f'{root}.{field}',
                  f'{root}.{field}')
        for old_field, new_field in (
                ('extraEnvs', 'extraEnv'),
                ('extraPodAnnotations', 'pod.annotations'),
                ('extraPodLabels', 'pod.labels'),
                ('extraSidecarContainers', 'pod.extraContainers'),
                ('nodeSelector', 'pod.nodeSelector'),
                ('hostAliases', 'pod.hostAliases'),
                ('initContainers', 'pod.initContainers'),
                ('volumes', 'pod.extraVolumes'),
                ('volumeMounts', 'extraVolumeMounts')):
            _move(self.source, self.output, f'{root}.{old_field}',
                  f'{root}.{new_field}')
        _move(self.source, self.output, f'{root}.imageName',
              f'{root}.image.name')
        _move(self.source, self.output, f'{root}.imagePullPolicy',
              f'{root}.image.pullPolicy')

        extra_arguments = _pop(self.source, f'{root}.extraArgs')
        generated_arguments: list[str] = []
        if component == 'backendListener':
            for old_field, argument_name, default in (
                    ('max_unacked_messages', 'max_unacked_messages', 100),
                    ('podCacheTtl', 'pod_event_cache_ttl', 15)):
                value = _pop(self.source, f'{root}.{old_field}')
                generated_arguments.append(
                    _argument(argument_name,
                              default if value is MISSING else value))
            if self.include_namespace_usage is not MISSING:
                generated_arguments.append(_argument(
                    'include_namespace_usage', self.include_namespace_usage))
            for old_field, argument_name, default in (
                    ('apiQps', 'api_qps', 20),
                    ('apiBurst', 'api_burst', 30)):
                value = _pop(self.source, f'{root}.{old_field}')
                generated_arguments.append(
                    _argument(argument_name,
                              default if value is MISSING else value))
        else:
            frequency = _pop(self.source, f'{root}.progressIterFrequency')
            generated_arguments.append(_argument(
                'progress_iter_frequency',
                '15s' if frequency is MISSING else frequency))
        if extra_arguments is not MISSING:
            if isinstance(extra_arguments, list):
                generated_arguments.extend(str(item)
                                           for item in extra_arguments)
            else:
                self.issue(f'{root}.extraArgs', 'expected a list')
        for argument in generated_arguments:
            self._append_argument(component, argument)

        service_name = _pop(self.source, f'{root}.serviceName')
        expected_service_name = (
            'osmo-backend-listener' if component == 'backendListener'
            else 'osmo-backend-worker')
        if service_name not in (MISSING, expected_service_name):
            self.issue(f'{root}.serviceName',
                       'custom legacy service names are not configurable')
        service_account = _pop(self.source, f'{root}.serviceAccount')
        expected_account = (
            'backend-listener' if component == 'backendListener'
            else 'backend-worker')
        if service_account not in (MISSING, expected_account):
            self.issue(
                f'{root}.serviceAccount',
                'custom service-account suffixes require the final rendered '
                'legacy account name in services.*.serviceAccount.name')

    def convert_test_runner(self) -> None:
        source = _pop(self.source, 'backendTestRunner')
        if source is MISSING:
            return
        if not isinstance(source, dict):
            self.issue('backendTestRunner', 'expected a mapping')
            return
        source = copy.deepcopy(source)
        for key in ('enabled', 'cronJob', 'jobTemplate', 'extraRoles'):
            if key in source:
                _set(self.output, f'services.backendTestRunner.{key}',
                     source.pop(key))
        pod_template = source.pop('podTemplate', MISSING)
        if isinstance(pod_template, dict):
            self._convert_test_runner_pod(copy.deepcopy(pod_template))
        elif pod_template is not MISSING:
            self.issue('backendTestRunner.podTemplate', 'expected a mapping')
        environment = source.pop('env', MISSING)
        if isinstance(environment, dict):
            additional = environment.pop('additional', MISSING)
            if additional is not MISSING:
                _set(self.output, 'services.backendTestRunner.extraEnv',
                     additional)
            for path in _leaf_paths(environment, 'backendTestRunner.env'):
                self.issue(path, 'no umbrella-chart mapping')
        for old_key, new_key in (
                ('configMap', 'configMap'),
                ('labels', 'labels'),
                ('annotations', 'annotations')):
            if old_key in source:
                _set(self.output, f'services.backendTestRunner.{new_key}',
                     source.pop(old_key))
        volumes = source.pop('volumes', MISSING)
        if isinstance(volumes, dict):
            converted_volume: YamlObject = {}
            if 'testConfigName' in volumes:
                converted_volume['name'] = volumes.pop('testConfigName')
            if 'testConfigMountPath' in volumes:
                converted_volume['mountPath'] = volumes.pop(
                    'testConfigMountPath')
            if converted_volume:
                _set(self.output,
                     'services.backendTestRunner.testConfigVolume',
                     converted_volume)
            for path in _leaf_paths(volumes, 'backendTestRunner.volumes'):
                self.issue(path, 'no umbrella-chart mapping')
        elif volumes is not MISSING:
            self.issue('backendTestRunner.volumes', 'expected a mapping')
        for path in _leaf_paths(source, 'backendTestRunner'):
            self.issue(path, 'no umbrella-chart mapping')

    def _convert_test_runner_pod(self, pod_template: YamlObject) -> None:
        image = pod_template.pop('image', MISSING)
        if isinstance(image, dict):
            image = copy.deepcopy(image)
            repository = image.pop('repository', MISSING)
            if repository is not MISSING:
                try:
                    converted = _image(repository)
                    converted.pop('tag', None)
                    _set(self.output,
                         'services.backendTestRunner.image.registry',
                         converted['registry'])
                    _set(self.output,
                         'services.backendTestRunner.image.repository',
                         converted['repository'])
                except ValueError as error:
                    self.issue('backendTestRunner.podTemplate.image.repository',
                               str(error))
            for old_key, new_key in (
                    ('tag', 'tag'), ('pullPolicy', 'pullPolicy')):
                if old_key in image:
                    _set(self.output,
                         f'services.backendTestRunner.image.{new_key}',
                         image.pop(old_key))
            for path in _leaf_paths(
                    image, 'backendTestRunner.podTemplate.image'):
                self.issue(path, 'no umbrella-chart mapping')
        elif image is not MISSING:
            self.issue('backendTestRunner.podTemplate.image',
                       'expected a mapping')
        init_container = pod_template.pop('initContainer', MISSING)
        if isinstance(init_container, dict):
            init_container = copy.deepcopy(init_container)
            image_reference = init_container.pop('image', MISSING)
            if image_reference is not MISSING:
                try:
                    _set(self.output,
                         'services.backendTestRunner.initContainer.image',
                         _image(image_reference))
                except ValueError as error:
                    self.issue(
                        'backendTestRunner.podTemplate.initContainer.image',
                        str(error))
            pull_policy = init_container.pop('imagePullPolicy', MISSING)
            if pull_policy is not MISSING:
                _set(
                    self.output,
                    'services.backendTestRunner.initContainer.image.pullPolicy',
                    pull_policy)
            if 'resources' in init_container:
                _set(self.output,
                     'services.backendTestRunner.initContainer.resources',
                     init_container.pop('resources'))
            for path in _leaf_paths(
                    init_container,
                    'backendTestRunner.podTemplate.initContainer'):
                self.issue(path, 'no umbrella-chart mapping')
        elif init_container is not MISSING:
            self.issue('backendTestRunner.podTemplate.initContainer',
                       'expected a mapping')
        container = pod_template.pop('container', MISSING)
        if isinstance(container, dict):
            container = copy.deepcopy(container)
            if 'resources' in container:
                _set(self.output,
                     'services.backendTestRunner.container.resources',
                     container.pop('resources'))
            if 'args' in container:
                self.issue('backendTestRunner.podTemplate.container.args',
                           'custom complete argument lists must be reviewed '
                           'against services.backendTestRunner.extraArgs')
                container.pop('args')
            for path in _leaf_paths(
                    container, 'backendTestRunner.podTemplate.container'):
                self.issue(path, 'no umbrella-chart mapping')
        elif container is not MISSING:
            self.issue('backendTestRunner.podTemplate.container',
                       'expected a mapping')
        for old_key, new_key in (
                ('securityContext', 'pod.podSecurityContext'),
                ('containerSecurityContext', 'pod.containerSecurityContext'),
                ('nodeSelector', 'pod.nodeSelector'),
                ('tolerations', 'pod.tolerations'),
                ('hostAliases', 'pod.hostAliases'),
                ('affinity', 'pod.affinity'),
                ('restartPolicy', 'pod.restartPolicy'),
                ('terminationGracePeriodSeconds',
                 'pod.terminationGracePeriodSeconds'),
                ('automountServiceAccountToken',
                 'pod.automountServiceAccountToken'),
                ('labels', 'pod.labels'),
                ('annotations', 'pod.annotations')):
            if old_key in pod_template:
                _set(self.output,
                     f'services.backendTestRunner.{new_key}',
                     pod_template.pop(old_key))
        service_account = pod_template.pop('serviceAccount', MISSING)
        if service_account is not MISSING:
            if (not isinstance(service_account, str)
                    or not service_account):
                self.issue(
                    'backendTestRunner.podTemplate.serviceAccount',
                    'expected a non-empty string')
            elif self.legacy_base_name:
                _set(self.output,
                     'services.backendTestRunner.serviceAccount.name',
                     f'{self.legacy_base_name}-{service_account}')
        for ignored_key in ('dnsPolicy', 'dnsConfig', 'hostnameTemplate',
                            'subdomain'):
            pod_template.pop(ignored_key, None)
        for path in _leaf_paths(pod_template,
                                'backendTestRunner.podTemplate'):
            self.issue(path, 'no umbrella-chart mapping')

    def finish(self) -> ConversionResult:
        _move(self.source, self.output, 'podMonitor.enabled',
              'monitoring.podMonitor.compute.enabled')
        _move(self.source, self.output, 'extraConfigMaps',
              'compute.extraConfigMaps')
        if (self.output['services']['backendTestRunner'].get('enabled', True)
                and not self.legacy_base_name):
            self.issue(
                '--release-name',
                'required to preserve the legacy backend test-runner '
                'ServiceAccount name when global.name is unset')
        if (self.output['services']['backendTestRunner'].get('enabled', True)
                and not self.output['compute'].get('backendTestNamespace')):
            self.issue(
                'global.backendTestNamespace',
                'required when the legacy backend test runner is enabled; '
                'set it explicitly or disable backendTestRunner.enabled')
        remaining = _prune_empty(self.source)
        for path in _leaf_paths(remaining):
            self.issue(path, 'no umbrella-chart mapping')
        unique_issues = sorted(set(self.issues), key=lambda issue: issue.path)
        return ConversionResult(_prune_empty(self.output), unique_issues)


def convert_values(values: YamlObject,
                   release_namespace: str = 'osmo',
                   release_name: str | None = None) -> ConversionResult:
    """Convert merged legacy backend values without discarding a key."""
    converter = _Converter(values, release_namespace, release_name)
    converter.convert_global()
    converter.convert_services()
    converter.convert_test_runner()
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
            'Convert legacy backend-operator values to compute-only umbrella '
            'osmo-chart values. Multiple inputs merge left-to-right like '
            'Helm.'),
        epilog=(
            'By default, unsupported or ambiguous input suppresses YAML and '
            'exits 2. Use --allow-unmapped to emit the safe partial output. '
            'Diagnostics never include secret values.'),
    )
    parser.add_argument('values', nargs='+', type=pathlib.Path,
                        help='legacy backend values YAML (repeat to merge)')
    parser.add_argument('-o', '--output', type=pathlib.Path,
                        help='write converted YAML here instead of stdout')
    parser.add_argument(
        '--release-namespace', default='osmo',
        help=('namespace where the umbrella Helm release will run; must '
              'match legacy global.agentNamespace (default: osmo)'))
    parser.add_argument(
        '--release-name',
        help=('existing Helm release name; required when the legacy backend '
              'test runner is enabled and global.name is unset'))
    parser.add_argument(
        '--allow-unmapped', action='store_true',
        help='emit safe partial output when manual follow-up is required')
    return parser


def main() -> int:
    parser = _parser()
    arguments = parser.parse_args()
    try:
        merged: YamlObject = {}
        for path in arguments.values:
            merged = _deep_merge(merged, _load(path))
        result = convert_values(merged, arguments.release_namespace,
                                arguments.release_name)
    except (OSError, ValueError, yaml.YAMLError) as error:
        parser.error(str(error))
    if result.issues:
        print(f'conversion requires {len(result.issues)} manual follow-up(s):',
              file=sys.stderr)
        for issue in result.issues:
            print(f'- {issue.path}: {issue.message}', file=sys.stderr)
        if not arguments.allow_unmapped:
            print('no YAML emitted; rerun with --allow-unmapped to inspect the '
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
