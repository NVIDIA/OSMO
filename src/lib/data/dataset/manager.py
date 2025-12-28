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
Module for managing datasets.
"""

import functools
import logging
import os
from typing import Dict, List

import pydantic

from . import common, downloading, migrating, updating, uploading
from .. import storage
from ...utils import (
    cache,
    client,
    client_configs,
    logging as logging_utils,
    common as utils_common,
    osmo_errors,
)

logger = logging.getLogger(__name__)


@logging_utils.scope_logging
class Manager(pydantic.BaseModel):
    """
    Manager for a dataset.
    """

    class Config:
        arbitrary_types_allowed = True
        extra = pydantic.Extra.forbid
        frozen = True
        keep_untouched = (functools.cached_property,)

    #########################
    #    Required fields    #
    #########################

    dataset_input: utils_common.DatasetStructure = pydantic.Field(
        ...,
        description='A dataset structure that uniquely identifies a dataset.',
    )

    service_client: client.ServiceClient = pydantic.Field(
        ...,
        description='The service client to use for the dataset.',
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

    executor_params: storage.ExecutorParameters = pydantic.Field(
        default_factory=storage.ExecutorParameters,
        description='The executor parameters for the storage client.',
    )

    logging_level: int = pydantic.Field(
        default=logging.ERROR,
        description='The logging level for the dataset manager.',
    )

    @functools.cached_property
    def cache_config(self) -> cache.CacheConfig | None:
        """
        Resolves the cache configuration.

        :return: The cache configuration.
        :rtype: Optional[cache.CacheConfig]
        """
        return client_configs.get_cache_config()

    @property
    def dataset(self) -> utils_common.DatasetStructure:
        """
        The dataset structure.
        """
        if not self.dataset_input.tag:
            self.dataset_input.tag = 'latest'

        if not self.dataset_input.bucket:
            self.dataset_input.bucket = common.get_user_bucket(self.service_client)

        return self.dataset_input

    ##################
    #    Download    #
    ##################

    def _validate_download_destination(
        self,
        destination: str,
        resume: bool,
    ) -> None:
        """
        Validates the download destination.

        Ensures that the destination is empty/non-existent unless resuming.
        """
        info_result = self.service_client.request(
            client.RequestMethod.GET,
            common.construct_info_api_path(self.dataset),
            params={
                'count': 1,
            },
        )

        if info_result['type'] == 'DATASET':
            # If the path exists and is not empty while not resuming
            path = os.path.join(destination, self.dataset.name)
            if os.path.isdir(path) and os.listdir(path) and not resume:
                raise osmo_errors.OSMOUserError(f'Path {path} is not empty')

            if resume and not self.dataset.tag:
                raise osmo_errors.OSMOUserError('Specify specific version in order to resume.')

        elif info_result['type'] == 'COLLECTION':
            for version in info_result['versions']:
                # If the path exists and is not empty while not resuming
                path = os.path.join(destination, version['name'])
                if os.path.isdir(path) and os.listdir(path) and not resume:
                    raise osmo_errors.OSMOUserError(f'Path {path} is not empty')

    def download(
        self,
        destination: str,
        *,
        regex: str | None = None,
        resume: bool = False,
    ) -> Dict[str, storage.DownloadSummary]:
        """
        Downloads a dataset to a destination directory.

        :param str destination: The destination directory to download the dataset to.
        :param str | None regex: A regex to filter the dataset by.
        :param bool resume: Whether to resume the download from a previous attempt.

        :return: The download summaries.
        :rtype: Dict[str, storage.DownloadSummary]

        :raises osmo_errors.OSMOCredentialError: If credential validation fails for any
                                                 storage backend used in the dataset.
        """
        # Validate the dataset prior to downloading.
        self._validate_download_destination(destination, resume)

        download_result: common.DownloadResponse = self.validate_download()

        # Create dataset info objects
        dataset_infos = [
            common.DatasetInfo(
                name=dataset_name,
                manifest_path=manifest_path,
            )
            for dataset_name, manifest_path in zip(
                download_result['dataset_names'],
                download_result['locations'],
                strict=True,
            )
        ]

        # Check credentials for all storage backends used in the dataset
        for dataset_info in dataset_infos:
            storage_backend = storage.construct_storage_backend(
                dataset_info.manifest_path,
                cache_config=self.cache_config,
            )
            storage_backend.data_auth(access_type=storage.AccessType.READ)

        # Download the datasets
        download_summaries = downloading.download(
            dataset_infos,
            destination,
            regex=regex,
            resume=resume,
            enable_progress_tracker=self.enable_progress_tracker,
            executor_params=self.executor_params,
            cache_config=self.cache_config,
        )

        logger.info(
            'Dataset %s from bucket %s has been downloaded to %s',
            self.dataset.name,
            self.dataset.bucket,
            destination,
        )

        total_retries = 0
        total_failures = []

        for download_summary in download_summaries.values():
            total_retries += download_summary.retries
            total_failures.extend(download_summary.failures)

        if total_retries:
            logger.info('Retried %s times', total_retries)
        if total_failures:
            logger.info('Download Failed on files:')
            for message in total_failures:
                logger.info(message)

        return download_summaries

    ################
    #    Upload    #
    ################

    def upload_start(
        self,
        input_paths: List[str],
        *,
        description: str | None = None,
        resume: bool = False,
        metadata: Dict[str, common.JSONValue] | None = None,
    ) -> common.UploadStartResult:
        """
        Starts an upload of a dataset by creating a new version.

        .. important::
            Upload operations should be initiated with this method to ensure that subsequent
            calls to `upload` are scoped to the same upload version (in the event of retries
            and failures).

        :param List[str] input_paths: The paths to the input files.
        :param str | None description: The description of the dataset.
        :param bool resume: Whether to resume the upload from a previous attempt.
        :param Dict[str, common.JSONValue] | None metadata: The metadata of the dataset.

        :return: The upload start response.
        :rtype: UploadStartResponse

        :raises osmo_errors.OSMOCredentialError: If credential validation fails for any
                                                 storage backend used in the dataset.
        """
        if resume and not self.dataset.tag:
            raise osmo_errors.OSMOUserError('Specify specific version in order to resume.')

        # Perform Authentication against bucket location
        location_result: common.LocationResponse = self.service_client.request(
            client.RequestMethod.GET,
            common.construct_location_api_path(self.dataset),
        )
        path_components = storage.construct_storage_backend(
            location_result['path'],
            cache_config=self.cache_config,
        )
        path_components.data_auth(access_type=storage.AccessType.WRITE)

        # Parse and validate the input paths
        local_paths, backend_paths = common.parse_upload_paths(input_paths)

        # Make a upload request to the service client
        upload_response: common.UploadResponse = self.service_client.request(
            client.RequestMethod.POST,
            common.construct_upload_api_path(self.dataset),
            params={
                'tag': self.dataset.tag,
                'description': description or '',
                'resume': resume,
            },
            payload={
                'metadata': metadata or {},
            },
        )

        return common.UploadStartResult(
            upload_response=upload_response,
            local_upload_paths=local_paths,
            backend_upload_paths=backend_paths,
        )

    def upload(
        self,
        upload_start_result: common.UploadStartResult,
        *,
        regex: str | None = None,
        request_headers: List[storage.RequestHeaders] | None = None,
        labels: Dict[str, common.JSONValue] | None = None,
    ) -> common.UploadResult:
        """
        Uploads data to the dataset.

        :param common.UploadStartResult upload_start_result: The upload start result.
        :param str | None regex: The regex to filter the dataset by.
        :param List[storage.RequestHeaders] | None request_headers: The request headers.
        :param Dict[str, common.JSONValue] | None labels: The labels to set for the dataset.

        :return: The upload response.
        :rtype: UploadResult
        """
        logger.info(
            'Uploading to Dataset %s version %s bucket %s',
            self.dataset.name,
            upload_start_result.upload_response['version_id'],
            self.dataset.bucket,
        )

        # Uploads the data to the dataset
        upload_operation_result = uploading.upload(
            upload_start_result,
            regex=regex,
            enable_progress_tracker=self.enable_progress_tracker,
            executor_params=self.executor_params,
            request_headers=request_headers,
            cache_config=self.cache_config,
        )

        # Mark Upload as Done
        upload_response: common.UploadResponse = self.service_client.request(
            client.RequestMethod.POST,
            common.construct_upload_api_path(self.dataset),
            params={
                'tag': self.dataset.tag,
                'finish': True,
                'version_id': upload_start_result.upload_response['version_id'],
                'checksum': upload_operation_result.checksum,
                'size': upload_operation_result.summary.size,
                'update_dataset_size': upload_operation_result.summary.size_transferred,
            },
            payload={
                'labels': labels or {},
            },
        )

        upload_summary = upload_operation_result.summary

        if logger.isEnabledFor(logging.INFO):
            # Print summary to logger if enabled
            logger.info(
                'Dataset %s has been uploaded to bucket %s',
                self.dataset.name,
                self.dataset.bucket,
            )

            logger.info(
                'Uploaded %s new data to the storage.',
                utils_common.storage_convert(upload_summary.size_transferred),
            )

            if upload_summary.retries:
                logger.info('Retried %s times', upload_summary.retries)

            if upload_summary.failures:
                logger.info('Upload Failed on files:')
                for message in upload_summary.failures:
                    logger.info(message)

        return common.UploadResult(
            upload_response=upload_response,
            upload_summary=upload_summary,
        )

    ################
    #    Update    #
    ################

    def _update_dataset_start(
        self,
        add_paths: List[str] | None,
        remove_regex: str | None,
        resume_tag: str | None,
        metadata: Dict[str, common.JSONValue] | None,
    ) -> common.UpdateStartResult:
        """
        Starts an update of a dataset by creating a new version.
        """
        # Validate that the dataset is a manifest based dataset
        download_response = self.validate_download()
        current_manifest_path = download_response['locations'][0]

        # Perform Authentication against bucket location
        location_result: common.LocationResponse = self.service_client.request(
            client.RequestMethod.GET,
            common.construct_location_api_path(self.dataset),
        )
        path_components = storage.construct_storage_backend(
            location_result['path'],
            cache_config=self.cache_config,
        )

        if remove_regex:
            # Validate delete access
            path_components.data_auth(access_type=storage.AccessType.DELETE)
        if add_paths:
            # Validate write access
            path_components.data_auth(access_type=storage.AccessType.WRITE)

        # If add_paths is provided, seperate paths and perform basic authentication
        # against backend paths
        local_to_remote_mappings: List[common.LocalToRemoteMapping] | None = None
        remote_to_remote_mappings: List[common.RemoteToRemoteMapping] | None = None
        if add_paths:
            local_to_remote_mappings, remote_to_remote_mappings = common.parse_update_paths(
                add_paths,
            )

        # Create new dataset version
        upload_response: common.UploadResponse = self.service_client.request(
            client.RequestMethod.POST,
            common.construct_upload_api_path(self.dataset),
            params={
                'tag': resume_tag or '',
                'resume': resume_tag is not None,
            },
            payload={
                'metadata': metadata or {},
            },
        )

        return common.UpdateStartResult(
            upload_response=upload_response,
            current_manifest_path=current_manifest_path,
            local_update_paths=local_to_remote_mappings,
            backend_update_paths=remote_to_remote_mappings,
            remove_regex=remove_regex,
        )

    def update_start(
        self,
        *,
        add_paths: List[str] | None = None,
        remove_regex: str | None = None,
        resume_tag: str | None = None,
        metadata: Dict[str, common.JSONValue] | None = None,
    ) -> common.UpdateStartResult:
        """
        Starts an update of a dataset by creating a new version.

        .. important::
            Update operations should be initiated with this method to ensure that subsequent
            calls to `update` are scoped to the same update version (in the event of retries
            and failures).

        .. note::
            At least one of `add_paths` or `remove_regex` must be provided. Both are acceptable.

        :param List[str] | None add_paths: The paths to the input files.
        :param str | None remove_regex: The regex to filter the dataset by.
        :param str | None resume_tag: The tag to resume the update from.
        :param Dict[str, common.JSONValue] | None metadata: The metadata of the dataset.

        :return: The update start response.
        :rtype: UpdateStartResult

        :raises osmo_errors.OSMOCredentialError: If credential validation fails for any
                                                 storage backend used in the dataset.
        """
        if not add_paths and not remove_regex:
            raise osmo_errors.OSMOUserError(
                'At least one of add_paths or remove_regex must be provided.',
            )

        info_result = self.service_client.request(
            client.RequestMethod.GET,
            common.construct_info_api_path(self.dataset),
            params={
                'tag': self.dataset.tag,
                'all_flag': False,
                'order': 'DESC',
                'count': 1,
            },
        )

        match info_result['type']:
            case 'DATASET':
                return self._update_dataset_start(
                    add_paths=add_paths,
                    remove_regex=remove_regex,
                    resume_tag=resume_tag,
                    metadata=metadata,
                )
            case 'COLLECTION':
                raise osmo_errors.OSMOUserError(
                    f'Cannot update collections. {self.dataset.name} in bucket '
                    f'{self.dataset.bucket} is a collection.',
                )
            case _:
                raise osmo_errors.OSMOUserError(f'Invalid dataset type: {info_result["type"]}')

    def update(
        self,
        update_start_result: common.UpdateStartResult,
        *,
        request_headers: List[storage.RequestHeaders] | None = None,
        labels: Dict[str, common.JSONValue] | None = None,
    ) -> common.UploadResult:
        """
        Updates a dataset.

        :param common.UpdateStartResult update_start_result: The update start result.
        :param List[storage.RequestHeaders] | None request_headers: The request headers.
        :param Dict[str, common.JSONValue] | None labels: The labels to set for the dataset.

        :return: The update response (reuses the upload result class).
        :rtype: UploadResult
        """
        if (
            not update_start_result.local_update_paths
            and not update_start_result.backend_update_paths
            and not update_start_result.remove_regex
        ):
            raise osmo_errors.OSMOUserError(
                'At least one of local_update_paths, backend_update_paths, or remove_regex '
                'must be provided.',
            )

        logger.info(
            'Updating Dataset %s version %s bucket %s',
            self.dataset.name,
            update_start_result.upload_response['version_id'],
            self.dataset.bucket,
        )

        # Updates the dataset
        upload_operation_result = updating.update(
            update_start_result,
            enable_progress_tracker=self.enable_progress_tracker,
            executor_params=self.executor_params,
            request_headers=request_headers,
            cache_config=self.cache_config,
        )

        # Marks Update as Done
        upload_response: common.UploadResponse = self.service_client.request(
            client.RequestMethod.POST,
            common.construct_upload_api_path(self.dataset),
            params={
                'tag': self.dataset.tag,
                'finish': True,
                'version_id': update_start_result.upload_response['version_id'],
                'checksum': upload_operation_result.checksum,
                'size': upload_operation_result.summary.size,
                'update_dataset_size': upload_operation_result.summary.size_transferred,
            },
            payload={
                'labels': labels or {},
            },
        )

        upload_summary = upload_operation_result.summary

        if logger.isEnabledFor(logging.INFO):
            # Print summary to logger if enabled
            logger.info(
                'Dataset %s has been updated in bucket %s',
                self.dataset.name,
                self.dataset.bucket,
            )

            logger.info(
                'Uploaded %s new data to the storage.',
                utils_common.storage_convert(upload_summary.size_transferred),
            )

            if upload_summary.retries:
                logger.info('Retried %s times', upload_summary.retries)

            if upload_summary.failures:
                logger.info('Upload Failed on files:')
                for message in upload_summary.failures:
                    logger.info(message)

        return common.UploadResult(
            upload_response=upload_response,
            upload_summary=upload_summary,
        )

    def migrate(self) -> common.MigrateResult:
        """
        Migrates a dataset to a manifest based dataset.
        """
        # Get the hash location (file destination)
        info_result = self.service_client.request(
            client.RequestMethod.GET,
            common.construct_info_api_path(self.dataset),
            params={
                'tag': self.dataset.tag,
            },
        )
        hash_location = info_result['hash_location']

        # Make a download request to the service client
        download_response: common.DownloadResponse = self.service_client.request(
            client.RequestMethod.GET,
            common.construct_download_api_path(self.dataset),
            params={
                'tag': self.dataset.tag,
            },
        )

        migrated = False
        summaries: Dict[str, storage.CopySummary] = {}

        for dataset_name, old_location, new_location in zip(
            download_response.get('dataset_names', []),
            download_response.get('locations', []),
            download_response.get('new_locations', []),
            strict=True,
        ):
            if not new_location:
                continue

            logger.info('Migrating %s to use manifests', dataset_name)

            migrate_operation_result = migrating.migrate(
                source_uri=old_location,
                destination_uri=hash_location,
                destination_manifest_uri=new_location,
                enable_progress_tracker=self.enable_progress_tracker,
                executor_params=self.executor_params,
                cache_config=self.cache_config,
            )

            summaries[dataset_name] = migrate_operation_result.summary

            migrated = True
            logger.info('Finished migrating %s to use manifests', dataset_name)

        if migrated:
            download_response = self.service_client.request(
                client.RequestMethod.POST,
                common.construct_migrate_api_path(self.dataset),
                params={
                    'tag': self.dataset.tag,
                },
            )
        else:
            logger.info('No datasets to migrate')

        return common.MigrateResult(
            migrate_response=download_response,
            summaries=summaries,
        )

    def validate_download(self) -> common.DownloadResponse:
        """
        Validates that the dataset is a manifest based dataset.
        """
        # Make a download request to the service client
        download_response: common.DownloadResponse = self.service_client.request(
            client.RequestMethod.GET,
            common.construct_download_api_path(self.dataset),
            params={
                'tag': self.dataset.tag,
            },
        )

        if not download_response.get('dataset_names') or not download_response.get('locations'):
            raise osmo_errors.OSMODatasetError('Invalid dataset download response')

        # Validate that the dataset is a manifest based dataset
        if any(len(location) > 0 for location in download_response.get('new_locations', [])):
            raise osmo_errors.OSMOUserError(
                'Cannot operate on a legacy (non-manifest based) dataset. '
                'Please migrate the dataset via `osmo dataset migrate '
                f'{self.dataset.bucket}/{self.dataset.name}:{self.dataset.tag}`',
            )

        return download_response
