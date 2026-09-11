"""Authenticate backend operators with credentials projected from Kubernetes Secrets."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import dataclasses
import hmac
import json
import logging
from pathlib import Path
import re
from typing import Final

from src.utils.job import task as task_lib


BACKEND_ROLE: Final = 'osmo-backend'
_CREDENTIAL_NAME_PATTERN: Final = re.compile(r'^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$')
_TOKEN_PATTERN: Final = re.compile(r'^[A-Za-z0-9_-]+$')
_CURRENT_TOKEN_KEY: Final = 'token'
_PREVIOUS_TOKEN_KEY: Final = 'previous-token'
logger = logging.getLogger(__name__)


class BackendTokenConfigurationError(ValueError):
    """Raised when the projected backend-token Secret contract is invalid."""


@dataclasses.dataclass(frozen=True)
class BackendTokenIdentity:
    """The fixed identity represented by one backend bootstrap credential."""

    username: str
    roles: tuple[str, ...]
    token_name: str


@dataclasses.dataclass(frozen=True)
class BootstrapTokenIdentity:
    """The configured identity represented by one bootstrap token."""

    username: str
    roles: tuple[str, ...]
    token_name: str


@dataclasses.dataclass(frozen=True)
class _BootstrapTokenSpec:
    identity_id: str
    token_name: str
    current_key: str
    directory: Path
    identity: BootstrapTokenIdentity


@dataclasses.dataclass(frozen=True)
class _BootstrapTokenCandidate:
    token: str
    identity: BootstrapTokenIdentity


@dataclasses.dataclass(frozen=True)
class _BackendTokenCandidate:
    """One accepted token and the backend identity it authenticates."""

    token: str
    identity: BackendTokenIdentity


@dataclasses.dataclass(frozen=True)
class _CredentialProjection:
    """Resolved state for one projected backend credential."""

    credential_directory: Path
    generation_directory: Path | None
    error: BackendTokenConfigurationError | None = None


class BackendSecretAuthenticator:
    """Loads and validates backend credentials from projected Secret directories."""

    def __init__(self, token_directory: str):
        self._token_directory = Path(token_directory)
        self._cache: tuple[
            tuple[tuple[str, str, str, int, int], ...] | None,
            tuple[_BackendTokenCandidate, ...],
        ] = (None, ())

    def validate(self) -> None:
        """Validate the currently projected credential generation."""
        self._load_candidates()

    def authenticate(self, access_token: str) -> BackendTokenIdentity | None:
        """Return the fixed backend identity when a projected token matches."""
        candidates = self._load_candidates()
        encoded_access_token = access_token.encode('utf-8')
        matched_identity = None
        for candidate in candidates:
            matches = hmac.compare_digest(
                encoded_access_token, candidate.token.encode('utf-8'))
            if matches:
                matched_identity = candidate.identity
        return matched_identity

    def _load_candidates(self) -> list[_BackendTokenCandidate]:
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

        projection_state = []
        credential_projections = []
        for credential_directory in credential_directories:
            try:
                generation_directory = self._resolve_generation_directory(
                    credential_directory)
            except BackendTokenConfigurationError as error:
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
            for token_key in (_CURRENT_TOKEN_KEY, _PREVIOUS_TOKEN_KEY):
                token_path = generation_directory / token_key
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
                projection_state.append((credential_directory.name, token_key,
                                         str(generation_directory),
                                         modification_time, token_size))
        return tuple(projection_state), credential_projections

    def _parse_candidates(
            self, credential_projections: list[_CredentialProjection]) \
            -> list[_BackendTokenCandidate]:
        """Parse valid credentials and omit malformed or ambiguous entries."""
        candidates_by_credential: dict[str, list[_BackendTokenCandidate]] = {}
        for credential_projection in credential_projections:
            credential_name = credential_projection.credential_directory.name
            try:
                if credential_projection.error is not None:
                    raise credential_projection.error
                if credential_projection.generation_directory is None:
                    raise BackendTokenConfigurationError(
                        f'Backend credential {credential_name} has no projected generation')
                candidates_by_credential[credential_name] = self._parse_credential(
                    credential_name, credential_projection.generation_directory)
            except BackendTokenConfigurationError as error:
                logger.warning('Ignoring invalid backend credential %s: %s',
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
                'Ignoring backend credential %s because its token duplicates another credential',
                credential_name)

        return [
            candidate
            for credential_name, candidates in candidates_by_credential.items()
            if credential_name not in conflicting_credentials
            for candidate in candidates
        ]

    def _parse_credential(self, credential_name: str,
                          generation_directory: Path) -> list[_BackendTokenCandidate]:
        """Parse the current and optional previous token for one identity."""
        if not _CREDENTIAL_NAME_PATTERN.fullmatch(credential_name):
            raise BackendTokenConfigurationError(
                f'Invalid backend credential name {credential_name}')
        identity = BackendTokenIdentity(
            username=f'backend-operator-{credential_name}',
            roles=(BACKEND_ROLE,),
            token_name=f'backend-bootstrap-{credential_name}',
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
                raise BackendTokenConfigurationError(
                    f'Duplicate backend token in credential {credential_name}')
            observed_tokens.add(token)
            candidates.append(_BackendTokenCandidate(token=token, identity=identity))
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
            raise BackendTokenConfigurationError(
                f'Backend credential {credential_directory.name} has an invalid projection') \
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
        if not _TOKEN_PATTERN.fullmatch(token):
            raise BackendTokenConfigurationError(
                f'Backend credential {credential_name} key {token_key} has invalid format')
        return token


class BootstrapSecretAuthenticator:
    """Authenticates configured user and backend identities from Secret mounts."""

    def __init__(self, config_file: str, token_directory: str):
        self._token_specs = self._read_config(
            Path(config_file), Path(token_directory))
        self._cache: tuple[
            tuple[tuple[str, str, str, int, int], ...] | None,
            tuple[_BootstrapTokenCandidate, ...],
        ] = (None, ())

    def validate(self) -> None:
        self._load_candidates()

    def authenticate(self, access_token: str) -> BootstrapTokenIdentity | None:
        candidates = self._load_candidates()
        encoded_access_token = access_token.encode('utf-8')
        matched_identity = None
        for candidate in candidates:
            if hmac.compare_digest(
                    encoded_access_token, candidate.token.encode('utf-8')):
                matched_identity = candidate.identity
        return matched_identity

    @staticmethod
    def _read_config(
        config_file: Path,
        token_directory: Path,
    ) -> tuple[_BootstrapTokenSpec, ...]:
        try:
            raw_config = json.loads(config_file.read_text(encoding='utf-8'))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise BackendTokenConfigurationError(
                f'Bootstrap identity config {config_file} is unreadable') from error
        if not isinstance(raw_config, dict) or set(raw_config) != {'identities'}:
            raise BackendTokenConfigurationError(
                'Bootstrap identity config must contain only identities')
        identities = raw_config['identities']
        if not isinstance(identities, dict) or not identities:
            raise BackendTokenConfigurationError(
                'Bootstrap identity config contains no identities')

        token_specs = []
        usernames = set()
        for identity_id, identity_config in sorted(identities.items()):
            if (
                not isinstance(identity_id, str)
                or not _CREDENTIAL_NAME_PATTERN.fullmatch(identity_id)
                or not isinstance(identity_config, dict)
                or set(identity_config) != {'kind', 'username', 'roles', 'tokens'}
            ):
                raise BackendTokenConfigurationError(
                    f'Invalid bootstrap identity {identity_id}')
            kind = identity_config['kind']
            username = identity_config['username']
            roles = identity_config['roles']
            tokens = identity_config['tokens']
            if (
                kind not in ('user', 'backend')
                or not isinstance(username, str)
                or not re.fullmatch(
                    r'^[a-zA-Z0-9](?:[a-zA-Z0-9_.@-]*[a-zA-Z0-9])?$',
                    username)
                or username in usernames
                or not isinstance(roles, list)
                or not roles
                or any(not isinstance(role, str) or not role for role in roles)
                or len(set(roles)) != len(roles)
                or not isinstance(tokens, dict)
                or not tokens
                or (kind == 'backend' and roles != [BACKEND_ROLE])
            ):
                raise BackendTokenConfigurationError(
                    f'Invalid bootstrap identity {identity_id}')
            usernames.add(username)
            for token_name, token_config in sorted(tokens.items()):
                if (
                    not isinstance(token_name, str)
                    or not _CREDENTIAL_NAME_PATTERN.fullmatch(token_name)
                    or not isinstance(token_config, dict)
                    or set(token_config) != {'key'}
                    or not isinstance(token_config['key'], str)
                    or not re.fullmatch(r'^[A-Za-z0-9._-]+$', token_config['key'])
                ):
                    raise BackendTokenConfigurationError(
                        f'Invalid bootstrap token {identity_id}/{token_name}')
                token_specs.append(_BootstrapTokenSpec(
                    identity_id=identity_id,
                    token_name=token_name,
                    current_key=token_config['key'],
                    directory=token_directory / identity_id / token_name,
                    identity=BootstrapTokenIdentity(
                        username=username,
                        roles=tuple(roles),
                        token_name=f'bootstrap-{identity_id}-{token_name}',
                    ),
                ))
        return tuple(token_specs)

    def _load_candidates(self) -> list[_BootstrapTokenCandidate]:
        projection_state = []
        projections: list[tuple[
            _BootstrapTokenSpec,
            Path | None,
            BackendTokenConfigurationError | None,
        ]] = []
        for token_spec in self._token_specs:
            try:
                generation_directory = BackendSecretAuthenticator._resolve_generation_directory(
                    token_spec.directory)
            except BackendTokenConfigurationError as projection_error:
                generation_directory = None
                projections.append((
                    token_spec, generation_directory, projection_error))
            else:
                projections.append((token_spec, generation_directory, None))
            for key in (token_spec.current_key, _PREVIOUS_TOKEN_KEY):
                path = (generation_directory or token_spec.directory) / key
                try:
                    state = path.stat()
                    modification_time = state.st_mtime_ns
                    size = state.st_size
                except FileNotFoundError:
                    modification_time = -1
                    size = -1
                except OSError:
                    modification_time = -2
                    size = -2
                projection_state.append((
                    token_spec.identity_id, token_spec.token_name,
                    str(path), modification_time, size))
        state_tuple = tuple(projection_state)
        if state_tuple == self._cache[0]:
            return list(self._cache[1])

        candidates_by_token: list[_BootstrapTokenCandidate] = []
        for token_spec, generation_directory, stored_error in projections:
            if stored_error is not None or generation_directory is None:
                logger.warning(
                    'Ignoring invalid bootstrap token %s/%s: %s',
                    token_spec.identity_id, token_spec.token_name,
                    stored_error)
                continue
            try:
                tokens = []
                for key, required in (
                        (token_spec.current_key, True),
                        (_PREVIOUS_TOKEN_KEY, False)):
                    token = BackendSecretAuthenticator._read_token(
                        generation_directory,
                        f'{token_spec.identity_id}/{token_spec.token_name}',
                        key,
                        required)
                    if token is not None:
                        tokens.append(token)
                if len(tokens) != len(set(tokens)):
                    raise BackendTokenConfigurationError(
                        f'Duplicate bootstrap token in {token_spec.identity_id}/'
                        f'{token_spec.token_name}')
                candidates_by_token.extend(
                    _BootstrapTokenCandidate(token=token, identity=token_spec.identity)
                    for token in tokens)
            except BackendTokenConfigurationError as token_error:
                logger.warning(
                    'Ignoring invalid bootstrap token %s/%s: %s',
                    token_spec.identity_id, token_spec.token_name, token_error)

        token_counts: dict[str, int] = {}
        for candidate in candidates_by_token:
            token_counts[candidate.token] = token_counts.get(candidate.token, 0) + 1
        candidates = [
            candidate for candidate in candidates_by_token
            if token_counts[candidate.token] == 1
        ]
        if len(candidates) != len(candidates_by_token):
            logger.warning('Ignoring duplicate bootstrap token values')
        self._cache = (state_tuple, tuple(candidates))
        return candidates


_authenticator: BackendSecretAuthenticator | None = None
_bootstrap_authenticator: BootstrapSecretAuthenticator | None = None


def configure(token_directory: str | None) -> None:
    """Configure or disable Secret-backed backend authentication."""
    global _authenticator  # pylint: disable=global-statement
    if token_directory is None:
        _authenticator = None
        return
    authenticator = BackendSecretAuthenticator(token_directory)
    authenticator.validate()
    _authenticator = authenticator


def configure_bootstrap(
    config_file: str | None,
    token_directory: str | None,
) -> None:
    """Configure or disable generalized Secret-backed identity authentication."""
    global _bootstrap_authenticator  # pylint: disable=global-statement
    if config_file is None and token_directory is None:
        _bootstrap_authenticator = None
        return
    if config_file is None or token_directory is None:
        raise BackendTokenConfigurationError(
            'Bootstrap identity config and token directory must be set together')
    authenticator = BootstrapSecretAuthenticator(config_file, token_directory)
    authenticator.validate()
    _bootstrap_authenticator = authenticator


def authenticate(
    access_token: str,
) -> BackendTokenIdentity | BootstrapTokenIdentity | None:
    """Authenticate against the configured Secret directory, when enabled."""
    if _bootstrap_authenticator is not None:
        identity = _bootstrap_authenticator.authenticate(access_token)
        if identity is not None:
            return identity
    if _authenticator is None:
        return None
    return _authenticator.authenticate(access_token)
