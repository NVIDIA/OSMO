"""Authenticated MCP probes and protected OAuth sessions for OETF.

Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

from __future__ import annotations

import contextlib
import dataclasses
import fcntl
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
import time
from typing import Any, Iterator
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
import requests


class McpSessionError(RuntimeError):
    """An actionable failure that never includes OAuth credentials or bodies."""


@dataclasses.dataclass(repr=False)
class McpSession:
    """One public MCP client's credentials, bound to a resource and principal."""

    resource_url: str
    username: str
    client_id: str
    access_token: str
    refresh_token: str
    expires_at: float


def resource_url(base_url: str) -> str:
    """OSMO's MCP resource is on its configured HTTPS service origin."""
    try:
        parsed = urlsplit(base_url)
        valid = (
            parsed.scheme == "https" and parsed.hostname
            and parsed.path in ("", "/")
            and parsed.username is None and parsed.password is None
            and not parsed.query and not parsed.fragment
            and (parsed.port is None or 0 < parsed.port < 65536)
            and not any(character.isspace() for character in base_url)
        )
    except ValueError:
        valid = False
    if not valid:
        raise McpSessionError("MCP requires an absolute HTTPS OSMO service origin.")
    return base_url.rstrip("/") + "/mcp"


def _json_http(method: str, url: str, *, limit: int = 65536, **kwargs: Any) -> dict:
    """Bound responses and never reflect token responses or HTTP exceptions."""
    try:
        with requests.Session() as client:
            # Never pick up netrc credentials, cookies or ambient proxy auth.
            client.trust_env = False
            with client.request(
                method, url, timeout=(5, 30), allow_redirects=False,
                stream=True, **kwargs,
            ) as response:
                if response.status_code != 200:
                    raise McpSessionError(
                        f"MCP {method} failed (HTTP {response.status_code}); "
                        "check the dev endpoint or repeat MCP login."
                    )
                content = bytearray()
                for chunk in response.iter_content(8192):
                    content.extend(chunk)
                    if len(content) > limit:
                        raise McpSessionError("MCP response exceeded its size limit.")
                value = json.loads(content)
                if not isinstance(value, dict):
                    raise McpSessionError("MCP returned an invalid JSON object.")
                return value
    except (requests.RequestException, ValueError):
        raise McpSessionError("MCP request failed or returned invalid JSON.") from None


def discover_authorization(base_url: str) -> tuple[dict, list[str]]:
    """Validate OSMO's scoped discovery before sending any refresh credential."""
    resource = resource_url(base_url)
    origin = resource.removesuffix("/mcp")
    protected = _json_http("GET", origin + "/.well-known/oauth-protected-resource/mcp")
    if (protected.get("resource") != resource
            or protected.get("authorization_servers") != [resource]):
        raise McpSessionError("MCP discovery does not match the configured resource.")
    scopes = protected.get("scopes_supported")
    if (not isinstance(scopes, list) or not scopes
            or not all(isinstance(scope, str) and scope.startswith(resource + "/")
                       and not any(character.isspace() for character in scope)
                       for scope in scopes)):
        raise McpSessionError("MCP discovery does not advertise valid resource scopes.")
    metadata = _json_http("GET", origin + "/.well-known/oauth-authorization-server/mcp")
    expected = {
        "issuer": resource,
        "authorization_endpoint": resource + "/authorize",
        "token_endpoint": resource + "/token",
        "registration_endpoint": resource + "/register",
    }
    if any(metadata.get(name) != value for name, value in expected.items()):
        raise McpSessionError("MCP OAuth endpoints do not match the configured resource.")
    return metadata, scopes


class SessionStore:
    """An encrypted, atomic session file guarded by an exclusive process lock.

    The directory is private (0700); key, ciphertext and lock are private
    regular files (0600). A caller chooses a separate directory per identity.
    Neither this directory nor its key belongs in Bazel outputs or reports.
    """

    def __init__(self, directory: str):
        if not directory:
            raise McpSessionError(
                "MCP session is required; run //test/oetf:mcp_login and pass "
                "--mcp-session-dir. Authenticated MCP tests do not skip."
            )
        self.directory = Path(directory).expanduser().absolute()

    @staticmethod
    def _check_owner(info: os.stat_result, *, directory: bool = False) -> None:
        correct_type = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
        if (not correct_type or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) & 0o077
                or (not directory and info.st_nlink != 1)):
            raise McpSessionError("MCP session storage must be private and owned by the caller.")

    @contextlib.contextmanager
    def locked(self, *, create: bool = False) -> Iterator[SessionStore]:
        try:
            if create:
                self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            self._check_owner(self.directory.lstat(), directory=True)
            descriptor = os.open(
                self.directory / "lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600,
            )
            try:
                self._check_owner(os.fstat(descriptor))
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise McpSessionError(
                        "MCP session is in use; retry after the other run."
                    ) from None
                yield self
            finally:
                os.close(descriptor)
        except OSError:
            raise McpSessionError(
                "MCP session storage is unavailable; run //test/oetf:mcp_login first."
            ) from None

    def _read(self, name: str) -> bytes:
        descriptor = os.open(
            self.directory / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
        )
        with os.fdopen(descriptor, "rb") as source:
            self._check_owner(os.fstat(source.fileno()))
            content = source.read(65537)
        if len(content) > 65536:
            raise McpSessionError("MCP session file exceeds its size limit.")
        return content

    def _write(self, name: str, content: bytes) -> None:
        if len(content) > 65536:
            raise McpSessionError("MCP session file exceeds its size limit.")
        destination = self.directory / name
        if destination.exists() or destination.is_symlink():
            self._check_owner(destination.lstat())
        descriptor, temporary = tempfile.mkstemp(
            prefix=".session-", dir=self.directory,
        )
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def load(self, resource: str, username: str) -> McpSession:
        try:
            raw = json.loads(Fernet(self._read("key")).decrypt(self._read("session")))
            if not isinstance(raw, dict):
                raise ValueError
            session = McpSession(**raw)
            if (not all(isinstance(value, str) and value
                        and value.isascii() and value.isprintable()
                        and not any(character.isspace() for character in value)
                        for value in (session.resource_url, session.username,
                                      session.client_id, session.access_token,
                                      session.refresh_token))
                    or re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", session.access_token) is None
                    or isinstance(session.expires_at, bool)
                    or not isinstance(session.expires_at, (int, float))
                    or not math.isfinite(session.expires_at) or session.expires_at <= 0):
                raise ValueError
        except (OSError, ValueError, TypeError, InvalidToken):
            raise McpSessionError("MCP session is missing or invalid; repeat MCP login.") from None
        if session.resource_url != resource or session.username != username:
            raise McpSessionError("MCP session belongs to a different endpoint or user.")
        return session

    def save(self, session: McpSession) -> None:
        try:
            if not (self.directory / "key").exists():
                self._write("key", Fernet.generate_key())
            cipher = Fernet(self._read("key"))
            payload = json.dumps(dataclasses.asdict(session), allow_nan=False).encode()
            self._write("session", cipher.encrypt(payload))
        except (OSError, ValueError, TypeError):
            raise McpSessionError("Could not persist MCP session; repeat MCP login.") from None


def session_from_tokens(
    *, resource: str, username: str, client_id: str, tokens: dict,
    previous_refresh_token: str = "",
) -> McpSession:
    """Validate a proxy-issued token response without exposing rejected input."""
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token", previous_refresh_token)
    expires_in = tokens.get("expires_in")
    if (not isinstance(access_token, str) or not isinstance(refresh_token, str)
            or re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", access_token) is None):
        raise McpSessionError("MCP returned invalid OAuth credentials; repeat MCP login.")
    token_type = tokens.get("token_type")
    if (not isinstance(token_type, str) or token_type.lower() != "bearer"
            or not all(isinstance(value, str) and value and value.isascii() and value.isprintable()
                       and not any(character.isspace() for character in value)
                       for value in (resource, username, client_id, access_token, refresh_token))
            or isinstance(expires_in, bool) or not isinstance(expires_in, (int, float))
            or not math.isfinite(expires_in) or expires_in <= 0):
        raise McpSessionError("MCP returned invalid OAuth credentials; repeat MCP login.")
    return McpSession(
        resource, username, client_id, access_token, refresh_token,
        time.time() + expires_in,
    )


class McpClient:
    """A headless OETF client; only explicit mcp_login opens a browser."""

    def __init__(self, base_url: str, session_dir: str, username: str):
        self.base_url = base_url.rstrip("/")
        self.resource = resource_url(base_url)
        if not username or not isinstance(username, str):
            raise McpSessionError("MCP requires the authenticated OETF username.")
        self.username = username
        self.store = SessionStore(session_dir)

    def _access_token(self, *, force_refresh: bool = False) -> str:
        with self.store.locked():
            session = self.store.load(self.resource, self.username)
            if force_refresh or session.expires_at <= time.time() + 30:
                # The pinned SDK refreshes before discovery on cache reload and
                # otherwise guesses /token. Resolve the scoped endpoint first.
                metadata, _ = discover_authorization(self.base_url)
                tokens = _json_http("POST", metadata["token_endpoint"], data={
                    "grant_type": "refresh_token",
                    "refresh_token": session.refresh_token,
                    "client_id": session.client_id,
                    "resource": self.resource,
                })
                session = session_from_tokens(
                    resource=self.resource, username=self.username,
                    client_id=session.client_id, tokens=tokens,
                    previous_refresh_token=session.refresh_token,
                )
                self.store.save(session)
            return session.access_token

    def refresh(self) -> None:
        """Force refresh through discovery and atomically persist rotation."""
        self._access_token(force_refresh=True)

    def request(self, request_id: int, method: str, params: dict) -> dict:
        token = self._access_token()
        response = _json_http(
            "POST", self.resource, limit=1024 * 1024,
            headers={"Authorization": f"Bearer {token}",
                     "Accept": "application/json, text/event-stream"},
            json={"jsonrpc": "2.0", "id": request_id, "method": method, "params": params},
        )
        if (response.get("jsonrpc") != "2.0" or response.get("id") != request_id
                or "error" in response or not isinstance(response.get("result"), dict)):
            raise McpSessionError("MCP returned an unsuccessful JSON-RPC response.")
        return response["result"]

    def call_tool(self, name: str, arguments: dict) -> dict:
        """Return only a successful structured tool result."""
        result = self.request(1, "tools/call", {"name": name, "arguments": arguments})
        if (result.get("isError") is not False
                or not isinstance(result.get("structuredContent"), dict)):
            raise McpSessionError("MCP tool returned an unsuccessful structured result.")
        return result["structuredContent"]
