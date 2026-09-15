"""Mocked unit coverage of the OAuth bootstrap, not deployed login/E2E.

Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import argparse
import asyncio
import contextlib
import io
import json
import logging
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock
import warnings

import httpx
from mcp.shared import auth as oauth_models

from test.oetf import mcp, mcp_login


BASE_URL = "https://dev.example"
RESOURCE = BASE_URL + "/mcp"
SCOPE = RESOURCE + "/access_as_user"
SYNTHETIC_SECRET = "synthetic-oauth-secret"


class McpBootstrapTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # unittest keeps this context open through the test and its cleanup.
        temporary = self.enterContext(
            tempfile.TemporaryDirectory(),  # pylint: disable=consider-using-with
        )
        self.args = argparse.Namespace(
            url=BASE_URL, username="test-user",
            session_dir=str(Path(temporary) / "session"),
            callback_port=8765,
        )
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(mock.patch.object(
            mcp_login.httpx.AsyncHTTPTransport, "handle_async_request",
            side_effect=AssertionError("Unexpected HTTPX request in bootstrap unit test"),
        ))
        self.enterContext(mock.patch.object(
            mcp.requests.Session, "request",
            side_effect=AssertionError("Unexpected requests call in bootstrap unit test"),
        ))
        # Use the pinned client's real metadata and storage adapter. Only the
        # network/client exchange is mocked; no browser or listener is started.
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="Using in-memory token storage.*")
            self.oauth = mcp_login._InteractiveOAuth(  # pylint: disable=protected-access
                mcp_url=RESOURCE, scopes=[SCOPE], callback_host="127.0.0.1",
                callback_port=8765, token_storage=mcp_login.MemoryStore(),
                additional_client_metadata={"token_endpoint_auth_method": "none"},
            )
        self.tokens = oauth_models.OAuthToken(
            access_token=SYNTHETIC_SECRET, refresh_token="synthetic-refresh-secret",
            expires_in=600, scope=SCOPE,
        )
        self.client_info = oauth_models.OAuthClientInformationFull(
            client_id="test-public-client", token_endpoint_auth_method="none",
            redirect_uris=["http://127.0.0.1:8765/callback"], scope=SCOPE,
        )
        await self.oauth.token_storage_adapter.set_tokens(self.tokens)
        await self.oauth.token_storage_adapter.set_client_info(self.client_info)
        self.expiry = await self.oauth.token_storage_adapter.get_token_expiry()
        self.oauth_factory = self.enterContext(mock.patch.object(
            mcp_login, "_InteractiveOAuth", return_value=self.oauth,
        ))
        self.discovery = self.enterContext(mock.patch.object(
            mcp, "discover_authorization", return_value=({}, [SCOPE]),
        ))
        self.real_client_type = mcp_login.Client
        self.client_factory = self.enterContext(mock.patch.object(mcp_login, "Client"))
        self.client = self.client_factory.return_value.__aenter__.return_value
        self.client.call_tool_mcp = mock.AsyncMock(return_value=SimpleNamespace(
            isError=False, structuredContent={"profile": {"username": "test-user"}},
        ))
        self.browser = self.enterContext(mock.patch.object(mcp_login.webbrowser, "open"))

    def assert_session_not_saved(self):
        self.assertFalse((Path(self.args.session_dir) / "session").exists())
        self.assertNotIn("login succeeded", self.output.getvalue())

    async def test_bootstrap_binds_identity_and_preserves_absolute_expiry(self):
        assert self.expiry is not None
        with mock.patch.object(mcp.time, "time", return_value=self.expiry - 5):
            await mcp_login.bootstrap(self.args)
        store = mcp.SessionStore(self.args.session_dir)
        with store.locked():
            session = store.load(RESOURCE, "test-user")
        self.assertEqual(session.client_id, "test-public-client")
        self.assertEqual(session.access_token, SYNTHETIC_SECRET)
        self.assertEqual(session.refresh_token, "synthetic-refresh-secret")
        self.assertEqual(session.expires_at, self.expiry)
        self.client.call_tool_mcp.assert_awaited_once_with("osmo_get_profile", {}, timeout=30)
        self.discovery.assert_called_once_with(BASE_URL)
        arguments = self.oauth_factory.call_args.kwargs
        self.assertEqual(arguments["mcp_url"], RESOURCE)
        self.assertEqual(arguments["scopes"], [SCOPE])
        self.assertEqual(arguments["additional_client_metadata"],
                         {"token_endpoint_auth_method": "none"})
        self.assertEqual(arguments["callback_host"], "127.0.0.1")
        self.assertEqual(arguments["callback_port"], 8765)
        self.assertIs(arguments["httpx_client_factory"], mcp_login._http_client)  # pylint: disable=protected-access
        self.assertEqual(self.oauth.context.client_metadata.grant_types,
                         ["authorization_code", "refresh_token"])
        self.assertNotIn(SYNTHETIC_SECRET, self.output.getvalue())
        self.assertNotIn("synthetic-refresh-secret", self.output.getvalue())
        self.browser.assert_not_called()

    async def test_initialization_can_wait_for_interactive_deadline(self):
        await mcp_login.bootstrap(self.args)
        settings = self.client_factory.call_args.kwargs
        callback_timeout = self.oauth_factory.call_args.kwargs["callback_timeout"]
        self.assertGreaterEqual(settings["timeout"], callback_timeout)

        async def response(request):
            payload = json.loads(request.content)
            if payload["method"] == "initialize":
                # Scale the real configured deadlines down to milliseconds.
                # Waiting for OAuth occupies this same SDK initialize request.
                await asyncio.sleep(0.1)
                return httpx.Response(200, json={
                    "jsonrpc": "2.0", "id": payload["id"], "result": {
                        "protocolVersion": "2025-03-26", "capabilities": {},
                        "serverInfo": {"name": "synthetic", "version": "1"},
                    },
                })
            return httpx.Response(202)

        def http_client(*args, **kwargs):
            kwargs.update(transport=httpx.MockTransport(response))
            return mcp_login._http_client(*args, **kwargs)  # pylint: disable=protected-access

        transport = mcp_login.StreamableHttpTransport(
            RESOURCE, httpx_client_factory=http_client,
        )
        async with self.real_client_type(
            transport, timeout=settings["timeout"] / 1000,
            init_timeout=settings["init_timeout"] / 1000,
        ) as client:
            self.assertIsNotNone(client.initialize_result)

    async def test_past_absolute_expiry_is_preserved_for_headless_refresh(self):
        expiry = time.time() - 10
        with mock.patch.object(self.oauth.token_storage_adapter, "get_token_expiry",
                               new=mock.AsyncMock(return_value=expiry)):
            await mcp_login.bootstrap(self.args)
        store = mcp.SessionStore(self.args.session_dir)
        with store.locked():
            self.assertEqual(store.load(RESOURCE, "test-user").expires_at, expiry)

    async def test_mismatched_or_malformed_profile_never_saves_session(self):
        profiles: tuple[object, ...] = (
            None, [], {}, {"profile": []}, {"profile": {"username": SYNTHETIC_SECRET}},
        )
        for profile in profiles:
            with self.subTest(profile_type=type(profile).__name__):
                self.client.call_tool_mcp.return_value = SimpleNamespace(
                    isError=False, structuredContent=profile,
                )
                with self.assertRaises(mcp.McpSessionError) as caught:
                    await mcp_login.bootstrap(self.args)
                self.assertNotIn(SYNTHETIC_SECRET, str(caught.exception))
                self.assert_session_not_saved()

    async def test_tool_error_does_not_authenticate_matching_profile(self):
        self.client.call_tool_mcp.return_value.isError = True
        with self.assertRaises(mcp.McpSessionError):
            await mcp_login.bootstrap(self.args)
        self.assert_session_not_saved()

    async def test_missing_oauth_state_never_saves_session(self):
        for method in ("get_tokens", "get_client_info", "get_token_expiry"):
            with self.subTest(method=method), mock.patch.object(
                    self.oauth.token_storage_adapter, method,
                    new=mock.AsyncMock(return_value=None)):
                with self.assertRaises(mcp.McpSessionError):
                    await mcp_login.bootstrap(self.args)
                self.assert_session_not_saved()

    async def test_confidential_client_never_saves_session(self):
        for update in ({"token_endpoint_auth_method": "client_secret_post"},
                       {"token_endpoint_auth_method": None},
                       {"client_secret": SYNTHETIC_SECRET}):
            client_info = self.client_info.model_copy(update=update)
            await self.oauth.token_storage_adapter.set_client_info(client_info)
            with self.subTest(field=next(iter(update))), self.assertRaises(mcp.McpSessionError):
                await mcp_login.bootstrap(self.args)
            self.assert_session_not_saved()

    async def test_missing_or_invalid_client_id_never_saves_session(self):
        for client_id in (None, "", "bad client"):
            client_info = self.client_info.model_copy(update={"client_id": client_id})
            await self.oauth.token_storage_adapter.set_client_info(client_info)
            with self.subTest(client_id=client_id), self.assertRaises(mcp.McpSessionError):
                await mcp_login.bootstrap(self.args)
            self.assert_session_not_saved()

    async def test_invalid_tokens_never_save_session(self):
        for update in ({"refresh_token": None}, {"access_token": "bad\r\nsecret"},
                       {"expires_in": 0}, {"expires_in": None}):
            tokens = self.tokens.model_copy(update=update)
            await self.oauth.token_storage_adapter.set_tokens(tokens)
            with self.subTest(field=next(iter(update))), self.assertRaises(mcp.McpSessionError):
                await mcp_login.bootstrap(self.args)
            self.assert_session_not_saved()

    async def test_invalid_absolute_expiry_never_saves_session(self):
        for expiry in (True, "secret-expiry", float("nan"), float("inf"), 0, -1):
            with self.subTest(expiry_type=type(expiry).__name__), mock.patch.object(
                    self.oauth.token_storage_adapter, "get_token_expiry",
                    new=mock.AsyncMock(return_value=expiry)):
                with self.assertRaises(mcp.McpSessionError):
                    await mcp_login.bootstrap(self.args)
                self.assert_session_not_saved()

    async def test_discovery_failure_stops_before_interactive_login(self):
        self.discovery.side_effect = mcp.McpSessionError("MCP discovery rejected.")
        with self.assertRaises(mcp.McpSessionError):
            await mcp_login.bootstrap(self.args)
        self.oauth_factory.assert_not_called()
        self.client_factory.assert_not_called()
        self.assert_session_not_saved()

    async def test_storage_failure_does_not_report_login_success(self):
        with mock.patch.object(mcp.SessionStore, "save", side_effect=mcp.McpSessionError(
                "Could not persist MCP session; repeat MCP login.")):
            with self.assertRaises(mcp.McpSessionError):
                await mcp_login.bootstrap(self.args)
        self.assert_session_not_saved()

    async def test_redirect_hook_rejects_cross_origin_before_display(self):
        for authorization_url in ("https://untrusted.example/mcp/authorize?secret=value",
                                  BASE_URL + "/authorize?secret=value",
                                  "http://dev.example/mcp/authorize?secret=value"):
            with self.subTest(authorization_url=authorization_url):
                with self.assertRaises(mcp.McpSessionError) as caught:
                    await self.oauth.redirect_handler(authorization_url)
                self.assertNotIn("secret=value", str(caught.exception))
                self.assertNotIn("secret=value", self.output.getvalue())
        self.browser.assert_not_called()

    async def test_redirect_hook_opens_only_confirmed_authorization_url(self):
        authorization_url = RESOURCE + "/authorize?state=synthetic-state&code_challenge=synthetic"
        await self.oauth.redirect_handler(authorization_url)
        self.browser.assert_called_once_with(authorization_url)
        self.assertIn(authorization_url, self.output.getvalue())


class McpLoginCommandTest(unittest.TestCase):
    def setUp(self):
        self.arguments = ["--url", BASE_URL, "--username", "test-user",
                          "--session-dir", "/unused-unit-test-session"]
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.error = self.enterContext(contextlib.redirect_stderr(io.StringIO()))
        self.previous_logging = logging.root.manager.disable
        self.addCleanup(logging.disable, self.previous_logging)

    def test_http_client_disables_ambient_auth_and_redirects(self):
        with mock.patch.object(mcp_login.httpx, "AsyncClient") as client:
            mcp_login._http_client(trust_env=True, follow_redirects=True, timeout=10)  # pylint: disable=protected-access
        client.assert_called_once_with(
            headers=None, timeout=10, auth=None, trust_env=False, follow_redirects=False,
        )

    def test_http_client_accepts_sdk_positional_arguments(self):
        headers = {"x-test-header": "synthetic"}
        timeout = mcp_login.httpx.Timeout(15)
        auth = mock.Mock(spec=mcp_login.httpx.Auth)
        with mock.patch.object(mcp_login.httpx, "AsyncClient") as client:
            mcp_login._http_client(headers, timeout, auth)  # pylint: disable=protected-access
        client.assert_called_once_with(
            headers=headers, timeout=timeout, auth=auth,
            trust_env=False, follow_redirects=False,
        )

    def test_command_sanitizes_library_failures_and_restores_logging(self):
        captured_logs = io.StringIO()
        handler = logging.StreamHandler(captured_logs)
        logger = logging.getLogger("fastmcp.client.auth")
        logger.addHandler(handler)
        self.addCleanup(logger.removeHandler, handler)
        self.addCleanup(handler.close)

        async def fail_login(args):
            del args
            logger.critical(SYNTHETIC_SECRET)
            raise RuntimeError(SYNTHETIC_SECRET)

        logging.disable(logging.WARNING)
        with mock.patch.object(mcp_login, "bootstrap", side_effect=fail_login):
            self.assertEqual(mcp_login.main(self.arguments), 1)
        self.assertEqual(logging.root.manager.disable, logging.WARNING)
        self.assertIn("MCP login failed", self.error.getvalue())
        self.assertNotIn(SYNTHETIC_SECRET, self.output.getvalue() + self.error.getvalue())
        self.assertNotIn(SYNTHETIC_SECRET, captured_logs.getvalue())

    def test_command_reports_fixed_session_failure_without_traceback(self):
        with mock.patch.object(mcp_login, "bootstrap", new=mock.AsyncMock(
                side_effect=mcp.McpSessionError(
                    "MCP session belongs to a different endpoint or user."))):
            self.assertEqual(mcp_login.main(self.arguments), 1)
        self.assertIn("different endpoint or user", self.error.getvalue())
        self.assertNotIn("Traceback", self.error.getvalue())

    def test_command_cancellation_restores_logging(self):
        with mock.patch.object(mcp_login, "bootstrap", new=mock.AsyncMock(
                side_effect=KeyboardInterrupt)):
            self.assertEqual(mcp_login.main(self.arguments), 130)
        self.assertEqual(logging.root.manager.disable, self.previous_logging)
        self.assertIn("MCP login cancelled", self.error.getvalue())

    def test_invalid_callback_port_never_starts_bootstrap(self):
        for port in ("0", "65536"):
            with self.subTest(port=port), mock.patch.object(mcp_login, "bootstrap") as bootstrap:
                with self.assertRaises(SystemExit) as caught:
                    mcp_login.main([*self.arguments, "--callback-port", port])
                self.assertEqual(caught.exception.code, 2)
                bootstrap.assert_not_called()


if __name__ == "__main__":
    unittest.main()
