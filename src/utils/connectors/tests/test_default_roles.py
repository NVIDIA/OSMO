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
                        'pool:List',
                        'profile:Read',
                        'profile:Update',
                        'resources:Read',
                        'user:List',
                        'workflow:List',
                    ],
                    resources=['*'],
                ),
                role.RolePolicy(
                    actions=['workflow:List', 'workflow:Read'],
                    resources=['*'],
                ),
                role.RolePolicy(
                    actions=['workflow:*'],
                    resources=['pool/default'],
                ),
            ],
        )

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertTrue(did_update)
        self.assertNotIn('workflow:Create', existing_role.policies[0].actions)
        self.assertIn('workflow:List', existing_role.policies[0].actions)
        self.assertIn('workflow:Read', existing_role.policies[0].actions)
        self.assertEqual(existing_role.policies[0].resources, ['*'])
        self.assertEqual(existing_role.policies[1].actions, ['workflow:*'])
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
                    actions=['workflow:List', 'workflow:Read'],
                    resources=['*'],
                ),
                role.RolePolicy(
                    actions=['workflow:*'],
                    resources=['pool/default'],
                ),
            ],
        )

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertTrue(did_update)
        self.assertEqual(existing_role.external_roles, ['osmo-user'])
        self.assertEqual(existing_role.policies[1].actions, ['workflow:*'])
        self.assertEqual(existing_role.policies[1].resources, ['pool/orion-gb200-02'])
        self.assertEqual(existing_role.policies[2].actions, ['workflow:*'])
        self.assertEqual(existing_role.policies[2].resources, ['pool/default'])

    def test_preserves_existing_actions_when_appending_default_scopes(self):
        existing_role = connectors.Role(
            name='osmo-user',
            description='User role',
            external_roles=['osmo-user'],
            policies=[
                role.RolePolicy(
                    actions=['app:*', 'workflow:Create', 'workflow:List', 'workflow:*'],
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
                    actions=['workflow:List', 'workflow:Read'],
                    resources=['*'],
                ),
                role.RolePolicy(
                    actions=['workflow:*'],
                    resources=['pool/default'],
                ),
            ],
        )

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertTrue(did_update)
        self.assertEqual(existing_role.external_roles, ['osmo-user'])
        self.assertEqual(existing_role.policies[0].actions, [
            'app:*',
            'workflow:Create',
            'workflow:List',
            'workflow:*',
            'workflow:Read',
        ])
        self.assertEqual(existing_role.policies[0].resources, ['*'])
        self.assertEqual(existing_role.policies[1].actions, ['workflow:*'])
        self.assertEqual(existing_role.policies[1].resources, ['pool/orion-gb200-02'])
        self.assertEqual(existing_role.policies[2].actions, ['workflow:*'])
        self.assertEqual(existing_role.policies[2].resources, ['pool/default'])

    def test_append_only_does_not_move_existing_workflow_actions(self):
        existing_role = connectors.Role(
            name='osmo-user',
            description='User role',
            policies=[
                role.RolePolicy(
                    actions=[
                        'workflow:Create',
                        'workflow:List',
                        'workflow:Read',
                        'workflow:Update',
                    ],
                    resources=['*'],
                ),
            ],
        )
        default_role = connectors.Role(
            name='osmo-user',
            description='Standard user role',
            policies=[
                role.RolePolicy(
                    actions=['workflow:List', 'workflow:Read'],
                    resources=['*'],
                ),
                role.RolePolicy(
                    actions=['workflow:*'],
                    resources=['pool/default'],
                ),
            ],
        )

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertTrue(did_update)
        self.assertEqual(
            existing_role.policies[0].actions,
            [
                'workflow:Create',
                'workflow:List',
                'workflow:Read',
                'workflow:Update',
            ],
        )
        self.assertEqual(existing_role.policies[0].resources, ['*'])
        self.assertEqual(existing_role.policies[1].actions, ['workflow:*'])
        self.assertEqual(existing_role.policies[1].resources, ['pool/default'])

    def test_returns_false_when_existing_role_already_contains_defaults(self):
        existing_role = connectors.Role(
            name='osmo-user',
            description='User role',
            policies=[
                role.RolePolicy(
                    actions=['app:*', 'workflow:List', 'workflow:Read'],
                    resources=['*'],
                ),
                role.RolePolicy(actions=['workflow:*'], resources=['pool/default']),
            ],
        )
        default_role = connectors.Role(
            name='osmo-user',
            description='Standard user role',
            policies=[
                role.RolePolicy(
                    actions=['app:*', 'workflow:List', 'workflow:Read'],
                    resources=['*'],
                ),
                role.RolePolicy(actions=['workflow:*'], resources=['pool/default']),
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
                role.RolePolicy(actions=['app:*', 'credentials:*'], resources=['*']),
            ],
        )

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertTrue(did_update)
        self.assertEqual(len(existing_role.policies), 1)
        self.assertEqual(existing_role.policies[0].actions, ['app:*', 'credentials:*'])
        self.assertEqual(existing_role.policies[0].resources, ['*'])

    def test_copies_default_policies_when_existing_role_has_none(self):
        existing_role = connectors.Role(
            name='osmo-user',
            description='User role',
            policies=[],
        )
        default_role = connectors.Role(
            name='osmo-user',
            description='Standard user role',
            policies=[
                role.RolePolicy(actions=['app:*'], resources=['*']),
            ],
        )

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertTrue(did_update)
        self.assertEqual(existing_role.policies[0].actions, ['app:*'])
        self.assertEqual(existing_role.policies[0].resources, ['*'])
        existing_role.policies[0].actions.append('credentials:*')
        self.assertEqual(default_role.policies[0].actions, ['app:*'])

    def test_returns_false_when_both_existing_and_default_have_no_policies(self):
        existing_role = connectors.Role(
            name='empty-role',
            description='Empty role',
            policies=[],
        )
        default_role = connectors.Role(
            name='empty-role',
            description='Empty default role',
            policies=[],
        )

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertFalse(did_update)
        self.assertEqual(existing_role.policies, [])

    def test_osmo_admin_default_role_denies_internal_actions(self):
        osmo_admin = connectors.DEFAULT_ROLES['osmo-admin']

        self.assertEqual(osmo_admin.policies[0].effect, role.PolicyEffect.ALLOW)
        self.assertEqual(osmo_admin.policies[0].actions, ['*:*'])
        self.assertEqual(osmo_admin.policies[0].resources, ['*'])

        self.assertEqual(osmo_admin.policies[1].effect, role.PolicyEffect.DENY)
        self.assertEqual(osmo_admin.policies[1].actions, ['internal:*'])
        self.assertEqual(osmo_admin.policies[1].resources, ['*'])

    def test_default_role_merge_appends_admin_internal_deny(self):
        existing_role = connectors.Role(
            name='osmo-admin',
            description='Administrator with full access except internal endpoints',
            policies=[
                role.RolePolicy(actions=['*:*'], resources=['*']),
                role.RolePolicy(actions=[], resources=[]),
            ],
        )
        default_role = connectors.DEFAULT_ROLES['osmo-admin']

        did_update = connectors.merge_default_role_policies(existing_role, default_role)

        self.assertTrue(did_update)
        self.assertEqual(len(existing_role.policies), 3)
        self.assertEqual(existing_role.policies[2].effect, role.PolicyEffect.DENY)
        self.assertEqual(existing_role.policies[2].actions, ['internal:*'])
        self.assertEqual(existing_role.policies[2].resources, ['*'])

    def test_osmo_user_default_role_allows_only_workflow_read_list_on_all_pools(self):
        osmo_user = connectors.DEFAULT_ROLES['osmo-user']

        wildcard_policy_actions = [
            action
            for policy in osmo_user.policies
            if policy.resources == ['*']
            for action in policy.actions
        ]
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

        self.assertEqual(
            wildcard_policy_actions,
            [
                'app:*',
                'auth:Token',
                'credentials:*',
                'pool:List',
                'profile:Read',
                'profile:Update',
                'resources:Read',
                'user:List',
                'workflow:List',
                'workflow:Read',
            ],
        )
        self.assertEqual(
            wildcard_workflow_actions,
            [
                'workflow:List',
                'workflow:Read',
            ],
        )
        self.assertEqual(len(scoped_workflow_policies), 1)
        self.assertEqual(scoped_workflow_policies[0].actions, ['workflow:*'])


if __name__ == '__main__':
    unittest.main()
