"""Compatibility wrapper for the renamed service-account Secret authenticator."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from src.service.core.auth import service_account_secret_auth


BackendTokenConfigurationError = (
    service_account_secret_auth.ServiceAccountTokenConfigurationError)
BackendTokenIdentity = service_account_secret_auth.ServiceAccountTokenIdentity
logger = service_account_secret_auth.logger


class BackendSecretAuthenticator(
        service_account_secret_auth.ServiceAccountSecretAuthenticator):
    """Deprecated backend-only authenticator with token-only compatibility."""

    def __init__(self, token_directory: str):
        super().__init__(token_directory, allow_legacy_backend_credentials=True)


def configure(token_directory: str | None) -> None:
    """Configure the deprecated token-only backend Secret contract."""
    service_account_secret_auth.configure(
        token_directory,
        allow_legacy_backend_credentials=token_directory is not None,
    )


def authenticate(access_token: str) -> BackendTokenIdentity | None:
    """Authenticate through the shared service-account authenticator."""
    return service_account_secret_auth.authenticate(access_token)
