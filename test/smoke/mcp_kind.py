"""Essential MCP discovery, embedded Dex login, and caller-bound tools on KIND."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0

import unittest

from test.oetf.smoke_fixture import SmokeFixture


_REQUIRED_TOOLS = frozenset({
    "osmo_cancel_workflow",
    "osmo_get_profile",
    "osmo_get_workflow",
    "osmo_get_workflow_logs",
    "osmo_health",
    "osmo_search_pools",
    "osmo_submit_workflow",
    "osmo_validate_workflow",
})


class McpKind(SmokeFixture):
    """Exercise real quickstart OAuth without a pre-supplied MCP token."""

    def test_public_discovery_surface(self) -> None:
        metadata = self.mcp().expect_discovery()
        self.assertIn("openid", metadata["scopes_supported"])

    def test_embedded_dex_oauth_and_tools(self) -> None:
        probe = self.mcp().authenticate_embedded_dex()
        initialized = probe.request("initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "oetf-mcp-kind", "version": "1.0"},
        })
        self.assertEqual(initialized.get("protocolVersion"), "2025-06-18")
        self.assertIsInstance(initialized.get("serverInfo"), dict)
        self.assertTrue(initialized["serverInfo"].get("name"))

        catalog = probe.request("tools/list", {}).get("tools")
        if not isinstance(catalog, list):
            self.fail("MCP tools/list must return a tool list")
        tool_names = []
        for tool in catalog:
            self.assertIsInstance(tool, dict)
            self.assertIsInstance(tool.get("name"), str)
            self.assertTrue(tool["name"].strip())
            self.assertIsInstance(tool.get("description"), str)
            self.assertTrue(tool["description"].strip())
            self.assertIsInstance(tool.get("inputSchema"), dict)
            self.assertEqual(tool["inputSchema"].get("type"), "object")
            tool_names.append(tool["name"])
        self.assertEqual(len(tool_names), len(set(tool_names)))
        self.assertTrue(_REQUIRED_TOOLS.issubset(tool_names))

        pool = self.config.pool
        self.assertTrue(pool, "OETF_POOL must select the KIND workflow pool.")
        profile = probe.call_tool("osmo_get_profile", {})
        self.assertEqual(profile["profile"]["username"], "admin")
        self.assertIn("osmo-admin", profile["roles"])
        self.assertIn(pool, profile["pools"])
        self.assertEqual(probe.call_tool("osmo_health", {}), {"status": "healthy"})

        search = probe.call_tool("osmo_search_pools", {"query": pool})
        self.assertIsInstance(search.get("node_sets"), list)
        pool_names = []
        for node_set in search["node_sets"]:
            self.assertIsInstance(node_set, dict)
            self.assertIsInstance(node_set.get("pools"), list)
            for item in node_set["pools"]:
                self.assertIsInstance(item, dict)
                pool_names.append(item.get("name"))
        self.assertIn(pool, pool_names)
        self.assertEqual(search.get("count"), len(pool_names))

        validation = probe.call_tool("osmo_validate_workflow", {
            "workflow_spec": """\
version: 2
workflow:
  name: mcp-kind-validation
  resources:
    default:
      cpu: 1
      memory: 1Gi
      storage: 1Gi
  tasks:
  - name: check
    image: alpine:3.20
    command: [echo]
    args: [mcp-validation]
    resource: default
""",
            "pool": pool,
        })
        self.assertIs(validation.get("valid"), True)
        self.assertEqual(validation.get("pool"), pool)
        self.assertIsInstance(validation.get("warnings"), list)

    def test_embedded_dex_rejects_upstream_token(self) -> None:
        probe = self.mcp().authenticate_embedded_dex()
        profile = probe.call_tool("osmo_get_profile", {})
        self.assertEqual(profile["profile"]["username"], "admin")

        upstream_token = probe.direct_dex_token()
        api_profile = probe.api_get("/api/profile/settings", upstream_token)
        self.assertEqual(api_profile["profile"]["username"], "admin")
        self.assertEqual(api_profile["roles"], profile["roles"])
        for token_kind, token in (
            ("valid upstream ID token", upstream_token),
            ("invalid bearer", "invalid-mcp-bearer"),
            ("absent bearer", ""),
        ):
            with self.subTest(token_kind=token_kind):
                response = probe.raw_request("tools/list", {}, token=token)
                self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
