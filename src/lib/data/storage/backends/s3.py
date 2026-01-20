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
S3 Object Storage Client.
"""

import dataclasses
import datetime
import logging
import os
import re
import time
from typing import Any, Callable, Dict, Generator, List, Tuple, Type
from typing_extensions import assert_never, override

import boto3.exceptions
import boto3.s3.transfer
import boto3.session
import botocore.config
import botocore.exceptions
import botocore.parsers
import botocore.response
import mypy_boto3_s3.client
import mypy_boto3_s3.type_defs

from . import common
from .. import credentials
from ..core import client, provider
from ....utils import common as utils_common

logger = logging.getLogger(__name__)

##################################
# S3 Environment Variable Names. #
##################################


# Timeout for S3 API calls.
OSMO_S3_TIMEOUT = 'OSMO_S3_TIMEOUT'

# Max retry count for retryable S3 API calls.
OSMO_S3_MAX_RETRY_COUNT = 'OSMO_S3_MAX_RETRY_COUNT'

# Max pool connections for S3 client.
OSMO_S3_MAX_POOL_CONNECTIONS = 'OSMO_S3_MAX_POOL_CONNECTIONS'

# Multipart threshold for S3 uploads.
OSMO_S3_MULTIPART_THRESHOLD_BYTES = 'OSMO_S3_MULTIPART_THRESHOLD_BYTES'

# Max concurrency for S3 uploads.
OSMO_S3_MAX_CONCURRENCY = 'OSMO_S3_MAX_CONCURRENCY'

# Paginator size for S3 list objects.
OSMO_S3_PAGINATOR_SIZE = 'OSMO_S3_PAGINATOR_SIZE'

# Delete objects batch size for S3 delete objects.
OSMO_S3_DELETE_OBJECTS_BATCH_SIZE = 'OSMO_S3_DELETE_OBJECTS_BATCH_SIZE'


##################################


def _get_s3_max_retry_count() -> int:
    """
    Returns the maximum retry count for S3 API calls.
    """
    return max(1, int(os.getenv(OSMO_S3_MAX_RETRY_COUNT, '3')))


def _get_s3_timeout() -> datetime.timedelta:
    """
    Returns the timeout for S3 API calls.
    """
    return utils_common.to_timedelta(os.getenv(OSMO_S3_TIMEOUT, '24h'))


def _get_boto_config(scheme: str) -> botocore.config.Config:
    """
    Returns the boto3 configuration for the given scheme.
    """
    max_attempts = _get_s3_max_retry_count()
    max_pool_connections = max(10, int(os.getenv(OSMO_S3_MAX_POOL_CONNECTIONS, '160')))

    if scheme == common.StorageBackendType.TOS.value:
        # TOS requires additional configurations.
        return botocore.config.Config(
            retries={
                'max_attempts': max_attempts,
                'mode': 'standard',
            },
            max_pool_connections=max_pool_connections,
            s3={'addressing_style': 'virtual'},
        )

    return botocore.config.Config(
        retries={
            'max_attempts': max_attempts,
            'mode': 'standard',
        },
        max_pool_connections=max_pool_connections,
    )


def _get_s3_transfer_config() -> boto3.s3.transfer.TransferConfig:
    """
    Returns the transfer configuration for S3 uploads, copies, and downloads.
    """
    return boto3.s3.transfer.TransferConfig(
        multipart_threshold=int(os.getenv(OSMO_S3_MULTIPART_THRESHOLD_BYTES, '536870912')),
        max_concurrency=int(os.getenv(OSMO_S3_MAX_CONCURRENCY, '5')),
    )


def _get_s3_paginator_size() -> int:
    """
    Returns the size of the paginator.
    """
    return int(os.getenv(OSMO_S3_PAGINATOR_SIZE, '1000'))


def _get_delete_objects_batch_size() -> int:
    """
    Returns the size of the delete objects batch.

    1000 is the upper limit of delete_objects API call:
    https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3/client/delete_objects.html
    """
    return min(1000, int(os.getenv(OSMO_S3_DELETE_OBJECTS_BATCH_SIZE, '1000')))


def _fetch_code_from_upload_failed_error(err: str) -> str | None:
    # Upload failed errors look like:
    # Failed to upload <input> to <output>: An error occurred (<error>) when calling the
    # <api> operation: <message>
    pattern = r'An error occurred \(([a-zA-Z0-9]+)\)'
    match = re.search(pattern, err)
    if match:
        return match.group(1)
    return None


def _add_request_headers(
    session: boto3.session.Session,
    extra_headers: Dict[str, Dict[str, str]] | None = None,
):
    """
    Function that adds a custom header and prints all headers.
    """
    if not extra_headers:
        return

    def _get_add_headers_func(request_headers: Dict[str, str]):
        def _add_headers(model, params, request_signer, **kwargs):
            # pylint: disable=unused-argument
            params['headers'].update(request_headers)
        return _add_headers

    #  Register the function to an event.
    if session.events:
        event_emitter = session.events
        for key, value in extra_headers.items():
            if value:
                event_emitter.register(key, _get_add_headers_func(value))
    else:
        logger.warning('No event emitter found in session.')


class S3ErrorHandler(client.ErrorHandler):
    """
    Error handler for S3 Object Storage API calls.
    """

    _ELIGIBLE_ERRORS: Tuple[Type[Exception], ...] = (
        botocore.exceptions.BotoCoreError,
        botocore.exceptions.ClientError,
        botocore.exceptions.EndpointConnectionError,
        botocore.exceptions.ConnectTimeoutError,
        botocore.exceptions.SSLError,
        botocore.parsers.ResponseParserError,
        boto3.exceptions.S3UploadFailedError,
    )

    def eligible(self, error: Exception) -> bool:
        """
        Returns whether the error is eligible to be handled.
        """
        return isinstance(error, self._ELIGIBLE_ERRORS)

    def handle_error(
        self,
        error: Exception,
        context: client.APIContext,
    ) -> bool:
        """
        Handles a boto3 error and returns whether to retry the operation.

        Args:
            error: The error to handle.
            context: The API execution context.

        Returns:
            bool: Whether to retry the operation.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """

        error_type = type(error).__name__
        error_message = error.args[0] if error.args else str(error)

        # Evaluate the timeout and max retry count from the environment variables.
        timeout = _get_s3_timeout()
        max_retry_count = _get_s3_max_retry_count()

        if timeout <= context.time_since_start:
            raise client.OSMODataStorageClientError(
                f'{error_type}: {error_message}.\n'
                f'Timed out after {timeout}. '
                f'Retried {context.retries} times',
                context=context,
            ) from error

        if isinstance(
            error,
            (botocore.exceptions.ClientError, boto3.exceptions.S3UploadFailedError),
        ):
            response_code: str | None = None
            request_id: str | None = None

            # S3UploadFailedError catches ClientError but does not do
            # raise S3UploadFailedError from ClientError
            # which means we can't fetch ClientError from __cause__
            if isinstance(error, boto3.exceptions.S3UploadFailedError):
                response_code = _fetch_code_from_upload_failed_error(str(error))
            else:
                response = error.response
                if response:
                    response_code = response.get('Error', {}).get('Code')
                    request_id = response.get('ResponseMetadata', {}).get('RequestId')

            if response_code == 'AuthorizationHeaderMalformed':
                raise client.OSMODataStorageClientError(response_code, context=context) from error

            if response_code == 'SignatureDoesNotMatch':
                raise client.OSMODataStorageClientError(response_code, context=context) from error

            if response_code == 'InvalidClientTokenId':
                raise client.OSMODataStorageClientError(response_code, context=context) from error

            if response_code == '403':
                # Forbidden error, not a retryable error.
                raise client.OSMODataStorageClientError(response_code, context=context) from error

            if response_code not in ('429', 'ServiceUnavailable', 'NoSuchKey', '404'):
                if context.retries < max_retry_count:
                    logger.error(
                        'Unknown error: %s. Retrying %d more times. Request ID: %s',
                        error,
                        max_retry_count - context.retries,
                        request_id,
                    )
                    return True
                raise client.OSMODataStorageClientError(
                    f'{error_type}: {error_message}',
                    context=context,
                ) from error

            elif response_code in ('NoSuchKey', '404'):
                if not context.extra_data.get('suppress_no_key_error', False):
                    logger.error('Object not found: %s. Request ID: %s', error, request_id)
                return False

            else:
                # Exponential backoff for other errors.
                time_left = max(datetime.timedelta(0),
                                timeout - context.time_since_start)
                logger.error('Encountering too many requests: Waiting and Retrying for %s. '
                             'Request ID: %s', time_left, request_id)
                delay = utils_common.get_exponential_backoff_delay(context.retries)
                time.sleep(delay)

        elif isinstance(error, (botocore.exceptions.EndpointConnectionError,
                                botocore.exceptions.ConnectTimeoutError,
                                botocore.exceptions.SSLError,
                                botocore.parsers.ResponseParserError)):
            if (
                context.retries == 0 or
                datetime.timedelta(minutes=1) <= context.time_since_last_attempt
            ):
                time_left = max(datetime.timedelta(0),
                                timeout - context.time_since_start)
                logger.error('Connection error occurred: %s: Waiting and Retrying for %s.',
                             error, time_left)

        else:  # Default botocore.exceptions.BotoCoreError
            if context.retries < max_retry_count:
                logger.error(
                    'Unknown error: %s. Retrying %d more times.',
                    error,
                    max_retry_count - context.retries,
                )
                return True
            raise client.OSMODataStorageClientError(
                f'{error_type}: {error_message}',
                context=context,
            ) from error

        return True


class S3ResumableStream(client.ResumableStream):
    """
    A resumable stream for S3.
    """

    _s3_client: mypy_boto3_s3.S3Client
    _error_handler: S3ErrorHandler

    _bucket: str
    _key: str

    _offset: int  # Original starting offset (immutable)
    _end: int | None  # Absolute end position (inclusive)
    _object_size: int | None

    _current_stream: botocore.response.StreamingBody | None = None
    _exhausted: bool = False

    def __init__(
        self,
        s3_client: mypy_boto3_s3.S3Client,
        error_handler: S3ErrorHandler,
        bucket: str,
        key: str,
        *,
        offset: int | None = None,
        length: int | None = None,
        object_size: int | None = None,
    ):
        super().__init__()

        self._s3_client = s3_client
        self._bucket = bucket
        self._key = key
        self._error_handler = error_handler
        self._offset = offset or 0
        self._length = length
        self._object_size = object_size

        # Calculate absolute end position (inclusive)
        if object_size and length:
            self._end = min(
                self._offset + length - 1,
                object_size - 1,
            )
        else:
            self._end = None

        self._current_stream = None
        self._exhausted = False

    def _get_current_position(self) -> int:
        """Returns the current absolute position in the object."""
        return self._offset + self._bytes_read

    def _create_range_header(self) -> str | None:
        """Creates the appropriate Range header for the current position."""
        if not self._object_size:
            return None

        current_position = self._get_current_position()

        if self._end:
            return f'bytes={current_position}-{self._end}'

        return f'bytes={current_position}-'

    def _get_new_stream(self) -> botocore.response.StreamingBody:
        """Gets a new stream from S3, handling retries."""
        def _call_api() -> botocore.response.StreamingBody:
            range_header = self._create_range_header()
            if range_header:
                response = self._s3_client.get_object(
                    Bucket=self._bucket,
                    Key=self._key,
                    Range=range_header,
                )
            else:
                response = self._s3_client.get_object(
                    Bucket=self._bucket,
                    Key=self._key,
                )

            # Validate response body exists
            # This will be retried by the error handler.
            if response.get('Body') is None:
                raise botocore.exceptions.ResponseStreamingError(
                    'Get object response body is unexpectedly None',
                )

            return response['Body']

        return self.execute_api(_call_api, self._error_handler).result

    def _close_current_stream(self) -> None:
        if self._current_stream:
            try:
                self._current_stream.close()
            except Exception:  # pylint: disable=broad-except
                pass
            finally:
                self._current_stream = None

    @override
    def __next__(self) -> bytes:
        if self._exhausted:
            raise StopIteration

        while True:
            try:
                if self._current_stream is None:
                    self._current_stream = self._get_new_stream()

                chunk = next(self._current_stream)

                # Update bytes read counter
                self._bytes_read += len(chunk)

                # Check if we've reached or exceeded the end position
                if self._end is not None and self._get_current_position() > self._end:
                    self._exhausted = True

                return chunk

            except StopIteration as err:
                self._exhausted = True
                raise err

            except botocore.exceptions.IncompleteReadError:
                logger.warning(
                    'IncompleteReadError occurred at position %d for %s/%s, resuming...',
                    self._get_current_position(),
                    self._bucket,
                    self._key,
                )

                # Close the current boto3 stream but not the entire resumable stream.
                self._close_current_stream()

                # Continue the loop to re-establish the stream.
                continue

    @override
    def read(self, n: int = -1) -> bytes:
        if n < -1:
            raise ValueError('n must be -1, 0, or positive')

        if self._exhausted:
            return b''

        while True:
            if self._current_stream is None:
                self._current_stream = self._get_new_stream()

            try:
                data = self._current_stream.read(amt=n if n != -1 else None)

                # Update bytes read counter.
                self._bytes_read += len(data)

                # Check if we've reached or exceeded the end position
                if self._end is not None and self._get_current_position() > self._end:
                    self._exhausted = True

                # If we've reached the end of the stream
                if (n == -1 or n > 0) and not data:
                    self._exhausted = True

                return data
            except botocore.exceptions.IncompleteReadError:
                logger.warning(
                    'IncompleteReadError occurred at position %d for %s/%s, resuming...',
                    self._get_current_position(),
                    self._bucket,
                    self._key,
                )

                # Close the current boto3 stream but not the entire resumable stream.
                self._close_current_stream()

                # Continue the loop to re-establish the stream.
                continue

    @override
    def close(self) -> None:
        self._close_current_stream()
        super().close()


def create_client(
    data_cred: credentials.DataCredential,
    scheme: str,
    *,
    endpoint_url: str | None = None,
    region: str | None = None,
    extra_headers: Dict[str, Dict[str, str]] | None = None,
) -> mypy_boto3_s3.S3Client:
    """
    Creates a raw boto3 client based on the given parameters.

    CAUTION: The resulting client is not thread-safe and should not be shared between threads
          without proper synchronization.

    Args:
        data_cred: The data credential.
        scheme: The scheme of the storage.
        endpoint_url: The endpoint URL.
        region: The region.
        extra_headers: Extra headers to add to the client

    Returns:
        mypy_boto3_s3.S3Client
    """
    def _get_client() -> mypy_boto3_s3.S3Client:
        config = _get_boto_config(scheme)

        session = boto3.Session()
        _add_request_headers(session, extra_headers)

        match data_cred:
            case credentials.StaticDataCredential():
                # Uses direct credentials (e.g. access key and secret key)
                return session.client(
                    's3',
                    endpoint_url=endpoint_url,
                    aws_access_key_id=data_cred.access_key_id,
                    aws_secret_access_key=data_cred.access_key.get_secret_value(),
                    region_name=region,
                    config=config,
                )
            case credentials.DefaultDataCredential():
                # Uses ambient credentials (e.g. Environment variables, Workload Identity, etc.)
                return session.client(
                    's3',
                    endpoint_url=endpoint_url,
                    region_name=region,
                    config=config,
                )
            case _ as unreachable:
                assert_never(unreachable)

    return client.execute_api(
        _get_client,
        S3ErrorHandler(),
    ).result


class S3StorageClient(client.StorageClient):
    """
    A concrete implementation of the StorageClient interface for S3.
    """
    _s3_client: mypy_boto3_s3.client.S3Client
    _s3_error_handler: S3ErrorHandler
    _supports_batch_delete: bool

    def __init__(
        self,
        s3_client_factory: Callable[[], mypy_boto3_s3.client.S3Client],
        *,
        supports_batch_delete: bool = False,
    ):
        super().__init__()
        self._s3_client = s3_client_factory()
        self._s3_error_handler = S3ErrorHandler()
        self._supports_batch_delete = supports_batch_delete

    @override
    def close(self) -> None:
        """
        Closes the S3 Storage client.
        """
        try:
            self._s3_client.close()
        except Exception:  # pylint: disable=broad-except
            pass
        finally:
            super().close()

    def _get_object_info(
        self,
        bucket: str,
        key: str,
        *,
        suppress_no_key_error: bool = False,
    ) -> client.APIResponse[client.GetObjectInfoResponse]:
        """
        Gets the information about an object in the S3 Object Storage.
        """
        def _call_api() -> client.GetObjectInfoResponse:
            head = self._s3_client.head_object(Bucket=bucket, Key=key)
            return client.GetObjectInfoResponse(
                key=key,
                size=head['ContentLength'],
                checksum=head['ETag'].strip('"'),
                last_modified=head['LastModified'],
            )

        extra_data: client.APIContextExtraData = {
            'suppress_no_key_error': suppress_no_key_error,
        }

        with client.APIContext(extra_data=extra_data) as context:
            return client.execute_api(
                _call_api,
                self._s3_error_handler,
                context,
            )

    @override
    def get_object_info(
        self,
        bucket: str,
        key: str,
    ) -> client.APIResponse[client.GetObjectInfoResponse]:
        """
        Gets the information about an object in the S3 Object Storage.

        Args:
            bucket: The bucket of the object.
            key: The key of the object.

        Returns:
            src.lib.utils.data.client.GetObjectInfoResponse:
                The information about the object.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        return self._get_object_info(bucket, key)

    @override
    def object_exists(
        self,
        bucket: str,
        key: str,
        *,
        checksum: str | None = None,
    ) -> client.APIResponse[client.ObjectExistsResponse]:
        """
        Checks if an object exists in the S3 Object Storage.

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
                object_info_api_response = self._get_object_info(
                    bucket,
                    key,
                    suppress_no_key_error=True,
                )
                object_info_response = object_info_api_response.result
                exists = checksum == object_info_response.checksum if checksum else True
                return client.ObjectExistsResponse(
                    exists=exists,
                    info=object_info_response,
                )
            except client.OSMODataStorageClientError as err:
                if isinstance(err.__cause__, botocore.exceptions.ClientError):
                    response = err.__cause__.response
                    if response and response.get('Error', {}).get('Code') in ('NoSuchKey', '404'):
                        return client.ObjectExistsResponse(exists=False)
                raise err

        return client.execute_api(_call_api, self._s3_error_handler)

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
        Gets an object from the S3 Object Storage.

        Args:
            bucket: The bucket of the object.
            key: The key of the object.
            offset: The offset of the object to start streaming from. (Optional)
            length: The length of the object to return. (Optional)

        Returns:
            src.lib.utils.data.client.APIResponse[src.lib.utils.data.client.GetObjectResponse]:
                An object from the S3 Object Storage.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """

        def _call_api() -> client.GetObjectResponse:
            object_info = self._get_object_info(bucket, key).result
            object_size = object_info.size

            resumable_stream = S3ResumableStream(
                self._s3_client,
                self._s3_error_handler,
                bucket,
                key,
                offset=offset,
                length=length,
                object_size=object_size,
            )

            return client.GetObjectResponse(
                body=resumable_stream,
                key=key,
                size=object_size,
                checksum=object_info.checksum,
                last_modified=object_info.last_modified,
            )

        return client.execute_api(_call_api, self._s3_error_handler)

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
        Lists objects in the S3 Object Storage.

        Args:
            bucket: The bucket of the objects.
            prefix: The prefix of the objects.
            regex: The regex to filter the objects. (Optional)
            range_query: The range query parameters. (Optional)
            recursive: Whether to list recursively.

        Returns:
            client.APIResponse[client.ListObjectsIteratorResponse]:
                An iterator of the objects in the S3 Object Storage.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        def _call_api() -> Generator[client.GetObjectInfoResponse, None, None]:
            prefix_param: str | None = prefix
            regex_check = re.compile(regex) if regex else None
            returned_entries = False

            start_after: str | None = range_query.start_after if range_query else None
            end_at: str | None = range_query.end_at if range_query else None

            try:
                if prefix_param and not prefix_param.endswith('/'):
                    # See if path is an object first.
                    object_exists_response = self.object_exists(bucket, prefix_param).result

                    if object_exists_response.exists:
                        assert object_exists_response.info is not None
                        returned_entries = True
                        yield object_exists_response.info
                        return

                    prefix_param += '/'   # Ensure that we are listing from the 'directory'

                # Prefix is not an object, try listing the objects in the directory.
                paginator = self._s3_client.get_paginator('list_objects_v2')

                paginate_kwargs: Dict[str, Any] = {
                    'Bucket': bucket,
                    'PaginationConfig': {
                        'PageSize': _get_s3_paginator_size(),
                    },
                }

                if prefix_param:
                    paginate_kwargs['Prefix'] = prefix_param
                if start_after:
                    paginate_kwargs['StartAfter'] = start_after
                if not recursive:
                    paginate_kwargs['Delimiter'] = '/'

                page_iterator = paginator.paginate(**paginate_kwargs)

                for page in page_iterator:

                    if not recursive:
                        # Emit "directories" when non-recursive
                        for common_prefix in page.get('CommonPrefixes', []):
                            dir_prefix = common_prefix.get('Prefix')
                            if not dir_prefix:
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

                    # For both recursive and non-recursive modes, emit the objects.
                    for obj in page.get('Contents', []):
                        if 'Key' not in obj or 'Size' not in obj or 'ETag' not in obj:
                            logger.warning('Invalid object: %s', obj)
                            continue

                        if end_at and obj['Key'] > end_at:
                            # We went past the end of the range query.
                            return

                        if obj['Key'].endswith('/'):
                            # The object is a directory.
                            continue

                        if regex_check:
                            base = prefix_param or ''
                            if not regex_check.match(os.path.relpath(obj['Key'], base)):
                                # The object does not match the regex.
                                continue

                        returned_entries = True
                        yield client.GetObjectInfoResponse(
                            key=obj['Key'],
                            size=obj['Size'],
                            checksum=obj['ETag'].strip('"'),
                            last_modified=obj['LastModified'],
                        )

                        if end_at and obj['Key'] == end_at:
                            # We reached the end of the range query.
                            return

            finally:
                if regex and not returned_entries:
                    logger.warning('No entries matched regex %s', regex)
                elif not returned_entries:
                    logger.warning('No entries found for prefix: %s', prefix)

        return client.execute_api(
            lambda: client.ListObjectsIteratorResponse(
                objects=client.ListObjectsIterator(objects=_call_api()),
            ),
            self._s3_error_handler,
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
        Uploads an object to the S3 Object Storage.

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

        def progress(bytes_transfered: int) -> None:
            nonlocal amount_uploaded
            amount_uploaded += bytes_transfered
            if progress_hook:
                progress_hook(bytes_transfered)

        def _call_api() -> client.UploadResponse:
            try:
                self._s3_client.upload_file(
                    Filename=filename,
                    Bucket=bucket,
                    Key=key,
                    ExtraArgs={
                        'ContentType': client.get_content_type(filename),
                    },
                    Callback=progress,
                    Config=_get_s3_transfer_config(),
                )
            except Exception as err:  # pylint: disable=broad-except
                progress(-amount_uploaded)
                raise err

            return client.UploadResponse(size=amount_uploaded)

        return client.execute_api(_call_api, self._s3_error_handler)

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
        Downloads an object from the S3 Object Storage.

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

        def progress(bytes_transfered: int) -> None:
            nonlocal amount_downloaded
            amount_downloaded += bytes_transfered
            if progress_hook:
                progress_hook(bytes_transfered)

        def _call_api() -> client.DownloadResponse:
            try:
                with open(filename, 'wb') as file:
                    self._s3_client.download_fileobj(
                        Bucket=bucket,
                        Key=key,
                        Fileobj=file,
                        Callback=progress,
                        Config=_get_s3_transfer_config(),
                    )
            except Exception as err:  # pylint: disable=broad-except
                progress(-amount_downloaded)
                if os.path.exists(filename):
                    try:
                        os.remove(filename)
                    except OSError as cleanup_error:
                        logger.error('Failed to remove incomplete file: %s', cleanup_error)
                raise err

            return client.DownloadResponse(size=amount_downloaded)

        return client.execute_api(_call_api, self._s3_error_handler)

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
        Copies an object within the S3 Object Storage.

        Args:
            source_bucket: The bucket of the source object.
            source_key: The key of the source object.
            destination_bucket: The bucket of the destination object.
            destination_key: The key of the destination object.
            progress_hook: A hook to call with the progress of the copy. (Optional)

        Returns:
            src.lib.utils.data.client.APIResponse[src.lib.utils.data.client.CopyResponse]:
                The response of the copy API call.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        amount_copied = 0

        def progress(bytes_transfered: int) -> None:
            nonlocal amount_copied
            amount_copied += bytes_transfered
            if progress_hook:
                progress_hook(bytes_transfered)

        def _call_api() -> client.CopyResponse:
            copy_source = mypy_boto3_s3.type_defs.CopySourceTypeDef(
                Bucket=source_bucket,
                Key=source_key,
            )

            try:
                self._s3_client.copy(
                    CopySource=copy_source,
                    Bucket=destination_bucket,
                    Key=destination_key,
                    Callback=progress,
                    Config=_get_s3_transfer_config(),
                )
            except Exception as err:  # pylint: disable=broad-except
                progress(-amount_copied)
                raise err

            return client.CopyResponse(size=amount_copied)

        return client.execute_api(_call_api, self._s3_error_handler)

    @override
    def delete(
        self,
        bucket: str,
        prefix: str | None = None,
        *,
        regex: str | None = None,
    ) -> client.APIResponse[client.DeleteResponse]:
        """
        Deletes objects from the S3 Object Storage.

        Args:
            bucket: The bucket of the objects.
            prefix: The prefix of the object(s) to delete. This can be a prefix or a single object.
            regex: The regex to filter the objects. (Optional)

        Returns:
            src.lib.utils.data.client.APIResponse[src.lib.utils.data.client.DeleteResponse]:
                The response of the delete API call.

        Raises:
            src.lib.utils.data.client.OSMODataStorageClientError
        """
        def _call_api() -> client.DeleteResponse:
            list_response = self.list_objects(bucket, prefix, regex=regex).result

            delete_errors: List[client.DeleteError] = []
            success_count = 0

            if self._supports_batch_delete:
                # Generate batches of objects to delete.
                batch_size = _get_delete_objects_batch_size()

                def _gen_batch() -> Generator[
                        List[mypy_boto3_s3.type_defs.ObjectIdentifierTypeDef], None, None
                ]:
                    batch: List[mypy_boto3_s3.type_defs.ObjectIdentifierTypeDef] = []
                    for obj in list_response.objects:
                        batch.append({'Key': obj.key})
                        if len(batch) == batch_size:
                            yield batch
                            batch = []
                    if batch:
                        yield batch

                # Delete objects in batches
                for batch in _gen_batch():
                    delete_objects_response = self._s3_client.delete_objects(
                        Bucket=bucket,
                        Delete={
                            'Objects': batch,
                            'Quiet': False,
                        },
                    )
                    success_count += len(delete_objects_response.get('Deleted', []))
                    if delete_objects_response.get('Errors'):
                        for error in delete_objects_response['Errors']:
                            delete_errors.append(client.DeleteError(
                                key=error['Key'],
                                message=f'Code: {error["Code"]}, Reason: {error["Message"]}',
                            ))

            else:
                # Batch delete is not supported, delete objects one by one.
                for obj in list_response.objects:
                    delete_object_response = self._s3_client.delete_object(
                        Bucket=bucket,
                        Key=obj.key,
                    )
                    if response_metadata := delete_object_response.get('ResponseMetadata'):
                        if response_metadata['HTTPStatusCode'] >= 400:
                            delete_errors.append(client.DeleteError(
                                key=obj.key,
                                message=f'Code: {response_metadata["HTTPStatusCode"]}',
                            ))
                            continue

                    success_count += 1

            return client.DeleteResponse(
                success_count=success_count,
                failures=delete_errors,
            )

        return client.execute_api(_call_api, self._s3_error_handler)


@dataclasses.dataclass(frozen=True)
class S3StorageClientFactory(provider.StorageClientFactory):
    """
    Factory for the S3StorageClient.
    """

    data_cred: credentials.DataCredential
    region: str
    scheme: str
    endpoint_url: str | None = dataclasses.field(default=None)
    extra_headers: Dict[str, Dict[str, str]] | None = dataclasses.field(default=None)
    supports_batch_delete: bool = dataclasses.field(default=False)

    @override
    def create(self) -> S3StorageClient:
        return S3StorageClient(
            lambda: create_client(
                self.data_cred,
                scheme=self.scheme,
                endpoint_url=self.endpoint_url,
                region=self.region,
                extra_headers=self.extra_headers,
            ),
            supports_batch_delete=self.supports_batch_delete,
        )
