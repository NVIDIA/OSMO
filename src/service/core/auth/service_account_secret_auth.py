"""Authenticate service accounts with credentials projected from Kubernetes Secrets."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import dataclasses
import hashlib
import hmac
import logging
from pathlib import Path
import re
from typing import Final

from src.lib.utils import common
from src.utils.job import task as task_lib


_CREDENTIAL_NAME_PATTERN: Final = re.compile(r'^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$')
_ROLE_PATTERN: Final = re.compile(r'^[A-Za-z0-9](?:[-A-Za-z0-9_.:@/]*[A-Za-z0-9])?$')
_TOKEN_PATTERN: Final = re.compile(r'^[A-Za-z0-9_-]+$')
_CURRENT_TOKEN_KEY: Final = 'token'
_PREVIOUS_TOKEN_KEY: Final = 'previous-token'
_USERNAME_KEY: Final = 'username'
_ROLES_KEY: Final = 'roles'
_PROJECTED_KEYS: Final = (
    _CURRENT_TOKEN_KEY,
    _PREVIOUS_TOKEN_KEY,
    _USERNAME_KEY,
    _ROLES_KEY,
)
logger = logging.getLogger(__name__)


class ServiceAccountTokenConfigurationError(ValueError):
    """Raised when the projected service-account Secret contract is invalid."""


@dataclasses.dataclass(frozen=True)
class ServiceAccountTokenIdentity:
    """The identity represented by one service-account token."""

    username: str
    roles: tuple[str, ...]
    token_name: str


@dataclasses.dataclass(frozen=True)
class _ServiceAccountTokenCandidate:
    """One accepted token and the service-account identity it authenticates."""

    token: str
    identity: ServiceAccountTokenIdentity


@dataclasses.dataclass(frozen=True)
class _CredentialProjection:
    """Resolved state for one projected service-account credential."""

    credential_directory: Path
    generation_directory: Path | None
    error: ServiceAccountTokenConfigurationError | None = None


class ServiceAccountSecretAuthenticator:
    """Loads service-account credentials from projected Secret directories."""

    def __init__(self, token_directory: str, *,
                 allow_legacy_backend_credentials: bool = False):
        self._token_directory = Path(token_directory)
        self._allow_legacy_backend_credentials = allow_legacy_backend_credentials
        self._cache: tuple[
            tuple[tuple[str, str, str, int, int], ...] | None,
            tuple[_ServiceAccountTokenCandidate, ...],
        ] = (None, ())

    def validate(self) -> None:
        """Validate the currently projected credential generation."""
        self._load_candidates()

    def authenticate(self, access_token: str) -> ServiceAccountTokenIdentity | None:
        """Return the service-account identity when a projected token matches."""
        candidates = self._load_candidates()
        encoded_access_token = access_token.encode('utf-8')
        matched_identity = None
        for candidate in candidates:
            matches = hmac.compare_digest(
                encoded_access_token, candidate.token.encode('utf-8'))
            if matches:
                matched_identity = candidate.identity
        return matched_identity

    def resolve_identity(self, token_digest: str, username: str,
                         token_name: str) -> ServiceAccountTokenIdentity | None:
        """Resolve an identity from a digest without retaining the plaintext token."""
        if not re.fullmatch(r'[0-9a-f]{64}', token_digest):
            return None
        matched_identity = None
        for candidate in self._load_candidates():
            candidate_digest = hashlib.sha256(candidate.token.encode('utf-8')).hexdigest()
            identity_matches = (
                hmac.compare_digest(candidate.identity.username, username)
                and hmac.compare_digest(candidate.identity.token_name, token_name)
            )
            if hmac.compare_digest(candidate_digest, token_digest) and identity_matches:
                matched_identity = candidate.identity
        return matched_identity

    def _load_candidates(self) -> list[_ServiceAccountTokenCandidate]:
        """Return parsed credentials, reloading after a projection change."""
        projection_state, credential_generations = self._read_projection_state()
        cached_projection_state, cached_candidates = self._cache
        if projection_state == cached_projection_state:
            return list(cached_candidates)

        candidates = self._parse_candidates(credential_generations)
        self._cache = (projection_state, tuple(candidates))
        return candidates

    def _read_projection_state(
            self) -> tuple[tuple[tuple[str, str, str, int, int], ...],
                           list[_CredentialProjection]]:
        """Capture token file state without reading token material."""
        try:
            if not self._token_directory.is_dir():
                raise ServiceAccountTokenConfigurationError(
                    f'Service account token directory {self._token_directory} does not exist')
            credential_directories = sorted(
                path for path in self._token_directory.iterdir()
                if path.is_dir() and not path.name.startswith('.'))
        except OSError as error:
            raise ServiceAccountTokenConfigurationError(
                f'Service account token directory {self._token_directory} is unreadable') \
                from error
        if not credential_directories:
            raise ServiceAccountTokenConfigurationError(
                f'Service account token directory {self._token_directory} contains no credentials')

        projection_state = []
        credential_projections = []
        for credential_directory in credential_directories:
            try:
                generation_directory = self._resolve_generation_directory(
                    credential_directory)
            except ServiceAccountTokenConfigurationError as error:
                credential_projections.append(_CredentialProjection(
                    credential_directory=credential_directory,
                    generation_directory=None,
                    error=error))
                generation_link = credential_directory / '..data'
                try:
                    generation_stat = generation_link.lstat()
                    modification_time = generation_stat.st_mtime_ns
                    token_size = generation_stat.st_size
                except OSError:
                    modification_time = -1
                    token_size = -1
                projection_state.append((credential_directory.name, '..data',
                                         str(generation_link),
                                         modification_time, token_size))
                continue

            credential_projections.append(_CredentialProjection(
                credential_directory=credential_directory,
                generation_directory=generation_directory))
            for projected_key in _PROJECTED_KEYS:
                token_path = generation_directory / projected_key
                try:
                    token_stat = token_path.stat()
                    modification_time = token_stat.st_mtime_ns
                    token_size = token_stat.st_size
                except FileNotFoundError:
                    modification_time = -1
                    token_size = -1
                except OSError:
                    modification_time = -2
                    token_size = -2
                projection_state.append((credential_directory.name, projected_key,
                                         str(generation_directory),
                                         modification_time, token_size))
        return tuple(projection_state), credential_projections

    def _parse_candidates(
            self, credential_projections: list[_CredentialProjection]) \
            -> list[_ServiceAccountTokenCandidate]:
        """Parse valid credentials and omit malformed or ambiguous entries."""
        candidates_by_credential: dict[str, list[_ServiceAccountTokenCandidate]] = {}
        for credential_projection in credential_projections:
            credential_name = credential_projection.credential_directory.name
            try:
                if credential_projection.error is not None:
                    raise credential_projection.error
                if credential_projection.generation_directory is None:
                    raise ServiceAccountTokenConfigurationError(
                        f'Service account credential {credential_name} has no projected generation')
                candidates_by_credential[credential_name] = self._parse_credential(
                    credential_name, credential_projection.generation_directory)
            except ServiceAccountTokenConfigurationError as error:
                logger.warning('Ignoring invalid service account credential %s: %s',
                               credential_name, error)

        token_owners: dict[str, set[str]] = {}
        for credential_name, candidates in candidates_by_credential.items():
            for candidate in candidates:
                token_owners.setdefault(candidate.token, set()).add(credential_name)
        conflicting_credentials = {
            credential_name
            for credential_names in token_owners.values()
            if len(credential_names) > 1
            for credential_name in credential_names
        }
        for credential_name in sorted(conflicting_credentials):
            logger.warning(
                'Ignoring service account credential %s because its token duplicates another credential',
                credential_name)

        return [
            candidate
            for credential_name, candidates in candidates_by_credential.items()
            if credential_name not in conflicting_credentials
            for candidate in candidates
        ]

    def _parse_credential(self, credential_name: str,
                          generation_directory: Path) -> list[_ServiceAccountTokenCandidate]:
        """Parse the current and optional previous token for one identity."""
        if not _CREDENTIAL_NAME_PATTERN.fullmatch(credential_name):
            raise ServiceAccountTokenConfigurationError(
                f'Invalid service account credential name {credential_name}')
        username_path = generation_directory / _USERNAME_KEY
        roles_path = generation_directory / _ROLES_KEY
        if (self._allow_legacy_backend_credentials
                and not username_path.exists() and not roles_path.exists()):
            identity = ServiceAccountTokenIdentity(
                username=f'backend-operator-{credential_name}',
                roles=('osmo-backend',),
                token_name=f'backend-bootstrap-{credential_name}',
            )
        else:
            username = self._read_required_text(
                generation_directory, credential_name, _USERNAME_KEY)
            if len(username) > 255 or not re.fullmatch(common.USERNAME_REGEX, username):
                raise ServiceAccountTokenConfigurationError(
                    f'Service account credential {credential_name} has invalid username')
            roles_text = self._read_required_text(
                generation_directory, credential_name, _ROLES_KEY)
            roles = tuple(roles_text.splitlines())
            if (not roles or len(roles) != len(set(roles)) or any(
                    len(role) > 255 or not _ROLE_PATTERN.fullmatch(role) for role in roles)):
                raise ServiceAccountTokenConfigurationError(
                    f'Service account credential {credential_name} has invalid roles')
            identity = ServiceAccountTokenIdentity(
                username=username,
                roles=roles,
                token_name=f'service-account-{credential_name}',
            )
        candidates = []
        observed_tokens: set[str] = set()
        for token_key, required in (
                (_CURRENT_TOKEN_KEY, True),
                (_PREVIOUS_TOKEN_KEY, False)):
            token = self._read_token(generation_directory, credential_name,
                                     token_key, required)
            if token is None:
                continue
            if token in observed_tokens:
                raise ServiceAccountTokenConfigurationError(
                    f'Duplicate service account token in credential {credential_name}')
            observed_tokens.add(token)
            candidates.append(_ServiceAccountTokenCandidate(token=token, identity=identity))
        return candidates

    @staticmethod
    def _resolve_generation_directory(credential_directory: Path) -> Path:
        """Resolve the atomic Kubernetes Secret projection when present."""
        generation_link = credential_directory / '..data'
        if not generation_link.is_symlink():
            return credential_directory
        try:
            return generation_link.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise ServiceAccountTokenConfigurationError(
                f'Service account credential {credential_directory.name} has an invalid projection') \
                from error

    @staticmethod
    def _read_token(generation_directory: Path, credential_name: str,
                    token_key: str, required: bool) -> str | None:
        """Read and validate one projected token value."""
        token_path = generation_directory / token_key
        try:
            token = token_path.read_text(encoding='utf-8')
        except FileNotFoundError as error:
            if not required:
                return None
            raise ServiceAccountTokenConfigurationError(
                f'Service account credential {credential_name} is missing key {token_key}') \
                from error
        except (OSError, UnicodeError) as error:
            raise ServiceAccountTokenConfigurationError(
                f'Service account credential {credential_name} key {token_key} is unreadable') \
                from error

        if token.endswith('\r\n'):
            token = token[:-2]
        elif token.endswith('\n'):
            token = token[:-1]

        if len(token) not in task_lib.VALID_TOKEN_LENGTHS:
            raise ServiceAccountTokenConfigurationError(
                f'Service account credential {credential_name} key {token_key} has invalid length')
        if not _TOKEN_PATTERN.fullmatch(token):
            raise ServiceAccountTokenConfigurationError(
                f'Service account credential {credential_name} key {token_key} has invalid format')
        return token

    @staticmethod
    def _read_required_text(generation_directory: Path, credential_name: str,
                            key: str) -> str:
        path = generation_directory / key
        try:
            value = path.read_text(encoding='utf-8')
        except FileNotFoundError as error:
            raise ServiceAccountTokenConfigurationError(
                f'Service account credential {credential_name} is missing key {key}') from error
        except (OSError, UnicodeError) as error:
            raise ServiceAccountTokenConfigurationError(
                f'Service account credential {credential_name} key {key} is unreadable') \
                from error
        return value.removesuffix('\r\n').removesuffix('\n')


_authenticator: ServiceAccountSecretAuthenticator | None = None


def configure(token_directory: str | None, *,
              allow_legacy_backend_credentials: bool = False) -> None:
    """Configure or disable Secret-backed service-account authentication."""
    global _authenticator  # pylint: disable=global-statement
    if token_directory is None:
        _authenticator = None
        return
    authenticator = ServiceAccountSecretAuthenticator(
        token_directory,
        allow_legacy_backend_credentials=allow_legacy_backend_credentials,
    )
    authenticator.validate()
    _authenticator = authenticator


def authenticate(access_token: str) -> ServiceAccountTokenIdentity | None:
    """Authenticate against the configured Secret directory, when enabled."""
    if _authenticator is None:
        return None
    return _authenticator.authenticate(access_token)


def resolve_identity(token_digest: str, username: str,
                     token_name: str) -> ServiceAccountTokenIdentity | None:
    """Resolve a still-projected token identity from its digest and claims."""
    if _authenticator is None:
        return None
    return _authenticator.resolve_identity(token_digest, username, token_name)
