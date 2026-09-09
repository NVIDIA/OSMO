# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
"""Tests for legacy backend-operator values conversion."""

import pathlib
import subprocess
import sys
import tempfile
import unittest

import yaml


class BackendValuesConvertTest(unittest.TestCase):
    """Tests observable conversion behavior through the command-line tool."""

    def run_converter(self, values: list[dict], *arguments: str
                      ) -> subprocess.CompletedProcess[str]:
        """Run the converter against temporary values files."""
        script = pathlib.Path(__file__).parents[1] / 'backend_values_convert.py'
        with tempfile.TemporaryDirectory() as temporary_directory:
            paths = []
            for index, value in enumerate(values):
                path = pathlib.Path(temporary_directory) / f'values-{index}.yaml'
                path.write_text(yaml.safe_dump(value), encoding='utf-8')
                paths.append(str(path))
            return subprocess.run(
                [sys.executable, str(script), *paths, *arguments],
                check=False,
                capture_output=True,
                text=True,
            )

    def test_cli_maps_token_backend_values(self) -> None:
        legacy = {
            'global': {
                'osmoImageLocation': 'nvcr.io/nvstaging/osmo',
                'osmoImageTag': '6.4.0-test',
                'imagePullSecret': 'nvcr-secret',
                'backendName': 'dgx-h100-dev',
                'backendNamespace': 'osmo-staging',
                'backendTestNamespace': 'osmo-staging-test',
                'serviceUrl': 'https://staging.osmo.example.com',
                'accountUsername': 'unused-token-user',
                'accountPasswordSecret': 'unused-password-secret',
                'loginMethod': 'token',
                'accountTokenSecret': 'staging-access-token',
                'accountTokenSecretKey': 'token',
                'serviceAccountName': 'unused-legacy-value',
                'nodeConditionPrefix': 'staging.osmo.example.com/',
                'nodeSelector': {'nodeGroup': 'monitoring'},
                'tolerations': [{
                    'key': 'dedicated',
                    'operator': 'Equal',
                    'value': 'system-workload',
                    'effect': 'NoSchedule',
                }],
                'priorityClasses': {'enabled': False},
                'networkPolicy': {
                    'enabled': True,
                    'clusterCIDRs': ['10.244.0.0/16'],
                    'allowedNamespaces': ['osmo-bridge-proxy'],
                },
            },
            'services': {
                'backendListener': {
                    'enableNodeLabelUpdate': True,
                    'apiQps': 200,
                    'apiBurst': 1000,
                    'resources': {
                        'requests': {'cpu': '2', 'memory': '16Gi'},
                        'limits': {'cpu': '2', 'memory': '16Gi'},
                    },
                },
                'backendWorker': {
                    'extraRBACRules': [{
                        'apiGroups': [''],
                        'resources': ['configmaps'],
                        'verbs': ['list', 'create', 'delete', 'patch'],
                    }],
                },
            },
            'backendTestRunner': {
                'podTemplate': {
                    'image': {
                        'repository': (
                            'nvcr.io/nvstaging/osmo/backend-test-runner'),
                    },
                },
                'extraRoles': [{
                    'apiVersion': 'rbac.authorization.k8s.io/v1',
                    'kind': 'Role',
                    'metadata': {
                        'name': 'test-runner-osmo-staging',
                        'namespace': 'osmo-staging',
                    },
                    'rules': [],
                }],
            },
            'podMonitor': {'enabled': True},
        }
        script = pathlib.Path(__file__).parents[1] / 'backend_values_convert.py'

        with tempfile.TemporaryDirectory() as temporary_directory:
            values_path = pathlib.Path(temporary_directory) / 'values.yaml'
            values_path.write_text(yaml.safe_dump(legacy), encoding='utf-8')
            completed = subprocess.run(
                [sys.executable, str(script), str(values_path)],
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        converted = yaml.safe_load(completed.stdout)
        self.assertEqual(converted['planes'], {
            'control': {'enabled': False},
            'compute': {'enabled': True},
        })
        self.assertEqual(converted['embeddedDependencies'], {
            'postgresql': {'enabled': False},
            'valkey': {'enabled': False},
            'objectStorage': {'enabled': False},
        })
        self.assertEqual(converted['nameOverride'], 'backend-operator')
        self.assertEqual(converted['fullnameOverride'], '')
        self.assertEqual(converted['imageRegistry'], 'nvcr.io')
        self.assertEqual(converted['imageRepository'], 'nvstaging/osmo')
        self.assertEqual(converted['imageTag'], '6.4.0-test')
        self.assertEqual(converted['imagePullSecrets'], [
            {'name': 'nvcr-secret'},
        ])
        self.assertEqual(converted['externalUrl'],
                         'https://staging.osmo.example.com')
        self.assertEqual(converted['compute']['backendName'], 'dgx-h100-dev')
        self.assertEqual(converted['compute']['workloadNamespace'], {
            'name': 'osmo-staging',
            'create': False,
        })
        self.assertEqual(converted['compute']['backendTestNamespace'],
                         'osmo-staging-test')
        self.assertEqual(converted['compute']['authentication'], {
            'existingSecret': 'staging-access-token',
            'tokenKey': 'token',
        })
        self.assertEqual(converted['compute']['nodeConditionPrefix'],
                         'staging.osmo.example.com/')
        self.assertEqual(converted['compute']['workflowNetworkPolicy'], {
            'enabled': True,
            'clusterCIDRs': ['10.244.0.0/16'],
            'allowedNamespaces': ['osmo-bridge-proxy'],
        })
        self.assertFalse(converted['compute']['priorityClasses']['create'])
        self.assertEqual(converted['podDefaults']['nodeSelector'],
                         {'nodeGroup': 'monitoring'})
        self.assertEqual(converted['podDefaults']['tolerations'], [{
            'key': 'dedicated',
            'operator': 'Equal',
            'value': 'system-workload',
            'effect': 'NoSchedule',
        }])
        listener = converted['services']['backendListener']
        self.assertTrue(listener['enableNodeLabelUpdate'])
        self.assertEqual(listener['extraArgs'], [
            '--max_unacked_messages=100',
            '--pod_event_cache_ttl=15',
            '--include_namespace_usage=osmo-staging,osmo-prod',
            '--api_qps=200',
            '--api_burst=1000',
        ])
        self.assertEqual(listener['image']['pullPolicy'], 'Always')
        self.assertEqual(listener['resources']['requests']['memory'], '16Gi')
        worker = converted['services']['backendWorker']
        self.assertEqual(worker['image']['pullPolicy'], 'Always')
        self.assertEqual(worker['extraArgs'], [
            '--progress_iter_frequency=15s',
        ])
        self.assertEqual(worker['resources'], {
            'requests': {'cpu': '1', 'memory': '1Gi'},
            'limits': {'memory': '1Gi'},
        })
        self.assertEqual(worker['extraRBACRules'][0]['resources'],
                         ['configmaps'],
        )
        test_runner = converted['services']['backendTestRunner']
        self.assertTrue(test_runner['enabled'])
        self.assertEqual(test_runner['image'], {
            'registry': 'nvcr.io',
            'repository': 'nvstaging/osmo/backend-test-runner',
            'pullPolicy': 'Always',
        })
        self.assertEqual(test_runner['extraRoles'][0]['kind'], 'Role')
        self.assertTrue(
            converted['monitoring']['podMonitor']['compute']['enabled'])

    def test_cli_preserves_legacy_defaults(self) -> None:
        legacy = {
            'global': {
                'loginMethod': 'token',
                'accountTokenSecret': 'backend-token',
            },
        }
        script = pathlib.Path(__file__).parents[1] / 'backend_values_convert.py'

        with tempfile.TemporaryDirectory() as temporary_directory:
            values_path = pathlib.Path(temporary_directory) / 'values.yaml'
            values_path.write_text(yaml.safe_dump(legacy), encoding='utf-8')
            completed = subprocess.run(
                [sys.executable, str(script), str(values_path)],
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        converted = yaml.safe_load(completed.stdout)
        self.assertEqual(converted['podDefaults']['tolerations'], [{
            'key': 'ops',
            'operator': 'Exists',
            'effect': 'NoSchedule',
        }])
        self.assertEqual(
            converted['services']['backendListener']['extraArgs'], [
                '--max_unacked_messages=100',
                '--pod_event_cache_ttl=15',
                '--include_namespace_usage=osmo-staging,osmo-prod',
                '--api_qps=20',
                '--api_burst=30',
            ])
        self.assertEqual(
            converted['services']['backendWorker']['extraArgs'],
            ['--progress_iter_frequency=15s'],
        )

    def test_cli_uses_explicit_global_name_as_fullname_override(self) -> None:
        completed = self.run_converter([{
            'global': {
                'name': 'stable-backend-name',
                'loginMethod': 'token',
                'accountTokenSecret': 'backend-token',
            },
        }])

        self.assertEqual(completed.returncode, 0, completed.stderr)
        converted = yaml.safe_load(completed.stdout)
        self.assertEqual(converted['fullnameOverride'], 'stable-backend-name')

    def test_cli_rejects_password_authentication(self) -> None:
        completed = self.run_converter([{
            'global': {
                'loginMethod': 'password',
                'accountPasswordSecret': 'password-secret',
            },
        }])

        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, '')
        self.assertIn('global.loginMethod', completed.stderr)

    def test_cli_requires_release_namespace_to_match_agents(self) -> None:
        values = {
            'global': {
                'agentNamespace': 'backend-agents',
                'loginMethod': 'token',
                'accountTokenSecret': 'backend-token',
            },
        }

        rejected = self.run_converter([values])
        accepted = self.run_converter(
            [values], '--release-namespace', 'backend-agents')

        self.assertEqual(rejected.returncode, 2)
        self.assertIn('global.agentNamespace', rejected.stderr)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)

    def test_cli_reports_unmapped_paths_without_values(self) -> None:
        secret_value = 'do-not-print-this-value'
        completed = self.run_converter([{
            'global': {
                'loginMethod': 'token',
                'accountTokenSecret': 'backend-token',
            },
            'unsupported': {'credential': secret_value},
        }])

        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, '')
        self.assertIn('unsupported.credential', completed.stderr)
        self.assertNotIn(secret_value, completed.stderr)

    def test_allow_unmapped_emits_partial_conversion(self) -> None:
        completed = self.run_converter([{
            'global': {
                'loginMethod': 'token',
                'accountTokenSecret': 'backend-token',
            },
            'unsupported': {'setting': True},
        }], '--allow-unmapped')

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn('unsupported.setting', completed.stderr)
        self.assertEqual(
            yaml.safe_load(completed.stdout)['compute']['authentication']
            ['existingSecret'],
            'backend-token',
        )

    def test_cli_merges_multiple_files_in_helm_order(self) -> None:
        completed = self.run_converter([
            {
                'global': {
                    'loginMethod': 'token',
                    'accountTokenSecret': 'backend-token',
                    'backendName': 'base-name',
                    'nodeSelector': {'pool': 'base', 'arch': 'amd64'},
                },
            },
            {
                'global': {
                    'backendName': 'override-name',
                    'nodeSelector': {'pool': 'override'},
                },
            },
        ])

        self.assertEqual(completed.returncode, 0, completed.stderr)
        converted = yaml.safe_load(completed.stdout)
        self.assertEqual(converted['compute']['backendName'], 'override-name')
        self.assertEqual(converted['podDefaults']['nodeSelector'], {
            'pool': 'override',
            'arch': 'amd64',
        })


if __name__ == '__main__':
    unittest.main()
