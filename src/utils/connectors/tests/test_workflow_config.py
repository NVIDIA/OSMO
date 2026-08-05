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
import unittest

import pydantic

from src.utils import connectors


class TestWorkflowLabelsConfig(unittest.TestCase):
    """Labels config validation for the workflow config model."""

    def test_defaults_are_inert(self):
        self.assertEqual(connectors.WorkflowConfig().labels_config.policy, [])
        self.assertEqual(connectors.WorkflowConfig().labels_config.pod_label_prefix, '')

    def test_accepts_pod_label_prefix(self):
        config = connectors.WorkflowConfig(labels_config={
            'pod_label_prefix': 'example.com/',
        })
        self.assertEqual(
            config.labels_config.pod_label_prefix, 'example.com/')

    def test_rejects_pod_label_prefix_with_whitespace_or_overlong(self):
        with self.assertRaisesRegex(pydantic.ValidationError, 'whitespace'):
            connectors.WorkflowConfig(labels_config={
                'pod_label_prefix': 'has space/',
            })
        with self.assertRaisesRegex(pydantic.ValidationError, 'at most 253'):
            connectors.WorkflowConfig(labels_config={
                'pod_label_prefix': 'x' * 254,
            })

    def test_accepts_independent_enforcement_modes(self):
        config = connectors.WorkflowConfig(labels_config={
            'policy': [
                {'key': 'project', 'allow_list': ['audio'], 'enforcement': 'warn'},
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
            connectors.LabelPolicy(key='project').enforcement,
            connectors.LabelEnforcement.OFF,
        )
        with self.assertRaises(pydantic.ValidationError):
            connectors.LabelPolicy(key='project', enforcement='block')

    def test_assert_message_defaults_empty_and_strips(self):
        self.assertEqual(connectors.LabelPolicy(key='project').assert_message, '')
        self.assertEqual(
            connectors.LabelPolicy(
                key='project', assert_message='  See the registry.  ').assert_message,
            'See the registry.',
        )

    def test_assert_message_rejects_multiline_and_overlong(self):
        with self.assertRaisesRegex(pydantic.ValidationError, 'single line'):
            connectors.LabelPolicy(key='project', assert_message='line one\nline two')
        with self.assertRaisesRegex(pydantic.ValidationError, 'at most 256'):
            connectors.LabelPolicy(key='project', assert_message='x' * 257)

    def test_rejects_duplicate_policy_keys(self):
        with self.assertRaisesRegex(pydantic.ValidationError, 'Duplicate label policy key'):
            connectors.WorkflowConfig(labels_config={
                'policy': [{'key': 'project'}, {'key': 'project'}],
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
            {'policy': [{'key': '-invalid-key'}]},
            {'policy': [{'key': 'project', 'allow_list': ['']}]},
        ]
        for labels_config in invalid_configs:
            with self.subTest(labels_config=labels_config), \
                 self.assertRaises(pydantic.ValidationError):
                connectors.WorkflowConfig(labels_config=labels_config)


if __name__ == '__main__':
    unittest.main()
