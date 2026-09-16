# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Shared assertions for real embedded-Dex authorization-code/PKCE login."""

import base64
import hashlib
import html
import http.cookiejar
import json
import re
import secrets
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request


class _CallbackRedirect(Exception):
    def __init__(self, location):
        super().__init__('OAuth callback captured')
        self.location = location


class _LoopbackRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Capture the OAuth callback instead of following its loopback URL."""

    def __init__(self, callback_url):
        super().__init__()
        self.callback_url = callback_url

    def redirect_request(  # pylint: disable=arguments-renamed
        self, request, file_pointer, code, message, headers, new_url
    ):
        if new_url.startswith(self.callback_url):
            raise _CallbackRedirect(new_url)
        return super().redirect_request(
            request, file_pointer, code, message, headers, new_url
        )


class EmbeddedAuthAssertions(unittest.TestCase):
    """Use with a unittest fixture; credentials stay in memory."""

    def _authenticate_embedded_admin(self, external_url, password):
        callback_url = 'http://127.0.0.1:33747/callback'
        verifier = (
            base64.urlsafe_b64encode(secrets.token_bytes(48))
            .rstrip(b'=')
            .decode('ascii')
        )
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest())
            .rstrip(b'=')
            .decode('ascii')
        )
        state = secrets.token_urlsafe(24)
        authorization_url = (
            external_url
            + '/dex/auth?'
            + urllib.parse.urlencode(
                {
                    'client_id': 'osmo-cli',
                    'redirect_uri': callback_url,
                    'response_type': 'code',
                    'scope': 'openid profile email groups',
                    'state': state,
                    'code_challenge': challenge,
                    'code_challenge_method': 'S256',
                }
            )
        )
        cookie_jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(cookie_jar),
            _LoopbackRedirectHandler(callback_url),
        )
        login_page = None
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                with opener.open(authorization_url, timeout=5) as response:
                    login_page = response.read().decode('utf-8')
                break
            except urllib.error.URLError, ConnectionError:
                time.sleep(1)
        if login_page is None:
            raise AssertionError('embedded Dex login did not become reachable')
        form = re.search(
            r'<form[^>]+action=["\']([^"\']+)["\']', login_page, flags=re.IGNORECASE
        )
        if form is None:
            raise AssertionError('embedded Dex login form was not rendered')
        login_url = urllib.parse.urljoin(
            authorization_url, html.unescape(form.group(1))
        )
        login_request = urllib.request.Request(
            login_url,
            data=urllib.parse.urlencode(
                {
                    'login': 'admin@osmo.local',
                    'password': password.decode('ascii'),
                }
            ).encode('ascii'),
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        callback_location = None
        try:
            opener.open(login_request, timeout=10)
        except _CallbackRedirect as redirect:
            callback_location = redirect.location
        if callback_location is None:
            raise AssertionError('Dex did not redirect after login')
        callback_query = urllib.parse.parse_qs(
            urllib.parse.urlparse(callback_location).query
        )
        self.assertEqual([state], callback_query.get('state'))
        self.assertIn('code', callback_query)

        token_request = urllib.request.Request(
            external_url + '/dex/token',
            data=urllib.parse.urlencode(
                {
                    'grant_type': 'authorization_code',
                    'code': callback_query['code'][0],
                    'redirect_uri': callback_url,
                    'client_id': 'osmo-cli',
                    'code_verifier': verifier,
                }
            ).encode('ascii'),
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with urllib.request.urlopen(token_request, timeout=10) as response:
            token_response = json.load(response)
        id_token = token_response['id_token']
        payload_part = id_token.split('.')[1]
        payload_part += '=' * (-len(payload_part) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_part))
        self.assertEqual('CgVhZG1pbhIFbG9jYWw', payload['sub'])
        self.assertEqual('admin', payload['name'])
        self.assertEqual(external_url + '/dex', payload['iss'])

        admin_request = urllib.request.Request(
            external_url + '/api/configs/pool',
            headers={'Authorization': 'Bearer ' + id_token},
        )
        authorization_deadline = time.monotonic() + 45
        while True:
            try:
                with urllib.request.urlopen(admin_request, timeout=10) as response:
                    status = response.status
                    response_body = ''
            except urllib.error.HTTPError as error:
                status = error.code
                response_body = error.read().decode('utf-8', errors='replace')
                error.close()
            if (
                status not in (401, 502, 503, 504)
                or time.monotonic() >= authorization_deadline
            ):
                break
            time.sleep(1)
        self.assertNotIn(
            status,
            (401, 403),
            'issued administrator identity was rejected by gateway authorization: '
            + response_body,
        )
        self.assertEqual(200, status, response_body)

        profile_request = urllib.request.Request(
            external_url + '/api/profile/settings',
            headers={'Authorization': 'Bearer ' + id_token},
        )
        with urllib.request.urlopen(profile_request, timeout=10) as response:
            profile = json.load(response)
        self.assertEqual('admin', profile['profile']['username'])
        self.assertIn('osmo-admin', profile['roles'])
        return id_token
