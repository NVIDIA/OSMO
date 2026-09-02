"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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
import datetime
import hashlib
import hmac
import json
import logging
from pathlib import Path
import re
import secrets
import time
from typing import Any
from urllib.parse import quote, urlencode, urlparse

import fastapi
import pydantic
from starlette import status

from src.service.core.auth import objects
from src.service.core.workflow import objects as workflow_objects
from src.utils import auth, connectors
from src.utils.job import task as task_lib


router = fastapi.APIRouter(tags=['OIDC Provider'])
logger = logging.getLogger(__name__)

TRANSACTION_TTL = 600
CODE_TTL = 60
TOKEN_TTL = 300
REFRESH_TTL = 8 * 60 * 60
COOKIE_NAME_SECURE = '__Host-osmo_oidc_transaction'
COOKIE_NAME_INSECURE = 'osmo_oidc_transaction'
OPAQUE_VALUE_BYTES = 32
PKCE_PATTERN = re.compile(r'^[A-Za-z0-9._~-]{43,128}$')


class LoginRequest(pydantic.BaseModel, extra='forbid'):
    """PAT login request from the public OSMO UI."""
    transaction_id: str = pydantic.Field(min_length=40, max_length=128)
    csrf_token: str = pydantic.Field(min_length=40, max_length=128)
    token: str = pydantic.Field(min_length=1, max_length=256)


class PersonalAccessTokenIdentity(pydantic.BaseModel, extra='forbid'):
    """Validated database PAT identity retained without plaintext token material."""
    username: str
    token_name: str
    roles: list[str]
    expires_at: datetime.datetime
    token_digest: str


def _context() -> workflow_objects.WorkflowServiceContext:
    return workflow_objects.WorkflowServiceContext.get()


def _config() -> workflow_objects.WorkflowServiceConfig:
    config = _context().config
    if not config.token_oidc_provider_enabled:
        raise fastapi.HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return config


def _redis():
    return connectors.RedisConnector.get_instance().client


def _issuer(config: workflow_objects.WorkflowServiceConfig) -> str:
    return config.token_oidc_issuer.rstrip('/')


def _cookie_name(config: workflow_objects.WorkflowServiceConfig) -> str:
    return COOKIE_NAME_SECURE if config.token_oidc_cookie_secure else COOKIE_NAME_INSECURE


def _key(kind: str, opaque_value: str) -> str:
    digest = hashlib.sha256(opaque_value.encode()).hexdigest()
    return f'{{osmo}}:oidc:{kind}:{digest}'


def _hash_value(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _random_value() -> str:
    return secrets.token_urlsafe(OPAQUE_VALUE_BYTES)


def _load_record(kind: str, value: str, *, consume: bool = False) -> dict[str, Any] | None:
    redis_client = _redis()
    key = _key(kind, value)
    serialized = redis_client.getdel(key) if consume else redis_client.get(key)
    if serialized is None:
        return None
    if isinstance(serialized, bytes):
        serialized = serialized.decode('utf-8')
    return json.loads(serialized)


def _save_record(kind: str, value: str, record: dict[str, Any], ttl: int) -> None:
    _redis().setex(_key(kind, value), ttl, json.dumps(record, separators=(',', ':')))


def _delete_record(kind: str, value: str) -> None:
    _redis().delete(_key(kind, value))


def _browser_binding(
    request: fastapi.Request,
    config: workflow_objects.WorkflowServiceConfig,
) -> str | None:
    return request.cookies.get(_cookie_name(config))


def _bound_transaction(
    request: fastapi.Request,
    config: workflow_objects.WorkflowServiceConfig,
    transaction_id: str,
) -> dict[str, Any]:
    record = _load_record('authorization', transaction_id)
    binding = _browser_binding(request, config)
    if record is None or binding is None or not hmac.compare_digest(
            record.get('binding_hash', ''), _hash_value(binding)):
        raise fastapi.HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Login request is missing, expired, or belongs to another browser.',
        )
    return record


def _origin(config: workflow_objects.WorkflowServiceConfig) -> str:
    issuer_url = urlparse(_issuer(config))
    return f'{issuer_url.scheme}://{issuer_url.netloc}'


def _validate_pat(plaintext_token: str) -> PersonalAccessTokenIdentity | None:
    if len(plaintext_token) not in task_lib.VALID_TOKEN_LENGTHS:
        return None
    database = _context().database
    token = objects.AccessToken.validate_access_token(database, plaintext_token)
    if token is None or token.expires_at.date() <= datetime.datetime.now(
            datetime.timezone.utc).date():
        return None
    roles = objects.AccessToken.get_roles_for_token(database, token.user_name, token.token_name)
    if not roles:
        return None
    return PersonalAccessTokenIdentity(
        username=token.user_name,
        token_name=token.token_name,
        roles=roles,
        expires_at=token.expires_at,
        token_digest=auth.hash_access_token(plaintext_token).hex(),
    )


def _resolve_pat(record: dict[str, Any]) -> PersonalAccessTokenIdentity | None:
    database = _context().database
    digest = bytes.fromhex(record['token_digest'])
    fetch_command = '''
        SELECT user_name, token_name, expires_at, description
        FROM access_token
        WHERE access_token = %s AND user_name = %s AND token_name = %s;
    '''
    rows = database.execute_fetch_command(
        fetch_command,
        (digest, record['username'], record['token_name']),
        True,
    )
    if not rows:
        return None
    token = objects.AccessToken(**rows[0])
    if token.expires_at.date() <= datetime.datetime.now(datetime.timezone.utc).date():
        return None
    roles = objects.AccessToken.get_roles_for_token(database, token.user_name, token.token_name)
    if not roles:
        return None
    return PersonalAccessTokenIdentity(
        username=token.user_name,
        token_name=token.token_name,
        roles=roles,
        expires_at=token.expires_at,
        token_digest=record['token_digest'],
    )


def _oauth_error(error: str, description: str, http_status: int = 400) -> fastapi.Response:
    return fastapi.responses.JSONResponse(
        status_code=http_status,
        content={'error': error, 'error_description': description},
        headers={'Cache-Control': 'no-store', 'Pragma': 'no-cache'},
    )


def _authenticate_client(
    request: fastapi.Request,
    config: workflow_objects.WorkflowServiceConfig,
) -> bool:
    authorization = request.headers.get('authorization', '')
    if not authorization.startswith('Basic '):
        return False
    try:
        decoded = base64.b64decode(authorization[6:], validate=True).decode('utf-8')
        client_id, client_secret = decoded.split(':', 1)
        expected_secret = Path(config.token_oidc_client_secret_file).read_text(
            encoding='utf-8').strip()
    except (OSError, UnicodeError, ValueError):
        return False
    return hmac.compare_digest(client_id, config.token_oidc_client_id) and hmac.compare_digest(
        client_secret, expected_secret)


def _issue_tokens(
    config: workflow_objects.WorkflowServiceConfig,
    identity: PersonalAccessTokenIdentity,
    *,
    nonce: str | None,
    auth_time: int,
    session_id: str,
) -> dict[str, Any]:
    now = int(time.time())
    access_token = _random_value()
    refresh_token = _random_value()
    common_record = {
        'username': identity.username,
        'token_name': identity.token_name,
        'token_digest': identity.token_digest,
        'roles': identity.roles,
        'auth_time': auth_time,
        'nonce': nonce,
        'session_id': session_id,
    }
    _save_record('access', access_token, common_record, TOKEN_TTL)
    _save_record('refresh', refresh_token, common_record, REFRESH_TTL)
    service_auth = _context().database.get_service_configs().service_auth
    id_token = service_auth.create_oidc_id_token(
        issuer=_issuer(config),
        audience=config.token_oidc_client_id,
        expire_timestamp=now + TOKEN_TTL,
        username=identity.username,
        roles=identity.roles,
        token_name=identity.token_name,
        nonce=nonce,
        auth_time=auth_time,
        session_id=session_id,
    )
    return {
        'token_type': 'Bearer',
        'access_token': access_token,
        'expires_in': TOKEN_TTL,
        'refresh_token': refresh_token,
        'scope': 'openid profile roles offline_access',
        'id_token': id_token,
    }


@router.get('/api/auth/oidc/.well-known/openid-configuration', include_in_schema=False)
def discovery() -> fastapi.Response:
    config = _config()
    issuer = _issuer(config)
    return fastapi.responses.JSONResponse(
        content={
            'issuer': issuer,
            'authorization_endpoint': f'{issuer}/authorize',
            'token_endpoint': f'{issuer}/token',
            'userinfo_endpoint': f'{issuer}/userinfo',
            'jwks_uri': f'{_origin(config)}/api/auth/keys',
            'response_types_supported': ['code'],
            'response_modes_supported': ['query'],
            'grant_types_supported': ['authorization_code', 'refresh_token'],
            'subject_types_supported': ['public'],
            'id_token_signing_alg_values_supported': ['RS256'],
            'token_endpoint_auth_methods_supported': ['client_secret_basic'],
            'code_challenge_methods_supported': ['S256'],
            'scopes_supported': ['openid', 'profile', 'roles', 'offline_access'],
            'claims_supported': [
                'iss', 'sub', 'aud', 'iat', 'nbf', 'exp', 'nonce', 'auth_time',
                'preferred_username', 'unique_name', 'name', 'roles', 'osmo_token_name',
            ],
        },
        headers={'Cache-Control': 'public, max-age=300'},
    )


@router.get('/api/auth/oidc/authorize', include_in_schema=False)
def authorize(request: fastapi.Request) -> fastapi.Response:
    config = _config()
    parameters: dict[str, str] = {}
    for key, value in request.query_params.multi_items():
        if key in parameters:
            return fastapi.responses.PlainTextResponse(
                'Duplicate authorization parameter.', status_code=400)
        parameters[key] = value

    required = (
        'response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'nonce',
        'code_challenge', 'code_challenge_method',
    )
    if any(not parameters.get(name) for name in required):
        return fastapi.responses.PlainTextResponse(
            'Missing authorization parameter.', status_code=400)
    if parameters['client_id'] != config.token_oidc_client_id or parameters[
            'redirect_uri'] != config.token_oidc_redirect_uri:
        return fastapi.responses.PlainTextResponse(
            'Invalid OAuth client or redirect URI.', status_code=400)
    supported_scopes = {'openid', 'profile', 'roles', 'offline_access'}
    requested_scopes = set(parameters['scope'].split())
    if (parameters['response_type'] != 'code'
            or parameters['code_challenge_method'] != 'S256'
            or not PKCE_PATTERN.fullmatch(parameters['code_challenge'])
            or 'openid' not in requested_scopes
            or not requested_scopes.issubset(supported_scopes)):
        redirect_query = urlencode({
            'error': 'invalid_request',
            'error_description': 'Unsupported authorization request.',
            'state': parameters['state'],
        })
        return fastapi.responses.RedirectResponse(
            f'{config.token_oidc_redirect_uri}?{redirect_query}', status_code=303)

    transaction_id = _random_value()
    binding = _random_value()
    csrf_token = _random_value()
    _save_record('authorization', transaction_id, {
        'status': 'pending',
        'binding_hash': _hash_value(binding),
        'csrf_hash': _hash_value(csrf_token),
        'client_id': parameters['client_id'],
        'redirect_uri': parameters['redirect_uri'],
        'scope': parameters['scope'],
        'state': parameters['state'],
        'nonce': parameters['nonce'],
        'code_challenge': parameters['code_challenge'],
        'created_at': int(time.time()),
    }, TRANSACTION_TTL)
    separator = '&' if '?' in config.token_oidc_login_page_url else '?'
    response = fastapi.responses.RedirectResponse(
        f'{config.token_oidc_login_page_url}{separator}transaction_id={quote(transaction_id)}',
        status_code=303,
        headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'},
    )
    response.set_cookie(
        _cookie_name(config),
        binding,
        max_age=TRANSACTION_TTL,
        secure=config.token_oidc_cookie_secure,
        httponly=True,
        samesite='lax',
        path='/',
    )
    return response


@router.get('/api/auth/oidc/login-context', include_in_schema=False)
def login_context(request: fastapi.Request, transaction_id: str) -> fastapi.Response:
    config = _config()
    record = _bound_transaction(request, config, transaction_id)
    if record.get('status') != 'pending':
        raise fastapi.HTTPException(status_code=400, detail='Login request cannot be used.')
    # The CSRF token is not stored in plaintext. Rotate it when the page obtains context.
    csrf_token = _random_value()
    record['csrf_hash'] = _hash_value(csrf_token)
    _save_record('authorization', transaction_id, record, TRANSACTION_TTL)
    return fastapi.responses.JSONResponse(
        content={
            'transaction_id': transaction_id,
            'csrf_token': csrf_token,
            'expires_in': TRANSACTION_TTL,
            'submit_url': '/api/auth/oidc/login',
        },
        headers={
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache',
            'Referrer-Policy': 'no-referrer',
        },
    )


@router.post('/api/auth/oidc/login', include_in_schema=False)
def login(
    request: fastapi.Request,
    login_request: LoginRequest,
) -> fastapi.Response:
    config = _config()
    request_origin = request.headers.get('origin')
    if request_origin != _origin(config):
        raise fastapi.HTTPException(status_code=403, detail='Request origin is not allowed.')
    record = _bound_transaction(request, config, login_request.transaction_id)
    if record.get('status') != 'pending' or not hmac.compare_digest(
            record.get('csrf_hash', ''), _hash_value(login_request.csrf_token)):
        raise fastapi.HTTPException(status_code=400, detail='Login request cannot be used.')
    identity = _validate_pat(login_request.token)
    if identity is None:
        logger.info('PAT-backed OIDC login rejected for transaction %s',
                    _hash_value(login_request.transaction_id)[:16])
        return fastapi.responses.JSONResponse(
            status_code=401,
            content={'error': 'invalid_credentials', 'message': 'The token is invalid or expired.'},
            headers={'Cache-Control': 'no-store'},
        )
    record.update({
        'status': 'authenticated',
        'username': identity.username,
        'token_name': identity.token_name,
        'token_digest': identity.token_digest,
        'roles': identity.roles,
        'auth_time': int(time.time()),
        'session_id': _random_value(),
    })
    _save_record('authorization', login_request.transaction_id, record, TRANSACTION_TTL)
    continue_url = (
        '/api/auth/oidc/authorize/complete?transaction_id='
        f'{quote(login_request.transaction_id)}'
    )
    return fastapi.responses.JSONResponse(
        content={'continue_url': continue_url},
        headers={'Cache-Control': 'no-store', 'Pragma': 'no-cache'},
    )


@router.get('/api/auth/oidc/authorize/complete', include_in_schema=False)
def complete_authorization(request: fastapi.Request, transaction_id: str) -> fastapi.Response:
    config = _config()
    record = _bound_transaction(request, config, transaction_id)
    if record.get('status') != 'authenticated':
        raise fastapi.HTTPException(status_code=400, detail='Login is not complete.')
    consumed = _load_record('authorization', transaction_id, consume=True)
    if consumed is None or consumed.get('status') != 'authenticated':
        raise fastapi.HTTPException(status_code=400, detail='Login request was already used.')
    code = _random_value()
    _save_record('code', code, consumed, CODE_TTL)
    response = fastapi.responses.RedirectResponse(
        f"{consumed['redirect_uri']}?{urlencode({'code': code, 'state': consumed['state']})}",
        status_code=303,
        headers={'Cache-Control': 'no-store'},
    )
    response.delete_cookie(
        _cookie_name(config),
        secure=config.token_oidc_cookie_secure,
        httponly=True,
        samesite='lax',
        path='/',
    )
    return response


@router.post('/api/auth/oidc/token', include_in_schema=False)
def token(
    request: fastapi.Request,
    grant_type: str = fastapi.Form(...),
    code: str | None = fastapi.Form(default=None),
    redirect_uri: str | None = fastapi.Form(default=None),
    code_verifier: str | None = fastapi.Form(default=None),
    refresh_token: str | None = fastapi.Form(default=None),
) -> fastapi.Response:
    config = _config()
    if not _authenticate_client(request, config):
        response = _oauth_error('invalid_client', 'Client authentication failed.', 401)
        response.headers['WWW-Authenticate'] = 'Basic realm="osmo-oidc"'
        return response

    if grant_type == 'authorization_code':
        if not code or not redirect_uri or not code_verifier or not PKCE_PATTERN.fullmatch(
                code_verifier):
            return _oauth_error('invalid_request', 'Code exchange parameters are missing.')
        record = _load_record('code', code, consume=True)
        expected_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode()).digest()).rstrip(b'=').decode()
        if (record is None
                or record.get('client_id') != config.token_oidc_client_id
                or record.get('redirect_uri') != redirect_uri
                or not hmac.compare_digest(record.get('code_challenge', ''), expected_challenge)):
            return _oauth_error('invalid_grant', 'Authorization code is invalid or expired.')
        identity = _resolve_pat(record)
        if identity is None:
            return _oauth_error('invalid_grant', 'The authorization grant is no longer valid.')
        return fastapi.responses.JSONResponse(
            content=_issue_tokens(
                config,
                identity,
                nonce=record.get('nonce'),
                auth_time=record['auth_time'],
                session_id=record['session_id'],
            ),
            headers={'Cache-Control': 'no-store', 'Pragma': 'no-cache'},
        )

    if grant_type == 'refresh_token':
        if not refresh_token:
            return _oauth_error('invalid_request', 'Refresh token is missing.')
        record = _load_record('refresh', refresh_token, consume=True)
        if record is None:
            return _oauth_error('invalid_grant', 'Refresh token is invalid or expired.')
        identity = _resolve_pat(record)
        if identity is None:
            return _oauth_error('invalid_grant', 'The authorization grant is no longer valid.')
        return fastapi.responses.JSONResponse(
            content=_issue_tokens(
                config,
                identity,
                nonce=None,
                auth_time=record['auth_time'],
                session_id=record['session_id'],
            ),
            headers={'Cache-Control': 'no-store', 'Pragma': 'no-cache'},
        )

    return _oauth_error('unsupported_grant_type', 'Grant type is not supported.')


@router.api_route('/api/auth/oidc/userinfo', methods=['GET', 'POST'], include_in_schema=False)
def userinfo(request: fastapi.Request) -> fastapi.Response:
    _config()
    authorization = request.headers.get('authorization', '')
    if not authorization.startswith('Bearer '):
        response = _oauth_error('invalid_token', 'Bearer access token is required.', 401)
        response.headers['WWW-Authenticate'] = 'Bearer error="invalid_token"'
        return response
    record = _load_record('access', authorization[7:])
    identity = _resolve_pat(record) if record is not None else None
    if identity is None:
        response = _oauth_error('invalid_token', 'Access token is invalid or expired.', 401)
        response.headers['WWW-Authenticate'] = 'Bearer error="invalid_token"'
        return response
    return fastapi.responses.JSONResponse(
        content={
            'sub': identity.username,
            'preferred_username': identity.username,
            'unique_name': identity.username,
            'name': identity.username,
            'roles': identity.roles,
            'osmo_token_name': identity.token_name,
        },
        headers={'Cache-Control': 'no-store'},
    )
