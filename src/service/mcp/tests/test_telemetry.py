"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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

from src.service.mcp import request_context, telemetry


class TelemetryTest(unittest.TestCase):
    """Keep upstream telemetry useful without logging resource identifiers."""

    def test_route_templates_remove_dynamic_identifiers(self) -> None:
        cases = {
            '/api/workflow/private-workflow-1/logs': (
                '/api/workflow/{workflow_id}/logs'
            ),
            '/api/workflow/private-workflow-1/cancel': (
                '/api/workflow/{workflow_id}/cancel'
            ),
            '/api/app/user/private-app/spec': '/api/app/user/{app_name}/spec',
            '/api/app/user/private-app/rename': (
                '/api/app/user/{app_name}/rename'
            ),
            '/api/credentials/private-credential': (
                '/api/credentials/{credential_name}'
            ),
            '/api/resources/private-node': '/api/resources/{node_name}',
            '/api/pool/private-pool/workflow': (
                '/api/pool/{pool}/workflow'
            ),
            '/api/pool/private-pool/workflow/private-workflow-1/restart': (
                '/api/pool/{pool}/workflow/{workflow_id}/restart'
            ),
            '/api/unrecognized/private-value': '/api/{unclassified}',
            '/api/profile/settings': '/api/profile/settings',
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                template = telemetry.route_template(path)
                self.assertEqual(template, expected)
                for secret in (
                    'private-workflow-1',
                    'private-app',
                    'private-credential',
                    'private-node',
                    'private-pool',
                ):
                    self.assertNotIn(secret, template)

    def test_log_includes_required_static_fields_only(self) -> None:
        with (
            request_context.track_tool('osmo_get_workflow'),
            self.assertLogs('src.service.mcp.telemetry', level='INFO') as captured,
        ):
            telemetry.log_upstream_call(
                method='GET',
                path='/api/workflow/private-workflow-1',
                status_code=200,
                duration_ms=12.5,
                outcome='response_received',
                request_id='request-123',
            )

        self.assertEqual(len(captured.output), 1)
        record = captured.output[0]
        for expected in (
            'tool=osmo_get_workflow',
            'method=GET',
            'route=/api/workflow/{workflow_id}',
            'status=200',
            'outcome=response_received',
            'duration_ms=12.500',
            'request_id=request-123',
        ):
            self.assertIn(expected, record)
        self.assertNotIn('private-workflow-1', record)

    def test_log_tool_outcome_uses_only_classified_fields(self) -> None:
        with self.assertLogs(
            'src.service.mcp.telemetry',
            level='INFO',
        ) as captured:
            telemetry.log_tool_outcome(
                tool_name='osmo_get_profile',
                outcome='invalid_result',
                duration_ms=3.25,
                request_id='request-456',
            )

        self.assertEqual(len(captured.output), 1)
        record = captured.output[0]
        for expected in (
            'tool=osmo_get_profile',
            'outcome=invalid_result',
            'duration_ms=3.250',
            'request_id=request-456',
        ):
            self.assertIn(expected, record)


if __name__ == '__main__':
    unittest.main()
