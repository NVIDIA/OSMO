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

import copy
import io
import os
from pathlib import Path
import tempfile
import unittest
from typing import Any, Dict
from unittest import mock

import yaml

from deployments.upgrades import export_configs_to_helm as exporter


def _empty_export() -> Dict[str, Any]:
    configs: Dict[str, Any] = {
        section: {} for section in exporter.RUNTIME_SECTION_NAMES
    }
    configs['roles'] = {
        'osmo-default': {
            'description': 'Default role',
            'policies': [],
            'external_roles': [],
        },
    }
    return configs


class SecretMappingTest(unittest.TestCase):

    def test_legacy_actions_block_unified_export_without_partial_yaml(self):
        configs = _empty_export()
        configs['roles']['osmo-default']['policies'] = [
            {'actions': ['*:*'], 'resources': ['*']},
            {'effect': 'Deny', 'actions': [{
                'base': 'http', 'path': '/api/workflow/*', 'method': 'GET',
            }]},
        ]
        original = copy.deepcopy(configs)
        with mock.patch.object(exporter, 'collect_configs', return_value=configs), \
                mock.patch('sys.argv', ['export', '--url', 'https://osmo.example.com']), \
                mock.patch('sys.stdout', new_callable=io.StringIO) as stdout, \
                mock.patch('sys.stderr', new_callable=io.StringIO) as stderr:
            self.assertEqual(exporter.main(), 2)
        self.assertEqual(stdout.getvalue(), '')
        self.assertIn('roles.osmo-default', stderr.getvalue())
        self.assertIn('policies.1.actions', stderr.getvalue())
        self.assertIn('Action 0: legacy path-based actions', stderr.getvalue())
        self.assertEqual(configs, original)
        legacy = exporter.build_helm_values(configs, 'legacy', [])
        self.assertEqual(legacy['services']['configs']['roles'], configs['roles'])

    def test_unified_export_validates_without_rewriting_role_definitions(self):
        configs = _empty_export()
        configs['roles']['osmo-default'].update({
            'sync_mode': 'force',
            'external_roles': ['idp-users'],
            'policies': [
                {'actions': ['workflow:Read', {'action': 'workflow:Create'}],
                 'resources': ['pool/team-a']},
                {'effect': 'Deny', 'actions': ['workflow:Create'], 'resources': []},
            ],
        })
        original = copy.deepcopy(configs)
        values = exporter.build_helm_values(configs, 'unified', [])
        self.assertEqual(values['configuration']['snapshot']['roles'], original['roles'])
        self.assertEqual(configs, original)

    def test_partial_api_export_is_rejected(self):
        with mock.patch.multiple(
                exporter,
                export_singleton=mock.Mock(side_effect=[{}, {}]),
                export_backends=mock.Mock(return_value=None),
                export_pools=mock.Mock(return_value={}),
                export_named_configs=mock.Mock(return_value={}),
                export_roles=mock.Mock(return_value={})):
            with self.assertRaisesRegex(ValueError, 'backends'):
                exporter.collect_configs('https://osmo.example.com', {})

    def test_mapping_rejects_secret_path_traversal(self):
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml') as mapping_file:
            yaml.safe_dump(
                {
                    'secretMappings': [{
                        'path': 'workflow.workflow_alerts',
                        'secretName': 'osmo-alerts',
                        'secretKey': '../../token',
                    }],
                },
                mapping_file,
            )
            mapping_file.flush()

            with self.assertRaisesRegex(ValueError, 'Secret key'):
                exporter.load_secret_mappings(mapping_file.name)

    def test_mapping_requires_explicit_secret_key(self):
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml') as mapping_file:
            yaml.safe_dump(
                {
                    'secretMappings': [{
                        'path': 'workflow.workflow_alerts',
                        'secretName': 'osmo-alerts',
                    }],
                },
                mapping_file,
            )
            mapping_file.flush()

            with self.assertRaisesRegex(ValueError, 'secretKey is required'):
                exporter.load_secret_mappings(mapping_file.name)

    def test_mapping_rejects_overlapping_paths_in_either_order(self):
        paths = [
            'workflow.workflow_alerts',
            'workflow.workflow_alerts.slack_token',
        ]
        for ordered_paths in (paths, list(reversed(paths))):
            with self.subTest(paths=ordered_paths), tempfile.NamedTemporaryFile(
                    mode='w', suffix='.yaml') as mapping_file:
                yaml.safe_dump(
                    {
                        'secretMappings': [
                            {
                                'path': mapping_path,
                                'secretName': f'osmo-alerts-{index}',
                                'secretKey': 'alerts.yaml',
                            }
                            for index, mapping_path in enumerate(ordered_paths)
                        ],
                    },
                    mapping_file,
                )
                mapping_file.flush()

                with self.assertRaisesRegex(ValueError, 'overlap'):
                    exporter.load_secret_mappings(mapping_file.name)

    def test_existing_invalid_secret_reference_is_rejected(self):
        configs = _empty_export()
        configs['workflow'] = {
            'workflow_alerts': {
                'secretName': '../outside',
                'secretKey': 'alerts.yaml',
            },
        }

        with self.assertRaisesRegex(ValueError, 'Secret name'):
            exporter.validate_secret_references(configs)

    def test_secret_name_rejects_dns_label_longer_than_63_characters(self):
        configs = _empty_export()
        configs['workflow'] = {
            'workflow_alerts': {
                'secretName': ('a' * 64) + '.valid',
                'secretKey': 'alerts.yaml',
            },
        }

        with self.assertRaisesRegex(ValueError, 'Secret name'):
            exporter.validate_secret_references(configs)

    def test_existing_secret_file_reference_is_rejected(self):
        configs = _empty_export()
        configs['workflow'] = {
            'workflow_alerts': {
                'secret_file': '/tmp/alerts.yaml',
            },
        }

        with self.assertRaisesRegex(ValueError, 'not supported'):
            exporter.validate_secret_references(configs)

    def test_masked_secret_requires_mapping(self):
        configs = _empty_export()
        configs['workflow'] = {
            'workflow_alerts': {'slack_token': exporter.MASKED_SECRET},
        }

        with self.assertRaisesRegex(
                ValueError,
                r'workflow\.workflow_alerts\.slack_token'):
            exporter.apply_secret_mappings(configs, [])

    def test_mapping_preserves_nonsecret_fields(self):
        configs = _empty_export()
        configs['workflow'] = {
            'workflow_alerts': {
                'slack_token': exporter.MASKED_SECRET,
                'smtp_settings': {'host': 'mail.example.com'},
            },
        }
        mappings = [
            (
                ('workflow', 'workflow_alerts'),
                {'secretName': 'osmo-alerts', 'secretKey': 'alerts.yaml'},
            ),
        ]

        exporter.apply_secret_mappings(configs, mappings)

        self.assertEqual(
            configs['workflow']['workflow_alerts'],
            {
                'smtp_settings': {'host': 'mail.example.com'},
                'secretName': 'osmo-alerts',
                'secretKey': 'alerts.yaml',
            },
        )
        values = exporter.build_helm_values(
            configs, 'unified', mapped_secret_names=['osmo-alerts'])
        self.assertIn('configuration', values)
        self.assertIn('roles', values['configuration']['snapshot'])
        self.assertEqual(
            values['configuration']['secretRefs'],
            [{'secretName': 'osmo-alerts'}],
        )
        self.assertNotIn(exporter.MASKED_SECRET, yaml.safe_dump(values))

    def test_enclosing_mapping_removes_masked_list_values(self):
        configs = _empty_export()
        configs['workflow'] = {
            'workflow_alerts': {
                'tokens': [exporter.MASKED_SECRET],
            },
        }

        exporter.apply_secret_mappings(
            configs,
            [(
                ('workflow', 'workflow_alerts'),
                {'secretName': 'osmo-alerts', 'secretKey': 'alerts.yaml'},
            )],
        )

        self.assertNotIn(
            exporter.MASKED_SECRET,
            yaml.safe_dump(exporter.build_helm_values(
                configs, 'unified', mapped_secret_names=['osmo-alerts'])),
        )

    def test_workload_secret_is_not_mounted_as_control_plane_config(self):
        configs = _empty_export()
        configs['podTemplates'] = {
            'workload': {
                'spec': {
                    'volumes': [{
                        'name': 'workload-credentials',
                        'secret': {'secretName': 'backend-only-secret'},
                    }],
                },
            },
        }

        exporter.validate_secret_references(
            configs, secrets_root='/control-plane/secrets')
        values = exporter.build_helm_values(configs, 'unified', [])

        self.assertNotIn('secretRefs', values['configuration'])
        workload_secret = values['configuration']['snapshot'][
            'podTemplates']['workload']['spec']['volumes'][0]['secret']
        self.assertEqual(
            workload_secret, {'secretName': 'backend-only-secret'})

    def test_legacy_output_is_explicit(self):
        configs = _empty_export()
        configs['workflow'] = {
            'backend_images': {
                'init': 'registry.example.com/init:6.3',
                'client': 'registry.example.com/client:6.3',
            },
        }
        configs['roles']['osmo-default']['sync_mode'] = 'force'

        values = exporter.build_helm_values(configs, 'legacy', [])

        self.assertTrue(values['services']['configs']['enabled'])
        self.assertNotIn('configuration', values)
        managed = values['services']['configs']
        self.assertEqual(managed['workflow']['backend_images'], {
            'init': 'registry.example.com/init:6.3',
            'client': 'registry.example.com/client:6.3',
        })
        self.assertNotIn('sync_mode', managed['roles']['osmo-default'])

    def test_unified_output_owns_release_images_and_preserves_sync_mode(self):
        configs = _empty_export()
        configs['workflow'] = {
            'backend_images': {
                'init': 'registry.example.com/init:6.3',
                'client': 'registry.example.com/client:6.3',
                'credential': {'secretName': 'registry-credential'},
            },
        }
        configs['roles']['osmo-default']['sync_mode'] = 'force'

        values = exporter.build_helm_values(configs, 'unified', [])

        snapshot = values['configuration']['snapshot']
        self.assertEqual(snapshot['workflow']['backend_images'], {
            'credential': {'secretName': 'registry-credential'},
        })
        self.assertEqual(
            snapshot['roles']['osmo-default']['sync_mode'], 'force')

    def test_unified_output_matches_chart_render_fixture(self):
        values = exporter.build_helm_values(_empty_export(), 'unified', [])
        fixture_path = (
            Path(__file__).parents[2]
            / 'charts/osmo/tests/unified-export-values.yaml'
        )

        with fixture_path.open(encoding='utf-8') as fixture_file:
            expected = yaml.safe_load(fixture_file)

        self.assertEqual(values, expected)
        self.assertNotIn('enabled', values['configuration'])

    def test_roles_export_preserves_sync_mode(self):
        with mock.patch.object(exporter, 'fetch', return_value=[{
            'name': 'operator',
            'description': 'Operator role',
            'policies': [],
            'immutable': False,
            'external_roles': ['operator-group'],
            'sync_mode': 'force',
        }]):
            roles = exporter.export_roles('https://osmo.example.com', {})

        self.assertEqual(roles, {
            'operator': {
                'description': 'Operator role',
                'policies': [],
                'immutable': False,
                'external_roles': ['operator-group'],
                'sync_mode': 'force',
            },
        })

    def test_workflow_export_preserves_legacy_release_images(self):
        with mock.patch.object(exporter, 'fetch', return_value={
            'backend_images': {
                'init': 'registry.example.com/init:6.3',
                'client': 'registry.example.com/client:6.3',
                'credential': {'secretName': 'registry-credential'},
            },
        }):
            workflow = exporter.export_workflow(
                'https://osmo.example.com', {})

        self.assertEqual(workflow, {
            'backend_images': {
                'init': 'registry.example.com/init:6.3',
                'client': 'registry.example.com/client:6.3',
                'credential': {'secretName': 'registry-credential'},
            },
        })

    def test_idp_sync_preflight_reports_force_assignments_and_pats(self):
        responses = {
            '/api/auth/user?start_index=1&count=1000': {
                'users': [{'id': 'alice@example.com'}],
                'total_results': 1,
            },
            '/api/auth/user/alice%40example.com/roles': {
                'roles': [{
                    'role_name': 'operator',
                    'assigned_by': 'idp-sync',
                }],
            },
            '/api/auth/user/alice%40example.com/access_token': [{
                'token_name': 'automation',
                'roles': ['operator'],
            }],
        }
        with mock.patch.object(
                exporter, 'fetch', side_effect=lambda _, path, __: responses[path]), \
                mock.patch('sys.stderr') as stderr:
            exporter.report_idp_sync_upgrade_risks(
                'https://osmo.example.com', {}, {
                    'operator': {'sync_mode': 'force'},
                })

        output = ''.join(call.args[0] for call in stderr.write.call_args_list)
        self.assertIn('1 force-derived user role assignment(s)', output)
        self.assertIn('1 associated PAT grant(s)', output)
        self.assertIn('request-driven', output)

    def test_idp_sync_preflight_fails_if_assignment_audit_is_incomplete(self):
        with mock.patch.object(exporter, 'fetch', return_value=None):
            with self.assertRaisesRegex(ValueError, 'enumerate users'):
                exporter.report_idp_sync_upgrade_risks(
                    'https://osmo.example.com', {}, {
                        'operator': {'sync_mode': 'force'},
                    })

    def test_idp_sync_preflight_rejects_malformed_audit_records(self):
        role_config = {'operator': {'sync_mode': 'force'}}
        cases = {
            'user': [{
                'users': [None], 'total_results': 1,
            }],
            'assignments': [{
                'users': [{'id': 'alice'}], 'total_results': 1,
            }, {}],
            'PAT': [{
                'users': [{'id': 'alice'}], 'total_results': 1,
            }, {
                'roles': [{
                    'role_name': 'operator', 'assigned_by': 'idp-sync',
                }],
            }, [{'token_name': 'broken'}]],
        }
        for record_type, responses in cases.items():
            with self.subTest(record_type=record_type), mock.patch.object(
                    exporter, 'fetch', side_effect=responses):
                with self.assertRaisesRegex(ValueError, 'malformed'):
                    exporter.report_idp_sync_upgrade_risks(
                        'https://osmo.example.com', {}, role_config)

    def test_idp_sync_preflight_rejects_incomplete_pagination(self):
        responses = [{
            'users': [{'id': 'alice'}], 'total_results': 2,
        }, {
            'users': [], 'total_results': 2,
        }]
        with mock.patch.object(exporter, 'fetch', side_effect=responses):
            with self.assertRaisesRegex(ValueError, 'before all users'):
                exporter.report_idp_sync_upgrade_risks(
                    'https://osmo.example.com', {}, {
                        'operator': {'sync_mode': 'force'},
                    })

    def test_idp_sync_preflight_rejects_inconsistent_pagination_total(self):
        responses = [{
            'users': [{'id': 'alice'}], 'total_results': 3,
        }, {
            'users': [{'id': 'bob'}], 'total_results': 2,
        }]
        with mock.patch.object(exporter, 'fetch', side_effect=responses):
            with self.assertRaisesRegex(ValueError, 'inconsistent user count'):
                exporter.report_idp_sync_upgrade_risks(
                    'https://osmo.example.com', {}, {
                        'operator': {'sync_mode': 'force'},
                    })

    def test_idp_sync_preflight_enumerates_two_pages(self):
        responses = [{
            'users': [{'id': 'alice'}], 'total_results': 2,
        }, {
            'users': [{'id': 'bob'}], 'total_results': 2,
        }, {
            'roles': [],
        }, {
            'roles': [],
        }]
        with mock.patch.object(
                exporter, 'fetch', side_effect=responses) as fetch:
            exporter.report_idp_sync_upgrade_risks(
                'https://osmo.example.com', {}, {
                    'operator': {'sync_mode': 'force'},
                })

        self.assertIn(
            'start_index=2', fetch.call_args_list[1].args[1])

    def test_idp_sync_preflight_rejects_duplicate_users(self):
        responses = [{
            'users': [{'id': 'alice'}], 'total_results': 2,
        }, {
            'users': [{'id': 'alice'}], 'total_results': 2,
        }]
        with mock.patch.object(exporter, 'fetch', side_effect=responses):
            with self.assertRaisesRegex(ValueError, 'duplicate user'):
                exporter.report_idp_sync_upgrade_risks(
                    'https://osmo.example.com', {}, {
                        'operator': {'sync_mode': 'force'},
                    })


class ConfigVerificationTest(unittest.TestCase):

    @staticmethod
    def _write_rendered_config(path, runtime, inject_runtime_images=True):
        runtime = copy.deepcopy(runtime)
        if inject_runtime_images:
            backend_images = runtime.setdefault(
                'workflow', {}).setdefault('backend_images', {})
            backend_images.setdefault(
                'init', 'registry.example.com/osmo/init-container:6.4')
            backend_images.setdefault(
                'client', 'registry.example.com/osmo/client:6.4')
        with open(path, 'w', encoding='utf-8') as rendered_file:
            yaml.safe_dump_all(
                [
                    {
                        'apiVersion': 'v1',
                        'kind': 'ConfigMap',
                        'metadata': {
                            'name': 'osmo-gateway-ratelimit-config',
                        },
                        'data': {
                            'config.yaml': yaml.safe_dump({
                                'domain': 'ratelimit',
                                'descriptors': [],
                            }),
                        },
                    },
                    {
                        'apiVersion': 'v1',
                        'kind': 'ConfigMap',
                        'metadata': {'name': 'osmo-api-config'},
                        'data': {'config.yaml': yaml.safe_dump(runtime)},
                    },
                ],
                rendered_file,
            )

    def test_rendered_config_and_mounted_secret_pass_production_validation(self):
        configs = _empty_export()
        configs['workflow'] = {
            'workflow_alerts': {
                'slack_token': {
                    'secretName': 'osmo-alerts',
                    'secretKey': 'slack-token.yaml',
                },
            },
        }
        runtime = exporter.to_runtime_config(configs)

        with tempfile.TemporaryDirectory() as temp_dir:
            secret_dir = os.path.join(temp_dir, 'osmo-alerts')
            os.makedirs(secret_dir)
            with open(
                    os.path.join(secret_dir, 'slack-token.yaml'),
                    'w', encoding='utf-8') as secret_file:
                yaml.safe_dump({'value': 'xoxb-test-token'}, secret_file)

            rendered_path = os.path.join(temp_dir, 'rendered.yaml')
            self._write_rendered_config(rendered_path, runtime)

            exporter.verify_rendered_config(
                configs, rendered_path, temp_dir)

    def test_missing_mounted_secret_is_rejected(self):
        configs = _empty_export()
        configs['workflow'] = {
            'workflow_alerts': {
                'secretName': 'missing-alerts',
                'secretKey': 'alerts.yaml',
            },
        }
        runtime = exporter.to_runtime_config(configs)

        with tempfile.TemporaryDirectory() as temp_dir:
            rendered_path = os.path.join(temp_dir, 'rendered.yaml')
            self._write_rendered_config(rendered_path, runtime)

            with self.assertRaisesRegex(ValueError, 'unreadable'):
                exporter.verify_rendered_config(
                    configs, rendered_path, temp_dir)

    def test_mapped_secret_must_supply_original_masked_field(self):
        configs = _empty_export()
        configs['workflow'] = {
            'workflow_alerts': {
                'secretName': 'osmo-alerts',
                'secretKey': 'alerts.yaml',
            },
        }
        runtime = exporter.to_runtime_config(configs)

        with tempfile.TemporaryDirectory() as temp_dir:
            secret_dir = os.path.join(temp_dir, 'osmo-alerts')
            os.makedirs(secret_dir)
            with open(
                    os.path.join(secret_dir, 'alerts.yaml'),
                    'w', encoding='utf-8') as secret_file:
                yaml.safe_dump({'smtp_settings': {}}, secret_file)
            rendered_path = os.path.join(temp_dir, 'rendered.yaml')
            self._write_rendered_config(rendered_path, runtime)

            with self.assertRaisesRegex(ValueError, 'required fields'):
                exporter.verify_rendered_config(
                    configs,
                    rendered_path,
                    temp_dir,
                    {('workflow', 'workflow_alerts', 'slack_token')},
                )

    def test_rendered_mismatch_is_rejected(self):
        configs = _empty_export()
        configs['service'] = {
            'service_base_url': 'https://live.osmo.example.com',
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            rendered_path = os.path.join(temp_dir, 'rendered.yaml')
            mismatched = copy.deepcopy(exporter.to_runtime_config(configs))
            mismatched['service']['service_base_url'] = (
                'https://wrong.osmo.example.com')
            self._write_rendered_config(rendered_path, mismatched)

            with self.assertRaisesRegex(ValueError, 'does not match'):
                exporter.verify_rendered_config(
                    configs, rendered_path, temp_dir)

    def test_rendered_config_requires_release_owned_workflow_images(self):
        configs = _empty_export()
        runtime = exporter.to_runtime_config(configs)

        with tempfile.TemporaryDirectory() as temp_dir:
            rendered_path = os.path.join(temp_dir, 'rendered.yaml')
            self._write_rendered_config(
                rendered_path, runtime, inject_runtime_images=False)
            with self.assertRaisesRegex(ValueError, 'release-owned workflow'):
                exporter.verify_rendered_config(
                    configs, rendered_path, temp_dir)

    def test_rendered_config_requires_all_nine_sections(self):
        configs = _empty_export()
        runtime = exporter.to_runtime_config(configs)
        runtime.pop('backend_tests')

        with tempfile.TemporaryDirectory() as temp_dir:
            rendered_path = os.path.join(temp_dir, 'rendered.yaml')
            self._write_rendered_config(rendered_path, runtime)
            with self.assertRaisesRegex(ValueError, 'exactly the nine'):
                exporter.verify_rendered_config(
                    configs, rendered_path, temp_dir)

    def test_rendered_config_rejects_dangling_runtime_references(self):
        configs = _empty_export()
        configs['pools'] = {
            'pool-a': {
                'backend': 'missing-backend',
                'common_pod_template': [],
                'common_resource_validations': [],
                'common_group_templates': [],
                'platforms': {},
            },
        }
        runtime = exporter.to_runtime_config(configs)

        with tempfile.TemporaryDirectory() as temp_dir:
            rendered_path = os.path.join(temp_dir, 'rendered.yaml')
            self._write_rendered_config(rendered_path, runtime)
            with self.assertRaisesRegex(ValueError, 'missing backend'):
                exporter.verify_rendered_config(
                    configs, rendered_path, temp_dir)

    def test_rendered_config_rejects_payload_over_one_mib(self):
        configs = _empty_export()
        runtime = exporter.to_runtime_config(configs)
        runtime['pod_templates'] = {
            'oversized': {'payload': 'x' * exporter.MAX_CONFIGMAP_DATA_BYTES},
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            rendered_path = os.path.join(temp_dir, 'rendered.yaml')
            self._write_rendered_config(rendered_path, runtime)
            with self.assertRaisesRegex(ValueError, '1 MiB'):
                exporter.verify_rendered_config(
                    configs, rendered_path, temp_dir)


if __name__ == '__main__':
    unittest.main()
