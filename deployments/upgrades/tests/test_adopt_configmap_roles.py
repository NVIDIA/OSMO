"""Tests for the two-phase 6.3 ConfigMap role adoption gate."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
# SPDX-License-Identifier: Apache-2.0

import json
import os
import tempfile
import unittest
from unittest import mock

import yaml

from deployments.upgrades import adopt_configmap_roles as adoption


class RoleAdoptionTest(unittest.TestCase):

    def _write_yaml(self, directory, name, value):
        path = os.path.join(directory, name)
        with open(path, 'w', encoding='utf-8') as output_file:
            yaml.safe_dump(value, output_file)
        return path

    def test_load_requires_explicit_sync_mode_and_matches_file_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            roles_path = self._write_yaml(directory, 'roles.yaml', {
                'roles': {
                    'osmo-default': {
                        'description': 'default',
                        'policies': [{'actions': ['auth:Login']}],
                        'external_roles': [],
                        'immutable': True,
                    },
                },
            })
            sync_path = self._write_yaml(directory, 'sync.yaml', {
                'syncModes': {'osmo-default': 'force'},
            })

            roles = adoption.load_desired_roles(roles_path, sync_path)

            self.assertEqual(roles[0]['sync_mode'], 'force')
            self.assertEqual(roles[0]['external_roles'], ['osmo-default'])
            self.assertTrue(roles[0]['immutable'])

    def test_load_rejects_missing_sync_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            roles_path = self._write_yaml(directory, 'roles.yaml', {
                'roles': {'custom': {'description': '', 'policies': []}},
            })
            sync_path = self._write_yaml(directory, 'sync.yaml', {'syncModes': {}})
            with self.assertRaisesRegex(adoption.AdoptionError, 'missing'):
                adoption.load_desired_roles(roles_path, sync_path)

    def test_load_rejects_non_boolean_immutable_flag(self):
        with tempfile.TemporaryDirectory() as directory:
            roles_path = self._write_yaml(directory, 'roles.yaml', {
                'roles': {'custom': {'immutable': 'false', 'policies': []}},
            })
            sync_path = self._write_yaml(directory, 'sync.yaml', {
                'syncModes': {'custom': 'import'},
            })
            with self.assertRaisesRegex(adoption.AdoptionError, 'immutable'):
                adoption.load_desired_roles(roles_path, sync_path)

    def test_load_rejects_legacy_action_maps(self):
        with tempfile.TemporaryDirectory() as directory:
            roles_path = self._write_yaml(directory, 'roles.yaml', {
                'roles': {
                    'custom': {
                        'policies': [{
                            'actions': [{'path': '/api/legacy', 'method': 'GET'}],
                        }],
                    },
                },
            })
            sync_path = self._write_yaml(directory, 'sync.yaml', {
                'syncModes': {'custom': 'import'},
            })
            with self.assertRaisesRegex(adoption.AdoptionError, 'semantic string actions'):
                adoption.load_desired_roles(roles_path, sync_path)

    def test_load_uses_production_semantic_action_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            roles_path = self._write_yaml(directory, 'roles.yaml', {
                'roles': {
                    'custom': {
                        'policies': [{'actions': ['not-a-semantic-action']}],
                    },
                },
            })
            sync_path = self._write_yaml(directory, 'sync.yaml', {
                'syncModes': {'custom': 'import'},
            })
            with self.assertRaisesRegex(adoption.AdoptionError, 'production role validator'):
                adoption.load_desired_roles(roles_path, sync_path)

    def test_write_roles_rejects_db_only_roles_before_mutation(self):
        cursor = mock.MagicMock()
        desired = [{
            'name': 'configured',
            'description': '',
            'policies': [],
            'immutable': False,
            'sync_mode': 'ignore',
            'external_roles': ['configured'],
        }]
        with mock.patch.object(
            adoption,
            '_read_db_roles',
            return_value=[{'name': 'configured'}, {'name': 'db-only'}],
        ):
            with self.assertRaisesRegex(adoption.AdoptionError, 'db-only'):
                adoption._validate_adoption_set(
                    [{'name': 'configured'}, {'name': 'db-only'}], desired)
        cursor.execute.assert_not_called()

    def test_role_diff_is_deterministic_and_non_mutating(self):
        current = [{
            'name': 'same', 'description': '', 'policies': [],
            'immutable': True, 'sync_mode': 'ignore',
            'external_roles': ['same'],
        }, {
            'name': 'changed', 'description': 'old', 'policies': [],
            'immutable': False, 'sync_mode': 'import',
            'external_roles': ['changed'],
        }]
        desired = [{
            'name': 'new', 'description': '', 'policies': [],
            'immutable': False, 'sync_mode': 'import',
            'external_roles': ['new'],
        }, current[0], {
            **current[1], 'description': 'new', 'immutable': True,
        }]

        self.assertEqual(adoption._role_diff(current, desired), {
            'create': ['new'],
            'update': ['changed'],
            'unchanged': ['same'],
        })

    def test_verified_receipt_detects_tampering(self):
        receipt = {
            'formatVersion': 1,
            'status': 'verified',
            'hybridVersion': '6.3-hybrid@sha256:abc',
            'preparedAt': '2026-01-01T00:00:00+00:00',
            'verifiedAt': '2026-01-01T00:01:00+00:00',
            'rolesHash': 'a' * 64,
            'assignmentsHash': 'b' * 64,
            'probeEvidence': {
                'hybridVersion': '6.3-hybrid@sha256:abc',
                'loginJwt': {'passed': True, 'evidence': 'login test 1'},
                'personalAccessToken': {'passed': True, 'evidence': 'PAT test 2'},
                'poolAuthorization': {'passed': True, 'evidence': 'pool test 3'},
            },
        }
        receipt['receiptHash'] = adoption._digest(receipt)
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as receipt_file:
            json.dump(receipt, receipt_file)
            receipt_file.flush()
            adoption.verify_receipt(receipt_file.name)
            receipt['rolesHash'] = 'c' * 64
            receipt_file.seek(0)
            receipt_file.truncate()
            json.dump(receipt, receipt_file)
            receipt_file.flush()
            with self.assertRaisesRegex(adoption.AdoptionError, 'modified'):
                adoption.verify_receipt(receipt_file.name)

    def test_verified_receipt_requires_every_probe(self):
        receipt = {
            'formatVersion': 1,
            'status': 'verified',
            'hybridVersion': '6.3-hybrid@sha256:abc',
            'preparedAt': '2026-01-01T00:00:00+00:00',
            'verifiedAt': '2026-01-01T00:01:00+00:00',
            'rolesHash': 'a' * 64,
            'assignmentsHash': 'b' * 64,
            'probeEvidence': {
                'hybridVersion': '6.3-hybrid@sha256:abc',
                'loginJwt': {'passed': True, 'evidence': 'login test 1'},
                'personalAccessToken': {'passed': True, 'evidence': 'PAT test 2'},
            },
        }
        receipt['receiptHash'] = adoption._digest(receipt)
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as receipt_file:
            json.dump(receipt, receipt_file)
            receipt_file.flush()
            with self.assertRaisesRegex(adoption.AdoptionError, 'poolAuthorization'):
                adoption.verify_receipt(receipt_file.name)


if __name__ == '__main__':
    unittest.main()
