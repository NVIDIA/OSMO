# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""
Shared definitions for storage backends modules.
"""

import abc
import enum
import functools
import logging
import os
import pathlib
from urllib import parse
from typing import Any, List

import pydantic

from ..core import header, provider
from ..credentials import credentials
from ....utils import osmo_errors


logger = logging.getLogger(__name__)


class StorageBackendType(enum.Enum):
    """
    Storage backend types.
    """
    SWIFT = 'swift'
    S3 = 's3'
    GS = 'gs'
    TOS = 'tos'
    AZURE = 'azure'


class AccessType(enum.Enum):
    """
    Access types.
    """
    READ = 'READ'
    WRITE = 'WRITE'
    DELETE = 'DELETE'


@pydantic.dataclasses.dataclass(frozen=True)
class StoragePath:
    """
    A class for storing Data Storage Path Details.

    This can be a path to a single object or a prefix to a collection of objects.
    """

    scheme: str = pydantic.Field(
        ...,
        description='The scheme of the storage profile.',
    )

    host: str = pydantic.Field(
        ...,
        description='The host of the storage profile.',
    )

    endpoint_url: str = pydantic.Field(
        ...,
        description='The endpoint URL of the storage profile.',
    )

    container: str = pydantic.Field(
        ...,
        description='The container of the storage profile.',
    )

    region: str = pydantic.Field(
        ...,
        description='The region of the storage profile.',
    )

    prefix: str = pydantic.Field(
        ...,
        description='The prefix of the storage path.',
    )


class StorageBackend(
    abc.ABC,
    pydantic.BaseModel,
    extra=pydantic.Extra.forbid,
    arbitrary_types_allowed=True,
    keep_untouched=(functools.cached_property,),  # Don't serialize cached properties
):
    """
    Represents information about a storage backend.
    """

    scheme: str
    uri: str
    netloc: str
    container: str
    path: str

    override_endpoint: str | None = None
    supports_environment_auth: bool = False

    @classmethod
    @abc.abstractmethod
    def create(
        cls,
        uri: str,
        url_details: parse.ParseResult,
        is_profile: bool = False,
        override_endpoint: str | None = None,
    ) -> 'StorageBackend':
        """
        Constructs a StorageBackend from a URI.
        """
        pass

    def __contains__(self, other: 'StorageBackend') -> bool:
        """
        Check if this storage backend contains another (i.e. superset of)
        """
        # Validate same backend coordinates
        if not (
            self.scheme == other.scheme
            and self.profile == other.profile
            and self.netloc == other.netloc
            and self.container == other.container
            and self.endpoint == other.endpoint
        ):
            return False

        # Self is a container root (contains all other paths)
        if not self.path:
            return True

        # Other is a container root (will not contain Self)
        if not other.path:
            return False

        # Check if other is a subpath of self
        try:
            self_normalized = os.path.normpath(self.path)
            other_normalized = os.path.normpath(other.path)
            common = os.path.commonpath([self_normalized, other_normalized])
            return pathlib.Path(common) == pathlib.Path(self_normalized)
        except ValueError:
            return False

    @property
    def endpoint(self) -> str:
        if self.override_endpoint:
            return self.override_endpoint
        return self.auth_endpoint

    @property
    @abc.abstractmethod
    def auth_endpoint(self) -> str:
        pass

    @property
    @abc.abstractmethod
    def profile(self) -> str:
        """
        Used for credentials
        """
        pass

    @property
    @abc.abstractmethod
    def container_uri(self) -> str:
        """
        Returns the uri link that goes up to the container not including the path field
        """
        pass

    @abc.abstractmethod
    def parse_uri_to_link(self, region: str) -> str:
        """
        Returns the https link corresponding to the uri.
        """
        pass

    @abc.abstractmethod
    def data_auth(
        self,
        data_cred: credentials.DataCredential | None = None,
        access_type: AccessType | None = None,
    ):
        """
        Validates if the access id and key can perform action.

        If no data credential is provided, it will be resolved via resolved_data_credential.

        Args:
            data_cred: The data credential to use for the validation.
            access_type: The access type to validate.
        """
        pass

    @abc.abstractmethod
    def region(
        self,
        data_cred: credentials.DataCredential | None = None,
    ) -> str:
        """
        Infer the region of the bucket from the storage backend.

        Some backends may not require a data credential to infer the region.
        If no data credential is provided, it will be resolved via resolved_data_credential.

        Args:
            data_cred: The data credential to use for the region inference.

        Returns:
            The region of the bucket.
        """
        pass

    @property
    @abc.abstractmethod
    def default_region(self) -> str:
        """
        The default region of the storage backend.
        """
        pass

    def to_storage_path(
        self,
        region: str | None = None,
    ) -> StoragePath:
        """
        Create a storage path from the storage backend.
        """
        return StoragePath(
            scheme=self.scheme,
            host=self.netloc,
            prefix=self.path,
            container=self.container,
            endpoint_url=self.endpoint,
            region=region or self.default_region,
        )

    @abc.abstractmethod
    def client_factory(
        self,
        data_cred: credentials.DataCredential | None = None,
        request_headers: List[header.RequestHeaders] | None = None,
        **kwargs: Any,
    ) -> provider.StorageClientFactory:
        """
        Returns a factory for creating storage clients.

        If no data credential is provided, it will be resolved via resolved_data_credential.

        Args:
            data_cred: The data credential to use for the client factory.
            request_headers: The request headers to use for the client factory.
            **kwargs: Additional keyword arguments to pass to the client factory.

        Returns:
            A factory for creating storage clients.
        """
        pass

    @functools.cached_property
    def resolved_data_credential(self) -> credentials.DataCredential:
        """
        Resolve the data credential for the storage backend.

        Returns:
            The resolved data credential.

        Raises:
            OSMOCredentialError: If the data credential is not found.
        """
        data_cred = credentials.get_static_data_credential_from_config(self.profile)

        if data_cred is not None:
            return data_cred

        if self.supports_environment_auth:
            return credentials.DefaultDataCredential(
                endpoint=self.profile,
                region=None,
            )

        raise osmo_errors.OSMOCredentialError(
            f'Data credential not found for {self.profile}')
