"""Authenticate backend operators with credentials projected from Kubernetes Secrets."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import dataclasses
import hmac
from pathlib import Path
import re
from typing import Final

from src.utils.job import task as task_lib


BACKEND_ROLE: Final = 'osmo-backend'
_CREDENTIAL_NAME_PATTERN: Final = re.compile(r'^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$')
_CURRENT_TOKEN_KEY: Final = 'token'
_PREVIOUS_TOKEN_KEY: Final = 'previous-token'


class BackendTokenConfigurationError(ValueError):
    """Raised when the projected backend-token Secret contract is invalid."""


@dataclasses.dataclass(frozen=True)
class BackendTokenIdentity:
    """The fixed identity represented by one backend bootstrap credential."""

    username: str
    roles: tuple[str, ...]
    token_name: str


@dataclasses.dataclass(frozen=True)
class _BackendTokenCandidate:
    token: str
    identity: BackendTokenIdentity


class BackendSecretAuthenticator:
    """Loads and validates backend credentials from projected Secret directories."""

    def __init__(self, token_directory: str):
        self._token_directory = Path(token_directory)

    def validate(self) -> None:
        """Validate the currently projected credential generation."""
        self._load_candidates()

    def authenticate(self, access_token: str) -> BackendTokenIdentity | None:
        """Return the fixed backend identity when a projected token matches."""
        candidates = self._load_candidates()
        matched_identity = None
        for candidate in candidates:
            matches = hmac.compare_digest(access_token, candidate.token)
            if matches:
                matched_identity = candidate.identity
        return matched_identity

    def _load_candidates(self) -> list[_BackendTokenCandidate]:
        try:
            if not self._token_directory.is_dir():
                raise BackendTokenConfigurationError(
                    f'Backend token directory {self._token_directory} does not exist')
            credential_directories = sorted(
                path for path in self._token_directory.iterdir()
                if path.is_dir() and not path.name.startswith('.'))
        except OSError as error:
            raise BackendTokenConfigurationError(
                f'Backend token directory {self._token_directory} is unreadable') from error
        if not credential_directories:
            raise BackendTokenConfigurationError(
                f'Backend token directory {self._token_directory} contains no credentials')

        candidates = []
        observed_tokens: set[str] = set()
        for credential_directory in credential_directories:
            credential_name = credential_directory.name
            if not _CREDENTIAL_NAME_PATTERN.fullmatch(credential_name):
                raise BackendTokenConfigurationError(
                    f'Invalid backend credential name {credential_name}')

            generation_directory = self._resolve_generation_directory(credential_directory)
            identity = BackendTokenIdentity(
                username=f'backend-operator-{credential_name}',
                roles=(BACKEND_ROLE,),
                token_name=f'backend-bootstrap-{credential_name}',
            )
            for token_key, required in (
                    (_CURRENT_TOKEN_KEY, True),
                    (_PREVIOUS_TOKEN_KEY, False)):
                token = self._read_token(generation_directory, credential_name,
                                         token_key, required)
                if token is None:
                    continue
                if token in observed_tokens:
                    raise BackendTokenConfigurationError(
                        f'Duplicate backend token in credential {credential_name}')
                observed_tokens.add(token)
                candidates.append(_BackendTokenCandidate(token=token, identity=identity))

        return candidates

    @staticmethod
    def _resolve_generation_directory(credential_directory: Path) -> Path:
        generation_link = credential_directory / '..data'
        if not generation_link.is_symlink():
            return credential_directory
        try:
            return generation_link.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise BackendTokenConfigurationError(
                f'Backend credential {credential_directory.name} has an invalid projection') \
                from error

    @staticmethod
    def _read_token(generation_directory: Path, credential_name: str,
                    token_key: str, required: bool) -> str | None:
        token_path = generation_directory / token_key
        try:
            token = token_path.read_text(encoding='utf-8')
        except FileNotFoundError as error:
            if not required:
                return None
            raise BackendTokenConfigurationError(
                f'Backend credential {credential_name} is missing key {token_key}') from error
        except (OSError, UnicodeError) as error:
            raise BackendTokenConfigurationError(
                f'Backend credential {credential_name} key {token_key} is unreadable') from error

        if token.endswith('\r\n'):
            token = token[:-2]
        elif token.endswith('\n'):
            token = token[:-1]

        if len(token) not in task_lib.VALID_TOKEN_LENGTHS:
            raise BackendTokenConfigurationError(
                f'Backend credential {credential_name} key {token_key} has invalid length')
        return token


_authenticator: BackendSecretAuthenticator | None = None


def configure(token_directory: str | None) -> None:
    """Configure or disable Secret-backed backend authentication."""
    global _authenticator  # pylint: disable=global-statement
    if token_directory is None:
        _authenticator = None
        return
    authenticator = BackendSecretAuthenticator(token_directory)
    authenticator.validate()
    _authenticator = authenticator


def authenticate(access_token: str) -> BackendTokenIdentity | None:
    """Authenticate against the configured Secret directory, when enabled."""
    if _authenticator is None:
        return None
    return _authenticator.authenticate(access_token)
