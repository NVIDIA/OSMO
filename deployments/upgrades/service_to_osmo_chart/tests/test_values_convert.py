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
"""

import pathlib
import subprocess
import sys
import tempfile
import unittest

import yaml

from deployments.upgrades.service_to_osmo_chart import values_convert


class ValuesConvertTest(unittest.TestCase):
    """Tests lossless mappings and explicit conversion boundaries."""

    def test_maps_control_plane_values(self):
        legacy = {
            'global': {
                'osmoImageLocation': 'registry.example.com/team/osmo',
                'osmoImageTag': '6.4.0',
                'imagePullSecret': 'registry-credential',
                'hostname': 'staging.example.com',
                'serviceAccountName': 'osmo-workload',
            },
            'services': {
                'postgres': {
                    'enabled': False,
                    'serviceName': 'postgres.example.com',
                    'port': 5433,
                    'db': 'osmo_db',
                    'user': 'osmo',
                    'passwordSecretName': 'postgres-credential',
                },
                'redis': {
                    'enabled': False,
                    'serviceName': 'valkey.example.com',
                    'port': 6380,
                    'dbNumber': 4,
                    'tlsEnabled': False,
                    'passwordSecretName': 'valkey-credential',
                },
                'worker': {
                    'scaling': {
                        'enabled': True,
                        'minReplicas': 3,
                        'maxReplicas': 7,
                    },
                    'nodeSelector': {'pool': 'control'},
                    'extraPodAnnotations': {'example.com/injected': 'true'},
                    'extraVolumes': [{'name': 'injected'}],
                },
                'service': {
                    'auth': {
                        'enabled': True,
                        'device_endpoint': 'https://idp.example/device',
                        'device_client_id': 'device-client',
                        'browser_endpoint': 'https://idp.example/browser',
                        'browser_client_id': 'browser-client',
                        'token_endpoint': 'https://idp.example/token',
                        'logout_endpoint': 'https://idp.example/logout',
                    },
                },
                'configs': {
                    'enabled': True,
                    'workflow': {
                        'workflow_data': {
                            'credential': {
                                'endpoint': 'azure://account/data/workflows',
                            },
                        },
                        'workflow_log': {
                            'credential': {
                                'endpoint': 'azure://account/data/logs',
                            },
                        },
                        'workflow_app': {
                            'credential': {
                                'endpoint': 'azure://account/data/apps',
                            },
                        },
                        'max_num_tasks': 50,
                    },
                },
            },
            'gateway': {
                'envoy': {
                    'image': 'envoyproxy/envoy:v1.38.1',
                    'scaling': {'minReplicas': 2, 'maxReplicas': 4},
                    'service': {'type': 'ClusterIP', 'httpsPort': 443},
                    'ingress': {
                        'enabled': True,
                        'ingressClass': 'alb',
                        'albAnnotations': {
                            'enabled': True,
                            'groupName': 'osmo',
                            'groupOrder': '20',
                            'sslCertArn': 'example-certificate',
                        },
                    },
                    'jwt': {'user_header': 'x-user', 'providers': []},
                },
                'upstreams': {
                    'service': {'enabled': True, 'host': 'osmo-service'},
                },
                'networkPolicies': {
                    'enabled': True,
                    'upstreams': [{
                        'name': 'osmo-service',
                        'podSelector': {'app': 'osmo-service'},
                        'port': 8000,
                    }],
                },
                'oauth2Proxy': {
                    'redis': {
                        'serviceName': 'valkey.example.com',
                        'port': 6380,
                        'dbNumber': 3,
                        'tlsEnabled': False,
                    },
                },
            },
            'podMonitor': {'enabled': True},
        }

        result = values_convert.convert_values(legacy)

        self.assertEqual(result.issues, [])
        converted = result.values
        self.assertEqual(converted['imageRegistry'], 'registry.example.com')
        self.assertEqual(converted['imageRepository'], 'team/osmo')
        self.assertEqual(converted['fullnameOverride'], 'osmo')
        self.assertEqual(converted['externalUrl'],
                         'https://staging.example.com')
        self.assertEqual(converted['externalDependencies']['postgresql'], {
            'host': 'postgres.example.com',
            'port': 5433,
            'database': 'osmo_db',
            'username': 'osmo',
        })
        self.assertEqual(converted['externalDependencies']['valkey'], {
            'host': 'valkey.example.com',
            'port': 6380,
            'database': 4,
            'tls': {'enabled': False},
        })
        self.assertEqual(
            converted['externalDependencies']['objectStorage'], {
                'authentication': {'type': 'sdkDefault'},
                'locations': {
                    'workflows': 'azure://account/data/workflows',
                    'logs': 'azure://account/data/logs',
                    'apps': 'azure://account/data/apps',
                },
            })
        self.assertEqual(
            converted['services']['worker']['autoscaling']['minReplicas'], 3)
        self.assertTrue(
            converted['services']['worker']['autoscaling']['enabled'])
        self.assertEqual(
            converted['services']['worker']['pod']['nodeSelector'],
            {'pool': 'control'})
        self.assertEqual(
            converted['services']['api']['auth']['deviceEndpoint'],
            'https://idp.example/device')
        self.assertEqual(converted['gateway']['envoy']['image'], {
            'registry': 'docker.io',
            'repository': 'envoyproxy/envoy',
            'tag': 'v1.38.1',
        })
        self.assertEqual(converted['gateway']['envoy']['jwt']['userHeader'],
                         'x-user')
        self.assertTrue(
            converted['gateway']['envoy']['autoscaling']['enabled'])
        self.assertEqual(
            converted['gateway']['envoy']['service']['extraPorts'], [{
                'name': 'https',
                'port': 443,
                'targetPort': 'envoy-http',
                'protocol': 'TCP',
            }])
        self.assertEqual(converted['gateway']['upstreams']['api']['host'],
                         '')
        self.assertEqual(converted['gateway']['oauth2Proxy']['redisDatabase'],
                         3)
        self.assertEqual(converted['gateway']['networkPolicies']['upstreams'],
                         [{'name': 'api', 'component': 'api', 'port': 8000}])
        self.assertTrue(
            converted['monitoring']['podMonitor']['control']['enabled'])

    def test_reports_every_unmapped_leaf_without_values(self):
        result = values_convert.convert_values({
            'unknown': {
                'token': 'must-not-appear-in-diagnostic',
                'nested': {'setting': True},
            },
        })

        issue_paths = [issue.path for issue in result.issues]
        messages = '\n'.join(issue.message for issue in result.issues)
        self.assertIn('unknown.token', issue_paths)
        self.assertIn('unknown.nested.setting', issue_paths)
        self.assertNotIn('must-not-appear-in-diagnostic', messages)

    def test_maps_swift_storage_and_per_location_secrets(self):
        result = values_convert.convert_values({
            'services': {
                'configs': {
                    'secretRefs': [{'secretName': 'workflow-data'}],
                    'workflow': {
                        'workflow_data': {
                            'credential': {
                                'endpoint': 'swift://data/workflows',
                                'secretName': 'workflow-data',
                            },
                            'base_url': 'https://swift.example.com/workflows',
                            'download_type': 'download',
                        },
                        'workflow_log': {
                            'credential': {
                                'endpoint': 'swift://logs/logs',
                                'secretName': 'workflow-logs',
                            },
                        },
                        'workflow_app': {
                            'credential': {
                                'endpoint': 'swift://apps/apps',
                                'secretName': 'workflow-apps',
                            },
                        },
                    },
                },
            },
        })

        issue_paths = {issue.path for issue in result.issues}
        self.assertIn('services.configs.secretRefs', issue_paths)
        self.assertNotIn('externalDependencies.objectStorage.locations',
                         issue_paths)
        self.assertEqual(
            result.values['externalDependencies']['objectStorage']
            ['authentication']['type'],
            'static')
        self.assertEqual(
            result.values['externalDependencies']['objectStorage']['locations'],
            {
                'workflows': 'swift://data/workflows',
                'logs': 'swift://logs/logs',
                'apps': 'swift://apps/apps',
            })
        self.assertEqual(
            result.values['secrets']['objectStorage']['credentialSecretRefs'],
            {
                'workflows': {'name': 'workflow-data', 'key': ''},
                'logs': {'name': 'workflow-logs', 'key': ''},
                'apps': {'name': 'workflow-apps', 'key': ''},
            })
        self.assertEqual(
            result.values['configuration']['workflow']['workflow_data'],
            {
                'base_url': 'https://swift.example.com/workflows',
                'download_type': 'download',
            })

    def test_reports_unsupported_storage_scheme(self):
        result = values_convert.convert_values({
            'services': {
                'configs': {
                    'workflow': {
                        name: {'credential': {'endpoint': f'ftp://{name}'}}
                        for name in (
                            'workflow_data', 'workflow_log', 'workflow_app')
                    },
                },
            },
        })

        issue_paths = {issue.path for issue in result.issues}
        self.assertIn('externalDependencies.objectStorage.locations',
                      issue_paths)

    def test_cli_is_strict_unless_partial_output_is_requested(self):
        script = pathlib.Path(values_convert.__file__)
        with tempfile.TemporaryDirectory() as temporary_directory:
            values_path = pathlib.Path(temporary_directory) / 'values.yaml'
            values_path.write_text(
                yaml.safe_dump({'unsupported': {'setting': True}}),
                encoding='utf-8')
            strict = subprocess.run(
                [sys.executable, str(script), str(values_path)],
                check=False, capture_output=True, text=True)
            partial = subprocess.run(
                [sys.executable, str(script), '--allow-unmapped',
                 str(values_path)],
                check=False, capture_output=True, text=True)

        self.assertEqual(strict.returncode, 2)
        self.assertEqual(strict.stdout, '')
        self.assertIn('unsupported.setting', strict.stderr)
        self.assertEqual(partial.returncode, 0)
        self.assertIn('planes:', partial.stdout)
        self.assertIn('unsupported.setting', partial.stderr)


if __name__ == '__main__':
    unittest.main()
