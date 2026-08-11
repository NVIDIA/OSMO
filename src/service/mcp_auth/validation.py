"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

import base64
import hashlib
import hmac
import ipaddress
import re
import secrets
from urllib import parse


_PKCE_VALUE = re.compile(r'^[A-Za-z0-9._~-]{43,128}$')


def validate_redirect_uri(
    redirect_uri: str,
    *,
    trusted_https_origins: frozenset[str] = frozenset(),
) -> str:
    """Validate an OAuth redirect without resolving or normalizing its host."""
    if not redirect_uri or len(redirect_uri) > 2048:
        raise ValueError('redirect_uri must contain between 1 and 2048 characters')
    if any(ord(character) < 0x20 for character in redirect_uri):
        raise ValueError('redirect_uri must not contain control characters')

    parsed = parse.urlsplit(redirect_uri)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError('redirect_uri must be an absolute URI')
    if parsed.fragment:
        raise ValueError('redirect_uri must not contain a fragment')
    if parsed.username is not None or parsed.password is not None:
        raise ValueError('redirect_uri must not contain user information')
    try:
        parsed.port
    except ValueError as error:
        raise ValueError('redirect_uri contains an invalid port') from error

    if parsed.scheme == 'https':
        if parsed.hostname is None:
            raise ValueError('redirect_uri must contain a host')
        origin = f'{parsed.scheme}://{parsed.netloc}'
        if origin not in trusted_https_origins:
            raise ValueError('HTTPS redirect_uri origin is not trusted')
    elif parsed.scheme == 'http':
        if not _is_loopback_host(parsed.hostname):
            raise ValueError('HTTP redirect_uri is allowed only for loopback hosts')
    else:
        raise ValueError('redirect_uri must use HTTPS or loopback HTTP')

    reserved_parameters = {
        name for name, _ in parse.parse_qsl(parsed.query, keep_blank_values=True)
        if name in {'code', 'error', 'state'}
    }
    if reserved_parameters:
        raise ValueError('redirect_uri query contains a reserved OAuth parameter')
    return redirect_uri


def _is_loopback_host(host: str | None) -> bool:
    if host == 'localhost':
        return True
    if host is None:
        return False
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def create_pkce_pair() -> tuple[str, str]:
    """Create an S256 verifier/challenge pair for the upstream OIDC flow."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip('=')
    return verifier, pkce_challenge(verifier)


def pkce_challenge(verifier: str) -> str:
    """Return the RFC 7636 S256 challenge for a syntactically valid verifier."""
    if not _PKCE_VALUE.fullmatch(verifier):
        raise ValueError('code_verifier is not a valid PKCE value')
    digest = hashlib.sha256(verifier.encode('ascii')).digest()
    return base64.urlsafe_b64encode(digest).decode('ascii').rstrip('=')


def validate_code_challenge(challenge: str, method: str) -> str:
    """Accept only an S256 challenge with the expected base64url shape."""
    if method != 'S256':
        raise ValueError('code_challenge_method must be S256')
    if len(challenge) != 43 or not re.fullmatch(r'[A-Za-z0-9_-]{43}', challenge):
        raise ValueError('code_challenge is not a valid S256 challenge')
    return challenge


def verify_pkce(verifier: str, expected_challenge: str) -> bool:
    """Compare a verifier to its expected challenge in constant time."""
    try:
        actual_challenge = pkce_challenge(verifier)
    except ValueError:
        return False
    return hmac.compare_digest(actual_challenge, expected_challenge)


def add_query_parameters(uri: str, parameters: dict[str, str]) -> str:
    """Append protocol response values to an already validated redirect URI."""
    parsed = parse.urlsplit(uri)
    query = parse.parse_qsl(parsed.query, keep_blank_values=True)
    query.extend(parameters.items())
    return parse.urlunsplit(parsed._replace(query=parse.urlencode(query)))
