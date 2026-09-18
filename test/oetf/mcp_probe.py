"""Public MCP smoke probes with real embedded-Dex OAuth authentication."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import base64
import binascii
import hashlib
from html.parser import HTMLParser
import os
import re
import secrets
import subprocess
from typing import Any, NoReturn
import unittest
from urllib import parse

import requests


_ACCEPT = {"Accept": "application/json, text/event-stream"}
_CALLBACK = "http://127.0.0.1:33749/callback"


class _LoginForm(HTMLParser):
    """Read only the first form and preserve its hidden CSRF fields."""

    def __init__(self) -> None:
        super().__init__()
        self.action: str | None = None
        self.method = ""
        self.fields: dict[str, str] = {}
        self._in_form = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "form" and self.action is None:
            self.action = attributes.get("action") or ""
            self.method = (attributes.get("method") or "get").lower()
            self._in_form = True
        if tag == "input" and self._in_form and attributes.get("name"):
            self.fields[str(attributes["name"])] = attributes.get("value") or ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "form":
            self._in_form = False


class McpProbe:
    """Exercise a deployed MCP endpoint without logging credential payloads.

    Fresh OAuth login reads credentials from the explicit KIND KUBECONFIG.
    Keep the default repr to avoid exposing credentials in assertion output.
    """

    def __init__(self, fixture: unittest.TestCase, base_url: str) -> None:
        self._fixture = fixture
        self.base_url = base_url.rstrip("/")
        origin = self._split_url(self.base_url)
        self._require(
            origin.scheme in {"http", "https"} and bool(origin.netloc)
            and not origin.path and not origin.query and not origin.fragment
            and origin.username is None and origin.password is None,
            "MCP base URL must be an HTTP(S) origin.",
        )
        self._origin = (origin.scheme, origin.netloc)
        self.access_token = ""
        self._password = ""
        self._request_id = 0

    def _fail(self, message: str) -> NoReturn:
        raise self._fixture.failureException(message) from None

    def _require(self, condition: bool, message: str) -> None:
        if not condition:
            self._fail(message)

    def _split_url(self, url: str) -> parse.SplitResult:
        try:
            target = parse.urlsplit(url)
            _ = target.port
            return target
        except ValueError:
            self._fail("MCP navigation has an invalid URL.")

    def _join_url(self, base: str, reference: str) -> str:
        try:
            return parse.urljoin(base, reference)
        except ValueError:
            self._fail("MCP navigation has an invalid URL.")

    def _same_origin(self, url: str) -> None:
        target = self._split_url(url)
        self._require(
            (target.scheme, target.netloc) == self._origin
            and target.username is None and target.password is None
            and not target.fragment
            and not any(ord(character) <= 0x20 for character in url)
            and "\\" not in url,
            "OAuth navigation must stay on the configured OSMO origin.",
        )

    def _send(
        self, method: str, url: str, *, session: requests.Session | None = None,
        **kwargs: Any,
    ) -> requests.Response:
        self._same_origin(url)
        send = session.request if session is not None else requests.request
        try:
            return send(method, url, timeout=30, allow_redirects=False, **kwargs)
        except requests.RequestException:
            self._fail("MCP HTTP request failed; credential-bearing details omitted.")

    def _expect_status(self, response: requests.Response, status: int, label: str) -> None:
        self._require(
            response.status_code == status,
            f"{label}: expected HTTP {status}, received HTTP {response.status_code}.",
        )

    def _json(self, response: requests.Response, label: str) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError:
            self._fail(f"{label}: response is not JSON.")
        self._require(isinstance(payload, dict), f"{label}: response must be an object.")
        return payload

    def expect_discovery(self) -> dict[str, Any]:
        """Check anonymous denial, canonical discovery, and private health routes."""
        metadata_url = self.base_url + "/.well-known/oauth-protected-resource/mcp"
        anonymous = self.raw_request("tools/list", {})
        self._expect_status(anonymous, 401, "Anonymous MCP request")
        challenge = anonymous.headers.get("WWW-Authenticate", "")
        self._require(
            challenge.startswith("Bearer ")
            and f'resource_metadata="{metadata_url}"' in challenge,
            "Anonymous MCP request is missing its canonical discovery challenge.",
        )
        response = self._send("GET", metadata_url)
        self._expect_status(response, 200, "Protected-resource discovery")
        resource = self._json(response, "Protected-resource discovery")
        self._require(
            resource.get("resource") == self.base_url + "/mcp"
            and resource.get("authorization_servers") == [self.base_url + "/mcp"],
            "Protected-resource discovery does not match the MCP origin and issuer.",
        )
        response = self._send(
            "GET", self.base_url + "/.well-known/oauth-authorization-server/mcp",
        )
        self._expect_status(response, 200, "Authorization-server discovery")
        metadata = self._json(response, "Authorization-server discovery")
        endpoints = {
            "issuer": "/mcp",
            "authorization_endpoint": "/mcp/authorize",
            "token_endpoint": "/mcp/token",
            "registration_endpoint": "/mcp/register",
        }
        self._require(
            all(metadata.get(key) == self.base_url + path for key, path in endpoints.items()),
            "Authorization-server discovery advertises a noncanonical endpoint.",
        )
        scopes = metadata.get("scopes_supported")
        self._require(
            isinstance(scopes, list) and bool(scopes)
            and all(isinstance(scope, str) and bool(scope.strip()) for scope in scopes),
            "Authorization-server discovery must advertise nonempty scopes.",
        )
        self._require(
            metadata.get("client_id_metadata_document_supported") is True
            and "S256" in metadata.get("code_challenge_methods_supported", []),
            "Authorization-server discovery must support CIMD and S256 PKCE.",
        )
        for path in ("/mcp/health", "/mcp/health/live", "/mcp/health/ready"):
            self._expect_status(self._send("GET", self.base_url + path), 404, "Private MCP health")
        return metadata

    def _kubectl(self, arguments: list[str]) -> str:
        kubeconfig = os.environ.get("KUBECONFIG", "")
        self._require(bool(kubeconfig), "Embedded Dex login requires explicit KUBECONFIG.")
        try:
            result = subprocess.run(
                ["kubectl", "--kubeconfig", kubeconfig, *arguments],
                check=False, capture_output=True, text=True, timeout=30,
            )
        except (OSError, subprocess.SubprocessError):
            self._fail("Unable to read embedded Dex credentials from KIND.")
        self._require(result.returncode == 0, "Unable to read embedded Dex credentials from KIND.")
        return result.stdout.strip()

    def _require_kind_origin(self) -> None:
        self._require(
            self._split_url(self.base_url).hostname in {"localhost", "127.0.0.1", "::1"},
            "Embedded Dex KIND login requires a loopback OSMO origin.",
        )

    def _admin_password(self) -> str:
        self._require_kind_origin()
        if not self._password:
            context = self._kubectl(["config", "current-context"])
            self._require(
                re.fullmatch(r"kind-[A-Za-z0-9_.-]+", context) is not None,
                "Embedded Dex credentials may only be read from a KIND context.",
            )
            encoded = self._kubectl([
                "--context", context, "--namespace", "osmo", "get", "secret",
                "osmo-embedded-dex-admin", "--output=jsonpath={.data.password}",
            ])
            try:
                self._password = base64.b64decode(encoded, validate=True).decode("utf-8")
            except (ValueError, binascii.Error, UnicodeError):
                self._fail("Embedded Dex password Secret is malformed.")
            self._require(bool(self._password), "Embedded Dex password Secret is empty.")
        return self._password

    @staticmethod
    def _pkce() -> tuple[str, str]:
        verifier = secrets.token_urlsafe(48)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest(),
        ).rstrip(b"=").decode("ascii")
        return verifier, challenge

    def _authorize(self, url: str, state: str) -> str:
        password = self._admin_password()
        with requests.Session() as session:
            response = self._send("GET", url, session=session)
            for _ in range(24):
                response_url = response.url
                if not isinstance(response_url, str):
                    self._fail("OAuth browser response has no URL.")
                if response.is_redirect:
                    location = self._join_url(response_url, response.headers["Location"])
                    callback = self._split_url(location)
                    if callback._replace(query="").geturl() == _CALLBACK:
                        query = parse.parse_qs(callback.query)
                        self._require(
                            query.get("state") == [state] and "error" not in query
                            and len(query.get("code", [])) == 1 and bool(query["code"][0]),
                            "OAuth callback must contain one code and the original state.",
                        )
                        return query["code"][0]
                    response = self._send("GET", location, session=session)
                    continue
                self._expect_status(response, 200, "OAuth browser page")
                form = _LoginForm()
                form.feed(response.text)
                if form.action is None or form.method != "post":
                    self._fail("OAuth browser page must contain a POST form.")
                destination = self._join_url(response_url, form.action)
                self._same_origin(destination)
                path = self._split_url(destination).path
                if "csrf_token" in form.fields and path == "/mcp/consent":
                    form.fields["action"] = "approve"
                elif "login" in form.fields and path.startswith("/dex/"):
                    form.fields.update(login="admin@osmo.local", password=password)
                elif "approval" in form.fields and path.startswith("/dex/"):
                    form.fields["approval"] = "approve"
                else:
                    self._fail("OAuth browser page has an unsupported form.")
                response = self._send("POST", destination, session=session, data=form.fields)
        self._fail("OAuth browser exceeded the redirect/form limit.")

    def authenticate_embedded_dex(
        self, *, pkce_verifier_override: str | None = None,
    ) -> McpProbe:
        """Obtain a fresh MCP bearer; verifier override supports negative test proofs."""
        self._require_kind_origin()
        self.access_token = ""
        metadata = self.expect_discovery()
        self._require(metadata["scopes_supported"] == ["openid"], "Expected embedded Dex scopes.")
        response = self._send("POST", metadata["registration_endpoint"], json={
            "redirect_uris": [_CALLBACK], "client_name": "OSMO OETF",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"], "token_endpoint_auth_method": "none",
        })
        self._expect_status(response, 201, "MCP client registration")
        client_id = self._json(response, "MCP client registration").get("client_id")
        if not isinstance(client_id, str) or not client_id:
            self._fail("Missing MCP client ID.")
        verifier, challenge = self._pkce()
        state = secrets.token_urlsafe(24)
        code = self._authorize(metadata["authorization_endpoint"] + "?" + parse.urlencode({
            "client_id": client_id, "redirect_uri": _CALLBACK, "response_type": "code",
            "scope": "openid", "state": state, "resource": self.base_url + "/mcp",
            "code_challenge": challenge, "code_challenge_method": "S256",
        }), state)
        response = self._send("POST", metadata["token_endpoint"], data={
            "grant_type": "authorization_code", "code": code, "client_id": client_id,
            "redirect_uri": _CALLBACK, "resource": self.base_url + "/mcp",
            "code_verifier": verifier if pkce_verifier_override is None else pkce_verifier_override,
        })
        self._expect_status(response, 200, "MCP OAuth token exchange")
        token = self._json(response, "MCP OAuth token exchange").get("access_token")
        if not isinstance(token, str) or not token:
            self._fail("Missing MCP access token.")
        self.access_token = token
        return self

    def direct_dex_token(self) -> str:
        """Get a fresh CLI ID token to verify the API/MCP authentication boundary."""
        self._require_kind_origin()
        verifier, challenge = self._pkce()
        state = secrets.token_urlsafe(24)
        code = self._authorize(self.base_url + "/dex/auth?" + parse.urlencode({
            "client_id": "osmo-cli", "redirect_uri": _CALLBACK, "response_type": "code",
            "scope": "openid profile email groups", "state": state,
            "code_challenge": challenge, "code_challenge_method": "S256",
        }), state)
        response = self._send("POST", self.base_url + "/dex/token", data={
            "grant_type": "authorization_code", "code": code, "client_id": "osmo-cli",
            "redirect_uri": _CALLBACK, "code_verifier": verifier,
        })
        self._expect_status(response, 200, "Dex CLI token exchange")
        token = self._json(response, "Dex CLI token exchange").get("id_token")
        if not isinstance(token, str) or not token:
            self._fail("Missing Dex CLI ID token.")
        return token

    def raw_request(
        self, method: str, params: dict[str, Any], token: str = "",
    ) -> requests.Response:
        """Send JSON-RPC; the default is explicitly anonymous."""
        self._request_id += 1
        headers = dict(_ACCEPT)
        if token:
            headers["Authorization"] = "Bearer " + token
        return self._send("POST", self.base_url + "/mcp", headers=headers, json={
            "jsonrpc": "2.0", "id": self._request_id, "method": method, "params": params,
        })

    def request(
        self, method: str, params: dict[str, Any], token: str | None = None,
    ) -> dict[str, Any]:
        """Require an HTTP 200 and a successful, matching JSON-RPC result."""
        response = self.raw_request(method, params, self.access_token if token is None else token)
        self._expect_status(response, 200, "MCP JSON-RPC request")
        payload = self._json(response, "MCP JSON-RPC request")
        response_id = payload.get("id")
        self._require(
            payload.get("jsonrpc") == "2.0" and isinstance(response_id, int)
            and not isinstance(response_id, bool)
            and response_id == self._request_id and "error" not in payload
            and isinstance(payload.get("result"), dict),
            "MCP JSON-RPC response must contain a successful result with the matching ID.",
        )
        return payload["result"]

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        result = self.request("tools/call", {"name": name, "arguments": arguments})
        self._require(
            result.get("isError") is False and isinstance(result.get("structuredContent"), dict),
            "MCP tool must return successful structured content.",
        )
        return result["structuredContent"]

    def api_get(
        self, path: str, token: str, params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Read the caller's Gateway API response without recording its bearer."""
        self._require(path.startswith("/api/"), "Expected an OSMO API path.")
        response = self._send(
            "GET", self.base_url + path,
            headers={"Authorization": "Bearer " + token}, params=params,
        )
        self._expect_status(response, 200, "Gateway API request")
        return self._json(response, "Gateway API request")
