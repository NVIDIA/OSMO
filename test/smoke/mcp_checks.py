"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Smoke: the deployed external MCP catalog and safe caller-bound tools work.

import json
import os
import unittest

import requests

from src.lib.utils.client import RequestMethod
from test.oetf.smoke_fixture import SmokeFixture


_EXPECTED_TOOL_NAMES = frozenset({
    "osmo_cancel_workflow",
    "osmo_create_app",
    "osmo_delete_app",
    "osmo_delete_credential",
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
    "osmo_rename_app",
    "osmo_set_profile",
    "osmo_submit_app",
    "osmo_submit_workflow",
    "osmo_update_app",
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
_CREDENTIAL_FIELDS = (
    "cred_name",
    "cred_type",
)


def _validation_workflow_spec():
    image = os.environ.get("OETF_DEFAULT_IMAGE") or "ubuntu:22.04"
    return f"""\
version: 2
workflow:
  name: mcp-smoke-validation
  resources:
    default:
      cpu: 1
      memory: 1Gi
      storage: 1Gi
  tasks:
  - name: check
    image: {json.dumps(image)}
    command: [echo]
    args: [mcp-validation]
    resource: default
"""


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

    def _mcp_request(self, request_id, method, params):
        response = self.service_client.request(
            method=RequestMethod.POST,
            endpoint="mcp",
            headers=dict(_MCP_ACCEPT_HEADERS),
            payload={
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params,
            },
            version_header=False,
        )
        return self._jsonrpc_result(response, request_id)

    def _call_tool(self, request_id, name, arguments):
        result = self._mcp_request(
            request_id,
            "tools/call",
            {
                "name": name,
                "arguments": arguments,
            },
        )
        structured_content = result.get("structuredContent")
        if (
            result.get("isError") is not False
            or not isinstance(structured_content, dict)
        ):
            self.fail(f"MCP tool {name} returned an unsuccessful result.")
        return structured_content

    def test_catalog_profile_and_credential_parity(self):
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

        catalog_result = self._mcp_request(1, "tools/list", {})
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

        cli_profile = self.cli(
            ["osmo", "profile", "list", "--format-type", "json"]
        ).expect_json()
        if not isinstance(cli_profile, dict):
            self.fail("OSMO CLI returned an invalid profile response.")
        cli_profile_settings = cli_profile.get("profile")
        if (
            not isinstance(cli_profile_settings, dict)
            or not isinstance(cli_profile.get("roles"), list)
            or not isinstance(cli_profile.get("pools"), list)
        ):
            self.fail("OSMO CLI returned an invalid profile response.")

        username = cli_profile_settings.get("username")
        if not isinstance(username, str) or not username.strip():
            self.fail("OSMO CLI profile must contain a nonempty username.")
        default_pool = cli_profile_settings.get("pool")
        accessible_pools = cli_profile["pools"]
        if (
            not accessible_pools
            or not all(
                isinstance(pool_name, str) and pool_name
                for pool_name in accessible_pools
            )
        ):
            self.fail("OSMO CLI profile must contain accessible pools.")
        if default_pool is not None and (
            not isinstance(default_pool, str)
            or not default_pool
            or default_pool not in accessible_pools
        ):
            self.fail("OSMO CLI profile contains an invalid default pool.")
        if not self.config.pool or self.config.pool not in accessible_pools:
            self.fail(
                "OETF_POOL must select a pool accessible to the authenticated user."
            )

        cli_token = cli_profile.get("token")
        expected_token = None
        if cli_token is not None:
            if not isinstance(cli_token, dict):
                self.fail("OSMO CLI returned invalid token metadata.")
            expected_token = {
                field: cli_token.get(field)
                for field in _TOKEN_FIELDS
            }
        expected_profile = {
            "profile": {
                field: cli_profile_settings.get(field)
                for field in _PROFILE_FIELDS
            },
            "roles": cli_profile["roles"],
            "pools": cli_profile["pools"],
            "token": expected_token,
        }

        profile = self._call_tool(2, "osmo_get_profile", {})
        if profile != expected_profile:
            self.fail(
                "MCP profile projection does not match the OSMO CLI profile."
            )

        health = self._call_tool(3, "osmo_health", {})
        if health != {"status": "healthy"}:
            self.fail("MCP health tool returned an invalid response.")

        cli_credentials = self.cli(
            ["osmo", "credential", "--format-type", "json", "list"]
        ).expect_json()
        if (
            not isinstance(cli_credentials, dict)
            or not isinstance(cli_credentials.get("credentials"), list)
        ):
            self.fail("OSMO CLI returned an invalid credential list.")
        cli_credential_metadata = []
        for credential in cli_credentials["credentials"]:
            if not isinstance(credential, dict) or not all(
                isinstance(credential.get(field), str)
                for field in _CREDENTIAL_FIELDS
            ):
                self.fail("OSMO CLI returned invalid credential metadata.")
            cli_credential_metadata.append({
                field: credential[field]
                for field in _CREDENTIAL_FIELDS
            })

        mcp_credentials = self._call_tool(
            4,
            "osmo_list_credentials",
            {},
        )
        if not isinstance(mcp_credentials.get("credentials"), list):
            self.fail("MCP returned an invalid credential list.")
        mcp_credential_metadata = mcp_credentials["credentials"]
        if not all(
            isinstance(credential, dict)
            and set(credential) == set(_CREDENTIAL_FIELDS)
            and all(
                isinstance(credential.get(field), str)
                for field in _CREDENTIAL_FIELDS
            )
            for credential in mcp_credential_metadata
        ):
            self.fail("MCP returned credential fields outside the approved metadata.")
        self.assertCountEqual(
            mcp_credential_metadata,
            cli_credential_metadata,
            "MCP credential metadata does not match the OSMO CLI.",
        )

    def test_workflow_validation_round_trip(self):
        pool = self.config.pool
        if not pool:
            self.fail("OETF_POOL must select a workflow validation pool.")

        validation = self._call_tool(
            1,
            "osmo_validate_workflow",
            {
                "workflow_spec": _validation_workflow_spec(),
                "pool": pool,
            },
        )
        self.assertEqual(
            validation,
            {
                "valid": True,
                "pool": pool,
                "logs": "Workflow validation succeeded.",
            },
        )


if __name__ == "__main__":
    unittest.main()
