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

from src.lib.utils import role
from src.utils import connectors


class TestDefaultRoleMerge(unittest.TestCase):
    """Tests for merging updated DEFAULT_ROLES into existing roles."""

    def test_preserves_default_policy_resource_scope_for_missing_actions(self):
        existing_role = connectors.Role(
            name='osmo-user',
            description='User role',
            policies=[
                role.RolePolicy(
                    actions=[
                        'app:*',
                        'credentials:*',
                        'dataset:*',
                        'pool:List',
                        'profile:Read',
                        'profile:Update',
                        'resources:Read',
                        'user:List',
                    ],
                    resources=['*'],
                )
            ],
        )
        default_role = connectors.Role(
            name='osmo-user',
            description='Standard user role',
            policies=[
                role.RolePolicy(
                    actions=[
                        'app:*',
                        'credentials:*',
                        'dataset:*',
                        'pool:List',
                        'profile:Read',
                        'profile:Update',
                        'resources:Read',
                        'user:List',
                    ],
                    resources=['*'],
                ),
                role.RolePolicy(
                    actions=['workflow:Create'],
                    resources=['pool/default'],
                ),
            ],
        )

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertTrue(did_update)
        self.assertNotIn('workflow:Create', existing_role.policies[0].actions)
        self.assertEqual(existing_role.policies[0].resources, ['*'])
        self.assertEqual(existing_role.policies[1].actions, ['workflow:Create'])
        self.assertEqual(existing_role.policies[1].resources, ['pool/default'])

    def test_preserves_existing_extra_policy_and_external_roles(self):
        existing_role = connectors.Role(
            name='osmo-user',
            description='User role',
            external_roles=['osmo-user'],
            policies=[
                role.RolePolicy(
                    actions=['app:*'],
                    resources=['*'],
                ),
                role.RolePolicy(
                    actions=['workflow:*'],
                    resources=['pool/orion-gb200-02'],
                ),
            ],
        )
        default_role = connectors.Role(
            name='osmo-user',
            description='Standard user role',
            policies=[
                role.RolePolicy(
                    actions=['app:*'],
                    resources=['*'],
                ),
                role.RolePolicy(
                    actions=['workflow:Create'],
                    resources=['pool/default'],
                ),
            ],
        )

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertTrue(did_update)
        self.assertEqual(existing_role.external_roles, ['osmo-user'])
        self.assertEqual(existing_role.policies[1].actions, ['workflow:*'])
        self.assertEqual(existing_role.policies[1].resources, ['pool/orion-gb200-02'])
        self.assertEqual(existing_role.policies[2].actions, ['workflow:Create'])
        self.assertEqual(existing_role.policies[2].resources, ['pool/default'])

    def test_returns_false_when_existing_role_already_contains_defaults(self):
        existing_role = connectors.Role(
            name='osmo-user',
            description='User role',
            policies=[
                role.RolePolicy(actions=['app:*'], resources=['*']),
                role.RolePolicy(actions=['workflow:Create'], resources=['pool/default']),
            ],
        )
        default_role = connectors.Role(
            name='osmo-user',
            description='Standard user role',
            policies=[
                role.RolePolicy(actions=['app:*'], resources=['*']),
                role.RolePolicy(actions=['workflow:Create'], resources=['pool/default']),
            ],
        )

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertFalse(did_update)

    def test_adds_missing_actions_to_matching_policy_scope(self):
        existing_role = connectors.Role(
            name='osmo-user',
            description='User role',
            policies=[
                role.RolePolicy(actions=['app:*'], resources=['*']),
            ],
        )
        default_role = connectors.Role(
            name='osmo-user',
            description='Standard user role',
            policies=[
                role.RolePolicy(actions=['app:*', 'dataset:*'], resources=['*']),
            ],
        )

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertTrue(did_update)
        self.assertEqual(len(existing_role.policies), 1)
        self.assertEqual(existing_role.policies[0].actions, ['app:*', 'dataset:*'])
        self.assertEqual(existing_role.policies[0].resources, ['*'])

    def test_osmo_user_default_role_scopes_workflow_actions_to_default_pool(self):
        osmo_user = connectors.DEFAULT_ROLES['osmo-user']

        wildcard_workflow_actions = [
            action
            for policy in osmo_user.policies
            if policy.resources == ['*']
            for action in policy.actions
            if action.startswith('workflow:')
        ]
        scoped_workflow_policies = [
            policy
            for policy in osmo_user.policies
            if policy.resources == ['pool/default']
        ]

        self.assertEqual(wildcard_workflow_actions, [])
        self.assertEqual(len(scoped_workflow_policies), 1)
        self.assertEqual(scoped_workflow_policies[0].actions, ['workflow:*'])


if __name__ == '__main__':
    unittest.main()
