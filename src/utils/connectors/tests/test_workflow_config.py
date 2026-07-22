"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
import json
import unittest
from unittest import mock

import pydantic

from src.utils import connectors


class WorkflowLabelsConfigTest(unittest.TestCase):
    """Labels config validates directly and survives legacy DB serialization."""

    def test_defaults_are_inert(self):
        self.assertEqual(connectors.WorkflowConfig().labels_config.policy, [])

    def test_accepts_independent_enforcement_modes(self):
        config = connectors.WorkflowConfig(labels_config={
            'policy': [
                {'key': 'PPP', 'allow_list': ['audio'], 'enforcement': 'warn'},
                {'key': 'team', 'enforcement': 'enforce'},
            ],
        })

        self.assertEqual(
            config.labels_config.policy[0].enforcement,
            connectors.LabelEnforcement.WARN,
        )
        self.assertEqual(
            config.labels_config.policy[1].enforcement,
            connectors.LabelEnforcement.ENFORCE,
        )

    def test_policy_defaults_to_off_and_rejects_unknown_mode(self):
        self.assertEqual(
            connectors.LabelPolicy(key='PPP').enforcement,
            connectors.LabelEnforcement.OFF,
        )
        with self.assertRaises(pydantic.ValidationError):
            connectors.LabelPolicy(key='PPP', enforcement='block')

    def test_rejects_duplicate_policy_keys(self):
        with self.assertRaisesRegex(pydantic.ValidationError, 'Duplicate label policy key'):
            connectors.WorkflowConfig(labels_config={
                'policy': [{'key': 'PPP'}, {'key': 'PPP'}],
            })

    def test_rejects_more_policy_keys_than_a_workflow_can_carry(self):
        with self.assertRaisesRegex(pydantic.ValidationError, 'at most 16 label policies'):
            connectors.WorkflowConfig(labels_config={
                'policy': [
                    {'key': f'key-{index}'}
                    for index in range(17)
                ],
            })

    def test_rejects_invalid_policy_key_and_allow_list_value(self):
        invalid_configs = [
            {'policy': [{'key': 'osmo.workflow_uuid'}]},
            {'policy': [{'key': 'PPP', 'allow_list': ['']}]},
        ]
        for labels_config in invalid_configs:
            with self.subTest(labels_config=labels_config), \
                 self.assertRaises(pydantic.ValidationError):
                connectors.WorkflowConfig(labels_config=labels_config)

    def test_legacy_serialization_round_trip(self):
        database = mock.Mock()
        config = connectors.WorkflowConfig(labels_config={
            'policy': [{
                'key': 'PPP',
                'allow_list': ['audio', 'robotics'],
                'enforcement': 'warn',
            }],
        })

        serialized = config.serialize(database)
        serialized_labels_config = serialized['labels_config']
        if not isinstance(serialized_labels_config, str):
            self.fail('labels_config must serialize as JSON text for the legacy config table.')
        stored = {'labels_config': json.loads(serialized_labels_config)}
        restored = connectors.WorkflowConfig.deserialize(stored, database)

        self.assertEqual(restored.labels_config, config.labels_config)


if __name__ == '__main__':
    unittest.main()
