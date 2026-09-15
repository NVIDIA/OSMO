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
from src.lib.utils.osmo_errors import OSMOError
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
    "osmo_list_tasks",
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

    def _base_url(self):
        return self.config.url.rstrip("/")

    def _protected_resource_metadata(self):
        """Fetch the public RFC 9728 document. No authentication required."""
        response = requests.get(
            f"{self._base_url()}/.well-known/oauth-protected-resource/mcp",
            timeout=10,
            allow_redirects=False,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_public_discovery_surface(self):
        """The unauthenticated surface clients rely on to bootstrap OAuth.

        Needs no caller token, which is the point: a client discovers how to
        authenticate before it can.
        """
        base_url = self._base_url()
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

        metadata = self._protected_resource_metadata()
        self.assertEqual(metadata.get("resource"), f"{base_url}/mcp")
        self.assertTrue(
            metadata.get("authorization_servers"),
            "protected-resource metadata advertises no authorization server.",
        )

        # FastMCP owns the OAuth surface, so it must advertise its endpoints
        # under /mcp rather than on the shared Gateway root.
        authorization_metadata = requests.get(
            f"{base_url}/.well-known/oauth-authorization-server/mcp",
            timeout=10,
            allow_redirects=False,
        )
        self.assertEqual(
            authorization_metadata.status_code,
            200,
            authorization_metadata.text,
        )
        self.assertEqual(
            authorization_metadata.json().get("authorization_endpoint"),
            f"{base_url}/mcp/authorize",
        )

        # Container health endpoints must not be exposed by the public Gateway.
        for path in ("/mcp/health", "/mcp/health/live"):
            health = requests.get(
                f"{base_url}{path}", timeout=10, allow_redirects=False
            )
            self.assertEqual(
                health.status_code,
                404,
                f"{path} is reachable from the internet.",
            )

    def test_catalog_profile_and_credential_parity(self):
        client = self.mcp()
        catalog_result = client.request(1, "tools/list", {})
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
        if cli_token is not None:
            if (
                not isinstance(cli_token, dict)
                or not isinstance(cli_token.get("name"), str)
                or not cli_token["name"]
                or (
                    cli_token.get("expires_at") is not None
                    and not isinstance(cli_token["expires_at"], str)
                )
            ):
                self.fail("OSMO CLI returned invalid token metadata.")
        # API-token login may report token metadata; MCP relays the SSO identity,
        # for which Core returns no OSMO API-token metadata. Principal and
        # effective permissions must still match for this parity environment.
        expected_profile = {
            "profile": {
                field: cli_profile_settings.get(field)
                for field in _PROFILE_FIELDS
            },
            "roles": cli_profile["roles"],
            "pools": cli_profile["pools"],
            "token": None,
        }

        profile = client.call_tool("osmo_get_profile", {})
        if profile != expected_profile:
            self.fail(
                "MCP profile projection does not match the OSMO CLI profile."
            )

        health = client.call_tool("osmo_health", {})
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

        mcp_credentials = client.call_tool(
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
        client = self.mcp()
        pool = self.config.pool
        if not pool:
            self.fail("OETF_POOL must select a workflow validation pool.")

        validation = client.call_tool(
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
                "warnings": [],
            },
        )

    def test_rejects_non_mcp_tokens(self):
        """An API-valid ID token still cannot authenticate to the MCP proxy."""
        try:
            self.service_client.request(
                method=RequestMethod.GET, endpoint="api/profile/settings",
            )
            token_login = self.service_client.login_manager.login_storage.token_login
        except OSMOError:
            self.fail("Cannot obtain an authenticated Core API session for rejection checks.")
        # get_access_token() returns a refresh credential, not the ID token that
        # ServiceClient actually puts in its Authorization header.
        api_jwt = token_login.id_token if token_login is not None else None
        if not isinstance(api_jwt, str) or not api_jwt:
            self.fail("MCP rejection checks require an authenticated Core API ID token.")
        try:
            with requests.Session() as client:
                client.trust_env = False
                with client.get(
                    f"{self._base_url()}/api/profile/settings",
                    headers={"Authorization": f"Bearer {api_jwt}"},
                    timeout=10, allow_redirects=False, stream=True,
                ) as response:
                    self.assertEqual(
                        response.status_code, 200,
                        "The rejection-test ID token is not valid for the Core API.",
                    )
                for label, token in (
                    ("missing", None),
                    ("invalid", "oetf-invalid-mcp-token"),
                    ("api-only", api_jwt),
                ):
                    with self.subTest(credential=label):
                        headers = dict(_MCP_ACCEPT_HEADERS)
                        if token is not None:
                            headers["Authorization"] = f"Bearer {token}"
                        with client.post(
                            f"{self._base_url()}/mcp", headers=headers,
                            json={"jsonrpc": "2.0", "id": 1,
                                  "method": "tools/list", "params": {}},
                            timeout=10, allow_redirects=False, stream=True,
                        ) as response:
                            self.assertEqual(
                                response.status_code, 401,
                                "MCP accepted a credential outside its OAuth session contract.",
                            )
        except requests.RequestException:
            self.fail("MCP credential-rejection checks could not reach the configured service.")

    def test_oauth_session_refresh(self):
        """A fresh fixture must refresh its persisted session before a tool call."""
        client = self.mcp()
        client.refresh()
        self.assertEqual(client.call_tool("osmo_health", {}), {"status": "healthy"})


if __name__ == "__main__":
    unittest.main()
