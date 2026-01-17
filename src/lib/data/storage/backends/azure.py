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
Azure Blob Storage Client.
"""

import dataclasses
import datetime
import logging
import os
import re
from typing import Any, Callable, Generator, Iterator, List, Tuple, Type
from urllib.parse import urlparse

from typing_extensions import assert_never, override

from azure.core import exceptions
from azure.identity import DefaultAzureCredential
from azure.storage import blob

from .. import credentials
from ..core import client, provider
from ....utils import common


logger = logging.getLogger(__name__)


##################################################
# Azure Blob Storage Environment Variable Names. #
##################################################


# Maximum number of blobs to delete in a single batch.
OSMO_AZURE_DELETE_BLOBS_BATCH_SIZE = 'OSMO_AZURE_DELETE_BLOBS_BATCH_SIZE'

# Timeout for Azure Blob Storage API calls.
OSMO_AZURE_TIMEOUT = 'OSMO_AZURE_TIMEOUT'

# SAS token expiry time for copy operations.
OSMO_AZURE_COPY_SAS_EXPIRY_TIME = 'OSMO_AZURE_COPY_SAS_EXPIRY_TIME'

# Maximum number of retries for Azure Blob Storage API calls.
OSMO_AZURE_MAX_RETRY_COUNT = 'OSMO_AZURE_MAX_RETRY_COUNT'


##################################################


def _get_azure_timeout() -> datetime.timedelta:
    """
    Returns the timeout for Azure Blob Storage API calls.
    """
    return common.to_timedelta(os.getenv(OSMO_AZURE_TIMEOUT, '24h'))


def _get_azure_max_retry_count() -> int:
    """
    Returns the maximum retry count for Azure Blob Storage API calls.
    """
    return max(1, int(os.getenv(OSMO_AZURE_MAX_RETRY_COUNT, '3')))


def _get_delete_blobs_batch_size() -> int:
    """
    Returns the size of the delete blobs batch.

    256 is the upper limit of delete_blobs API call:
    https://learn.microsoft.com/en-us/python/api/azure-storage-blob/azure.storage.blob.containerclient#azure-storage-blob-containerclient-delete-blobs
    """
    return min(256, int(os.getenv(OSMO_AZURE_DELETE_BLOBS_BATCH_SIZE, '256')))


def _get_copy_sas_expiry_time() -> datetime.timedelta:
    """
    Returns the expiry time for SAS tokens used for copy operations.
    """
    return common.to_timedelta(os.getenv(OSMO_AZURE_COPY_SAS_EXPIRY_TIME, '1h'))


def _get_md5_checksum(obj: blob.BlobProperties) -> str | None:
    """
    Returns the MD5 checksum of the object.
    """
    return obj.content_settings.content_md5.hex() if obj.content_settings.content_md5 else None


class AzureErrorHandler(client.ErrorHandler):
    """
    Error handler for Azure Blob Storage API calls.
    """
    _ELIGIBLE_ERRORS: Tuple[Type[Exception], ...] = (
        exceptions.AzureError,
    )

    def eligible(self, error: Exception) -> bool:
        """
        Returns whether the error is eligible to be retried.
        """
        return isinstance(error, self._ELIGIBLE_ERRORS)

    def handle_error(
        self,
        error: Exception,
        context: client.APIContext,
    ) -> bool:
        # pylint: disable=unused-argument
        """
        Handles a Azure Blob Storage error and returns whether to retry the operation.

        Args:
            error: The error to handle.
            context: The API execution context.

        Returns:
            bool: Whether to retry the operation.
        """
        # TODO: Implement more granular retry logic.
        # timeout = _get_azure_timeout()
        # max_retry_count = _get_azure_max_retry_count()

        error_type = type(error).__name__
        error_message = error.args[0] if error.args else str(error)

        raise client.OSMODataStorageClientError(
            message=f'{error_type}: {error_message}',
            context=context,
        ) from error


class AzureBlobStorageResumableStream(client.ResumableStream):
    """
    A resumable stream for Azure Blob Storage.
    """

    _blob_client: blob.BlobClient
    _azure_error_handler: AzureErrorHandler

    _offset: int  # Original starting offset (immutable)
    _end: int | None  # Absolute end position (inclusive)

    _current_stream: blob.StorageStreamDownloader[bytes] | None
    _current_chunk_iterator: Iterator[bytes] | None
    _exhausted: bool

    def __init__(
        self,
        blob_client: blob.BlobClient,
        error_handler: AzureErrorHandler,
        *,
        offset: int | None = None,
        length: int | None = None,
    ):
        super().__init__()

        self._blob_client = blob_client
        self._azure_error_handler = error_handler
        self._offset = offset or 0

        # Calculate absolute end position (inclusive)
        if length is not None:
            self._end = self._offset + length - 1
        else:
            self._end = None

        self._current_stream = None
        self._current_chunk_iterator = None
        self._exhausted = False

    def _get_current_position(self) -> int:
        """Returns the current absolute position in the blob."""
        return self._offset + self._bytes_read

    def _calculate_remaining_length(self) -> int | None:
        """Calculate how many bytes to request from current position."""
        if self._end is None:
            # Stream until the end
            return None

        current_position = self._get_current_position()
        return max(0, self._end - current_position + 1)

    def _get_new_stream(self) -> blob.StorageStreamDownloader[bytes]:
        def _call_api() -> blob.StorageStreamDownloader[bytes]:
            return self._blob_client.download_blob(
                offset=self._get_current_position(),
                length=self._calculate_remaining_length(),
            )

        return self.execute_api(_call_api, self._azure_error_handler).result

    def _get_new_chunk_iterator(self) -> Iterator[bytes]:
        return self._get_new_stream().chunks()

    @override
    def read(self, n: int = -1) -> bytes:
        """
        Reads bytes from the stream.

        TODO: Add support for resuming interrupted streams.

        :param int n: The number of bytes to read. If -1, reads the entire stream.

        :return: The bytes read from the stream.
        :rtype: bytes
        """
        if n < -1:
            raise ValueError('n must be -1, 0, or positive')

        if self._exhausted:
            return b''

        if self._current_stream is None:
            self._current_stream = self._get_new_stream()

        data = self._current_stream.read(size=n)

        # Update bytes read counter.
        self._bytes_read += len(data)

        # Check if we've reached the end position.
        if self._end is not None and self._get_current_position() > self._end:
            self._exhausted = True

        # If we've reached the end of the stream
        if (n == -1 or n > 0) and not data:
            self._exhausted = True

        return data

    @override
    def __next__(self) -> bytes:
        """
        Reads bytes from the stream.

        TODO: Add support for resuming interrupted streams.

        :return: The bytes read from the stream.
        :rtype: bytes
        """
        if self._exhausted:
            raise StopIteration

        if self._current_chunk_iterator is None:
            self._current_chunk_iterator = self._get_new_chunk_iterator()

        try:
            chunk = next(self._current_chunk_iterator)
        except StopIteration as err:
            self._exhausted = True
            raise err

        # Update bytes read counter
        self._bytes_read += len(chunk)

        # Check if we've reached or exceeded the end position
        if self._end is not None and self._get_current_position() > self._end:
            self._exhausted = True

        return chunk


def _extract_storage_account_from_endpoint(endpoint: str) -> str:
    """Extract storage account name from endpoint URL.

    Supports:
    - azure://storageaccount
    - azure://storageaccount/container/path
    - https://storageaccount.blob.core.windows.net
    """
    if endpoint.startswith('azure://'):
        parts = endpoint.replace('azure://', '').split('/')
        return parts[0]
    if '.blob.core.windows.net' in endpoint:
        parsed = urlparse(endpoint)
        return parsed.netloc.split('.')[0]
    raise ValueError(f'Cannot extract storage account from endpoint: {endpoint}')


def _extract_account_key_from_connection_string(connection_string: str) -> str:
    """Extract AccountKey from Azure Storage connection string.

    Connection strings use semicolon-delimited key=value format:
    DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=...
    """
    for part in connection_string.split(';'):
        if part.startswith('AccountKey='):
            return part[len('AccountKey='):]
    raise ValueError('AccountKey not found in connection string')


def create_client(data_cred: credentials.DataCredential) -> blob.BlobServiceClient:
    """
    Creates a new Azure Blob Storage client.
    """
    match data_cred:
        case credentials.StaticDataCredential():
            return blob.BlobServiceClient.from_connection_string(
                conn_str=data_cred.access_key.get_secret_value(),
            )
        case credentials.DefaultDataCredential():
            storage_account = _extract_storage_account_from_endpoint(data_cred.endpoint)
            account_url = f'https://{storage_account}.blob.core.windows.net'
            return blob.BlobServiceClient(
                account_url=account_url,
                credential=DefaultAzureCredential(),
            )
        case _ as unreachable:
            assert_never(unreachable)


class AzureBlobStorageClient(client.StorageClient):
    """
    A concrete implementation of the StorageClient interface for Azure Blob Storage.
    """
    _azure_client: blob.BlobServiceClient
    _data_cred: credentials.DataCredential
    _azure_error_handler: AzureErrorHandler

    def __init__(
        self,
        azure_client_factory: Callable[[], blob.BlobServiceClient],
        data_cred: credentials.DataCredential,
    ):
        super().__init__()
        self._azure_client = azure_client_factory()
        self._data_cred = data_cred
        self._azure_error_handler = AzureErrorHandler()

    @override
    def close(self) -> None:
        """
        Closes the Azure Blob Storage client.
        """
        try:
            self._azure_client.close()
        except Exception:  # pylint: disable=broad-except
            pass
        finally:
            super().close()

    @override
    def get_object_info(
        self,
        bucket: str,
        key: str,
    ) -> client.APIResponse[client.GetObjectInfoResponse]:
        """
        Gets the information about an object in the Azure Blob Storage.

        Args:
            bucket: The bucket of the object.
            key: The key of the object.

        Returns:
            src.lib.utils.data.client.APIResponse[src.lib.utils.data.client.GetObjectInfoResponse]:
                The information about the object.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        def _call_api() -> client.GetObjectInfoResponse:
            blob_client = self._azure_client.get_blob_client(bucket, key)
            blob_properties = blob_client.get_blob_properties()

            return client.GetObjectInfoResponse(
                key=blob_properties.name,
                size=blob_properties.size,
                checksum=_get_md5_checksum(blob_properties),
                last_modified=blob_properties.last_modified,
            )

        return client.execute_api(_call_api, self._azure_error_handler)

    @override
    def object_exists(
        self,
        bucket: str,
        key: str,
        *,
        checksum: str | None = None,
    ) -> client.APIResponse[client.ObjectExistsResponse]:
        """
        Checks if an object exists in the Azure Blob Storage.

        Args:
            bucket: The bucket of the object.
            key: The key of the object.
            checksum: The checksum of the desired object. (Optional)

        Returns:
            src.lib.utils.data.client.APIResponse[src.lib.utils.data.client.ObjectExistsResponse]:
                Whether the object exists or not.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        def _call_api() -> client.ObjectExistsResponse:
            try:
                object_info_response = self.get_object_info(bucket, key)
                exists = checksum == object_info_response.result.checksum if checksum else True
                return client.ObjectExistsResponse(
                    exists=exists,
                    info=object_info_response.result,
                )
            except client.OSMODataStorageClientError as err:
                if isinstance(err.__cause__, exceptions.ResourceNotFoundError):
                    return client.ObjectExistsResponse(exists=False)
                raise err

        return client.execute_api(_call_api, self._azure_error_handler)

    @override
    def get_object(
        self,
        bucket: str,
        key: str,
        *,
        offset: int | None = None,
        length: int | None = None,
    ) -> client.APIResponse[client.GetObjectResponse]:
        """
        Gets an object from the Azure Blob Storage.

        Args:
            bucket: The bucket of the object.
            key: The key of the object.
            offset: The offset of the object to start streaming from. (Optional)
            length: The length of the object to return. (Optional)

        Returns:
            src.lib.utils.data.client.GetObjectResponse:
                An object from the Azure Blob Storage.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        if length and offset is None:
            raise client.OSMODataStorageClientError('Offset is required when length is provided.')

        def _call_api() -> client.GetObjectResponse:
            blob_client = self._azure_client.get_blob_client(bucket, key)
            obj = self.get_object_info(bucket, key).result

            return client.GetObjectResponse(
                body=AzureBlobStorageResumableStream(
                    blob_client=blob_client,
                    error_handler=self._azure_error_handler,
                    offset=offset,
                    length=length,
                ),
                key=key,
                size=obj.size,
                checksum=obj.checksum,
                last_modified=obj.last_modified,
            )

        return client.execute_api(_call_api, self._azure_error_handler)

    @override
    def list_objects(
        self,
        bucket: str,
        prefix: str | None = None,
        *,
        regex: str | None = None,
        range_query: client.RangeQueryParams | None = None,
        recursive: bool = True,
    ) -> client.APIResponse[client.ListObjectsIteratorResponse]:
        """
        Lists objects in the Azure Blob Storage.

        Args:
            bucket: The bucket of the objects.
            prefix: The prefix of the objects.
            regex: The regex to filter the objects. (Optional)
            range_query: The range query parameters. (Optional)
            recursive: Whether to list recursively.

        Returns:
            src.lib.utils.data.client.ListObjectsIteratorResponse:
                An iterator of the objects in the Azure Blob Storage.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        def _call_api() -> Generator[client.GetObjectInfoResponse, None, None]:
            prefix_param: str | None = prefix
            regex_check = re.compile(regex) if regex else None
            returned_entries = False

            start_after = range_query.start_after if range_query else None
            end_at = range_query.end_at if range_query else None

            try:
                if prefix_param and not prefix_param.endswith('/'):
                    # See if path is an object first.
                    exists_response = self.object_exists(bucket, prefix_param).result
                    if exists_response.exists:
                        assert exists_response.info is not None
                        returned_entries = True
                        yield exists_response.info
                        return

                    prefix_param += '/'   # Ensure that we are listing from the 'directory'

                # Path is a directory, list the objects in the directory.
                container_client = self._azure_client.get_container_client(bucket)
                blob_walker = container_client.walk_blobs(
                    name_starts_with=prefix_param,
                    delimiter='/' if not recursive else '',
                )

                for item in blob_walker:
                    match item:
                        case blob.BlobPrefix():
                            # Item is a 'directory'
                            dir_prefix = item.name
                            if not item.name.endswith('/'):
                                dir_prefix += '/'

                            if start_after and dir_prefix <= start_after:
                                # Skip blobs before the start_after key.
                                # AzureBlobStorage does not support range queries,
                                # so we must consume the entire iterator.
                                continue

                            if end_at and dir_prefix > end_at:
                                # We went past the end of the range query.
                                return

                            if regex_check:
                                base = prefix_param or ''
                                rel_path = os.path.relpath(dir_prefix, base)

                                if rel_path.endswith('/'):
                                    # Drop the trailing slash
                                    rel_path = rel_path[:-1]

                                if not regex_check.match(rel_path):
                                    # The "directory" does not match the regex.
                                    continue

                            returned_entries = True
                            yield client.GetObjectInfoResponse(
                                key=dir_prefix,
                                is_directory=True,
                            )

                            if end_at and dir_prefix == end_at:
                                # We reached the end of the range query.
                                return

                        case blob.BlobProperties():
                            # Item is a blob
                            blob_properties = item

                            if start_after and blob_properties.name <= start_after:
                                # Skip blobs before the start_after key.
                                # AzureBlobStorage does not support range queries,
                                # so we must consume the entire iterator.
                                continue

                            if end_at and blob_properties.name > end_at:
                                # We went past the end of the range query.
                                return

                            if blob_properties.name.endswith('/'):
                                # The object is a directory.
                                continue

                            if regex_check:
                                base = prefix_param or ''
                                if not regex_check.match(
                                    os.path.relpath(blob_properties.name, base),
                                ):
                                    # The object does not match the regex.
                                    continue

                            returned_entries = True
                            yield client.GetObjectInfoResponse(
                                key=blob_properties.name,
                                size=blob_properties.size,
                                checksum=_get_md5_checksum(blob_properties),
                                last_modified=blob_properties.last_modified,
                            )

                            if end_at and blob_properties.name == end_at:
                                # We reached the end of the range query.
                                return

                        case _ as unreachable:
                            assert_never(unreachable)

            finally:
                if regex and not returned_entries:
                    logger.warning('No entries matched regex %s.', regex)
                elif not returned_entries:
                    logger.warning('No entries found for prefix %s.', prefix)

        return client.execute_api(
            lambda: client.ListObjectsIteratorResponse(
                objects=client.ListObjectsIterator(objects=_call_api()),
            ),
            self._azure_error_handler,
        )

    @override
    def upload(
        self,
        filename: str,
        bucket: str,
        key: str,
        *,
        progress_hook: Callable[..., Any] | None = None,
    ) -> client.APIResponse[client.UploadResponse]:
        """
        Uploads an object to the Azure Blob Storage.

        Args:
            filename: The filename to upload.
            bucket: The bucket of the object.
            key: The key of the object.
            progress_hook: A hook to call with the progress of the upload. (Optional)

        Returns:
            src.lib.utils.data.client.APIResponse[src.lib.utils.data.client.UploadResponse]:
                The response of the upload API call.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        amount_uploaded = 0

        def progress(current: int, _: int | None) -> None:
            nonlocal amount_uploaded
            transferred = current - amount_uploaded
            amount_uploaded += transferred
            if progress_hook:
                progress_hook(transferred)

        def _call_api() -> client.UploadResponse:
            try:
                blob_client = self._azure_client.get_blob_client(bucket, key)
                with open(filename, 'rb') as data:
                    blob_client.upload_blob(
                        data=data,
                        overwrite=True,
                        progress_hook=progress,
                    )
            except Exception as err:  # pylint: disable=broad-except
                progress(-amount_uploaded, None)
                raise err

            return client.UploadResponse(size=amount_uploaded)

        return client.execute_api(_call_api, self._azure_error_handler)

    @override
    def download(
        self,
        bucket: str,
        key: str,
        filename: str,
        *,
        progress_hook: Callable[..., Any] | None = None,
    ) -> client.APIResponse[client.DownloadResponse]:
        """
        Downloads an object from the Azure Blob Storage.

        Args:
            bucket: The bucket of the object.
            key: The key of the object.
            filename: The filename to download to.
            progress_hook: A hook to call with the progress of the download. (Optional)

        Returns:
            src.lib.utils.data.client.APIResponse[src.lib.utils.data.client.DownloadResponse]:
                The response of the download API call.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        amount_downloaded = 0

        def progress(current: int, _: int | None) -> None:
            nonlocal amount_downloaded
            transferred = current - amount_downloaded
            amount_downloaded += transferred
            if progress_hook:
                progress_hook(transferred)

        def _call_api() -> client.DownloadResponse:
            try:
                blob_client = self._azure_client.get_blob_client(bucket, key)
                with open(filename, 'wb') as file:
                    download_stream = blob_client.download_blob(
                        name=key,
                        progress_hook=progress,
                    )
                    download_stream.readinto(file)

            except Exception as err:  # pylint: disable=broad-except
                progress(-amount_downloaded, None)
                if os.path.exists(filename):
                    try:
                        os.remove(filename)
                    except OSError as cleanup_error:
                        logger.error('Failed to remove incomplete file: %s', cleanup_error)
                raise err

            return client.DownloadResponse(size=amount_downloaded)

        return client.execute_api(_call_api, self._azure_error_handler)

    @override
    def copy(
        self,
        source_bucket: str,
        source_key: str,
        destination_bucket: str,
        destination_key: str,
        *,
        progress_hook: Callable[[int], Any] | None = None,
    ) -> client.APIResponse[client.CopyResponse]:
        """
        Copies an object within the Azure Blob Storage.

        Args:
            source_bucket: The bucket of the source object.
            source_key: The key of the source object.
            destination_bucket: The bucket of the destination object.
            destination_key: The key of the destination object.

        Returns:
            src.lib.utils.data.client.APIResponse[src.lib.utils.data.client.CopyResponse]:
                The response of the copy API call.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        def _get_sas_url_for_copy(
            source_blob_client: blob.BlobClient,
            service_client: blob.BlobServiceClient,
        ) -> str:
            """
            Generate a SAS URL for the source blob that can be used for copy operations.

            Uses account key for static credentials, user delegation key for token credentials.
            """
            key_start_time = common.current_time().replace(tzinfo=datetime.timezone.utc)
            key_expiry_time = key_start_time + _get_copy_sas_expiry_time()

            match self._data_cred:
                case credentials.StaticDataCredential():
                    account_key = _extract_account_key_from_connection_string(
                        self._data_cred.access_key.get_secret_value(),
                    )
                    sas_token = blob.generate_blob_sas(
                        account_name=source_blob_client.account_name,
                        container_name=source_blob_client.container_name,
                        blob_name=source_blob_client.blob_name,
                        account_key=account_key,
                        permission=blob.BlobSasPermissions(read=True),
                        expiry=key_expiry_time,
                    )
                case credentials.DefaultDataCredential():
                    user_delegation_key = service_client.get_user_delegation_key(
                        key_start_time=key_start_time,
                        key_expiry_time=key_expiry_time,
                    )
                    sas_token = blob.generate_blob_sas(
                        account_name=source_blob_client.account_name,
                        container_name=source_blob_client.container_name,
                        blob_name=source_blob_client.blob_name,
                        user_delegation_key=user_delegation_key,
                        permission=blob.BlobSasPermissions(read=True),
                        expiry=key_expiry_time,
                    )
                case _ as unreachable:
                    assert_never(unreachable)

            return f'{source_blob_client.url}?{sas_token}'

        def _call_api() -> client.CopyResponse:
            source_blob_client = self._azure_client.get_blob_client(
                source_bucket,
                source_key,
            )
            destination_blob_client = self._azure_client.get_blob_client(
                destination_bucket,
                destination_key,
            )

            # Copy source blob to destination blob.
            destination_blob_client.upload_blob_from_url(
                _get_sas_url_for_copy(source_blob_client, self._azure_client),
            )

            blob_properties = destination_blob_client.get_blob_properties()

            if progress_hook:
                progress_hook(blob_properties.size)

            return client.CopyResponse(
                size=blob_properties.size,
            )

        return client.execute_api(_call_api, self._azure_error_handler)

    @override
    def delete(
        self,
        bucket: str,
        prefix: str | None = None,
        *,
        regex: str | None = None,
    ) -> client.APIResponse[client.DeleteResponse]:
        """
        Deletes objects from the Azure Blob Storage.

        Args:
            bucket: The bucket of the objects.
            prefix: The prefix of the objects. It can be a directory or a single object.
            regex: The regex to filter the objects. (Optional)

        Returns:
            src.lib.utils.data.client.APIResponse[src.lib.utils.data.client.DeleteResponse]:
                The response of the delete API call.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        def _call_api() -> client.DeleteResponse:
            list_response = self.list_objects(bucket, prefix, regex=regex).result

            # Generate batches of objects to delete.
            batch_size = _get_delete_blobs_batch_size()

            def _gen_batch() -> Generator[List[str], None, None]:
                batch = []
                for obj in list_response.objects:
                    batch.append(obj.key)
                    if len(batch) == batch_size:
                        yield batch
                        batch = []
                if batch:
                    yield batch

            delete_errors: List[client.DeleteError] = []
            success_count = 0

            container_client = self._azure_client.get_container_client(bucket)
            for batch in _gen_batch():
                resp_iter = container_client.delete_blobs(
                    *batch,
                    delete_snapshots='include',
                )
                for key, resp in zip(batch, resp_iter):
                    if resp.status_code >= 200 and resp.status_code < 300:
                        success_count += 1
                    else:
                        delete_errors.append(client.DeleteError(
                            key=key,
                            message=f'Code: {resp.status_code}, Reason: {resp.reason}',
                        ))

            return client.DeleteResponse(
                success_count=success_count,
                failures=delete_errors,
            )

        return client.execute_api(_call_api, self._azure_error_handler)


@dataclasses.dataclass(frozen=True)
class AzureBlobStorageClientFactory(provider.StorageClientFactory):
    """
    Factory for the AzureBlobStorageClient.
    """

    data_cred: credentials.DataCredential

    @override
    def create(self) -> AzureBlobStorageClient:
        return AzureBlobStorageClient(
            azure_client_factory=lambda: create_client(self.data_cred),
            data_cred=self.data_cred,
        )
