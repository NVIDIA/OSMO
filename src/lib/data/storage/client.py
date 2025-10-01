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
The client module provides a unified interface for working with data in a remote storage.
"""

import functools
import logging
import os
import collections.abc
from typing import Dict, Generator, List, Literal, TypedDict, overload
from typing_extensions import assert_never, Self, Unpack

import pydantic

from . import (
    backends,
    common,
    copying,
    deleting,
    downloading,
    streaming,
    listing,
    metrics,
    uploading,
)
from .backends import common as backends_common
from .core import executor, header
from .. import constants
from ...utils import (
    cache,
    client_configs,
    credentials,
    logging as logging_utils,
    osmo_errors,
    paths,
)

logger = logging.getLogger(__name__)


class OptionalParams(TypedDict, total=False):
    """
    Optional parameters for the storage client.
    """
    metrics_dir: str | None
    enable_progress_tracker: bool
    logging_level: int
    executor_params: executor.ExecutorParameters
    cache_config: cache.CacheConfig | None
    headers: Dict[str, str] | None


@logging_utils.scope_logging
class Client(pydantic.BaseModel):
    """
    A storage client that can be used to perform data operations against a remote storage.

    :param str storage_uri: The URI of the remote storage this client will operate against.
    :param str | None metrics_dir: The path to the metrics output directory.
    :param bool enable_progress_tracker: Whether to enable progress tracking.
    :param int logging_level: The logging level for the storage client.
    :param ExecutorParameters executor_params: The executor parameters for the storage client.
    :param credentials.DataCredential | None data_credential: Remote storage data credentials.
    :param cache.CacheConfig | None cache_config: Remote storage cache configuration.
    :param Dict[str, str] | None headers: Headers to apply to all requests of this client.

    .. note::
        If no data credential is provided, the client will attempt to resolve it from the
        file system.
    """

    class Config:
        extra = pydantic.Extra.forbid
        frozen = True
        keep_untouched = (functools.cached_property,)

    #########################
    #    Factory methods    #
    #########################

    @overload
    @classmethod
    def create(
        cls,
        *,
        storage_uri: str,
        data_credential: credentials.DataCredential | None = None,
        scope_to_container: bool = False,
        **kwargs: Unpack[OptionalParams],
    ) -> Self:
        ...

    @overload
    @classmethod
    def create(
        cls,
        *,
        storage_backend: backends_common.StorageBackend,
        data_credential: credentials.DataCredential | None = None,
        scope_to_container: bool = False,
        **kwargs: Unpack[OptionalParams],
    ) -> Self:
        ...

    @overload
    @classmethod
    def create(
        cls,
        *,
        data_credential: credentials.DataCredential,
        scope_to_container: bool = False,
        **kwargs: Unpack[OptionalParams],
    ) -> Self:
        ...

    @classmethod
    def create(
        cls,
        *,
        storage_uri: str | None = None,
        storage_backend: backends_common.StorageBackend | None = None,
        data_credential: credentials.DataCredential | None = None,
        scope_to_container: bool = False,
        **kwargs: Unpack[OptionalParams],
    ) -> Self:
        """
        Creates a new storage client from given parameters.

        .. important::
            Either storage_uri or storage_backend must be provided, not both.

        .. important::
            If data_credential is not provided, it will be resolved from the file system.

        :param str | None storage_uri: The storage URI to use for the client.
        :param backends_common.StorageBackend | None storage_backend: The storage backend to use for
                                                                      the client.
        :param credentials.DataCredential | None data_credential: The data credential to use for
                                                                  the client.
        :param bool scope_to_container: Whether to scope the client to the container.
        :param Unpack[OptionalParams] kwargs: Optional parameters to pass to the client.

        :return: A new storage client.
        :rtype: Client
        """
        if (
            data_credential is None and
            storage_uri is None and
            storage_backend is None
        ):
            raise osmo_errors.OSMOUsageError(
                'One of (data_credential, storage_uri, storage_backend) must be provided',
            )

        if storage_backend is not None and storage_uri is not None:
            raise osmo_errors.OSMOUsageError(
                'Either storage_backend or storage_uri can be provided, not both',
            )

        if storage_uri is None:
            if storage_backend is not None:
                storage_uri = storage_backend.uri

            elif data_credential is not None:
                storage_uri = data_credential.endpoint

            assert storage_uri is not None

        # Scope the storage_uri to the container if requested.
        if scope_to_container:
            storage_backend = backends.construct_storage_backend(
                uri=storage_uri,
                cache_config=kwargs.get('cache_config', None),
            )
            storage_uri = storage_backend.container_uri

        client = cls(
            storage_uri=storage_uri,
            data_credential_input=data_credential,
            **kwargs,
        )

        # Eagerly validate the data credential.
        _ = client.data_credential

        return client

    #########################
    #    Required fields    #
    #########################

    storage_uri: str = pydantic.Field(
        ...,
        regex=constants.STORAGE_BACKEND_REGEX,
        description='The URI of the remote storage this instance of storage Client will '
                    'operate against. Must point to a valid container.',
    )

    #########################
    #    Optional fields    #
    #########################

    metrics_dir: str | None = pydantic.Field(
        default=None,
        description='The path to the metrics output directory.',
    )

    enable_progress_tracker: bool = pydantic.Field(
        default=False,
        description='Whether to enable progress tracking.',
    )

    logging_level: int = pydantic.Field(
        default=logging.ERROR,
        description='The logging level for the storage client.',
    )

    executor_params: executor.ExecutorParameters = pydantic.Field(
        default=executor.ExecutorParameters(),
        description='The executor parameters for the storage client.',
    )

    data_credential_input: credentials.DataCredential | None = pydantic.Field(
        default=None,
        description='Remote storage data credentials.',
    )

    cache_config: cache.CacheConfig | None = pydantic.Field(
        default=None,
        description='Remote storage cache configuration.',
    )

    headers: Dict[str, str] | None = pydantic.Field(
        default=None,
        description='Headers to apply to all requests of this client.',
    )

    @functools.cached_property
    def data_credential(self) -> credentials.DataCredential:
        """
        Resolves the data credential.
        """
        # Validate data credential input if provided.
        if self.data_credential_input is not None:
            # Validate that the data credential endpoint matches the storage backend profile.
            data_cred_backend = backends.construct_storage_backend(
                uri=self.data_credential_input.endpoint,
                cache_config=self.cache_config,
            )
            if data_cred_backend.profile != self.storage_backend.profile:
                raise osmo_errors.OSMOCredentialError(
                    'Credential endpoint must match the storage backend profile')

        return (
            self.data_credential_input or
            client_configs.get_credentials(self.storage_backend.profile)
        )

    @functools.cached_property
    def storage_backend(self) -> backends_common.StorageBackend:
        """
        Storage backend.

        :return: The path components of the storage backend.
        :rtype: backends_common.StorageBackend
        """
        return backends.construct_storage_backend(
            uri=self.storage_uri,
            cache_config=self.cache_config,
        )

    @functools.cached_property
    def storage_auth(self) -> common.StorageAuth:
        """
        Storage backend authentication parameters.

        :return: The storage authentication parameters
        :rtype: common.StorageAuth
        """
        return common.StorageAuth(
            user=self.data_credential.access_key_id,
            key=self.data_credential.access_key.get_secret_value()
        )

    def _validate_remote_path(
        self,
        remote_path: str | None,
    ) -> str:
        """
        Validates and resolves the remote path.
        """
        if not remote_path:
            return self.storage_backend.path

        elif remote_path == self.storage_uri:
            return self.storage_backend.path

        elif remote_path == self.storage_backend.path:
            return remote_path

        elif remote_path[0] == '/':
            raise osmo_errors.OSMOUsageError(
                'Remote path cannot start with leading slash')

        elif '://' in remote_path:
            # Validate absolute remote paths
            remote_path_components = backends.construct_storage_backend(
                uri=remote_path,
                cache_config=self.cache_config,
            )

            if remote_path_components not in self.storage_backend:
                raise osmo_errors.OSMOUsageError(
                    f'Client storage backend: {self.storage_backend.uri} does not contain '
                    f'remote path: {remote_path}',
                )

            return remote_path_components.path

        else:
            return os.path.join(self.storage_backend.path, remote_path)

    ####################
    #      UPLOAD      #
    ####################

    @overload
    def upload_objects(
        self,
        source: str,
        *,
        destination_prefix: str | None = None,
        destination_name: str | None = None,
        regex: str | None = None,
        resume: bool = False,
        callback: uploading.UploadCallbackLike | None = None,
        extra_headers: Dict[str, str] | None = None,
    ) -> uploading.UploadSummary:
        ...

    @overload
    def upload_objects(
        self,
        source: List[str],
        *,
        destination_prefix: str | None = None,
        regex: str | None = None,
        resume: bool = False,
        callback: uploading.UploadCallbackLike | None = None,
        extra_headers: Dict[str, str] | None = None,
    ) -> uploading.UploadSummary:
        ...

    def upload_objects(
        self,
        source: str | List[str],
        *,
        destination_prefix: str | None = None,
        destination_name: str | None = None,
        regex: str | None = None,
        resume: bool = False,
        callback: uploading.UploadCallbackLike | None = None,
        extra_headers: Dict[str, str] | None = None,
    ) -> uploading.UploadSummary:
        """
        Uploads the specified local file or directory.

        .. important::
            destination_name remapping is only supported for a single source.

        :param str | List[str] source: The path to the local file or directory to be uploaded to
                                       the remote storage.
        :param str | None destination_prefix: The path to the remote storage prefix.
                                              If not provided, defaults to the client storage URI.
        :param str | None destination_name: The new name of the uploaded target. If not provided,
                                            defaults to the basename of the source.
        :param str | None regex: The regular expression used to filter files to upload.
                                 Defaults to `None`.
        :param bool resume: Whether a previous upload was resumed. Defaults to False.
        :param UploadCallbackLike | None callback: A callback function to be called after each
                                                   file is uploaded. Defaults to `None`.
        :param Dict[str, str] | None extra_headers: Additional headers to pass to the upload
                                                       operation. Defaults to `None`.

        :return: A summary of the upload operation.
        :rtype: uploading.UploadSummary
        """
        match source:
            case str():
                if destination_name is not None and source.endswith('/*'):
                    raise osmo_errors.OSMOUsageError(
                        'Destination name remapping is not supported for source '
                        'that ends with "/*"',
                    )

                return self._upload_with_paths(
                    source_paths=[source],
                    destination_prefix=destination_prefix,
                    destination_name=destination_name,
                    regex=regex,
                    resume=resume,
                    executor_params=self.executor_params,
                    callback=callback,
                    extra_headers=extra_headers,
                )
            case list():
                if destination_name is not None:
                    raise osmo_errors.OSMOUsageError(
                        'Destination name remapping is not supported for multiple sources',
                    )

                return self._upload_with_paths(
                    source_paths=source,
                    destination_prefix=destination_prefix,
                    destination_name=None,
                    regex=regex,
                    resume=resume,
                    executor_params=self.executor_params,
                    callback=callback,
                    extra_headers=extra_headers,
                )
            case _ as unreachable:
                assert_never(unreachable)

    @metrics.metered('upload_objects')
    def _upload_with_paths(
        self,
        source_paths: List[str],
        destination_prefix: str | None,
        destination_name: str | None,
        regex: str | None,
        resume: bool,
        executor_params: executor.ExecutorParameters,
        callback: uploading.UploadCallbackLike | None,
        extra_headers: Dict[str, str] | None,
    ) -> uploading.UploadSummary:
        """
        Uploads data using a list of source and destination paths.
        """
        if (
            executor_params.resolved_num_processes > 1 and
            callback is not None and
            not executor.validate_picklable(callback)
        ):
            # Validate that the callback is picklable if used in a multiprocessed operation.
            raise osmo_errors.OSMOUsageError('Callback is not picklable')

        upload_paths: List[uploading.UploadPath] = []

        remote_prefix = self._validate_remote_path(destination_prefix)

        for upload_path in source_paths:
            resolved_local_path = paths.resolve_local_path(upload_path)
            upload_paths.append(
                uploading.UploadPath(
                    source=resolved_local_path,
                    destination=common.RemotePath(
                        container=self.storage_backend.container,
                        prefix=remote_prefix,
                        name=destination_name,
                    ),
                ),
            )

        # Add upload headers if provided.
        request_headers: List[header.RequestHeaders] = []
        if self.headers:
            request_headers.append(header.ClientHeaders(headers=self.headers))
        if extra_headers:
            request_headers.append(header.UploadRequestHeaders(headers=extra_headers))

        client_factory = self.storage_backend.client_factory(
            access_key_id=self.storage_auth.user,
            access_key=self.storage_auth.key,
            region=self.data_credential.region,
            request_headers=request_headers,
        )

        upload_result = uploading.upload_objects(
            client_factory,
            uploading.UploadParams(
                upload_paths=upload_paths,
                regex=regex,
                resume=resume,
                enable_progress_tracker=self.enable_progress_tracker,
                executor_params=executor_params,
                callback=callback,
            ),
        )

        logger.info('Data has been uploaded')
        if upload_result.retries:
            logger.info('Retried %d times', upload_result.retries)

        if upload_result.failures:
            logger.error('Upload Failed on files:')
            for message in upload_result.failures:
                logger.error(message)

        return upload_result

    @overload
    def upload_with_worker_inputs(
        self,
        source: List[uploading.UploadWorkerInput],
        *,
        extra_headers: Dict[str, str] | None = None,
    ) -> uploading.UploadSummary:
        ...

    @overload
    def upload_with_worker_inputs(
        self,
        source: Generator[uploading.UploadWorkerInput, None, None],
        *,
        extra_headers: Dict[str, str] | None = None,
    ) -> uploading.UploadSummary:
        ...

    def upload_with_worker_inputs(
        self,
        source: (
            List[uploading.UploadWorkerInput] |
            Generator[uploading.UploadWorkerInput, None, None]
        ),
        *,
        extra_headers: Dict[str, str] | None = None,
    ) -> uploading.UploadSummary:
        """
        Uploads data using UploadWorkerInput objects.

        :param List[UploadWorkerInput] | Generator[UploadWorkerInput, None, None] source:
            A list of UploadWorkerInput objects or a generator of UploadWorkerInput objects.
        :param Dict[str, str] | None extra_headers: Extra headers to add to the request.

        :return: A summary of the upload operation.
        :rtype: uploading.UploadSummary
        """
        match source:
            case list():
                return self._upload_with_worker_inputs(
                    upload_params=uploading.UploadParams(
                        upload_worker_inputs=source,
                        enable_progress_tracker=self.enable_progress_tracker,
                        executor_params=self.executor_params,
                    ),
                    extra_headers=extra_headers,
                )
            case collections.abc.Generator():
                return self._upload_with_worker_inputs(
                    upload_params=uploading.UploadParams(
                        upload_worker_inputs_generator=source,
                        enable_progress_tracker=self.enable_progress_tracker,
                        executor_params=self.executor_params,
                    ),
                    extra_headers=extra_headers,
                )
            case _ as unreachable:
                assert_never(unreachable)

    @metrics.metered('upload_objects')
    def _upload_with_worker_inputs(
        self,
        upload_params: uploading.UploadParams,
        extra_headers: Dict[str, str] | None,
    ) -> uploading.UploadSummary:
        """
        Uploads data using a list of UploadWorkerInput objects.
        """
        # Add upload headers if provided.
        request_headers: List[header.RequestHeaders] = []
        if self.headers:
            request_headers.append(header.ClientHeaders(headers=self.headers))
        if extra_headers:
            request_headers.append(header.UploadRequestHeaders(headers=extra_headers))

        client_factory = self.storage_backend.client_factory(
            access_key_id=self.storage_auth.user,
            access_key=self.storage_auth.key,
            region=self.data_credential.region,
            request_headers=request_headers,
        )

        upload_result = uploading.upload_objects(
            client_factory,
            upload_params,
        )

        logger.info('Data has been uploaded')
        if upload_result.retries:
            logger.info('Retried %d times', upload_result.retries)

        if upload_result.failures:
            logger.error('Upload Failed on files:')
            for message in upload_result.failures:
                logger.error(message)

        return upload_result

    ####################
    #       COPY       #
    ####################

    @overload
    def copy_objects(
        self,
        destination_prefix: str,
        *,
        destination_name: str | None = None,
        source: str | None = None,
        regex: str | None = None,
    ) -> copying.CopySummary:
        ...

    @overload
    def copy_objects(
        self,
        destination_prefix: str,
        *,
        source: List[str],
        regex: str | None = None,
    ) -> copying.CopySummary:
        ...

    def copy_objects(
        self,
        destination_prefix: str,
        *,
        destination_name: str | None = None,
        source: str | List[str] | None = None,
        regex: str | None = None,
    ) -> copying.CopySummary:
        """
        Copies remote path(s) to a new location.

        :param str destination_prefix: The path to the remote destination prefix.
        :param str | None destination_name: The new name of the copied target. If not provided,
                                            defaults to the basename of the source.
        :param str | None source: The path to the remote source. If not provided, defaults to the
                                  client storage URI.
        :param str | None regex: The regular expression used to filter files to copy.
                                    Defaults to `None`.

        :return: A summary of the copy operation.
        :rtype: copying.CopySummary
        """
        match source:
            case None | '' | []:
                return self._copy_with_paths(
                    source_paths=[''],
                    destination_prefix=destination_prefix,
                    destination_name=destination_name,
                    regex=regex,
                )
            case str():
                if destination_name is not None and source.endswith('/*'):
                    raise osmo_errors.OSMOUsageError(
                        'Destination name remapping is not supported for source '
                        'that ends with "/*"',
                    )

                return self._copy_with_paths(
                    source_paths=[source],
                    destination_prefix=destination_prefix,
                    destination_name=destination_name,
                    regex=regex,
                )
            case list():
                if destination_name is not None:
                    raise osmo_errors.OSMOUsageError(
                        'Destination name remapping is not supported for multiple sources',
                    )

                return self._copy_with_paths(
                    source_paths=source,
                    destination_prefix=destination_prefix,
                    destination_name=None,
                    regex=regex,
                )

    @metrics.metered('copy_objects')
    def _copy_with_paths(
        self,
        source_paths: List[str],
        destination_prefix: str,
        destination_name: str | None,
        regex: str | None,
    ) -> copying.CopySummary:
        """
        Copies a remote path to a new location.
        """
        copy_source_paths: List[common.RemotePath] = []

        remote_destination_prefix = self._validate_remote_path(destination_prefix)

        copy_destination_path = common.RemotePath(
            container=self.storage_backend.container,
            prefix=remote_destination_prefix,
            name=destination_name,
        )

        for source_path in source_paths:
            remote_source_path = self._validate_remote_path(source_path)
            copy_source_paths.append(
                common.RemotePath(
                    container=self.storage_backend.container,
                    prefix=remote_source_path,
                ),
            )

        client_factory = self.storage_backend.client_factory(
            access_key_id=self.storage_auth.user,
            access_key=self.storage_auth.key,
            region=self.data_credential.region,
            request_headers=[
                header.ClientHeaders(headers=self.headers),
            ] if self.headers else None,
        )

        copy_result = copying.copy_objects(
            client_factory,
            copying.CopyParams(
                source=copy_source_paths,
                destination=copy_destination_path,
                enable_progress_tracker=self.enable_progress_tracker,
                executor_params=self.executor_params,
                regex=regex,
            ),
        )

        logger.info('Data has been copied')
        if copy_result.retries:
            logger.info('Retried %d times', copy_result.retries)

        if copy_result.failures:
            logger.error('Copy Failed on files:')
            for message in copy_result.failures:
                logger.error(message)

        return copy_result

    ######################
    #      DOWNLOAD      #
    ######################

    @overload
    def download_objects(
        self,
        destination: str,
        *,
        regex: str | None = None,
        resume: bool = False,
    ) -> downloading.DownloadSummary:
        ...

    @overload
    def download_objects(
        self,
        destination: str,
        *,
        source: str,
        regex: str | None = None,
        resume: bool = False,
    ) -> downloading.DownloadSummary:
        ...

    @overload
    def download_objects(
        self,
        destination: str,
        *,
        source: List[str],
        regex: str | None = None,
        resume: bool = False,
    ) -> downloading.DownloadSummary:
        ...

    def download_objects(
        self,
        destination: str,
        *,
        source: str | List[str] | None = None,
        regex: str | None = None,
        resume: bool = False,
    ) -> downloading.DownloadSummary:
        """
        Downloads remote path(s) to a local path.

        :param str | List[str] | None source: The path to download. If not provided, defaults to the
                                              client storage URI.
        :param str destination: The path to the local download destination.
        :param str | None regex: The regular expression used to filter files to download.
                                 Defaults to `None`.
        :param bool resume: Whether a previous download was resumed. Defaults to False.

        :return: A summary of the download operation.
        :rtype: DownloadSummary
        """
        match source:
            case None | '' | []:
                return self._download_with_paths(
                    destination_path=destination,
                    source_paths=[self.storage_backend.path],
                    regex=regex,
                    resume=resume,
                    executor_params=self.executor_params,
                )
            case str():
                return self._download_with_paths(
                    destination_path=destination,
                    source_paths=[source],
                    regex=regex,
                    resume=resume,
                    executor_params=self.executor_params,
                )
            case list():
                return self._download_with_paths(
                    destination_path=destination,
                    source_paths=source,
                    regex=regex,
                    resume=resume,
                    executor_params=self.executor_params,
                )
            case _ as unreachable:
                assert_never(unreachable)

    @metrics.metered('download_objects')
    def _download_with_paths(
        self,
        destination_path: str,
        source_paths: List[str],
        regex: str | None,
        resume: bool,
        executor_params: executor.ExecutorParameters,
    ) -> downloading.DownloadSummary:
        """
        Downloads data using a list of source and destination paths.
        """
        if not destination_path:
            raise osmo_errors.OSMOUsageError('Download destination is required')

        download_paths: List[downloading.DownloadPath] = []

        # Resolve the local path
        local_path = paths.resolve_local_path(destination_path)

        for source_path in source_paths:
            # Resolve the remote path
            remote_path = self._validate_remote_path(source_path)

            download_paths.append(
                downloading.DownloadPath(
                    source=common.RemotePath(
                        container=self.storage_backend.container,
                        prefix=remote_path,
                    ),
                    destination=local_path,
                ),
            )

        client_factory = self.storage_backend.client_factory(
            access_key_id=self.storage_auth.user,
            access_key=self.storage_auth.key,
            region=self.data_credential.region,
            request_headers=[
                header.ClientHeaders(headers=self.headers),
            ] if self.headers else None,
        )

        download_result = downloading.download_objects(
            client_factory,
            downloading.DownloadParams(
                download_paths=download_paths,
                regex=regex,
                resume=resume,
                executor_params=executor_params,
                enable_progress_tracker=self.enable_progress_tracker,
            ),
        )

        logger.info('Data has been downloaded')
        if download_result.retries:
            logger.info('Retried %d times', download_result.retries)

        if download_result.failures:
            logger.error('Download Failed on files:')
            for message in download_result.failures:
                logger.error(message)

        return download_result

    @overload
    def download_with_worker_inputs(
        self,
        source: List[downloading.DownloadWorkerInput],
    ) -> downloading.DownloadSummary:
        ...

    @overload
    def download_with_worker_inputs(
        self,
        source: Generator[downloading.DownloadWorkerInput, None, None],
    ) -> downloading.DownloadSummary:
        ...

    def download_with_worker_inputs(
        self,
        source: (
            List[downloading.DownloadWorkerInput] |
            Generator[downloading.DownloadWorkerInput, None, None]
        ),
    ) -> downloading.DownloadSummary:
        """
        Downloads using DownloadWorkerInput objects. This is a low-level API where the
        caller is responsible for providing the DownloadWorkerInput objects.

        :param List[DownloadWorkerInput] | Generator[DownloadWorkerInput, None, None] source:
            The list or generator of download worker input objects.

        :return: A summary of the download operation.
        :rtype: DownloadSummary
        """
        match source:
            case list():
                return self._download_with_worker_inputs(
                    download_params=downloading.DownloadParams(
                        download_worker_inputs=source,
                        enable_progress_tracker=self.enable_progress_tracker,
                        executor_params=self.executor_params,
                    ),
                )
            case collections.abc.Generator():
                return self._download_with_worker_inputs(
                    download_params=downloading.DownloadParams(
                        download_worker_inputs_generator=source,
                        enable_progress_tracker=self.enable_progress_tracker,
                        executor_params=self.executor_params,
                    ),
                )
            case _ as unreachable:
                assert_never(unreachable)

    @metrics.metered('download_objects')
    def _download_with_worker_inputs(
        self,
        download_params: downloading.DownloadParams,
    ) -> downloading.DownloadSummary:
        """
        Downloads data using a list of DownloadWorkerInput objects.
        """
        client_factory = self.storage_backend.client_factory(
            access_key_id=self.storage_auth.user,
            access_key=self.storage_auth.key,
            region=self.data_credential.region,
            request_headers=[
                header.ClientHeaders(headers=self.headers),
            ] if self.headers else None,
        )

        download_result = downloading.download_objects(
            client_factory,
            download_params,
        )

        logger.info('Data has been downloaded')
        if download_result.retries:
            logger.info('Retried %d times', download_result.retries)

        if download_result.failures:
            logger.error('Download Failed on files:')
            for message in download_result.failures:
                logger.error(message)

        return download_result

    #####################
    #      LISTING      #
    #####################

    def list_objects(
        self,
        *,
        prefix: str | None = None,
        regex: str | None = None,
        recursive: bool = True,
    ) -> listing.ListStream:
        """
        Retrieves a generator of objects from a remote URI.

        :param str | None prefix: The prefix used to filter objects.
        :param str | None regex: The regular expression used to filter objects.
        :param bool recursive: Whether to list recursively.

        :return: A generator of :py:class:`ListResult` found at the remote URI
        :rtype: ListStream
        """
        list_params = listing.ListParams(
            container_uri=self.storage_backend.container_uri,
            container=self.storage_backend.container,
            prefix=os.path.join(self.storage_backend.path, prefix or ''),
            regex=regex,
            recursive=recursive,
        )

        client_factory = self.storage_backend.client_factory(
            access_key_id=self.storage_auth.user,
            access_key=self.storage_auth.key,
            region=self.data_credential.region,
            request_headers=[
                header.ClientHeaders(headers=self.headers),
            ] if self.headers else None,
        )

        return listing.list_objects(
            client_factory,
            list_params,
        )

    ###############################
    #      Get Object Stream      #
    ###############################

    @overload
    def get_object_stream(
        self,
        remote_path: str,
    ) -> streaming.BytesStream:
        ...

    @overload
    def get_object_stream(
        self,
        remote_path: str,
        offset: int,
        *,
        length: int | None = None,
    ) -> streaming.BytesStream:
        ...

    @overload
    def get_object_stream(
        self,
        remote_path: str,
        *,
        as_lines: Literal[True],
    ) -> streaming.LinesStream:
        ...

    @overload
    def get_object_stream(
        self,
        remote_path: str,
        *,
        last_n_lines: int,
        as_lines: Literal[True] = True,
    ) -> streaming.LinesStream:
        ...

    @overload
    def get_object_stream(
        self,
        remote_path: str,
        *,
        as_io: Literal[True],
    ) -> streaming.BytesIO:
        ...

    def get_object_stream(
        self,
        remote_path: str | None = None,
        offset: int | None = None,
        *,
        as_io: bool = False,
        as_lines: bool = False,
        length: int | None = None,
        last_n_lines: int | None = None,
    ) -> streaming.BytesStream | streaming.LinesStream | streaming.BytesIO:
        """
        Fetches the file as a stream of bytes, lines, or file-like object.

        :param str remote_path: The remote path to fetch.
        :param int | None offset: The offset to start fetching from.
        :param bool as_io: Whether to fetch the file as a file-like object.
        :param bool as_lines: Whether to fetch the file as a stream of lines.
        :param int | None length: The length of the data to fetch.
        :param int | None last_n_lines: The number of lines to fetch from the end of the file.

        :return: A stream of bytes from the remote path.
        :rtype: streaming.BytesStream | streaming.LinesStream | streaming.BytesIO
        """
        validated_remote_path = self._validate_remote_path(remote_path)

        client_factory = self.storage_backend.client_factory(
            access_key_id=self.storage_auth.user,
            access_key=self.storage_auth.key,
            region=self.data_credential.region,
            request_headers=[
                header.ClientHeaders(headers=self.headers),
            ] if self.headers else None,
        )

        # Handle different fetch options

        # Last N Lines stream
        if last_n_lines is not None:
            return streaming.stream_object(
                client_factory,
                streaming.StreamParams(
                    container=self.storage_backend.container,
                    key=validated_remote_path,
                    options=streaming.LastNLinesStream(last_n_lines=last_n_lines),
                ),
                # Always stream as lines for last_n_lines fetches
                stream_lines=streaming.StreamLines(),
            )

        # Offset Fetch
        if offset is not None:
            return streaming.stream_object(
                client_factory,
                streaming.StreamParams(
                    container=self.storage_backend.container,
                    key=validated_remote_path,
                    options=streaming.OffsetStream(offset=offset, length=length),
                ),
                # Never stream as lines for offset fetches
            )

        # Full Fetch
        stream_params = streaming.StreamParams(
            container=self.storage_backend.container,
            key=validated_remote_path,
            options=streaming.FullStream(),
        )

        if as_lines:
            return streaming.stream_object(
                client_factory,
                stream_params,
                stream_lines=streaming.StreamLines(),
            )
        elif as_io:
            return streaming.stream_object(
                client_factory,
                stream_params,
                as_io=True,
            )
        else:
            return streaming.stream_object(
                client_factory,
                stream_params,
            )

    ####################
    #      DELETE      #
    ####################

    def delete_objects(
        self,
        *,
        prefix: str | None = None,
        regex: str | None = None,
    ) -> deleting.DeleteSummary:
        """
        Deletes all content at the remote URI.

        .. warning::
            If no prefix is provided, the entire storage URI (and everything under it)
            will be deleted.

        :param str | None prefix: The prefix used to filter objects.
        :param str | None regex: The regular expression used to filter objects.

        :return: A summary of the delete operation.
        :rtype: DeleteSummary
        """
        delete_prefix = self._validate_remote_path(prefix)

        delete_params = deleting.DeleteParams(
            container=self.storage_backend.container,
            prefix=delete_prefix,
            regex=regex,
        )

        client_factory = self.storage_backend.client_factory(
            access_key_id=self.storage_auth.user,
            access_key=self.storage_auth.key,
            region=self.data_credential.region,
            request_headers=[
                header.ClientHeaders(headers=self.headers),
            ] if self.headers else None,
        )

        delete_result = deleting.delete_objects(
            client_factory,
            delete_params,
        )

        logger.info('Data has been deleted, success_count=%d, failures=%d',
                    delete_result.success_count,
                    len(delete_result.failures))

        for message in delete_result.failures:
            logger.error(message)

        return delete_result


class SingleObjectClient(pydantic.BaseModel):
    """
    A client for performing operations on a SINGLE object.

    This is a thin wrapper around the Client class to provide a more convenient interface for
    interacting with a single object.
    """

    class Config:
        extra = pydantic.Extra.forbid
        frozen = True

    @overload
    @classmethod
    def create(
        cls,
        *,
        storage_uri: str,
        data_credential: credentials.DataCredential | None = None,
        **kwargs: Unpack[OptionalParams],
    ) -> Self:
        ...

    @overload
    @classmethod
    def create(
        cls,
        *,
        storage_backend: backends_common.StorageBackend,
        data_credential: credentials.DataCredential | None = None,
        **kwargs: Unpack[OptionalParams],
    ) -> Self:
        ...

    @classmethod
    def create(
        cls,
        *,
        storage_uri: str | None = None,
        storage_backend: backends_common.StorageBackend | None = None,
        data_credential: credentials.DataCredential | None = None,
        **kwargs: Unpack[OptionalParams],
    ) -> Self:
        """
        Creates a new object client from given parameters.

        .. important::
            Either storage_uri or storage_backend must be provided, not both.

        .. important::
            If data_credential is not provided, it will be resolved from the file system.

        :param str | None storage_uri: The object URI to use for the client.
        :param backends_common.StorageBackend | None storage_backend: The object storage backend to
                                                                      use for the client.
        :param credentials.DataCredential | None data_credential: The data credential to
                                                                  use for the client.
        :param Unpack[OptionalParams] kwargs: Optional parameters to pass to the client.

        :return: A new object client.
        :rtype: ObjectClient
        """
        if sum([
            storage_uri is None,
            storage_backend is None,
        ]) != 1:
            raise osmo_errors.OSMOUsageError(
                'Either storage_uri OR storage_backend must be provided',
            )

        if storage_uri is not None:
            storage_backend = backends.construct_storage_backend(
                uri=storage_uri,
                cache_config=kwargs.get('cache_config', None),
            )

        assert storage_backend is not None

        if storage_backend.path.endswith('/'):
            raise osmo_errors.OSMOUsageError(
                f'Object URI cannot end with a slash: {storage_backend.uri}')

        # Remove the object name from the path
        object_name = os.path.basename(storage_backend.path)
        if not object_name:
            raise osmo_errors.OSMOUsageError('Object URI must contain a basename')

        storage_uri = os.path.dirname(storage_backend.uri)

        # Scope the storage client to the storage prefix (not including the object name)
        storage_client = Client.create(
            storage_uri=storage_uri,
            data_credential=data_credential or None,
            **kwargs,
        )

        return cls(
            object_name=object_name,
            storage_client=storage_client,
        )

    object_name: str = pydantic.Field(
        ...,
        description='The basename of the object in the remote storage.',
    )

    storage_client: Client = pydantic.Field(
        ...,
        description='The storage client to use for performing operations on the object.',
    )

    def upload_object(
        self,
        source: str,
        *,
        resume: bool = False,
        callback: uploading.UploadCallbackLike | None = None,
        extra_headers: Dict[str, str] | None = None,
    ) -> uploading.UploadSummary:
        """
        Uploads the object to the remote storage.

        :param str source: The path to the local file to be uploaded to the remote storage.
        :param bool resume: Whether a previous upload was resumed. Defaults to False.
        :param UploadCallbackLike | None callback: A callback function to be called after each
                                                   file is uploaded. Defaults to `None`.
        :param Dict[str, str] | None extra_headers: Additional headers to pass to the upload
                                                    operation. Defaults to `None`.

        :return: A summary of the upload operation.
        :rtype: uploading.UploadSummary
        """
        if source.endswith('/*'):
            raise osmo_errors.OSMOUsageError(
                f'Source cannot end with "/*" in ObjectClient.upload_object(): {source}',
            )

        return self.storage_client.upload_objects(
            source=source,
            destination_name=self.object_name,
            resume=resume,
            callback=callback,
            extra_headers=extra_headers,
        )

    def copy_object(
        self,
        destination_prefix: str,
        *,
        destination_name: str | None = None,
    ) -> copying.CopySummary:
        """
        Copies the object to the remote storage.
        """
        return self.storage_client.copy_objects(
            destination_prefix=destination_prefix,
            destination_name=destination_name,
        )

    def download_object(
        self,
        destination: str,
        *,
        resume: bool = False,
    ) -> downloading.DownloadSummary:
        """
        Downloads the object to a local path.

        :param str destination: The path to the local download destination.
        :param bool resume: Whether a previous download was resumed. Defaults to False.

        :return: A summary of the download operation.
        :rtype: downloading.DownloadSummary
        """
        return self.storage_client.download_objects(
            destination=destination,
            resume=resume,
        )

    @overload
    def get_object_stream(self) -> streaming.BytesStream:
        ...

    @overload
    def get_object_stream(
        self,
        offset: int,
        *,
        length: int | None = None,
    ) -> streaming.BytesStream:
        ...

    @overload
    def get_object_stream(self, *, as_lines: Literal[True]) -> streaming.LinesStream:
        ...

    @overload
    def get_object_stream(
        self,
        *,
        last_n_lines: int,
        as_lines: Literal[True] = True,
    ) -> streaming.LinesStream:
        ...

    @overload
    def get_object_stream(self, *, as_io: Literal[True]) -> streaming.BytesIO:
        ...

    def get_object_stream(
        self,
        offset: int | None = None,
        *,
        as_io: bool = False,
        as_lines: bool = False,
        length: int | None = None,
        last_n_lines: int | None = None,
    ) -> streaming.BytesIO | streaming.BytesStream | streaming.LinesStream:
        """
        Fetches the file as a stream of bytes, lines, or file-like object.

        :param int | None offset: The offset to start fetching from.
        :param bool as_io: Whether to fetch the file as a file-like object.
        :param bool as_lines: Whether to fetch the file as a stream of lines.
        :param int | None length: The length of the data to fetch.
        :param int | None last_n_lines: The number of lines to fetch from the end of the file.

        :return: A stream of bytes from the remote path.
        :rtype: streaming.BytesStream | streaming.LinesStream | streaming.BytesIO
        """
        delegate = self.storage_client.get_object_stream
        if last_n_lines is not None:
            return delegate(self.object_name, last_n_lines=last_n_lines, as_lines=True)
        if offset is not None:
            return delegate(self.object_name, offset=offset, length=length)
        if as_lines:
            return delegate(self.object_name, as_lines=True)
        if as_io:
            return delegate(self.object_name, as_io=True)
        return delegate(self.object_name)

    def delete_object(self) -> deleting.DeleteSummary:
        """
        Deletes the object from the remote storage.

        :return: A summary of the delete operation.
        :rtype: deleting.DeleteSummary
        """
        return self.storage_client.delete_objects(
            prefix=self.object_name,
        )
