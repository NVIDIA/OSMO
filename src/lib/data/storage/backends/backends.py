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
This module contains the implementation of the storage backends.
"""

import collections
import logging
import os
import re
from typing import Any, Dict, List, Literal
from typing_extensions import assert_never, override
from urllib import parse

import boto3
import mypy_boto3_iam.client
import mypy_boto3_sts.client
import pydantic

from . import azure, s3, common
from .. import constants, credentials
from ..core import client, header
from ....utils import cache, osmo_errors


logger = logging.getLogger(__name__)


# Environment variable to skip data auth
# This is useful for testing and local development environments.
OSMO_SKIP_DATA_AUTH = 'OSMO_SKIP_DATA_AUTH'


def _skip_data_auth() -> bool:
    """
    Returns True if data auth should be skipped.
    """
    return os.getenv(OSMO_SKIP_DATA_AUTH, '0') == '1'


def _normalize_path(path: str) -> str:
    """
    Normalizes a path by replacing multiple consecutive slashes with a single slash.
    """
    return re.sub(r'/{2,}', '/', path)


class Boto3Backend(common.StorageBackend):
    """
    Base class for all boto3-based storage backends.
    """

    supports_batch_delete: bool = pydantic.Field(
        default=False,
        description='Whether the backend supports batch delete.',
    )

    @override
    @property
    def default_region(self) -> str:
        """
        The default region for boto3-based storage backends.
        """
        return constants.DEFAULT_BOTO3_REGION

    @staticmethod
    def _get_extra_headers(
        request_headers: List[header.RequestHeaders] | None,
    ) -> Dict[str, Dict[str, str]] | None:
        """
        Returns a dictionary of extra headers to be passed to the S3 client.
        """
        if request_headers is None:
            extra_headers = None
        else:
            extra_headers = collections.defaultdict[str, Dict[str, str]](dict)
            for request_header in request_headers:
                match request_header:
                    case header.UploadRequestHeaders():
                        extra_headers['before-call.s3.PutObject'].update(
                            request_header.headers,
                        )
                        extra_headers['before-call.s3.CreateMultipartUpload'].update(
                            request_header.headers,
                        )
                        extra_headers['before-call.s3.UploadPart'].update(
                            request_header.headers,
                        )
                        extra_headers['before-call.s3.CompleteMultipartUpload'].update(
                            request_header.headers,
                        )

                    case (
                        header.DownloadRequestHeaders() |
                        header.CopyRequestHeaders() |
                        header.DeleteRequestHeaders() |
                        header.FetchRequestHeaders() |
                        header.ListRequestHeaders()
                    ):
                        # TODO: Add support for other request headers in S3
                        logger.warning(
                            'Request headers are not supported yet for %s',
                            type(request_header),
                        )

                    case (
                        header.ClientHeaders() |
                        header.RequestHeaders()
                    ):
                        # Headers are applied to all S3 events
                        extra_headers['before-call.s3'].update(request_header.headers)

                    case _ as unreachable:
                        assert_never(unreachable)

        return extra_headers

    @override
    def client_factory(
        self,
        data_cred: credentials.DataCredential | None = None,
        request_headers: List[header.RequestHeaders] | None = None,
        **kwargs: Any,
    ) -> s3.S3StorageClientFactory:
        """
        Returns a factory for creating storage clients.
        """
        region = kwargs.get('region', None) or self.region(data_cred)

        if data_cred is None:
            data_cred = self.resolved_data_credential

        return s3.S3StorageClientFactory(  # pylint: disable=unexpected-keyword-arg
            data_cred=data_cred,
            region=region,
            scheme=self.scheme,
            endpoint_url=self.auth_endpoint if self.auth_endpoint else None,
            extra_headers=self._get_extra_headers(request_headers),
            supports_batch_delete=self.supports_batch_delete,
        )


class SwiftBackend(Boto3Backend):
    """
    Swift Backend
    """

    scheme: str = pydantic.Field(
        default=common.StorageBackendType.SWIFT.value,
        const=True,
        description='The scheme of the Swift backend.',
    )

    namespace: str = pydantic.Field(
        ...,
        description='The namespace of the Swift backend (e.g. AUTH_team-my-namespace)',
    )

    supports_batch_delete: Literal[True] = pydantic.Field(
        default=True,
        const=True,
        description='Whether the backend supports batch delete.',
    )

    # Cache the region to avoid re-computing it
    _region: str | None = pydantic.PrivateAttr(default=None)

    @override
    @classmethod
    def create(
        cls,
        uri: str,
        url_details: parse.ParseResult,
        is_profile: bool = False,
        override_endpoint: str | None = None,
    ) -> 'SwiftBackend':
        """
        Constructs a SwiftBackend from a URI.

        Expected format: swift://<net_loc>/<namespace>/<container>/<path>
        """
        # Validate URI format
        regex = constants.SWIFT_PROFILE_REGEX if is_profile else constants.SWIFT_REGEX
        if not re.fullmatch(regex, uri):
            raise osmo_errors.OSMOError(f'Incorrectly formatted Swift URI: {uri}')

        # Parse URI
        parsed_path = _normalize_path(url_details.path)
        split_path = parsed_path.split('/', 3)

        return cls(
            uri=uri,
            netloc=url_details.netloc,
            container='' if is_profile else split_path[2],
            path='' if is_profile or len(split_path) != 4 else split_path[3],
            namespace=split_path[1],
            override_endpoint=override_endpoint,
        )

    @override
    @property
    def auth_endpoint(self) -> str:
        return f'https://{self.netloc}'

    @override
    @property
    def profile(self) -> str:
        """
        Used for credentials
        """
        return f'{self.scheme}://{self.netloc}/{self.namespace}'

    @override
    @property
    def container_uri(self) -> str:
        """
        Returns the uri link that goes up to the container not including the path field
        """
        return f'{self.profile}/{self.container}'

    @override
    def parse_uri_to_link(self, region: str) -> str:
        # pylint: disable=unused-argument
        """
        Returns the https link corresponding to the uri
        """
        return f'https://{self.netloc}/v1/{self.namespace}/{self.container}/{self.path}'.rstrip('/')

    @override
    def data_auth(
        self,
        data_cred: credentials.DataCredential | None = None,
        access_type: common.AccessType | None = None,
    ):
        # pylint: disable=unused-argument
        """
        Validates if the data is valid for the backend
        """
        if _skip_data_auth():
            return

        if data_cred is None:
            data_cred = self.resolved_data_credential

        match data_cred:
            case credentials.StaticDataCredential():
                access_key_id = data_cred.access_key_id

                if ':' in access_key_id:
                    namespace = access_key_id.split(':')[1]
                else:
                    namespace = f'AUTH_{access_key_id}'

                if namespace != self.namespace:
                    raise osmo_errors.OSMOCredentialError(
                        f'Data key validation error: access_key_id {access_key_id} is ' +
                        f'not valid for the {self.namespace} namespace.')

            case credentials.DefaultDataCredential():
                raise NotImplementedError(
                    'Default data credentials are not supported for Swift backend')
            case _ as unreachable:
                assert_never(unreachable)

        s3_client = s3.create_client(
            data_cred=data_cred,
            scheme=self.scheme,
            endpoint_url=self.auth_endpoint,
            region=self.region(data_cred),
        )

        def _validate_auth():
            if self.container:
                s3_client.head_bucket(Bucket=self.container)
            else:
                s3_client.list_buckets(MaxBuckets=1)

        try:
            _ = client.execute_api(_validate_auth, s3.S3ErrorHandler())
        except client.OSMODataStorageClientError as err:
            if err.message == 'AuthorizationHeaderMalformed':
                raise osmo_errors.OSMOCredentialError(
                    f'Data key validation error: region {data_cred.region} is not valid: '
                    f'{err.__cause__}')
            if err.message == 'SignatureDoesNotMatch':
                raise osmo_errors.OSMOCredentialError(
                    f'Data key validation error: access_key_id {access_key_id} is not valid: '
                    f'{err.__cause__}')
            raise osmo_errors.OSMOCredentialError(
                f'Data key validation error: {err.__cause__}')

    @override
    def region(
        self,
        data_cred: credentials.DataCredential | None = None,
    ) -> str:
        """
        Infer the region of the bucket via provided credentials.

        If 'LocationConstraint' is not present, we will use the default region.
        """
        if self._region is not None:
            return self._region

        if data_cred is None:
            data_cred = self.resolved_data_credential

        match data_cred:
            case credentials.StaticDataCredential():
                pass
            case credentials.DefaultDataCredential():
                raise NotImplementedError(
                    'Default data credentials are not supported for Swift backend')
            case _ as unreachable:
                assert_never(unreachable)

        if data_cred.region is not None:
            return data_cred.region

        s3_client = s3.create_client(
            data_cred=data_cred,
            scheme=self.scheme,
            endpoint_url=self.auth_endpoint,
            # No region, we need to get it from the bucket location
        )

        def _get_region() -> str:
            bucket_location_resp = s3_client.get_bucket_location(Bucket=self.container)
            return (
                bucket_location_resp.get('LocationConstraint', self.default_region)
                or self.default_region
            )

        self._region = client.execute_api(_get_region, s3.S3ErrorHandler()).result
        return self._region


class S3Backend(Boto3Backend):
    """
    AWS S3 Backend
    """

    scheme: str = pydantic.Field(
        default=common.StorageBackendType.S3.value,
        const=True,
        description='The scheme of the S3 backend.',
    )

    supports_batch_delete: Literal[True] = pydantic.Field(
        default=True,
        const=True,
        description='Whether the backend supports batch delete.',
    )

    supports_environment_auth: Literal[True] = pydantic.Field(
        default=True,
        const=True,
        description='Whether the backend supports environment authentication.',
    )

    # Cache the region to avoid re-computing it
    _region: str | None = pydantic.PrivateAttr(default=None)

    @override
    @classmethod
    def create(
        cls,
        uri: str,
        url_details: parse.ParseResult,
        is_profile: bool = False,
        override_endpoint: str | None = None,
    ) -> 'S3Backend':
        """
        Constructs a S3Backend from a URI.

        Expected format: s3://<bucket>/<path>
        """
        # Validate URI format
        regex = constants.S3_PROFILE_REGEX if is_profile else constants.S3_REGEX
        if not re.fullmatch(regex, uri):
            raise osmo_errors.OSMOError(f'Incorrectly formatted S3 URI: {uri}')

        # Parse URI
        parsed_path = _normalize_path(url_details.path)

        return cls(
            uri=uri,
            netloc='',
            container=url_details.netloc,
            path=parsed_path.lstrip('/'),
            override_endpoint=override_endpoint,
        )

    @override
    @property
    def auth_endpoint(self) -> str:
        return ''

    @override
    @property
    def profile(self) -> str:
        """
        Used for credentials
        """
        return f'{self.scheme}://{self.container}'

    @override
    @property
    def container_uri(self) -> str:
        """
        Returns the uri link that goes up to the container not including the path field
        """
        return f'{self.profile}'

    @override
    def parse_uri_to_link(self, region: str) -> str:
        """
        Returns the https link corresponding to the uri
        """
        return f'https://{self.container}.s3.{region}.amazonaws.com/{self.path}'.rstrip('/')

    @override
    def data_auth(
        self,
        data_cred: credentials.DataCredential | None = None,
        access_type: common.AccessType | None = None,
    ):
        """
        Validates if the data is valid for the backend
        """
        if _skip_data_auth():
            return

        action = []
        if access_type == common.AccessType.READ:
            action.append('s3:GetObject')
        elif access_type == common.AccessType.WRITE:
            action += ['s3:PutObject', 's3:GetObject']
        elif access_type == common.AccessType.DELETE:
            action.append('s3:DeleteObject')

        if data_cred is None:
            data_cred = self.resolved_data_credential

        match data_cred:
            case credentials.StaticDataCredential():
                session = boto3.Session(
                    aws_access_key_id=data_cred.access_key_id,
                    aws_secret_access_key=data_cred.access_key.get_secret_value(),
                    region_name=self.region(data_cred),
                )
            case credentials.DefaultDataCredential():
                session = boto3.Session(
                    region_name=self.region(data_cred),
                )
            case _ as unreachable:
                assert_never(unreachable)

        iam_client: mypy_boto3_iam.client.IAMClient = session.client('iam')
        sts_client: mypy_boto3_sts.client.STSClient = session.client('sts')

        def _validate_auth():
            arn = sts_client.get_caller_identity()['Arn']
            path = f'{self.container}/{self.path if self.path else "*"}'

            if path.endswith('/'):
                # S3 IAM simulation will validate against an object with a trailing slash,
                # therefore we need to add a wildcard to the path.
                path += '*'

            bucket_objects_arn = f'arn:aws:s3:::{path}'

            results = iam_client.simulate_principal_policy(
                PolicySourceArn=arn,
                ResourceArns=[bucket_objects_arn],
                ActionNames=action
            )

            if access_type:
                for result in results['EvaluationResults']:
                    if result['EvalDecision'] != 'allowed':
                        raise osmo_errors.OSMOCredentialError(
                            f'Data key validation error: no {result["EvalActionName"]} '
                            f'access for s3://{path}')

        try:
            _ = client.execute_api(_validate_auth, s3.S3ErrorHandler())
        except client.OSMODataStorageClientError as err:
            raise osmo_errors.OSMOCredentialError(
                f'Data key validation error: {err.message}: {err.__cause__}')

    @override
    def region(
        self,
        data_cred: credentials.DataCredential | None = None,
    ) -> str:
        """
        Infer the region of the bucket via provided credentials.

        If 'LocationConstraint' is not present, we will use the default region.
        """
        if self._region is not None:
            return self._region

        if data_cred is None:
            data_cred = self.resolved_data_credential

        if data_cred.region is not None:
            return data_cred.region

        s3_client = s3.create_client(
            data_cred=data_cred,
            scheme=self.scheme,
        )

        def _get_region() -> str:
            bucket_location_resp = s3_client.get_bucket_location(Bucket=self.container)
            return (
                bucket_location_resp.get('LocationConstraint', self.default_region)
                or self.default_region
            )

        self._region = client.execute_api(_get_region, s3.S3ErrorHandler()).result
        return self._region


class GSBackend(Boto3Backend):
    """
    Google Cloud Platform GS Backend
    """

    scheme: str = pydantic.Field(
        default=common.StorageBackendType.GS.value,
        const=True,
        description='The scheme of the GS backend.',
    )

    # Google Cloud Storage does not support batch delete via S3 API:
    # https://issuetracker.google.com/issues/162653700
    supports_batch_delete: Literal[False] = pydantic.Field(
        default=False,
        const=True,
        description='Whether the backend supports batch delete.',
    )

    @override
    @classmethod
    def create(
        cls,
        uri: str,
        url_details: parse.ParseResult,
        is_profile: bool = False,
        override_endpoint: str | None = None,
    ) -> 'GSBackend':
        """
        Constructs a GSBackend from a URI.

        Expected format: gs://<bucket>/<path>
        """
        # Validate URI format
        regex = constants.GS_PROFILE_REGEX if is_profile else constants.GS_REGEX
        if not re.fullmatch(regex, uri):
            raise osmo_errors.OSMOError(f'Incorrectly formatted GS URI: {uri}')

        # Parse URI
        parsed_path = _normalize_path(url_details.path)

        return cls(
            uri=uri,
            netloc=constants.DEFAULT_GS_HOST,
            container=url_details.netloc,
            path=parsed_path.lstrip('/'),
            override_endpoint=override_endpoint,
        )

    @override
    @property
    def auth_endpoint(self) -> str:
        return f'https://{self.netloc}'

    @override
    @property
    def profile(self) -> str:
        """
        Used for credentials
        """
        return f'{self.scheme}://{self.container}'

    @override
    @property
    def container_uri(self) -> str:
        """
        Returns the uri link that goes up to the container not including the path field
        """
        return f'{self.profile}'

    @override
    def parse_uri_to_link(self, region: str) -> str:
        # pylint: disable=unused-argument
        """
        Returns the https link corresponding to the uri
        """
        return (
            f'https://storage.googleapis.com/storage/v1/b/{self.container}/o/{self.path}'
            .rstrip('/')
        )

    @override
    def data_auth(
        self,
        data_cred: credentials.DataCredential | None = None,
        access_type: common.AccessType | None = None,
    ):
        """
        Validates if the data is valid for the backend
        """
        if _skip_data_auth():
            return

        if data_cred is None:
            data_cred = self.resolved_data_credential

        match data_cred:
            case credentials.StaticDataCredential():
                s3_client = s3.create_client(
                    data_cred=data_cred,
                    scheme=self.scheme,
                    endpoint_url=self.auth_endpoint,
                    region=self.region(data_cred),
                )
            case credentials.DefaultDataCredential():
                # TODO: Implement Google Cloud Storage DAL for keyless authentication
                raise NotImplementedError(
                    'Default data credentials are not supported for GS backend yet')
            case _ as unreachable:
                assert_never(unreachable)

        # TODO: Have more detailed validation for different access types
        def _validate_auth():
            if self.container:
                s3_client.head_bucket(Bucket=self.container)
            else:
                s3_client.list_buckets(MaxBuckets=1)

        try:
            _ = client.execute_api(_validate_auth, s3.S3ErrorHandler())
        except client.OSMODataStorageClientError as err:
            raise osmo_errors.OSMOCredentialError(
                f'Data key validation error: {err.message}: {err.__cause__}')

    # TODO: Figure out how to correctly find region
    @override
    def region(
        self,
        data_cred: credentials.DataCredential | None = None,
    ) -> str:
        """
        Infer the region of the bucket via provided credentials.
        """
        if data_cred is None:
            data_cred = self.resolved_data_credential

        return data_cred.region or constants.DEFAULT_GS_REGION


class TOSBackend(Boto3Backend):
    """
    Bytedance Torch Object Storage Backend

    https://docs.byteplus.com/en/docs/tos/docs-compatibility-with-amazon-s3#appendix-tos-compatible-s3-apis
    """

    scheme: str = pydantic.Field(
        default=common.StorageBackendType.TOS.value,
        const=True,
        description='The scheme of the TOS backend.',
    )

    supports_batch_delete: Literal[True] = pydantic.Field(
        default=True,
        const=True,
        description='Whether the backend supports batch delete.',
    )

    @override
    @classmethod
    def create(
        cls,
        uri: str,
        url_details: parse.ParseResult,
        is_profile: bool = False,
        override_endpoint: str | None = None,
    ) -> 'TOSBackend':
        """
        Constructs a TOSBackend from a URI.

        Expected format: tos://<net_loc>/<bucket>/<path>
        """
        # Validate URI format
        regex = constants.TOS_PROFILE_REGEX if is_profile else constants.TOS_REGEX
        if not re.fullmatch(regex, uri):
            raise osmo_errors.OSMOError(f'Incorrectly formatted TOS URI: {uri}')

        # Parse URI
        parsed_path = _normalize_path(url_details.path)
        split_path = parsed_path.split('/', 2)

        return cls(
            uri=uri,
            netloc=url_details.netloc,
            container='' if is_profile else split_path[1],
            path='' if is_profile or len(split_path) != 3 else split_path[2].lstrip('/'),
            override_endpoint=override_endpoint,
        )

    @override
    @property
    def auth_endpoint(self) -> str:
        return f'https://{self.netloc}'

    @override
    @property
    def profile(self) -> str:
        """
        Used for credentials
        """
        return f'{self.scheme}://{self.netloc}/{self.container}'

    @override
    @property
    def container_uri(self) -> str:
        """
        Returns the uri link that goes up to the container not including the path field
        """
        return f'{self.profile}'

    @override
    def parse_uri_to_link(self, region: str) -> str:
        # pylint: disable=unused-argument
        """
        Returns the https link corresponding to the uri
        """
        return f'https://{self.container}.{self.netloc}/{self.path}'.rstrip('/')

    @override
    def data_auth(
        self,
        data_cred: credentials.DataCredential | None = None,
        access_type: common.AccessType | None = None,
    ):
        """
        Validates if the data is valid for the backend
        """
        if _skip_data_auth():
            return

        if data_cred is None:
            data_cred = self.resolved_data_credential

        match data_cred:
            case credentials.StaticDataCredential():
                s3_client = s3.create_client(
                    data_cred=data_cred,
                    scheme=self.scheme,
                    endpoint_url=self.auth_endpoint,
                    region=self.region(data_cred),
                )
            case credentials.DefaultDataCredential():
                raise NotImplementedError(
                    'Default data credentials are not supported for TOS backend')
            case _ as unreachable:
                assert_never(unreachable)

        def _validate_auth():
            if self.container:
                s3_client.head_bucket(Bucket=self.container)
            else:
                s3_client.list_buckets(MaxBuckets=1)

        try:
            client.execute_api(_validate_auth, s3.S3ErrorHandler())
        except client.OSMODataStorageClientError as err:
            raise osmo_errors.OSMOCredentialError(
                f'Data key validation error: {err.message}: {err.__cause__}')

    @override
    def region(self, _: credentials.DataCredential | None = None) -> str:
        # netloc = tos-s3-<region>.<endpoint>
        return self.netloc[len('tos-s3-'):].split('.')[0]

    @override
    @property
    def default_region(self) -> str:
        return constants.DEFAULT_TOS_REGION


class AzureBlobStorageBackend(common.StorageBackend):
    """
    Azure Blob Storage Backend
    """

    scheme: str = pydantic.Field(
        default=common.StorageBackendType.AZURE.value,
        const=True,
        description='The scheme of the Azure Blob Storage backend.',
    )

    storage_account: str = pydantic.Field(
        ...,
        description='The storage account of the Azure Blob Storage backend.',
    )

    supports_environment_auth: Literal[True] = pydantic.Field(
        default=True,
        const=True,
        description='Whether the backend supports environment authentication.',
    )

    @override
    @classmethod
    def create(
        cls,
        uri: str,
        url_details: parse.ParseResult,
        is_profile: bool = False,
        override_endpoint: str | None = None,
    ) -> 'AzureBlobStorageBackend':
        """
        Constructs a AzureBlobStorageBackend from a URI.

        Expected format: azure://<storage_account>/<container>/<path>
        """
        # Validate URI format
        regex = constants.AZURE_PROFILE_REGEX if is_profile else constants.AZURE_REGEX
        if not re.fullmatch(regex, uri):
            raise osmo_errors.OSMOError(f'Incorrectly formatted Azure URI: {uri}')

        # Parse URI
        parsed_path = _normalize_path(url_details.path)
        split_path = parsed_path.split('/', 2)

        return cls(
            uri=uri,
            netloc=constants.DEFAULT_AZURE_HOST,
            container='' if is_profile else split_path[1],
            path='' if is_profile or len(split_path) != 3 else split_path[2].lstrip('/'),
            storage_account=url_details.netloc,
            override_endpoint=override_endpoint,
        )

    @override
    @property
    def auth_endpoint(self) -> str:
        return f'https://{self.storage_account}.{self.netloc}'

    @override
    @property
    def profile(self) -> str:
        """
        Used for credentials
        """
        return f'{self.scheme}://{self.storage_account}'

    @override
    @property
    def container_uri(self) -> str:
        """
        Returns the uri link that goes up to the container not including the path field
        """
        return f'{self.profile}/{self.container}'

    @override
    def parse_uri_to_link(self, region: str) -> str:
        # pylint: disable=unused-argument
        """
        Returns the https link corresponding to the uri
        """
        return f'{self.endpoint}/{self.container}/{self.path}'.rstrip('/')

    @override
    def data_auth(
        self,
        data_cred: credentials.DataCredential | None = None,
        access_type: common.AccessType | None = None,
    ):
        # pylint: disable=unused-argument
        """
        Validates if the data is valid for the backend
        """
        if _skip_data_auth():
            return

        if data_cred is None:
            data_cred = self.resolved_data_credential

        def _validate_auth():
            with azure.create_client(data_cred) as service_client:
                if self.container:
                    with service_client.get_container_client(self.container) as container_client:
                        container_client.get_container_properties()
                        return
                else:
                    for _ in service_client.list_containers(results_per_page=1):
                        return

            raise client.OSMODataStorageClientError(
                'Data key validation error: No containers accessible with provided credentials',
            )

        try:
            client.execute_api(_validate_auth, azure.AzureErrorHandler())
        except client.OSMODataStorageClientError as err:
            raise osmo_errors.OSMOCredentialError(f'Data auth validation error: {err}')

    @override
    def region(
        self,
        _: credentials.DataCredential | None = None,
    ) -> str:
        # Azure Blob Storage does not encode region in the URLs, we will simply
        # use the default region to conform to the interface.
        return self.default_region

    @override
    @property
    def default_region(self) -> str:
        return constants.DEFAULT_AZURE_REGION

    @override
    def client_factory(
        self,
        data_cred: credentials.DataCredential | None = None,
        request_headers: List[header.RequestHeaders] | None = None,
        **kwargs: Any,
    ) -> azure.AzureBlobStorageClientFactory:
        # pylint: disable=unused-argument
        """
        Returns a factory for creating storage clients.
        """
        if data_cred is None:
            data_cred = self.resolved_data_credential

        return azure.AzureBlobStorageClientFactory(data_cred=data_cred)


def construct_storage_backend(
    uri: str,
    profile: bool = False,
    cache_config: cache.CacheConfig | None = None,
) -> common.StorageBackend:
    """
    Parses a storage backend uri and returns a StorageBackend instance.

    Args:
        uri: The uri to parse.
        profile: Whether the uri is a profile uri.
        cache_config: The cache config to use.

    Returns:
        A StorageBackend instance.
    """
    url_details = parse.urlparse(uri)
    override_endpoint = cache_config.get_cache_endpoint(uri) if cache_config else None

    if url_details.scheme == common.StorageBackendType.SWIFT.value:
        return SwiftBackend.create(
            uri=uri,
            url_details=url_details,
            is_profile=profile,
            override_endpoint=override_endpoint,
        )

    elif url_details.scheme == common.StorageBackendType.S3.value:
        return S3Backend.create(
            uri=uri,
            url_details=url_details,
            is_profile=profile,
            override_endpoint=override_endpoint,
        )

    elif url_details.scheme == common.StorageBackendType.GS.value:
        return GSBackend.create(
            uri=uri,
            url_details=url_details,
            is_profile=profile,
            override_endpoint=override_endpoint,
        )

    elif url_details.scheme == common.StorageBackendType.TOS.value:
        return TOSBackend.create(
            uri=uri,
            url_details=url_details,
            is_profile=profile,
            override_endpoint=override_endpoint,
        )

    elif url_details.scheme == common.StorageBackendType.AZURE.value:
        return AzureBlobStorageBackend.create(
            uri=uri,
            url_details=url_details,
            is_profile=profile,
            override_endpoint=override_endpoint,
        )

    raise osmo_errors.OSMOError(f'Unknown URI scheme: {url_details.scheme}')
