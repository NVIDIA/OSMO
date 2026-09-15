"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import copy
from types import SimpleNamespace
import unittest
from unittest import mock

from src.lib.utils.client import RequestMethod
from src.lib.utils.osmo_errors import OSMOError
from test.oetf import mcp
from test.oetf import smoke_fixture
from test.oetf.models import OetfConfig
from test.smoke import mcp_checks


def _check(method: str) -> tuple[mcp_checks.McpChecks, mock.Mock]:
    check = mcp_checks.McpChecks(methodName=method)
    check.config = OetfConfig(
        url="https://example.com", pool="test-pool",
        mcp_session_dir="/private/mcp-session", auth_username="not-authoritative",
    )
    service_client = mock.Mock()
    service_client.request.return_value = {"profile": {"username": "api-caller"}}
    check.service_client = service_client
    return check, service_client


class McpFixtureTest(unittest.TestCase):
    """MCP sessions are mandatory and bound to the authenticated Core caller."""

    @mock.patch.object(smoke_fixture.mcp_session, "McpClient")
    def test_client_uses_authenticated_identity_and_is_reused(self, client_type):
        check, service_client = _check("test_oauth_session_refresh")
        self.assertIs(check.mcp(), client_type.return_value)
        self.assertIs(check.mcp(), client_type.return_value)
        client_type.assert_called_once_with(
            "https://example.com", "/private/mcp-session", "api-caller",
        )
        service_client.request.assert_called_once_with(
            method=RequestMethod.GET, endpoint="api/profile/settings",
        )

    def test_missing_session_fails_catalog_instead_of_skipping(self):
        check, service_client = _check("test_catalog_profile_and_credential_parity")
        check.config.mcp_session_dir = ""
        cli = self.enterContext(mock.patch.object(check, "cli"))
        with self.assertRaisesRegex(mcp.McpSessionError, "MCP session is required"):
            check.test_catalog_profile_and_credential_parity()
        service_client.request.assert_not_called()
        cli.assert_not_called()

    def test_invalid_authenticated_profiles_fail_closed(self):
        profiles: tuple[object, ...] = (
            None, {}, {"profile": []}, {"profile": {"username": " "}},
        )
        for profile in profiles:
            with self.subTest(profile=profile):
                check, service_client = _check("test_oauth_session_refresh")
                service_client.request.return_value = profile
                with self.assertRaisesRegex(mcp.McpSessionError, "no valid MCP session identity"):
                    check.mcp()

    def test_profile_errors_do_not_expose_upstream_messages(self):
        check, service_client = _check("test_oauth_session_refresh")
        service_client.request.side_effect = OSMOError("sensitive-upstream-detail")
        with self.assertRaises(mcp.McpSessionError) as raised:
            check.mcp()
        self.assertNotIn("sensitive-upstream-detail", str(raised.exception))


class McpSmokeContractTest(unittest.TestCase):
    """Local pass-on-good/fail-on-bad checks for deployed smoke assertions."""

    def _parity_check(self):
        check, _ = _check("test_catalog_profile_and_credential_parity")
        client = mock.Mock()
        self.enterContext(mock.patch.object(check, "mcp", return_value=client))
        expected_tool_names = mcp_checks._EXPECTED_TOOL_NAMES  # pylint: disable=protected-access
        client.request.return_value = {
            "tools": [{"name": name} for name in expected_tool_names],
        }
        cli_profile: dict[str, object] = {
            "profile": {"username": "api-caller", "email_notification": False,
                        "slack_notification": True, "pool": "test-pool"},
            "roles": ["osmo-user"], "pools": ["test-pool"],
            "token": {"name": "api-token-metadata", "expires_at": None},
        }
        cli_credentials = {"credentials": [{"cred_name": "storage", "cred_type": "S3"}]}
        profile = copy.deepcopy(cli_profile)
        profile["token"] = None
        responses = [profile, {"status": "healthy"}, copy.deepcopy(cli_credentials)]
        client.call_tool.side_effect = responses
        self.enterContext(mock.patch.object(check, "cli", side_effect=[
            mock.Mock(expect_json=mock.Mock(return_value=cli_profile)),
            mock.Mock(expect_json=mock.Mock(return_value=cli_credentials)),
        ]))
        return check, client, responses

    def test_api_token_metadata_and_mcp_sso_metadata_are_distinct(self):
        check, client, _ = self._parity_check()
        check.test_catalog_profile_and_credential_parity()
        client.request.assert_called_once_with(1, "tools/list", {})
        self.assertEqual(client.call_tool.call_count, 3)
        self.assertEqual(len(mcp_checks._EXPECTED_TOOL_NAMES), 26)  # pylint: disable=protected-access

    def test_catalog_mutation_fails(self):
        check, client, _ = self._parity_check()
        client.request.return_value["tools"][0]["name"] = "unexpected_tool"
        with self.assertRaisesRegex(AssertionError, "catalog does not match"):
            check.test_catalog_profile_and_credential_parity()
        check.cli.assert_not_called()

    def test_principal_permission_or_token_metadata_mismatch_fails(self):
        for field, value in (
            ("profile", {"username": "another-caller"}),
            ("roles", ["unexpected-admin"]),
            ("pools", ["other-pool"]),
            ("token", {"name": "unexpected-api-token", "expires_at": None}),
        ):
            with self.subTest(field=field):
                check, _, responses = self._parity_check()
                responses[0][field] = value
                with self.assertRaisesRegex(AssertionError, "profile projection does not match"):
                    check.test_catalog_profile_and_credential_parity()

    def test_credential_fields_outside_allowlist_fail(self):
        check, _, responses = self._parity_check()
        responses[2]["credentials"][0]["secret"] = "must-not-appear-in-error"
        with self.assertRaisesRegex(AssertionError, "outside the approved metadata") as raised:
            check.test_catalog_profile_and_credential_parity()
        self.assertNotIn("must-not-appear-in-error", str(raised.exception))

    def test_refresh_precedes_health_on_fresh_fixture(self):
        check, _ = _check("test_oauth_session_refresh")
        client = mock.Mock()
        self.enterContext(mock.patch.object(check, "mcp", return_value=client))
        client.call_tool.return_value = {"status": "healthy"}
        check.test_oauth_session_refresh()
        self.assertEqual(client.mock_calls, [
            mock.call.refresh(), mock.call.call_tool("osmo_health", {}),
        ])

    def test_refresh_failure_cannot_pass_using_cached_access_token(self):
        check, _ = _check("test_oauth_session_refresh")
        client = mock.Mock()
        self.enterContext(mock.patch.object(check, "mcp", return_value=client))
        client.refresh.side_effect = mcp.McpSessionError("MCP refresh failed.")
        with self.assertRaises(mcp.McpSessionError):
            check.test_oauth_session_refresh()
        client.call_tool.assert_not_called()

    @staticmethod
    def _rejection_check(session_type, statuses=(401, 401, 401), api_status=200):
        check, service_client = _check("test_rejects_non_mcp_tokens")
        service_client.login_manager.login_storage.token_login = SimpleNamespace(
            id_token="api-id-jwt", refresh_token="not-an-api-jwt",
        )
        session = session_type.return_value.__enter__.return_value
        session.get.return_value.__enter__.return_value.status_code = api_status
        responses = []
        for status in statuses:
            response = mock.MagicMock()
            response.__enter__.return_value.status_code = status
            responses.append(response)
        session.post.side_effect = responses
        return check, session

    @mock.patch.object(mcp_checks.requests, "Session")
    def test_rejection_uses_api_valid_id_token_not_refresh_credential(self, session_type):
        check, session = self._rejection_check(session_type)
        check.test_rejects_non_mcp_tokens()
        self.assertFalse(session.trust_env)
        self.assertEqual(session.get.call_args.kwargs["headers"], {
            "Authorization": "Bearer api-id-jwt",
        })
        self.assertEqual(session.post.call_count, 3)
        self.assertEqual(
            [call.kwargs["headers"].get("Authorization") for call in session.post.call_args_list],
            [None, "Bearer oetf-invalid-mcp-token", "Bearer api-id-jwt"],
        )
        check.service_client.login_manager.get_access_token.assert_not_called()

    @mock.patch.object(mcp_checks.requests, "Session")
    def test_accepting_any_non_mcp_credential_fails(self, session_type):
        for index in range(3):
            with self.subTest(credential_index=index):
                statuses = [401, 401, 401]
                statuses[index] = 200
                check, _ = self._rejection_check(session_type, statuses)
                with self.assertRaisesRegex(AssertionError, "outside its OAuth session contract"):
                    check.test_rejects_non_mcp_tokens()

    @mock.patch.object(mcp_checks.requests, "Session")
    def test_invalid_api_token_cannot_make_rejection_test_pass(self, session_type):
        check, session = self._rejection_check(session_type, api_status=401)
        with self.assertRaisesRegex(AssertionError, "not valid for the Core API"):
            check.test_rejects_non_mcp_tokens()
        session.post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
