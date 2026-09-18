"""Boundary tests for the reusable public MCP smoke probe."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
# pylint: disable=protected-access

import base64
from contextlib import contextmanager
import hashlib
import io
import json
import os
import subprocess
import traceback
from types import SimpleNamespace
from typing import Any
import unittest
from unittest import mock
from urllib import parse

import requests

from test.oetf import mcp_probe


_BASE = "http://127.0.0.1:18080"
_CALLBACK = "http://127.0.0.1:33749/callback"
_SECRET = "credential-that-must-not-appear-in-errors"
_METADATA = {
    "issuer": _BASE + "/mcp",
    "authorization_endpoint": _BASE + "/mcp/authorize",
    "token_endpoint": _BASE + "/mcp/token",
    "registration_endpoint": _BASE + "/mcp/register",
    "scopes_supported": ["openid"],
    "code_challenge_methods_supported": ["S256"],
    "client_id_metadata_document_supported": True,
}


def _response(status=200, payload=None, *, url=_BASE + "/mcp", headers=None, body=None):
    response = requests.Response()
    response.status_code = status
    response.url = url
    response.headers.update(headers or {})
    response.raw = io.BytesIO((body if body is not None else json.dumps(payload)).encode("utf-8"))
    return response


class McpProbeTest(unittest.TestCase):
    """Exercise malformed responses and credentials crossing trust boundaries."""

    def setUp(self):
        self.probe = mcp_probe.McpProbe(self, _BASE)

    @contextmanager
    def _expect_sanitized_failure(self):
        try:
            yield
        except AssertionError:
            self.assertNotIn(_SECRET, traceback.format_exc())
        else:
            self.fail("Expected sanitized failure")

    def _browser(self, responses):
        session = mock.MagicMock(spec=requests.sessions.Session)
        session.__enter__.return_value = session
        session.request.side_effect = responses
        self.enterContext(mock.patch.object(mcp_probe.requests, "Session", return_value=session))
        self.enterContext(mock.patch.object(self.probe, "_admin_password", return_value=_SECRET))
        return session

    def _discovery_responses(self, metadata=None):
        return [
            _response(401, headers={
                "WWW-Authenticate": 'Bearer resource_metadata="' + _BASE
                + '/.well-known/oauth-protected-resource/mcp"',
            }),
            _response(payload={
                "resource": _BASE + "/mcp",
                "authorization_servers": [_BASE + "/mcp"],
            }),
            _response(payload=_METADATA if metadata is None else metadata),
            *[_response(404) for _ in range(3)],
        ]

    def test_discovery_checks_canonical_endpoints_and_private_health(self):
        with mock.patch.object(
            mcp_probe.requests, "request", side_effect=self._discovery_responses(),
        ) as send:
            self.assertEqual(self.probe.expect_discovery(), _METADATA)
        self.assertTrue(send.call_args_list[-1].args[1].endswith("/mcp/health/ready"))
        for mutation in ("wrong-endpoint", "public-health"):
            with self.subTest(mutation=mutation):
                responses = self._discovery_responses()
                if mutation == "wrong-endpoint":
                    responses[2] = _response(payload={
                        **_METADATA, "token_endpoint": "https://foreign.example/token",
                    })
                else:
                    responses[-1] = _response(200)
                with mock.patch.object(mcp_probe.requests, "request", side_effect=responses):
                    with self.assertRaises(AssertionError):
                        self.probe.expect_discovery()

    def test_discovery_does_not_accept_redirect_or_wrong_anonymous_challenge(self):
        for response in (
            _response(302, headers={"Location": _BASE + "/oauth2/start"}),
            _response(401, headers={"WWW-Authenticate": 'Bearer resource_metadata="wrong"'}),
        ):
            with self.subTest(status=response.status_code):
                with mock.patch.object(
                    mcp_probe.requests, "request", return_value=response,
                ) as send:
                    with self.assertRaises(AssertionError):
                        self.probe.expect_discovery()
                    self.assertEqual(send.call_count, 1)

    def test_oauth_preserves_csrf_and_exchanges_the_matching_pkce_verifier(self):
        session = self._browser([
            _response(302, headers={"Location": "/mcp/consent?transaction=one"}),
            _response(url=_BASE + "/mcp/consent?transaction=one", body=(
                '<form method="POST" action=""><input name="csrf_token" value="csrf-one">'
                '<input name="transaction" value="one"></form>'
            )),
            _response(302, headers={"Location": "/dex/auth/local"}),
            _response(url=_BASE + "/dex/auth/local", body=(
                '<form method="post" action="/dex/auth/local">'
                '<input name="login"><input name="password"></form>'
            )),
            _response(302, headers={
                "Location": _CALLBACK + "?code=authorization-code&state=state",
            }),
        ])
        with (
            mock.patch.object(self.probe, "expect_discovery", return_value=_METADATA),
            mock.patch.object(
                mcp_probe.secrets, "token_urlsafe", side_effect=["verifier", "state"],
            ),
            mock.patch.object(mcp_probe.requests, "request", side_effect=[
                _response(201, {"client_id": "registered-client"}),
                _response(payload={"access_token": _SECRET}),
            ]) as send,
        ):
            self.assertIs(self.probe.authenticate_embedded_dex(), self.probe)
        self.assertEqual(self.probe.access_token, _SECRET)
        self.assertNotIn(_SECRET, repr(self.probe))
        authorization_url = session.request.call_args_list[0].args[1]
        authorization_query = parse.parse_qs(parse.urlsplit(authorization_url).query)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(b"verifier").digest(),
        ).rstrip(b"=").decode()
        self.assertEqual(authorization_query["code_challenge"], [challenge])
        self.assertEqual(session.request.call_args_list[2].kwargs["data"], {
            "csrf_token": "csrf-one", "transaction": "one", "action": "approve",
        })
        self.assertEqual(session.request.call_args_list[4].kwargs["data"]["password"], _SECRET)
        self.assertEqual(send.call_args.kwargs["data"]["code_verifier"], "verifier")
        self.assertTrue(all(
            call.kwargs["allow_redirects"] is False for call in session.request.call_args_list
        ))

    def test_wrong_pkce_exchange_fails_without_response_body_or_previous_token(self):
        self.probe.access_token = "previous-session"
        with (
            mock.patch.object(self.probe, "expect_discovery", return_value=_METADATA),
            mock.patch.object(self.probe, "_authorize", return_value="code"),
            mock.patch.object(mcp_probe.requests, "request", side_effect=[
                _response(201, {"client_id": "client"}),
                _response(400, body=_SECRET),
            ]) as send,
        ):
            with self.assertRaisesRegex(AssertionError, "MCP OAuth token exchange") as error:
                self.probe.authenticate_embedded_dex(pkce_verifier_override="incorrect")
        self.assertNotIn(_SECRET, str(error.exception))
        self.assertEqual(self.probe.access_token, "")
        self.assertEqual(send.call_args.kwargs["data"]["code_verifier"], "incorrect")

    def test_oauth_rejects_off_origin_redirects_and_forms_before_sending_credentials(self):
        for response in (
            _response(302, headers={"Location": "https://foreign.example/login"}),
            _response(body=(
                '<form method="post" action="//foreign.example/login">'
                '<input name="login"></form>'
            )),
            _response(body=(
                '<form method="post" action="/api/credentials">'
                '<input name="login"></form>'
            )),
        ):
            with self.subTest(response=response.status_code):
                session = self._browser([response])
                with self.assertRaises(AssertionError):
                    self.probe._authorize(_BASE + "/mcp/authorize", "state")
                self.assertEqual(session.request.call_count, 1)

    def test_malformed_urls_do_not_echo_credential_bearing_authorities(self):
        malformed_url = "http://" + _SECRET + "\uff20foreign.example/login"
        for response in (
            _response(302, headers={"Location": malformed_url}),
            _response(body=(
                f'<form method="post" action="{malformed_url}">'
                '<input name="login"></form>'
            )),
        ):
            session = self._browser([response])
            with self._expect_sanitized_failure():
                self.probe._authorize(_BASE + "/mcp/authorize", "state")
            self.assertEqual(session.request.call_count, 1)
        with self._expect_sanitized_failure():
            mcp_probe.McpProbe(self, malformed_url)

    def test_oauth_callback_requires_exact_url_one_code_and_original_state(self):
        for location in (
            _CALLBACK + "?code=code&state=wrong",
            _CALLBACK + "?code=one&code=two&state=state",
            _CALLBACK + "?error=access_denied&state=state",
            _CALLBACK + "/extra?code=code&state=state",
            _CALLBACK + "?code=code&state=state#fragment",
        ):
            with self.subTest(location=location):
                session = self._browser([_response(302, headers={"Location": location})])
                with self.assertRaises(AssertionError):
                    self.probe._authorize(_BASE + "/mcp/authorize", "state")
                self.assertEqual(session.request.call_count, 1)

    def test_oauth_redirect_loop_is_bounded(self):
        session = self._browser(None)
        session.request.return_value = _response(302, headers={"Location": "/dex/auth"})
        with self.assertRaisesRegex(AssertionError, "redirect/form limit"):
            self.probe._authorize(_BASE + "/mcp/authorize", "state")
        self.assertEqual(session.request.call_count, 25)

    def test_embedded_login_refuses_external_origin_before_reading_or_sending_credentials(self):
        probe = mcp_probe.McpProbe(self, "https://external.example")
        with (
            mock.patch.object(mcp_probe.requests, "request") as send,
            mock.patch.object(mcp_probe.subprocess, "run") as run,
        ):
            for login in (probe.authenticate_embedded_dex, probe.direct_dex_token):
                with self.assertRaisesRegex(AssertionError, "loopback OSMO origin"):
                    login()
            send.assert_not_called()
            run.assert_not_called()

    def test_password_read_requires_explicit_kind_context(self):
        with mock.patch.dict(os.environ, {"KUBECONFIG": ""}):
            with mock.patch.object(mcp_probe.subprocess, "run") as run:
                with self.assertRaisesRegex(AssertionError, "explicit KUBECONFIG"):
                    self.probe._admin_password()
                run.assert_not_called()
        with mock.patch.dict(os.environ, {"KUBECONFIG": "/tmp/example-kubeconfig"}):
            with mock.patch.object(mcp_probe.subprocess, "run", return_value=SimpleNamespace(
                returncode=0, stdout="production\n", stderr="",
            )) as run:
                with self.assertRaisesRegex(AssertionError, "KIND context"):
                    self.probe._admin_password()
                self.assertEqual(run.call_count, 1)

    def test_password_read_pins_context_and_keeps_secret_out_of_commands(self):
        with (
            mock.patch.dict(os.environ, {"KUBECONFIG": "/tmp/example-kubeconfig"}),
            mock.patch.object(mcp_probe.subprocess, "run", side_effect=[
                SimpleNamespace(returncode=0, stdout="kind-test\n"),
                SimpleNamespace(returncode=0, stdout=base64.b64encode(_SECRET.encode()).decode()),
            ]) as run,
        ):
            self.assertEqual(self.probe._admin_password(), _SECRET)
        command = run.call_args.args[0]
        self.assertEqual(command[:7], [
            "kubectl", "--kubeconfig", "/tmp/example-kubeconfig", "--context", "kind-test",
            "--namespace", "osmo",
        ])
        self.assertNotIn(_SECRET, str(command))
        self.assertNotIn(_SECRET, repr(self.probe))

    def test_transport_and_subprocess_errors_suppress_credential_details(self):
        with (
            mock.patch.object(
                mcp_probe.requests, "request", side_effect=requests.ConnectionError(_SECRET),
            ),
            self._expect_sanitized_failure(),
        ):
            self.probe.raw_request("tools/list", {}, token=_SECRET)
        with (
            mock.patch.dict(os.environ, {"KUBECONFIG": "/tmp/example-kubeconfig"}),
            mock.patch.object(mcp_probe.subprocess, "run", side_effect=subprocess.TimeoutExpired(
                ["kubectl"], timeout=30, output=_SECRET,
            )),
            self._expect_sanitized_failure(),
        ):
            self.probe._admin_password()

    def test_rpc_rejects_malformed_or_error_results_without_echoing_payloads(self):
        for payload in (
            {"jsonrpc": "2.0", "id": 2, "result": {}},
            {"jsonrpc": "2.0", "id": True, "result": {}},
            {"jsonrpc": "2.0", "id": 1, "error": {"message": _SECRET}},
            {"jsonrpc": "2.0", "id": 1, "result": None},
            [_SECRET],
        ):
            with self.subTest(payload_type=type(payload).__name__):
                probe = mcp_probe.McpProbe(self, _BASE)
                with mock.patch.object(
                    mcp_probe.requests, "request", return_value=_response(payload=payload),
                ):
                    with self.assertRaises(AssertionError) as error:
                        probe.request("tools/list", {}, token=_SECRET)
                self.assertNotIn(_SECRET, str(error.exception))
        with mock.patch.object(mcp_probe.requests, "request", return_value=_response(body=_SECRET)):
            with self.assertRaisesRegex(AssertionError, "not JSON") as error:
                self.probe.request("tools/list", {})
            self.assertNotIn(_SECRET, str(error.exception))

    def test_raw_requests_are_anonymous_and_normal_requests_use_the_session(self):
        self.probe.access_token = _SECRET
        with mock.patch.object(mcp_probe.requests, "request", side_effect=[
            _response(401),
            _response(payload={"jsonrpc": "2.0", "id": 2, "result": {"tools": []}}),
        ]) as send:
            self.probe.raw_request("tools/list", {})
            self.assertEqual(self.probe.request("tools/list", {}), {"tools": []})
        self.assertNotIn("Authorization", send.call_args_list[0].kwargs["headers"])
        self.assertEqual(
            send.call_args_list[1].kwargs["headers"]["Authorization"], "Bearer " + _SECRET,
        )

    def test_tool_errors_cannot_pass_as_successful_http_responses(self):
        result: dict[str, Any]
        for result in (
            {"isError": True, "structuredContent": {}, "content": [{"text": _SECRET}]},
            {"structuredContent": {}},
            {"isError": False, "structuredContent": []},
        ):
            with mock.patch.object(self.probe, "request", return_value=result):
                with self.assertRaises(AssertionError) as error:
                    self.probe.call_tool("osmo_get_profile", {})
            self.assertNotIn(_SECRET, str(error.exception))


if __name__ == "__main__":
    unittest.main()
