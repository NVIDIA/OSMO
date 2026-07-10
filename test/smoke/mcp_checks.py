"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Smoke: the MCP profile tool relays the authenticated OSMO caller.

import unittest

from src.lib.utils.client import RequestMethod
from test.oetf.smoke_fixture import SmokeFixture


class McpChecks(SmokeFixture):
    """Validate the deployed Gateway-to-MCP-to-OSMO authentication path."""

    def test_profile_tool_relays_authenticated_identity(self):
        api_profile = self.http(
            "GET", "/api/profile/settings"
        ).expect_body_contains("profile")
        user_name = api_profile["profile"]["username"]
        self.assertIsInstance(user_name, str)
        self.assertTrue(user_name)

        mcp_response = self.service_client.request(
            method=RequestMethod.POST,
            endpoint="mcp",
            headers={"Accept": "application/json, text/event-stream"},
            payload={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "get_current_profile",
                    "arguments": {},
                },
            },
            version_header=False,
        )

        self.assertIsInstance(mcp_response, dict)
        result = mcp_response.get("result")
        self.assertIsInstance(result, dict)
        self.assertFalse(result.get("isError"), mcp_response)

        expected_profile = {
            "username": user_name,
            "email_notification": api_profile["profile"]["email_notification"],
            "slack_notification": api_profile["profile"]["slack_notification"],
            "pool": api_profile["profile"]["pool"],
            "roles": api_profile["roles"],
            "pools": api_profile["pools"],
        }
        self.assertEqual(result.get("structuredContent"), expected_profile)
        self.assertNotIn("token", result["structuredContent"])


if __name__ == "__main__":
    unittest.main()
