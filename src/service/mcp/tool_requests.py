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

import dataclasses
import json
from typing import Literal, TypeAlias

from mcp.server.fastmcp import Context
import pydantic
from starlette.requests import Request

from src.lib.api import profile as profile_contract
from src.service.mcp import gateway, request_context, tool_errors


JsonObject: TypeAlias = dict[str, pydantic.JsonValue]
JsonMutationResult: TypeAlias = JsonObject | str | None
ActiveProfile: TypeAlias = profile_contract.ProfileResponse

_JSON_OBJECT_ADAPTER = pydantic.TypeAdapter(JsonObject)
_JSON_MUTATION_RESULT_ADAPTER: pydantic.TypeAdapter[JsonMutationResult] = (
    pydantic.TypeAdapter(JsonMutationResult)
)
_PROFILE_PATH = '/api/profile/settings'
_MAX_PROFILE_RESPONSE_BYTES = 64 * 1024
_TEXT_TRUNCATION_SENTINEL = (
    '\n... truncated: OSMO response did not complete within the configured '
    'output boundary.'
)
_TEXT_TRUNCATION_SENTINEL_BYTES = len(
    _TEXT_TRUNCATION_SENTINEL.encode('utf-8')
)


@dataclasses.dataclass(frozen=True, slots=True)
class TruncatedTextResult:
    """One bounded UTF-8 text response and explicit completeness metadata."""

    text: str
    truncated: bool
    truncation_reason: str | None


async def request_json_object(
    context: Context,
    *,
    path: str,
    operation: str,
    max_response_bytes: int,
    query: gateway.QueryParams | None = None,
    suppress_upstream_details: bool = False,
    not_found_message: str | None = None,
) -> JsonObject:
    """Relay one fixed GET and require a bounded JSON object response.

    A caller may replace an upstream 404 with one fixed, scrubbed message when
    its tool contract intentionally makes missing and inaccessible equivalent.
    """
    response = await _request(
        context,
        path=path,
        operation=operation,
        max_response_bytes=max_response_bytes,
        query=query,
        suppress_upstream_details=suppress_upstream_details,
        not_found_message=not_found_message,
    )
    return _validate_json_object_body(response.body, operation=operation)


async def request_json_mutation(
    context: Context,
    *,
    method: Literal['POST', 'PATCH', 'DELETE'] = 'POST',
    path: str,
    operation: str,
    max_response_bytes: int,
    query: gateway.QueryParams | None = None,
    payload: gateway.JsonRequestBody | None = None,
) -> JsonMutationResult:
    """Relay one fixed write and require a bounded object, string, or null."""
    response = await _request(
        context,
        method=method,
        path=path,
        operation=operation,
        max_response_bytes=max_response_bytes,
        query=query,
        json_body=payload,
        suppress_upstream_details=True,
    )
    try:
        return _JSON_MUTATION_RESULT_ADAPTER.validate_json(
            response.body,
            strict=True,
        )
    except pydantic.ValidationError:
        raise tool_errors.uncertain_write_error(operation) from None


async def request_text(
    context: Context,
    *,
    path: str,
    operation: str,
    max_response_bytes: int,
    query: gateway.QueryParams | None = None,
    suppress_upstream_details: bool = False,
) -> str:
    """Relay one fixed GET and require a bounded UTF-8 text response."""
    response = await _request(
        context,
        path=path,
        operation=operation,
        max_response_bytes=max_response_bytes,
        query=query,
        suppress_upstream_details=suppress_upstream_details,
    )
    try:
        return response.body.decode('utf-8', errors='strict')
    except UnicodeDecodeError:
        raise tool_errors.PublicToolError(
            f'OSMO returned an invalid response while attempting to {operation}.'
        ) from None


async def request_truncated_text(
    context: Context,
    *,
    path: str,
    operation: str,
    max_response_bytes: int,
    query: gateway.QueryParams | None = None,
    suppress_upstream_details: bool = False,
) -> TruncatedTextResult:
    """Relay one fixed GET and mark an incomplete UTF-8 response prefix."""
    if max_response_bytes <= _TEXT_TRUNCATION_SENTINEL_BYTES:
        raise tool_errors.PublicToolError(
            f'Invalid MCP request while attempting to {operation}.'
        )
    response = await _request(
        context,
        path=path,
        operation=operation,
        max_response_bytes=(
            max_response_bytes - _TEXT_TRUNCATION_SENTINEL_BYTES
        ),
        query=query,
        suppress_upstream_details=suppress_upstream_details,
        truncate_text=True,
    )
    text = _decode_text_prefix(response, operation=operation)
    if response.body_truncated:
        text += _TEXT_TRUNCATION_SENTINEL
    return TruncatedTextResult(
        text=text,
        truncated=response.body_truncated,
        truncation_reason=response.truncation_reason,
    )


async def request_active_profile(context: Context) -> ActiveProfile:
    """Read and validate the active caller's profile and token pool scope."""
    response = await request_json_object(
        context,
        path=_PROFILE_PATH,
        operation='read the active user profile',
        max_response_bytes=_MAX_PROFILE_RESPONSE_BYTES,
    )
    try:
        return profile_contract.ProfileResponse.model_validate_json(
            json.dumps(response, ensure_ascii=False),
            strict=True,
        )
    except pydantic.ValidationError:
        raise tool_errors.PublicToolError(
            'OSMO returned an invalid profile response.'
        ) from None


def get_app_context(context: Context) -> gateway.AppContext:
    """Resolve process-lifetime dependencies from a real MCP HTTP request."""
    try:
        request = context.request_context.request
    except ValueError:
        raise tool_errors.PublicToolError(
            'MCP runtime context is unavailable.'
        ) from None
    if not isinstance(request, Request):
        raise tool_errors.PublicToolError('MCP runtime context is unavailable.')

    try:
        app_context = request.app.state.mcp_app_context
    except (AttributeError, KeyError):
        raise tool_errors.PublicToolError(
            'MCP runtime context is unavailable.'
        ) from None
    if not isinstance(app_context, gateway.AppContext):
        raise tool_errors.PublicToolError('MCP runtime context is unavailable.')
    return app_context


async def _request(
    context: Context,
    *,
    method: str = 'GET',
    path: str,
    operation: str,
    max_response_bytes: int,
    query: gateway.QueryParams | None,
    json_body: gateway.JsonRequestBody | None = None,
    suppress_upstream_details: bool = False,
    truncate_text: bool = False,
    not_found_message: str | None = None,
) -> gateway.GatewayResponse:
    app_context = get_app_context(context)
    try:
        credentials = request_context.get_request_credentials()
    except RuntimeError:
        raise tool_errors.PublicToolError(
            'MCP request authentication context is unavailable.'
        ) from None

    try:
        request_method = (
            app_context.gateway.request_text_prefix
            if truncate_text
            else app_context.gateway.request
        )
        response = await request_method(
            method,
            path,
            credentials=credentials,
            max_response_bytes=max_response_bytes,
            query=query,
            **(
                {'json_body': json_body}
                if not truncate_text
                else {}
            ),
        )
    except gateway.GatewayClientError as error:
        if method != 'GET':
            raise tool_errors.uncertain_write_error(operation) from None
        raise tool_errors.PublicToolError(str(error)) from None
    except ValueError:
        raise tool_errors.PublicToolError(
            f'Invalid MCP request while attempting to {operation}.'
        ) from None

    if response.status_code == 404 and not_found_message is not None:
        raise tool_errors.PublicToolError(
            tool_errors.bounded_safe_error(not_found_message)
        )
    if method != 'GET' and response.status_code >= 500:
        raise tool_errors.uncertain_write_error(operation)
    if (
        method != 'GET'
        and _mutation_error_code(response) == 'DATABASE'
    ):
        raise tool_errors.uncertain_write_error(operation)
    if response.status_code != 200:
        raise tool_errors.PublicToolError(tool_errors.upstream_error(
            operation,
            response.status_code,
            # The bounded body stays internal to the strict projector. Only
            # allowlisted structural metadata can reach the MCP client.
            body=response.body,
            body_truncated=response.body_truncated,
            suppress_upstream_details=suppress_upstream_details,
        ))
    return response


def _mutation_error_code(
    response: gateway.GatewayResponse,
) -> str | None:
    """Read only the bounded structural error code from a failed mutation."""
    if (
        response.status_code == 200
        or response.body_truncated
        or not response.body
    ):
        return None
    try:
        payload = json.loads(response.body)
    except (UnicodeDecodeError, ValueError, TypeError, RecursionError):
        return None
    if not isinstance(payload, dict):
        return None
    error_code = payload.get('error_code')
    return error_code if isinstance(error_code, str) else None


def _validate_json_object_body(body: bytes, *, operation: str) -> JsonObject:
    try:
        return _JSON_OBJECT_ADAPTER.validate_json(body, strict=True)
    except pydantic.ValidationError:
        raise tool_errors.PublicToolError(
            f'OSMO returned an invalid response while attempting to {operation}.'
        ) from None


def _decode_text_prefix(
    response: gateway.GatewayResponse,
    *,
    operation: str,
) -> str:
    """Decode a complete UTF-8 body or a valid prefix ending mid-codepoint."""
    try:
        return response.body.decode('utf-8', errors='strict')
    except UnicodeDecodeError as error:
        if (
            response.body_truncated
            and error.reason == 'unexpected end of data'
            and error.end == len(response.body)
            and len(response.body) - error.start <= 3
        ):
            try:
                return response.body[:error.start].decode(
                    'utf-8', errors='strict'
                )
            except UnicodeDecodeError:
                pass
        raise tool_errors.PublicToolError(
            f'OSMO returned an invalid response while attempting to {operation}.'
        ) from None
