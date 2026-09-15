"""Regression tests for OETF's real-token MCP session handling.

Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import dataclasses
import json
import os
from pathlib import Path
import stat
import tempfile
import time
import unittest
from unittest import mock

from cryptography.fernet import Fernet
import requests

from test.oetf import mcp


BASE_URL = "https://dev.example"
RESOURCE = BASE_URL + "/mcp"
SCOPE = RESOURCE + "/access_as_user"


class McpSessionTest(unittest.TestCase):
    def setUp(self):
        # unittest keeps this context open through the test and its cleanup.
        self.temporary = self.enterContext(
            tempfile.TemporaryDirectory(),  # pylint: disable=consider-using-with
        )
        self.directory = str(Path(self.temporary) / "session")
        self.store = mcp.SessionStore(self.directory)
        self.session = mcp.McpSession(
            RESOURCE, "test-user", "public-client", "access-secret", "refresh-secret",
            time.time() + 600,
        )
        with self.store.locked(create=True):
            self.store.save(self.session)

    def client(self):
        return mcp.McpClient(BASE_URL, self.directory, "test-user")

    @staticmethod
    def token_response(**overrides):
        return {
            "access_token": "next-access-secret", "refresh_token": "next-refresh-secret",
            "token_type": "Bearer", "expires_in": 600, **overrides,
        }

    @staticmethod
    def discovery_response(method, url, **kwargs):
        del method, kwargs
        if url.endswith("oauth-protected-resource/mcp"):
            return {"resource": RESOURCE, "authorization_servers": [RESOURCE],
                    "scopes_supported": [SCOPE]}
        return {"issuer": RESOURCE, "authorization_endpoint": RESOURCE + "/authorize",
                "token_endpoint": RESOURCE + "/token",
                "registration_endpoint": RESOURCE + "/register"}

    def test_encrypted_round_trip_and_private_permissions(self):
        with self.store.locked():
            self.assertEqual(self.store.load(RESOURCE, "test-user"), self.session)
        for name in ("key", "session", "lock"):
            path = Path(self.directory) / name
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertNotIn(b"access-secret", path.read_bytes())
            self.assertNotIn(b"refresh-secret", path.read_bytes())
        self.assertEqual(stat.S_IMODE(Path(self.directory).stat().st_mode), 0o700)
        self.assertNotIn("access-secret", repr(self.session))

    def test_session_rejects_other_endpoint_or_identity(self):
        for resource, username in (("https://other.example/mcp", "test-user"),
                                   (RESOURCE, "other-user")):
            with self.subTest(resource=resource, username=username), self.store.locked():
                with self.assertRaisesRegex(mcp.McpSessionError, "different endpoint or user"):
                    self.store.load(resource, username)

    def test_missing_session_fails_without_api_token_fallback(self):
        with mock.patch.dict(os.environ, {"OSMO_MCP_ACCESS_TOKEN": "legacy-token",
                                          "OETF_AUTH_TOKEN": "api-token"}):
            with self.assertRaisesRegex(mcp.McpSessionError, "do not skip"):
                mcp.McpClient(BASE_URL, "", "test-user")

    def test_non_private_directory_rejected(self):
        Path(self.directory).chmod(0o755)
        with self.assertRaisesRegex(mcp.McpSessionError, "private"):
            with self.store.locked():
                self.fail("must not enter unsafe directory")

    def test_non_private_credentials_rejected(self):
        for name in ("key", "session"):
            with self.subTest(name=name):
                path = Path(self.directory) / name
                path.chmod(0o644)
                with self.assertRaisesRegex(mcp.McpSessionError, "private"), self.store.locked():
                    self.store.load(RESOURCE, "test-user")
                path.chmod(0o600)

    def test_symlink_directory_rejected(self):
        link = Path(self.temporary) / "alias"
        link.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaisesRegex(mcp.McpSessionError, "private"):
            with mcp.SessionStore(str(link)).locked():
                self.fail("must not enter symlink")

    def test_symlink_credentials_rejected_without_overwriting_target(self):
        target = Path(self.temporary) / "target"
        target.write_bytes(b"unchanged")
        key = Path(self.directory) / "key"
        key.unlink()
        key.symlink_to(target)
        with self.assertRaises(mcp.McpSessionError), self.store.locked():
            self.store.save(self.session)
        self.assertEqual(target.read_bytes(), b"unchanged")

    def test_parallel_rotation_is_rejected(self):
        with self.store.locked():
            with self.assertRaisesRegex(mcp.McpSessionError, "in use"):
                with mcp.SessionStore(self.directory).locked():
                    self.fail("must not rotate concurrently")

    def test_fifo_credentials_fail_without_blocking(self):
        path = Path(self.directory) / "session"
        path.unlink()
        os.mkfifo(path, mode=0o600)
        with self.assertRaisesRegex(mcp.McpSessionError, "private"), self.store.locked():
            self.store.load(RESOURCE, "test-user")

    def test_tampered_ciphertext_rejected_without_reflecting_input(self):
        (Path(self.directory) / "session").write_bytes(b"sensitive-invalid-input")
        with self.assertRaises(mcp.McpSessionError) as caught, self.store.locked():
            self.store.load(RESOURCE, "test-user")
        self.assertNotIn("sensitive-invalid-input", str(caught.exception))

    def test_malformed_encrypted_session_rejected(self):
        with self.store.locked():
            cipher = Fernet(self.store._read("key"))  # pylint: disable=protected-access
            invalid_sessions: tuple[object, ...] = (
                [], {}, {**dataclasses.asdict(self.session), "expires_at": True},
                {**dataclasses.asdict(self.session), "expires_at": float("nan")},
            )
            for invalid in invalid_sessions:
                self.store._write("session", cipher.encrypt(json.dumps(invalid).encode()))  # pylint: disable=protected-access,line-too-long
                with self.assertRaises(mcp.McpSessionError):
                    self.store.load(RESOURCE, "test-user")

    def test_failed_atomic_replace_keeps_previous_session(self):
        with self.store.locked(), mock.patch.object(mcp.os, "replace", side_effect=OSError):
            with self.assertRaises(mcp.McpSessionError):
                self.store.save(dataclasses.replace(self.session, access_token="replacement"))
        with self.store.locked():
            self.assertEqual(self.store.load(RESOURCE, "test-user"), self.session)
        self.assertEqual(set(path.name for path in Path(self.directory).iterdir()),
                         {"key", "session", "lock"})

    def test_fresh_process_refresh_discovers_scoped_endpoint_and_persists_rotation(self):
        with self.store.locked():
            self.store.save(dataclasses.replace(self.session, expires_at=time.time() - 1))
        expected_calls = []

        def http(method, url, **kwargs):
            expected_calls.append((method, url, kwargs))
            if method == "GET":
                self.assertNotIn("headers", kwargs)
                return self.discovery_response(method, url, **kwargs)
            if url == RESOURCE + "/token":
                self.assertEqual(kwargs["data"], {
                    "grant_type": "refresh_token", "refresh_token": "refresh-secret",
                    "client_id": "public-client", "resource": RESOURCE,
                })
                return self.token_response()
            self.assertEqual(url, RESOURCE)
            self.assertEqual(kwargs["headers"]["Authorization"], "Bearer next-access-secret")
            return {"jsonrpc": "2.0", "id": 7, "result": {"tools": []}}

        with mock.patch.object(mcp, "_json_http", side_effect=http):
            self.assertEqual(self.client().request(7, "tools/list", {}), {"tools": []})
        self.assertEqual([url for _, url, _ in expected_calls], [
            BASE_URL + "/.well-known/oauth-protected-resource/mcp",
            BASE_URL + "/.well-known/oauth-authorization-server/mcp",
            RESOURCE + "/token", RESOURCE,
        ])
        with self.store.locked():
            rotated = self.store.load(RESOURCE, "test-user")
        self.assertEqual(rotated.refresh_token, "next-refresh-secret")
        self.assertGreater(rotated.expires_at, time.time())
        with mock.patch.object(mcp, "_json_http") as http:
            self.assertEqual(self.client()._access_token(), "next-access-secret")  # pylint: disable=protected-access
            http.assert_not_called()

    def test_force_refresh_does_not_accept_unexpired_cached_token(self):
        with mock.patch.object(mcp, "discover_authorization", return_value=(
                {"token_endpoint": RESOURCE + "/token"}, [SCOPE])), \
             mock.patch.object(mcp, "_json_http", return_value=self.token_response()) as http:
            self.client().refresh()
        self.assertEqual(http.call_count, 1)
        self.assertEqual(http.call_args.args, ("POST", RESOURCE + "/token"))

    def test_failed_refresh_preserves_session_and_does_not_call_mcp(self):
        with mock.patch.object(mcp, "discover_authorization", return_value=(
                {"token_endpoint": RESOURCE + "/token"}, [SCOPE])), \
             mock.patch.object(mcp, "_json_http", side_effect=mcp.McpSessionError(
                 "login required")) as http:
            with self.assertRaisesRegex(mcp.McpSessionError, "login required"):
                self.client().refresh()
        self.assertEqual(http.call_count, 1)
        with self.store.locked():
            self.assertEqual(self.store.load(RESOURCE, "test-user"), self.session)

    def test_malicious_discovery_never_receives_refresh_credential(self):
        for key in ("issuer", "authorization_endpoint", "token_endpoint", "registration_endpoint"):
            def http(method, url, field=key, **kwargs):
                self.assertEqual(method, "GET")
                response = self.discovery_response(method, url, **kwargs)
                if field in response:
                    response[field] = "https://untrusted.example/token"
                return response
            with self.subTest(key=key), mock.patch.object(mcp, "_json_http", side_effect=http):
                with self.assertRaisesRegex(mcp.McpSessionError, "endpoints"):
                    self.client().refresh()

    def test_missing_or_cross_resource_metadata_rejected(self):
        for response in ({}, {"resource": RESOURCE,
                              "authorization_servers": ["https://other.example"]}):
            with mock.patch.object(mcp, "_json_http", return_value=response):
                with self.assertRaises(mcp.McpSessionError):
                    self.client().refresh()

    def test_invalid_token_response_never_reflected(self):
        for overrides in ({"access_token": "bad\r\nsecret"}, {"token_type": 123},
                          {"access_token": "bad\x00secret"}, {"access_token": "bad:secret"},
                          {"refresh_token": "bad\x00secret"},
                          {"refresh_token": None}, {"expires_in": True},
                          {"expires_in": float("inf")}, {"expires_in": 0}):
            with self.subTest(overrides=list(overrides)), self.assertRaises(mcp.McpSessionError):
                mcp.session_from_tokens(resource=RESOURCE, username="test-user",
                                        client_id="client", tokens=self.token_response(**overrides))

    def test_refresh_response_can_retain_non_rotated_refresh_token(self):
        response = self.token_response()
        del response["refresh_token"]
        session = mcp.session_from_tokens(
            resource=RESOURCE, username="test-user", client_id="client",
            tokens=response, previous_refresh_token="retained-refresh",
        )
        self.assertEqual(session.refresh_token, "retained-refresh")

    def test_request_rejects_jsonrpc_and_tool_errors_without_reflection(self):
        for response in ({"jsonrpc": "2.0", "id": 1, "error": {"message": "secret"}},
                         {"jsonrpc": "2.0", "id": 2, "result": {}},
                         {"jsonrpc": "2.0", "id": 1, "result": {
                             "isError": True, "structuredContent": {"secret": "secret"}}}):
            with mock.patch.object(mcp, "_json_http", return_value=response):
                with self.assertRaises(mcp.McpSessionError) as caught:
                    self.client().call_tool("osmo_health", {})
                self.assertNotIn("secret", str(caught.exception))

    def test_only_https_service_origin_is_accepted(self):
        for url in ("http://dev.example", "https://user:secret@dev.example",
                    "https://dev.example/mcp", "https://dev.example?token=secret",
                    "https://dev.example/#fragment", "https://dev.example:bad"):
            with self.subTest(url=url), self.assertRaises(mcp.McpSessionError):
                mcp.resource_url(url)


class McpHttpTest(unittest.TestCase):
    def response(self, *, status=200, content=b"{}"):
        client = mock.MagicMock()
        response = client.__enter__.return_value.request.return_value.__enter__.return_value
        response.status_code = status
        response.iter_content.return_value = [content]
        return client

    def test_http_has_no_redirects_or_ambient_credentials(self):
        client = self.response()
        with mock.patch.object(mcp.requests, "Session", return_value=client):
            self.assertEqual(mcp._json_http("GET", RESOURCE), {})  # pylint: disable=protected-access
        session = client.__enter__.return_value
        self.assertFalse(session.trust_env)
        self.assertFalse(session.request.call_args.kwargs["allow_redirects"])
        self.assertTrue(session.request.call_args.kwargs["stream"])

    def test_http_rejects_oversized_invalid_or_non_object_json(self):
        for content in (b"x" * 65537, b"sensitive-invalid-json", b"[]"):
            with mock.patch.object(mcp.requests, "Session", return_value=self.response(
                    content=content)):
                with self.assertRaises(mcp.McpSessionError) as caught:
                    mcp._json_http("GET", RESOURCE)  # pylint: disable=protected-access
                self.assertNotIn("sensitive", str(caught.exception))

    def test_http_error_body_and_exception_are_not_reflected(self):
        with mock.patch.object(mcp.requests, "Session", return_value=self.response(
                status=401, content=b"secret")):
            with self.assertRaises(mcp.McpSessionError) as caught:
                mcp._json_http("POST", RESOURCE)  # pylint: disable=protected-access
        self.assertNotIn("secret", str(caught.exception))
        with mock.patch.object(mcp.requests, "Session", side_effect=requests.ConnectionError(
                "secret")):
            with self.assertRaises(mcp.McpSessionError) as caught:
                mcp._json_http("GET", RESOURCE)  # pylint: disable=protected-access
        self.assertNotIn("secret", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
