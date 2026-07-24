"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Smoke: the external MCP catalog and caller-bound profile round trip work.

import unittest

import requests

from src.lib.utils.client import RequestMethod
from test.oetf.smoke_fixture import SmokeFixture


_EXPECTED_TOOL_NAMES = frozenset({
    "osmo_cancel_workflow",
    "osmo_get_app",
    "osmo_get_app_spec",
    "osmo_get_profile",
    "osmo_get_resource",
    "osmo_get_workflow",
    "osmo_get_workflow_events",
    "osmo_get_workflow_logs",
    "osmo_get_workflow_spec",
    "osmo_health",
    "osmo_list_apps",
    "osmo_list_credentials",
    "osmo_list_resources",
    "osmo_list_workflows",
    "osmo_search_pools",
    "osmo_restart_workflow",
    "osmo_submit_workflow",
    "osmo_validate_workflow",
})
_MCP_ACCEPT_HEADERS = {
    "Accept": "application/json, text/event-stream",
}
_PROFILE_FIELDS = (
    "username",
    "email_notification",
    "slack_notification",
    "pool",
)
_TOKEN_FIELDS = (
    "name",
    "expires_at",
)


class McpChecks(SmokeFixture):
    """Exercise the deployed external MCP through its public Gateway route."""

    def _jsonrpc_result(self, response, request_id):
        if (
            not isinstance(response, dict)
            or response.get("jsonrpc") != "2.0"
            or response.get("id") != request_id
            or "error" in response
        ):
            self.fail("MCP returned an unsuccessful JSON-RPC response.")

        result = response.get("result")
        if not isinstance(result, dict):
            self.fail("MCP returned an invalid JSON-RPC result.")
        return result

    def test_catalog_and_profile_round_trip(self):
        base_url = self.config.url.rstrip("/")
        unauthenticated_response = requests.post(
            f"{base_url}/mcp",
            headers=dict(_MCP_ACCEPT_HEADERS),
            json={
                "jsonrpc": "2.0",
                "id": 0,
                "method": "tools/list",
                "params": {},
            },
            timeout=10,
            allow_redirects=False,
        )
        self.assertEqual(unauthenticated_response.status_code, 401)
        self.assertTrue(
            unauthenticated_response.headers.get(
                "www-authenticate", ""
            ).startswith("Bearer resource_metadata=")
        )

        catalog_response = self.service_client.request(
            method=RequestMethod.POST,
            endpoint="mcp",
            headers=dict(_MCP_ACCEPT_HEADERS),
            payload={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {},
            },
            version_header=False,
        )

        catalog_result = self._jsonrpc_result(catalog_response, 1)
        catalog_tools = catalog_result.get("tools")
        if not isinstance(catalog_tools, list) or not all(
            isinstance(tool, dict) for tool in catalog_tools
        ):
            self.fail("MCP returned an invalid tool catalog.")
        tool_names = [tool.get("name") for tool in catalog_tools]
        if (
            len(tool_names) != len(_EXPECTED_TOOL_NAMES)
            or set(tool_names) != _EXPECTED_TOOL_NAMES
        ):
            self.fail("MCP tool catalog does not match the expected contract.")

        direct_profile = self.service_client.request(
            method=RequestMethod.GET,
            endpoint="api/profile/settings",
        )
        if not isinstance(direct_profile, dict):
            self.fail("Core returned an invalid profile response.")
        direct_profile_settings = direct_profile.get("profile")
        if (
            not isinstance(direct_profile_settings, dict)
            or not isinstance(direct_profile.get("roles"), list)
            or not isinstance(direct_profile.get("pools"), list)
        ):
            self.fail("Core returned an invalid profile response.")

        direct_token = direct_profile.get("token")
        expected_token = None
        if direct_token is not None:
            if not isinstance(direct_token, dict):
                self.fail("Core returned invalid token metadata.")
            expected_token = {
                field: direct_token.get(field)
                for field in _TOKEN_FIELDS
            }
        expected_profile = {
            "profile": {
                field: direct_profile_settings.get(field)
                for field in _PROFILE_FIELDS
            },
            "roles": direct_profile["roles"],
            "pools": direct_profile["pools"],
            "token": expected_token,
        }

        profile_response = self.service_client.request(
            method=RequestMethod.POST,
            endpoint="mcp",
            headers=dict(_MCP_ACCEPT_HEADERS),
            payload={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "osmo_get_profile",
                    "arguments": {},
                },
            },
            version_header=False,
        )

        profile_result = self._jsonrpc_result(profile_response, 2)
        if (
            profile_result.get("isError") is not False
            or profile_result.get("structuredContent") != expected_profile
        ):
            self.fail(
                "MCP profile projection does not match the direct Core profile."
            )

        health_response = self.service_client.request(
            method=RequestMethod.POST,
            endpoint="mcp",
            headers=dict(_MCP_ACCEPT_HEADERS),
            payload={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "osmo_health",
                    "arguments": {},
                },
            },
            version_header=False,
        )

        health_result = self._jsonrpc_result(health_response, 3)
        if (
            health_result.get("isError") is not False
            or health_result.get("structuredContent")
            != {"status": "healthy"}
        ):
            self.fail("MCP health tool returned an invalid response.")


if __name__ == "__main__":
    unittest.main()
