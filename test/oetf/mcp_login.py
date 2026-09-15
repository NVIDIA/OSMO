"""Bootstrap OETF through the real MCP OAuth authorization-code/PKCE flow.

Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import argparse
import asyncio
import logging
import math
import sys
from typing import Any
from urllib.parse import urlsplit
import webbrowser

from fastmcp import Client
from fastmcp.client.auth import OAuth
from fastmcp.client.transports import StreamableHttpTransport
import httpx
from key_value.aio.stores.memory import MemoryStore

from test.oetf import mcp


def _http_client(
    headers: dict[str, str] | None = None,
    timeout: httpx.Timeout | float | None = 5.0,
    auth: httpx.Auth | None = None,
    **kwargs: Any,
) -> httpx.AsyncClient:
    kwargs.update(
        headers=headers, timeout=timeout, auth=auth,
        trust_env=False, follow_redirects=False,
    )
    return httpx.AsyncClient(**kwargs)


class _InteractiveOAuth(OAuth):
    """Use the supported display hook; protocol/PKCE/state remain SDK-owned."""

    async def redirect_handler(self, authorization_url: str) -> None:
        parsed = urlsplit(authorization_url)
        expected = urlsplit(self.mcp_url + "/authorize")
        if (parsed.scheme, parsed.netloc, parsed.path) != (
                expected.scheme, expected.netloc, expected.path):
            raise mcp.McpSessionError("MCP login advertised an unexpected authorization URL.")
        print("Open this URL and complete login/MFA and MCP consent:", flush=True)
        print(authorization_url, flush=True)
        webbrowser.open(authorization_url)


async def bootstrap(args: argparse.Namespace) -> None:
    resource = mcp.resource_url(args.url)
    _, scopes = mcp.discover_authorization(args.url)
    store = mcp.SessionStore(args.session_dir)
    with store.locked(create=True):
        oauth = _InteractiveOAuth(
            mcp_url=resource,
            scopes=scopes,
            client_name="OSMO OETF",
            token_storage=MemoryStore(),
            additional_client_metadata={"token_endpoint_auth_method": "none"},
            callback_host="127.0.0.1",
            callback_port=args.callback_port,
            callback_timeout=300,
            httpx_client_factory=_http_client,
        )
        transport = StreamableHttpTransport(
            resource, auth=oauth, httpx_client_factory=_http_client,
        )
        print(
            f"Callback: http://127.0.0.1:{oauth.redirect_port}/callback. "
            "If your browser is on another machine, forward that local port "
            "to this machine before opening the login URL.",
            flush=True,
        )
        # The SDK session timeout also covers OAuth during initialize; a short
        # session timeout would cancel the browser flow before its own deadline.
        async with Client(transport, timeout=330, init_timeout=330) as client:
            profile_result = await client.call_tool_mcp("osmo_get_profile", {}, timeout=30)
            profile = profile_result.structuredContent
            if (profile_result.isError or not isinstance(profile, dict)
                    or not isinstance(profile.get("profile"), dict)
                    or profile["profile"].get("username") != args.username):
                raise mcp.McpSessionError(
                    "MCP login did not authenticate the requested username; session not saved."
                )
            tokens = await oauth.token_storage_adapter.get_tokens()
            client_info = await oauth.token_storage_adapter.get_client_info()
            expiry = await oauth.token_storage_adapter.get_token_expiry()
            if (tokens is None or client_info is None
                    or isinstance(expiry, bool) or not isinstance(expiry, (float, int))
                    or not math.isfinite(expiry) or expiry <= 0
                    or not isinstance(client_info.client_id, str) or not client_info.client_id
                    or client_info.token_endpoint_auth_method != "none"
                    or client_info.client_secret):
                raise mcp.McpSessionError("MCP login did not produce a public-client session.")
            session = mcp.session_from_tokens(
                resource=resource, username=args.username,
                client_id=client_info.client_id, tokens=tokens.model_dump(),
            )
            # Preserve issuance time, not the end of the interactive login.
            session.expires_at = expiry
            store.save(session)
    print("MCP login succeeded; encrypted OETF session saved. No credentials were printed.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", required=True, help="HTTPS OSMO service origin, without /mcp.")
    parser.add_argument("--username", required=True, help="Expected OSMO username after login.")
    parser.add_argument(
        "--session-dir", required=True, help="Private directory outside build outputs.",
    )
    parser.add_argument("--callback-port", type=int, default=8765)
    args = parser.parse_args(argv)
    if not 0 < args.callback_port < 65536:
        parser.error("--callback-port must be between 1 and 65535")
    previous_logging = logging.root.manager.disable
    try:
        # OAuth libraries can reflect token bodies and callback query strings.
        # This standalone interactive command reports only fixed messages.
        logging.disable(logging.CRITICAL)
        asyncio.run(bootstrap(args))
        return 0
    except mcp.McpSessionError as error:
        print(str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("MCP login cancelled.", file=sys.stderr)
        return 130
    except Exception:  # pylint: disable=broad-except
        print("MCP login failed; check the dev endpoint and repeat login.", file=sys.stderr)
        return 1
    finally:
        logging.disable(previous_logging)


if __name__ == "__main__":
    sys.exit(main())
