"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

import base64
import datetime
import json
import shlex
from typing import Any, Dict, List, Sequence
import uuid

import fastapi

from src.lib.data import storage
from src.lib.utils import common, osmo_errors
from src.service.core.data import objects, query
from src.service.core.workflow import objects as wf_objects # pylint: disable=unused-import
from src.utils import connectors


router = fastapi.APIRouter(
    prefix='/api/bucket',
    tags = ['Dataset API']
)


def create_uuid() -> str:
    unique_id = uuid.uuid4()
    return base64.urlsafe_b64encode(unique_id.bytes).decode('utf-8')[:-2]


def get_dataset(postgres: connectors.PostgresConnector, bucket: str, name: str) -> Any:
    """
    Helper function for getting value from postgres fetch on dataset when the dataset should exist
    """
    fetch_cmd = '''
        SELECT * FROM dataset
        WHERE name = %s AND bucket = %s;
        '''
    dataset_info = postgres.execute_fetch_command(fetch_cmd, (name, bucket))

    if not dataset_info:
        raise osmo_errors.OSMOUserError(f'Could not find dataset or collection {name} ' +\
                                        f'in bucket {bucket}')
    return dataset_info[0]


def get_dataset_version(postgres: connectors.PostgresConnector, bucket: objects.DatasetPattern,
                        name: str, tag: str) -> Any:
    """
    Helper function for getting dataset_version
    """
    fetch_cmd = '''
        SELECT dataset_version.*, dataset.name FROM dataset_version
        INNER JOIN dataset ON dataset.id = dataset_version.dataset_id
        WHERE dataset_version.dataset_id = (SELECT id FROM dataset
            WHERE name = %s AND bucket = %s)
    '''
    fetch_inputs = [name, bucket]

    if tag:
        fetch_cmd += '''
            AND (dataset_version.version_id = %s OR dataset_version.version_id IN
            (SELECT version_id FROM dataset_tag WHERE tag = %s AND
                dataset_id = (SELECT id FROM dataset
                    WHERE name = %s AND bucket = %s)))
        '''
        fetch_inputs += [tag, tag, name, bucket]

    fetch_cmd += ' LIMIT 1;'

    dataset_rows = postgres.execute_fetch_command(fetch_cmd, tuple(fetch_inputs))
    if not dataset_rows:
        if not tag:
            tag = 'latest'
        raise osmo_errors.OSMOUserError(f'Dataset {name} tag {tag} does not exist in ' +\
                                        f'bucket {bucket}')
    return dataset_rows[0]


def is_collection(postgres: connectors.PostgresConnector, bucket: str, name: str) -> bool:
    return get_dataset(postgres, bucket, name).is_collection


def get_collection_datasets(postgres: connectors.PostgresConnector, bucket: str, name: str) -> List:
    """
    Helper function for getting datasets in a collection
    """
    fetch_cmd = '''
            SELECT collection.dataset_id, collection.version_id, dataset_version.location,
                dataset.hash_location,
                dataset_version.size, dataset.name from collection
            INNER JOIN dataset ON dataset.id = collection.dataset_id
            INNER JOIN dataset_version
                ON dataset_version.dataset_id = collection.dataset_id
                AND dataset_version.version_id = collection.version_id
            WHERE collection.id = (SELECT id FROM dataset
                WHERE name = %s AND bucket = %s)
            ORDER BY dataset.name;
        '''
    return postgres.execute_fetch_command(fetch_cmd, (name, bucket))


def get_collection_info(postgres: connectors.PostgresConnector,
                        bucket: str,
                        name: str) -> Sequence[objects.DataInfoCollectionEntry]:

    dataset_rows = get_collection_datasets(postgres, bucket, name)
    bucket_config = postgres.get_dataset_configs().get_bucket_config(bucket)

    rows: List[objects.DataInfoCollectionEntry] = []
    for row in dataset_rows:
        rows.append(objects.DataInfoCollectionEntry(
            name=row.name,
            version=row.version_id,
            location=storage.construct_storage_backend(row.location)\
                .parse_uri_to_link(bucket_config.region),
            uri=row.location,
            hash_location=row.hash_location,
            size=row.size))
    return rows


def get_dataset_info(postgres: connectors.PostgresConnector,
                     bucket: str,
                     name: str,
                     tag: str,
                     all_flag: bool,
                     count: int | None = None,
                     order: connectors.ListOrder = connectors.ListOrder.ASC
                     ) -> Sequence[objects.DataInfoDatasetEntry]:
    fetch_cmd = '''
        SELECT * FROM dataset_version
        WHERE dataset_id = (SELECT id FROM dataset WHERE name = %s AND bucket = %s)
        '''
    fetch_input: List = [name, bucket]
    if not (all_flag or tag):
        fetch_cmd += ' AND status = %s'
        fetch_input.append(objects.DatasetStatus.READY.name)
    if tag:
        fetch_cmd += '''
            AND (version_id = %s OR version_id IN
            (SELECT version_id FROM dataset_tag
             WHERE tag = %s
             AND dataset_id = (SELECT id FROM dataset WHERE name = %s and bucket = %s)))
        '''
        fetch_input += [tag, tag, name, bucket]
    if count:
        fetch_cmd += ' ORDER BY created_date DESC LIMIT %s'
        fetch_input.append(count)

    fetch_cmd = f'SELECT * FROM ({fetch_cmd}) as ds'
    if order == connectors.ListOrder.ASC:
        fetch_cmd += ' ORDER BY created_date ASC'
    else:
        fetch_cmd += ' ORDER BY created_date DESC'
    fetch_cmd += ';'

    dataset_rows = postgres.execute_fetch_command(fetch_cmd, tuple(fetch_input))

    if not dataset_rows:
        raise osmo_errors.OSMODatabaseError(f'Dataset/Collection {name} does not have '
                                            f'any entry fitting the parameters in bucket {bucket}.')

    bucket_config = postgres.get_dataset_configs().get_bucket_config(bucket)

    rows: List[objects.DataInfoDatasetEntry] = []
    for row in dataset_rows:
        fetch_cmd = '''
            SELECT * FROM dataset
            WHERE id in (SELECT id FROM collection WHERE dataset_id = %s AND version_id = %s);
            '''
        collections = postgres.execute_fetch_command(fetch_cmd, (row.dataset_id, row.version_id))
        fetch_cmd = '''
            SELECT * FROM dataset_tag
            WHERE dataset_id = %s AND version_id = %s;
            '''
        tags = postgres.execute_fetch_command(fetch_cmd, (row.dataset_id, row.version_id))
        rows.append(objects.DataInfoDatasetEntry(
            name=name,
            version=row.version_id,
            status=row.status,
            created_by=row.created_by,
            created_date=row.created_date.replace(microsecond=0),
            last_used=row.last_used.replace(microsecond=0),
            retention_policy=row.retention_policy,
            size=row.size if row.size else 0,
            checksum=row.checksum if row.checksum else 0,
            location=storage.construct_storage_backend(row.location)\
                .parse_uri_to_link(bucket_config.region),
            uri=row.location,
            metadata=row.metadata,
            tags=[element.tag for element in tags],
            collections=[element.name for element in collections]))
    return rows


def upload_start(bucket: objects.DatasetPattern,
                 name: objects.DatasetPattern,
                 tag: str,
                 description: str,
                 metadata: Dict[str, Any],
                 resume: bool,
                 user_header: str):
    postgres = connectors.PostgresConnector.get_instance()
    dataset_config = postgres.get_dataset_configs()
    bucket_config = dataset_config.get_bucket_config(bucket)

    current_time = common.current_time()

    if resume:
        # Resume requires version_id as tag
        version = tag
        if not version:
            raise osmo_errors.OSMOUserError('Version is required to resume.')

        if not version.isnumeric():
            raise osmo_errors.OSMOUserError(f'Version must be a number: {tag}')

        # See if dataset exists
        fetch_cmd = 'SELECT * FROM dataset WHERE name = %s and bucket = %s;'
        dataset_rows = postgres.execute_fetch_command(fetch_cmd, (name, bucket))

        if not dataset_rows:
            raise osmo_errors.OSMOUserError(f'Dataset {name} does not exist to resume.')
        elif dataset_rows[0].is_collection:
            raise osmo_errors.OSMOUserError(f'Dataset name {name} is a Collection')

        dataset_id = dataset_rows[0].id
        fetch_cmd = '''
            SELECT * FROM dataset_version
            WHERE dataset_id = %s
            AND version_id = %s
            AND status = %s;
            '''
        version_rows = postgres.execute_fetch_command(fetch_cmd,
                                                      (dataset_id, version,
                                                       objects.DatasetStatus.PENDING.name))

        if not version_rows:
            raise osmo_errors.OSMOUserError(f'Dataset {name} tag {tag} does not '
                                            'have any PENDING versions.')

        version_id = version_rows[0].version_id
        manifest_location = version_rows[0].location
        hash_location = dataset_rows[0].hash_location
    else:
        if tag.isnumeric():
            raise osmo_errors.OSMOUserError(f'Tags cannot be a number: {tag}')

        # Creates an entry in the dataset table.
        fetch_cmd = '''
            WITH input_rows(name, id, created_by, created_date, is_collection, labels,
                last_version, bucket, hash_location, hash_location_size) AS (
                VALUES(TEXT %s, TEXT %s, TEXT %s, TIMESTAMP %s, BOOLEAN %s, JSONB %s,
                    INT %s, TEXT %s, TEXT %s, BIGINT %s))
            , ins AS (
                INSERT INTO dataset (name, id, created_by, created_date, is_collection, labels,
                    last_version, bucket, hash_location, hash_location_size)
                SELECT * FROM input_rows
                ON CONFLICT (name, bucket) DO NOTHING
                RETURNING id, is_collection, hash_location
            )
            SELECT id, is_collection, hash_location FROM ins
            UNION ALL
            SELECT d.id, d.is_collection, d.hash_location FROM input_rows
            JOIN dataset d USING (name, bucket);
        '''
        dataset_id = create_uuid()
        dataset_rows = postgres.execute_fetch_command(
            fetch_cmd,
            (name, dataset_id, user_header, current_time, 'false', json.dumps({}), '0', bucket,
             f'{bucket_config.dataset_path}/{dataset_id}/hashes',
             '0'))
        if dataset_rows[0].is_collection:
            raise osmo_errors.OSMOUserError(f'Dataset name {name} is already a Collection')
        else:
            dataset_id = dataset_rows[0].id
        hash_location = dataset_rows[0].hash_location

        # Loop in case of collisions
        retry = 0
        while True:
            try:
                insert_cmd = '''
                    WITH updated_version AS (
                        UPDATE dataset SET last_version = last_version + 1
                        WHERE id = %s
                        RETURNING last_version
                    )
                    INSERT INTO dataset_version
                    (dataset_id, version_id, location, status, created_by,
                    created_date, last_used, metadata, retention_policy)
                    SELECT %s, updated_version.last_version,
                    %s || updated_version.last_version || '.json', %s, %s, %s, %s, %s, %s
                    FROM updated_version
                    RETURNING version_id, location;
                '''
                metadata.update({'description': description})

                version_info = postgres.execute_fetch_command(
                    insert_cmd,
                    (dataset_id, dataset_id,
                    f'{bucket_config.dataset_path}/{dataset_id}/manifests/',
                    objects.DatasetStatus.PENDING.name,
                    user_header, current_time, current_time, json.dumps(metadata), 'P3M'))
                break
            except osmo_errors.OSMODatabaseError as err:
                if retry >= 5:
                    raise osmo_errors.OSMODatabaseError(f'Create Dataset Version Failure: {err}')
                retry += 1

        version_id = version_info[0].version_id
        manifest_location = version_info[0].location

    return objects.DataUploadResponse(version_id=version_id,
                                      region=bucket_config.region,
                                      storage_path=hash_location,
                                      manifest_path=manifest_location)


def upload_finish(bucket: objects.DatasetPattern,
                  name: objects.DatasetPattern,
                  tag: str,
                  version_id: str,
                  checksum: str,
                  size: int,
                  labels: Dict[str, Any],
                  update_dataset_size: int):
    postgres = connectors.PostgresConnector.get_instance()

    dataset_info = get_dataset(postgres, bucket=bucket, name=name)

    fetch_cmd = '''
        SELECT * FROM dataset_version
        WHERE dataset_id = %s AND version_id = %s;
        '''
    version_rows = postgres.execute_fetch_command(fetch_cmd, (dataset_info.id, version_id))
    if not version_rows:
        raise osmo_errors.OSMODatabaseError(f'Dataset version {version_id} does not exist in ' +\
                                            f'bucket {bucket}.')

    update_cmd = '''
        BEGIN;
            UPDATE dataset_version SET status = %s, checksum = %s, size = %s
            WHERE dataset_id = %s AND version_id = %s;

            UPDATE dataset SET hash_location_size = hash_location_size + %s
            WHERE id = %s;
        COMMIT;
    '''
    postgres.execute_commit_command(
        update_cmd,
        (objects.DatasetStatus.READY.name, checksum, size, dataset_info.id, version_id,
         update_dataset_size, dataset_info.id))

    # Set Tag Latest to the version
    # Add Tag to Dataset Version
    insert_params = [version_rows[0].dataset_id, version_id]
    tag_value = ''
    if tag and tag != 'latest':
        tag_value = ', (%s, %s, %s)'
        insert_params += [version_rows[0].dataset_id, version_id, tag]
    insert_cmd = f'''
        INSERT INTO dataset_tag
        (dataset_id, version_id, tag)
        VALUES (%s, %s, 'latest'){tag_value} ON CONFLICT (dataset_id, tag) DO UPDATE
        SET version_id = EXCLUDED.version_id;
    '''

    postgres.execute_commit_command(insert_cmd, tuple(insert_params))

    update_labels(bucket, name, labels, [])


def build_collection(postgres: connectors.PostgresConnector,
                     bucket: objects.DatasetPattern,
                     inital_datasets: Dict[str, str] | None = None,
                     remove_datasets: List[objects.DatasetStructure] | None = None,
                     add_datasets: List[objects.DatasetStructure] | None = None) -> Dict[str, str]:
    if not inital_datasets:
        inital_datasets = {}
    if not remove_datasets:
        remove_datasets = []
    if not add_datasets:
        add_datasets = []

    new_datasets: Dict[str, str] = inital_datasets
    for element in remove_datasets:
        if is_collection(postgres, bucket, element.name):
            dataset_rows = get_collection_datasets(postgres, bucket, element.name)
            for row in dataset_rows:
                # Remove dataset if exists
                if row.dataset_id in new_datasets:
                    if row.version_id != new_datasets[row.dataset_id]:
                        raise osmo_errors.OSMOUserError(f'Cannot Delete Dataset {row.name} version '
                                                        f'{row.version_id}. Collection contains '
                                                        f'{new_datasets[row.dataset_id]}.')
                    new_datasets.pop(row.dataset_id)
        else:
            dataset_row = get_dataset_version(postgres, bucket, element.name, element.tag)

            if dataset_row.dataset_id in new_datasets:
                # Make sure the selected version is equal to the one that exists
                if element.tag and\
                   dataset_row.version_id != new_datasets[dataset_row.dataset_id]:
                    raise osmo_errors.OSMOUserError(f'Cannot Delete Dataset {element.name} version '
                                                    f'{dataset_row.version_id}. Collection '
                                                    'contains '
                                                    f'{new_datasets[dataset_row.dataset_id]}.')
                new_datasets.pop(dataset_row.dataset_id)

    for element in add_datasets:
        if is_collection(postgres, bucket, element.name):
            dataset_rows = get_collection_datasets(postgres, bucket, element.name)
            for row in dataset_rows:
                # Make sure there is only one version of each dataset
                if row.dataset_id in new_datasets and\
                   row.version_id != new_datasets[row.dataset_id]:
                    raise osmo_errors.OSMOUserError(f'Dataset {row.name} versions appears '
                                                    'more than once. Only 1 version of a '
                                                    'dataset can be in the Collection')
                new_datasets[row.dataset_id] = row.version_id
        else:
            if not element.tag:
                element.tag = 'latest'

            dataset_row = get_dataset_version(postgres, bucket, element.name, element.tag)

            # Make sure there is only one version of each dataset
            if dataset_row.dataset_id in new_datasets and\
                dataset_row.version_id != new_datasets[dataset_row.dataset_id]:
                raise osmo_errors.OSMOUserError(f'Dataset {element.name} versions appears more '
                                                'than once. Only 1 version of a '
                                                'dataset can be in the Collection')
            new_datasets[dataset_row.dataset_id] = dataset_row.version_id
    return new_datasets


@router.get('')
def get_bucket_info(default_only: bool = False,
                    username: str = fastapi.Depends(connectors.parse_username)
                    ) -> objects.BucketInfoResponse:
    """
    This api allows users to fetch the default bucket and the list of available buckets.
    """
    postgres = connectors.PostgresConnector.get_instance()
    dataset_configs = postgres.get_dataset_configs()

    bucket_information = {}
    if not default_only:
        bucket_information = {
            bucket_name: objects.BucketInfoEntry(
                path=bucket_info.dataset_path,
                description=bucket_info.description,
                mode=bucket_info.mode,
                default_cred=bucket_info.default_credential is not None\
                    and bucket_info.default_credential.access_key_id != '')\
                for bucket_name, bucket_info in dataset_configs.buckets.items()
        }

    default_bucket = connectors.UserProfile.fetch_from_db(postgres, username).bucket
    if not default_bucket:
        default_bucket = dataset_configs.default_bucket

    return objects.BucketInfoResponse(
        default=default_bucket,
        buckets=bucket_information)


@router.post('/{bucket}/dataset/{name}', include_in_schema=False)
def upload_dataset(bucket: objects.DatasetPattern,
                   name: objects.DatasetPattern,
                   tag: objects.DatasetTagPattern = '',
                   # For starting upload
                   description: str = '',
                   metadata: Dict = fastapi.Body(default = {}),
                   resume: bool = False,
                   # For finishing upload
                   finish: bool = False,
                   version_id: str = '',
                   checksum: str = '',
                   size: int = 0,
                   labels: Dict = fastapi.Body(default = {}),
                   # Size change in the dataset folder
                   update_dataset_size: int = 0,
                   username: str = fastapi.Depends(connectors.parse_username))\
                   -> objects.DataUploadResponse:
    """
    This api creates the dataset in the table. If finish is false, it creates the pending
    version. Otherwise, it will set the corresponding version to READY.
    """
    dataset_configs = connectors.PostgresConnector.get_instance().get_dataset_configs()
    # Make sure the bucket exists
    bucket_info = dataset_configs.get_bucket_config(bucket)
    bucket_info.valid_access(bucket, connectors.BucketModeAccess.WRITE)

    if not name:
        raise osmo_errors.OSMOUserError('Name is required.')
    if not finish:
        return upload_start(bucket, name, tag, description, metadata, resume, username)

    upload_finish(bucket, name, tag, version_id, checksum, size, labels, update_dataset_size)
    return objects.DataUploadResponse(version_id=version_id)


def _download_datasets(
    postgres: connectors.PostgresConnector,
    bucket: objects.DatasetPattern,
    name: objects.DatasetPattern,
    tag: objects.DatasetTagPattern,
    *,
    migrate: bool = False,
):
    dataset_info = get_dataset(postgres, bucket, name)
    if dataset_info.is_collection:
        fetch_cmd = '''
            SELECT collection.version_id, dataset_version.location, dataset.id, dataset.bucket,
            dataset.name FROM collection
            INNER JOIN dataset ON dataset.id = collection.dataset_id
            INNER JOIN dataset_version ON dataset_version.dataset_id = collection.dataset_id
                AND dataset_version.version_id = collection.version_id
            WHERE collection.id = %s;
            '''
        dataset_rows = postgres.execute_fetch_command(fetch_cmd, (dataset_info.id,))

        if not dataset_rows:
            raise osmo_errors.OSMODatabaseError(f'Collection {name} is empty in bucket {bucket}.')
    else:
        fetch_cmd = '''
            SELECT dataset_version.version_id, dataset_version.location, dataset.name, dataset.id,
            dataset.bucket
            FROM dataset_version INNER JOIN dataset
            ON dataset_version.dataset_id = dataset.id
            WHERE dataset.id = %s
            AND (version_id = %s OR version_id IN
                (SELECT version_id FROM dataset_tag WHERE tag = %s
                 AND dataset_id = %s))
            AND dataset_version.status = %s;
            '''
        dataset_rows = postgres.execute_fetch_command(fetch_cmd,
                                                      (dataset_info.id, tag, tag, dataset_info.id,
                                                       objects.DatasetStatus.READY.name))

        if not dataset_rows:
            raise osmo_errors.OSMODatabaseError(f'There is no READY dataset {name} with tag or ' +\
                                                f'id {tag} in bucket {bucket}.')

    dataset_config = postgres.get_dataset_configs()

    new_locations = []
    for row in dataset_rows:
        if not row.location.endswith('.json'):
            bucket_config = dataset_config.get_bucket_config(row.bucket)
            new_locations.append(f'{bucket_config.dataset_path}/{row.id}/manifests/'
                                 f'{row.version_id}.json')
        else:
            new_locations.append('')

    if migrate:
        for row, new_location in zip(dataset_rows, new_locations):
            if new_location:
                update_cmd = '''
                    UPDATE dataset_version SET location = %s
                    WHERE dataset_id = %s and version_id = %s;
                '''
                postgres.execute_commit_command(update_cmd,
                                                (new_location, row.id, row.version_id))

    # Update Last Used
    for row in dataset_rows:
        update_cmd = '''
            UPDATE dataset_version SET last_used = %s
            WHERE dataset_id = %s AND version_id = %s;
        '''
        postgres.execute_commit_command(
            update_cmd,
            (common.current_time(), row.id, row.version_id))

    bucket_config = dataset_config.get_bucket_config(bucket)
    return objects.DataDownloadResponse(dataset_names=[row.name for row in dataset_rows],
                                        dataset_versions=[row.version_id for row in dataset_rows],
                                        locations=[row.location for row in dataset_rows],
                                        new_locations=new_locations,
                                        is_collection=dataset_info.is_collection)


@router.get('/{bucket}/dataset/{name}', include_in_schema=False)
def download(
    bucket: objects.DatasetPattern,
    name: objects.DatasetPattern,
    tag: objects.DatasetTagPattern | None = fastapi.Query(default=None),
) -> objects.DataDownloadResponse:
    """ This api returns the dataset download response. """
    if not tag:
        tag = 'latest'

    postgres = connectors.PostgresConnector.get_instance()
    dataset_configs = postgres.get_dataset_configs()
    # Make sure the bucket exists
    bucket_info = dataset_configs.get_bucket_config(bucket)
    bucket_info.valid_access(bucket, connectors.BucketModeAccess.READ)
    return _download_datasets(postgres, bucket, name, tag)


@router.post('/{bucket}/dataset/{name}/migrate', include_in_schema=False)
def migrate_dataset(
    bucket: objects.DatasetPattern,
    name: objects.DatasetPattern,
    tag: objects.DatasetTagPattern | None = fastapi.Query(default=None),
) -> objects.DataDownloadResponse:
    """ This api migrates the dataset to a manifest based dataset. """
    if not tag:
        tag = 'latest'

    postgres = connectors.PostgresConnector.get_instance()
    dataset_configs = postgres.get_dataset_configs()
    # Make sure the bucket exists
    bucket_info = dataset_configs.get_bucket_config(bucket)
    bucket_info.valid_access(bucket, connectors.BucketModeAccess.READ)
    return _download_datasets(postgres, bucket, name, tag, migrate=True)


def clean_dataset(postgres: connectors.PostgresConnector,
                  dataset_info):
    delete_cmd = '''
        BEGIN;
            DELETE FROM dataset_version
                WHERE dataset_id = %s AND status = %s;
            DELETE FROM dataset
                WHERE id = %s
                AND id NOT IN (SELECT dataset_id from dataset_version);
        COMMIT;
        '''
    postgres.execute_commit_command(delete_cmd, (dataset_info.id,
                                                 objects.DatasetStatus.PENDING_DELETE.name,
                                                 dataset_info.id))


@router.delete('/{bucket}/dataset/{name}')
def delete_dataset(bucket: objects.DatasetPattern,
                   name: objects.DatasetPattern,
                   tag: objects.DatasetTagPattern | None = None,
                   all_flag: bool = False,
                   # Delete the dataset from database
                   finish: bool = False):
    """ This api deletes a Dataset. """
    postgres = connectors.PostgresConnector.get_instance()
    if all_flag:
        dataset_tag = ''
    elif tag:
        dataset_tag = tag
    else:
        dataset_tag = 'latest'

    dataset_info = get_dataset(postgres, bucket=bucket, name=name)
    if finish:
        clean_dataset(postgres, dataset_info)
        return objects.DataDeleteResponse(
            delete_locations=[dataset_info.hash_location],
            cleaned_size=dataset_info.hash_location_size,
        )

    bucket_info = postgres.get_dataset_configs().get_bucket_config(bucket)

    # Delete Collection
    if dataset_info.is_collection:
        delete_cmd = '''
            DELETE FROM dataset
            WHERE id = %s;
            '''
        postgres.execute_commit_command(delete_cmd, (dataset_info.id,))
        return objects.DataDeleteResponse()

    # Make sure the bucket has correct access
    bucket_info.valid_access(bucket, connectors.BucketModeAccess.WRITE)

    # Get versions
    try:
        dataset_version_info = get_dataset_info(postgres, bucket, name, dataset_tag, all_flag, None,
                                                connectors.ListOrder.DESC)
    except osmo_errors.OSMODatabaseError as err:
        if not all_flag:
            raise err
        # In case there are no version left
        return objects.DataDeleteResponse(
            delete_locations=[dataset_info.hash_location],
            cleaned_size=dataset_info.hash_location_size,
        )

    versions = [row.version for row in dataset_version_info]

    # Mark versions for PENDING_DELETE
    update_cmd = '''
        UPDATE dataset_version SET status = %s WHERE dataset_id = %s AND version_id IN %s;
        '''
    postgres.execute_commit_command(update_cmd,
                                    (objects.DatasetStatus.PENDING_DELETE.name,
                                     dataset_info.id,
                                     tuple(versions)))

    # Set Latest Tag to the Latest READY Version if latest was deleted
    fetch_cmd = '''
        SELECT * from dataset_version
        WHERE dataset_id = %s
        AND status = %s
        ORDER BY created_date DESC LIMIT 1;
        '''
    newest_ready = postgres.execute_fetch_command(fetch_cmd,
                                                  (dataset_info.id,
                                                   objects.DatasetStatus.READY.name))
    # If there is a ready version
    if newest_ready:
        insert_cmd = '''
            INSERT INTO dataset_tag (dataset_id, version_id, tag)
            VALUES (%s, %s, %s) ON CONFLICT (dataset_id, tag) DO UPDATE
            SET version_id = EXCLUDED.version_id;
        '''
        postgres.execute_commit_command(insert_cmd, (newest_ready[0].dataset_id,
                                                     newest_ready[0].version_id,
                                                     'latest'))
    else:
        delete_cmd = '''
            DELETE FROM dataset_tag
            WHERE dataset_id = %s
            AND tag = %s;
        '''
        postgres.execute_commit_command(delete_cmd, (dataset_info.id, 'latest'))

    # Delete Collections that are connected to Versions
    for version_info in dataset_version_info:
        if version_info.collections:
            for collection in version_info.collections:
                delete_cmd = '''
                    DELETE FROM dataset
                    WHERE name = %s and bucket = %s;
                    '''
                postgres.execute_commit_command(delete_cmd, (collection, bucket))

    fetch_cmd = '''
        SELECT * from dataset_version
        WHERE dataset_id = %s
        ORDER BY created_date DESC;
        '''
    version_rows = postgres.execute_fetch_command(fetch_cmd, (dataset_info.id,))

    # Keep track of all versions to delete
    delete_locations: List[str] = [dataset_info.hash_location]

    for version_row in version_rows:
        if objects.DatasetStatus.is_active(version_row.status):
            # Active version found, no need to continue
            # since we cannot hard delete yet.
            return objects.DataDeleteResponse(versions=versions)

        else:
            delete_locations.append(version_row.location)

    # No active version found, we can hard delete...
    return objects.DataDeleteResponse(
        versions=versions,
        delete_locations=delete_locations,
        cleaned_size=dataset_info.hash_location_size,
    )


def update_tags(bucket: objects.DatasetPattern,
                name: objects.DatasetPattern,
                tag: objects.DatasetTagPattern,
                set_tags: List[str],
                delete_tags: List[str]) -> objects.DataTagResponse:
    postgres = connectors.PostgresConnector.get_instance()

    for set_tag in set_tags:
        if set_tag.isnumeric():
            raise osmo_errors.OSMOUserError(f'Cannot set a number as a tag {set_tag}.')

    # Fetch tagged version
    dataset_row = get_dataset_version(postgres, bucket, name, tag)
    dataset_id = dataset_row.dataset_id
    version_id = dataset_row.version_id

    # Update Last Used
    update_cmd = '''
        UPDATE dataset_version SET last_used = %s where dataset_id = %s and version_id = %s;
    '''
    postgres.execute_commit_command(
        update_cmd,
        (common.current_time(), dataset_id, version_id))

    for set_tag in set_tags:
        # Update/Insert Tag
        insert_cmd = '''
            INSERT INTO dataset_tag (dataset_id, version_id, tag)
            VALUES (%s, %s, %s) ON CONFLICT (dataset_id, tag) DO UPDATE
            SET version_id = EXCLUDED.version_id;
        '''
        postgres.execute_commit_command(
                insert_cmd,
                (dataset_id, version_id, set_tag))

    for delete_tag in delete_tags:
        delete_cmd = '''
            DELETE FROM dataset_tag
            WHERE dataset_id = %s AND version_id = %s AND tag = %s;
        '''
        postgres.execute_commit_command(
                delete_cmd,
                (dataset_id, version_id, delete_tag))

    fetch_cmd = '''
        SELECT tag FROM dataset_tag WHERE dataset_id = %s AND version_id = %s;
        '''
    tag_rows = postgres.execute_fetch_command(fetch_cmd, (dataset_id, version_id))
    return objects.DataTagResponse(version_id=version_id, tags=[row.tag for row in tag_rows])


def update_labels(bucket: objects.DatasetPattern,
                  name: objects.DatasetPattern,
                  set_label: Dict,
                  delete_label: List[str]) -> objects.DataMetadataResponse:
    postgres = connectors.PostgresConnector.get_instance()
    new_labels = 'labels'
    update_input = []
    # Delete Labels
    if delete_label:
        for label in delete_label:
            update_input += [f'{{{label.replace(".", ",")}}}']
            new_labels += '#-%s'

    # Set Labels
    if set_label:
        common.verify_dict_keys(set_label)
        update_input += [json.dumps(set_label)]
        new_labels = f'jsonb_recursive_merge({new_labels}, %s)'

    update_cmd = 'UPDATE dataset\n' +\
                 f'SET labels = {new_labels}\n' +\
                 'WHERE name = %s AND bucket = %s\n' +\
                 'RETURNING labels;'
    dataset_info = postgres.execute_fetch_command(update_cmd, tuple(update_input + [name, bucket]))

    return objects.DataMetadataResponse(metadata=dataset_info[0].labels)


def update_meatdata(bucket: objects.DatasetPattern,
                    name: objects.DatasetPattern,
                    tag: objects.DatasetTagPattern,
                    set_key: Dict,
                    delete_key: List[str]) -> objects.DataMetadataResponse:
    postgres = connectors.PostgresConnector.get_instance()
    new_metadata = 'metadata'
    update_input = []
    # Delete Metadata
    if delete_key:
        for data_key in delete_key:
            update_input += [f'{{{data_key.replace(".", ",")}}}']
            new_metadata += '#-%s'

    # Set Metadata
    if set_key:
        common.verify_dict_keys(set_key)
        update_input += [json.dumps(set_key)]
        new_metadata = f'jsonb_recursive_merge({new_metadata}, %s)'

    update_cmd = 'UPDATE dataset_version\n' +\
                 f'SET metadata = {new_metadata}\n' +\
                 'WHERE dataset_id = (SELECT id FROM dataset WHERE name = %s AND bucket = %s)\n' +\
                 'AND (version_id = %s OR version_id IN\n' +\
                 '(SELECT version_id FROM dataset_tag WHERE tag = %s\n' +\
                 'AND dataset_id = (SELECT id FROM dataset WHERE name = %s AND bucket = %s)))\n' +\
                 'RETURNING metadata;\n'
    dataset_info = postgres.execute_fetch_command(
        update_cmd,
        tuple(update_input + [name, bucket, tag, tag, name, bucket]))

    if not dataset_info:
        raise osmo_errors.OSMOUserError(f'{name} is not a Dataset in bucket {bucket}')

    return objects.DataMetadataResponse(metadata=dataset_info[0].metadata)


def rename(bucket: objects.DatasetPattern, old_name: str, new_name: str):
    postgres = connectors.PostgresConnector.get_instance()

    dataset_info = get_dataset(postgres, bucket=bucket, name=old_name)
    if 'osmo1_entry' in dataset_info.labels:
        raise osmo_errors.OSMOUserError('This dataset/collection cannot be renamed.')

    try:
        update_command = 'UPDATE dataset SET name = %s WHERE id = %s;'
        postgres.execute_commit_command(update_command, (new_name, dataset_info.id))
    except osmo_errors.OSMODatabaseError as _:
        raise osmo_errors.OSMOUserError(f'Name {new_name} is already being used by bucket {bucket}')


@router.post('/{bucket}/dataset/{name}/attribute')
def change_name_tag_label_metadata(
    bucket: objects.DatasetPattern,
    name: objects.DatasetPattern,
    tag: objects.DatasetTagPattern | None = None,
    new_name: objects.DatasetPattern | None = None,
    set_tag: List[str] = fastapi.Query(default = []),
    delete_tag: List[str] = fastapi.Query(default = []),
    set_label: Dict = fastapi.Body(default = {}),
    delete_label: List[str] = fastapi.Query(default = []),
    set_metadata: Dict = fastapi.Body(default = {}),
    delete_metadata: List[str] = fastapi.Query(default = [])) -> objects.DataAttributeResponse:
    """
    This api can rename a dataset/collection or set/remove tags/labels/metadata.
    If tag is not given, latest tag is selected
    """
    if not tag:
        tag = 'latest'

    postgres = connectors.PostgresConnector.get_instance()
    # Validate the Dataset/Collection exists
    dataset_info = get_dataset(postgres, bucket, name)

    if dataset_info.is_collection and (set_tag or delete_tag or set_metadata or delete_metadata):
        raise osmo_errors.OSMOUserError('Collections do not support tag or metadata')

    if 'latest' in set_tag or 'latest' in delete_tag:
        raise osmo_errors.OSMOUserError('Cannot add or delete "latest" tag')

    tag_response = None
    if new_name:
        rename(bucket, name, new_name)
        name = new_name
    if set_tag or delete_tag:
        tag_response = update_tags(bucket, name, tag, set_tag, delete_tag)
    label_response = None
    if set_label or delete_label:
        label_response = update_labels(bucket, name, set_label, delete_label)
    metadata_response = None
    if set_metadata or delete_metadata:
        metadata_response = update_meatdata(bucket, name, tag, set_metadata, delete_metadata)

    return objects.DataAttributeResponse(tag_response=tag_response,
                                         label_response=label_response,
                                         metadata_response=metadata_response)


@router.get('/{bucket}/dataset/{name}/info')
def get_info(
    bucket: objects.DatasetPattern,
    name: objects.DatasetPattern,
    tag: objects.DatasetTagPattern | None = None,
    all_flag: bool = False,
    count: int = 100,
    order: connectors.ListOrder = fastapi.Query(default=connectors.ListOrder.ASC),
) -> objects.DataInfoResponse:
    """ This api gives info about the Dataset or Dataset Version. """
    postgres = connectors.PostgresConnector.get_instance()
    dataset_info = get_dataset(postgres, bucket=bucket, name=name)

    rows: Sequence[objects.DataInfoCollectionEntry | objects.DataInfoDatasetEntry] = []
    if dataset_info.is_collection:
        rows = get_collection_info(postgres, bucket, name)
    else:
        rows = get_dataset_info(postgres, bucket, name, tag if tag else '', all_flag, count, order)

    return objects.DataInfoResponse(name=name,
                                    id=dataset_info.id,
                                    bucket=dataset_info.bucket,
                                    created_by=dataset_info.created_by,
                                    created_date=
                                        dataset_info.created_date.replace(microsecond=0),\
                                    hash_location=dataset_info.hash_location,
                                    hash_location_size=dataset_info.hash_location_size,
                                    labels=dataset_info.labels,
                                    type=objects.DatasetType.COLLECTION
                                        if dataset_info.is_collection
                                        else objects.DatasetType.DATASET,
                                    versions=rows)


@router.get('/list_dataset')
def list_dataset_from_bucket(name: objects.DatasetPattern | None = None,
                             user: List[str] | None = fastapi.Query(default = None),
                             buckets: List[str] = fastapi.Query(default = []),
                             dataset_type: objects.DatasetType | None = None,
                             latest_before: datetime.datetime | None = None,
                             latest_after: datetime.datetime | None = None,
                             all_users: bool = False,
                             order: connectors.ListOrder
                                 = fastapi.Query(default=connectors.ListOrder.ASC),
                             count: int = 20,
                             username: str = fastapi.Depends(connectors.parse_username))\
                             -> objects.DataListResponse:
    """ This api returns the list of datasets/colections."""
    postgres = connectors.PostgresConnector.get_instance()
    fetch_cmd = '''
            SELECT dataset.*, dv.created_date as dv_created_date, dv.version_id as dv_version_id,
            COALESCE(dv.created_date, dataset.created_date) as combined_date
            FROM dataset
            LEFT JOIN (SELECT dataset_version.* FROM dataset_version
                INNER JOIN dataset_tag
                ON dataset_version.dataset_id = dataset_tag.dataset_id
                AND dataset_version.version_id = dataset_tag.version_id
                WHERE dataset_tag.tag = 'latest') dv ON dataset.id = dv.dataset_id
            WHERE (dataset.is_collection = True
                OR dataset.id in (SELECT dataset_id FROM dataset_version WHERE status = %s))
        '''
    fetch_input: List = [objects.DatasetStatus.READY.name]
    if dataset_type:
        fetch_cmd += ' AND is_collection = %s'
        fetch_input.append(dataset_type == objects.DatasetType.COLLECTION)
    if latest_before:
        fetch_cmd += '''
            AND ((is_collection = True AND dataset.created_date <= %s)
                OR (is_collection = False AND dv.created_date <= %s))
            '''
        fetch_input.append(latest_before)
        fetch_input.append(latest_before)
    if latest_after:
        fetch_cmd += '''
            AND ((is_collection = True AND dataset.created_date >= %s)
                OR (is_collection = False AND dv.created_date >= %s))
            '''
        fetch_input.append(latest_after)
        fetch_input.append(latest_after)
    if not all_users:
        parsed_users = postgres.fetch_user_names(user) if user else [username]
        fetch_cmd += ' AND (dataset.id IN (SELECT dataset_id from dataset_version ' +\
                     'WHERE dataset_version.created_by IN %s) ' +\
                     'OR (is_collection = True and dataset.created_by IN %s))'
        fetch_input.append(tuple(parsed_users))
        fetch_input.append(tuple(parsed_users))
    if buckets:
        fetch_cmd += ' AND dataset.bucket IN %s'
        fetch_input.append(tuple(buckets))
    if name:
        # _ and % are special characters in postgres
        name = name.replace('_', r'\_').replace('%', r'\%')
        fetch_cmd += ' AND name LIKE %s'
        fetch_input.append('%' + name + '%')

    fetch_cmd += \
        ' GROUP BY dataset.id, dv.created_date, dv.version_id ORDER BY combined_date DESC LIMIT %s'
    fetch_input.append(min(count, 1000))

    fetch_cmd = f'SELECT * FROM ({fetch_cmd}) as ds'
    if order == connectors.ListOrder.ASC:
        fetch_cmd += ' ORDER BY combined_date ASC'
    else:
        fetch_cmd += ' ORDER BY combined_date DESC'
    fetch_cmd += ';'

    dataset_rows = postgres.execute_fetch_command(fetch_cmd, tuple(fetch_input), True)
    rows = []
    for row in dataset_rows:
        rows.append(objects.DataListEntry(name=row['name'],
                                          id=row['id'],
                                          bucket=row['bucket'],
                                          create_time=row['created_date'].replace(microsecond=0),
                                          last_created=row['dv_created_date']
                                            .replace(microsecond=0)
                                            if row['dv_created_date'] else None,
                                          hash_location=row['hash_location'],
                                          hash_location_size=row['hash_location_size'],
                                          version_id=row['dv_version_id'],
                                          type=objects.DatasetType.COLLECTION
                                              if row['is_collection']
                                              else objects.DatasetType.DATASET))
    return objects.DataListResponse(datasets=rows)


@router.post('/{bucket}/dataset/{name}/collect')
def create_collection(bucket: objects.DatasetPattern,
                      name: objects.DatasetPattern,
                      datasets: List[objects.DatasetStructure] = fastapi.Body(..., embed=True),
                      username: str = fastapi.Depends(connectors.parse_username)):
    """ This api creates a collection from datasets. """
    if not name:
        raise osmo_errors.OSMOUserError('Name is required.')

    postgres = connectors.PostgresConnector.get_instance()

    new_datasets: Dict[str, str] = build_collection(postgres, bucket, add_datasets=datasets)

    # Create Collection in Dataset
    fetch_cmd = '''
        WITH input_rows(name, id, created_by, created_date, is_collection, labels, bucket) AS (
            VALUES(TEXT %s, TEXT %s, TEXT %s, TIMESTAMP %s, BOOLEAN %s, JSONB %s, TEXT %s))
        , ins AS (
            INSERT INTO dataset (name, id, created_by, created_date, is_collection, labels, bucket)
            SELECT * FROM input_rows
            ON CONFLICT (name, bucket) DO NOTHING
            RETURNING id, is_collection
        )
        SELECT id, is_collection FROM ins
        UNION ALL
        SELECT d.id, d.is_collection FROM input_rows
        JOIN dataset d USING (name, bucket);
    '''
    collection_id = create_uuid()
    _ = postgres.execute_fetch_command(
        fetch_cmd,
        (name, collection_id, username, common.current_time(), 'true', json.dumps({}), bucket))

    fetch_cmd = '''
        SELECT * FROM dataset WHERE id = %s;
    '''
    collection_row = postgres.execute_fetch_command(fetch_cmd, (collection_id,))
    if not collection_row:
        raise osmo_errors.OSMOUserError(f'Name {name} is already being used.')

    # Add Versions into Collection
    collection_versions = tuple((collection_id, key, value) for key, value in new_datasets.items())
    insert_cmd = 'INSERT INTO collection (id, dataset_id, version_id) VALUES ' +\
                 f'{",".join(["%s"] * len(collection_versions))};'
    postgres.execute_commit_command(insert_cmd, collection_versions)


@router.get('/{bucket}/query')
def query_dataset(
    bucket: objects.DatasetPattern,
    command: str = fastapi.Query(default=''),
) -> objects.DataQueryResponse:
    """ This api queries dataset."""
    if not command:
        raise osmo_errors.OSMOUserError('No query was given')

    # Remove comments
    lines = command.split('\n')
    command_parsed = []
    for line in lines:
        lex = shlex.shlex(line)
        lex.whitespace = '\n' # Strips the newline character
        line = ''.join(list(lex))
        if not line:
            continue
        command_parsed.append(line)

    postgres = connectors.PostgresConnector.get_instance()

    bucket_config = postgres.get_dataset_configs().get_bucket_config(str(bucket))

    query_term = query.QueryParser.get_instance().parse(' '.join(command_parsed))

    if query_term.metadata_enabled:
        query_term.cmd = query_term.cmd.replace('dataset.created_date',
                                                'dataset_version.created_date')
        query_term.cmd = 'SELECT dataset.name, dataset.id, dataset_version.* FROM dataset INNER ' +\
                         'JOIN dataset_version ON dataset_version.dataset_id = dataset.id ' +\
                         f'WHERE dataset.bucket = %s AND ({query_term.cmd});'
    else:
        query_term.cmd = 'SELECT * FROM dataset WHERE dataset.bucket = %s AND ' +\
                         f'({query_term.cmd});'
    query_term.params = [bucket] + query_term.params

    dataset_rows = postgres.execute_fetch_command(query_term.cmd, tuple(query_term.params))
    if not dataset_rows:
        raise osmo_errors.OSMOUserError(f'No Datasets Fit the Query in bucket {bucket}')

    dataset_infos: List[objects.DataInfoResponse | objects.DataInfoDatasetEntry] = []
    if query_term.metadata_enabled:
        for row in dataset_rows:
            dataset_infos.append(objects.DataInfoDatasetEntry(
                name=row.name,
                version=row.version_id,
                status=row.status,
                retention_policy=row.retention_policy,
                created_by=row.created_by,
                created_date=row.created_date.replace(microsecond=0),
                last_used=row.last_used.replace(microsecond=0),
                size=row.size if row.size else 0,
                checksum=row.checksum if row.checksum else 0,
                location=storage.construct_storage_backend(row.location)\
                    .parse_uri_to_link(bucket_config.region),
                uri=row.location,
                metadata=row.metadata,
                tags=[],
                collections=[]))
    else:
        for row in dataset_rows:
            dataset_infos.append(objects.DataInfoResponse(
                name=row.name,
                id=row.id,
                bucket=bucket,
                created_date=
                    row.created_date.replace(microsecond=0),
                labels=row.labels,
                type=objects.DatasetType.COLLECTION
                    if row.is_collection
                    else objects.DatasetType.DATASET,
                versions=[]))

    return objects.DataQueryResponse(type=objects.DatasetQueryType.VERSION
                                        if query_term.metadata_enabled
                                        else objects.DatasetQueryType.DATASET,
                                     datasets=dataset_infos)


@router.get('/{bucket}/location', include_in_schema=False)
def get_path_information(bucket: objects.DatasetPattern):
    """ This api gets the dataset location for CLI validation. """
    postgres = connectors.PostgresConnector.get_instance()

    bucket_config = postgres.get_dataset_configs().get_bucket_config(bucket)
    return objects.DataLocationResponse(path=bucket_config.dataset_path,
                                        region=bucket_config.region)


@router.post('/{bucket}/dataset/{name}/recollect', include_in_schema=False)
def update_collection(bucket: objects.DatasetPattern,
                      name: objects.DatasetPattern,
                      add_datasets: List[objects.DatasetStructure] = fastapi.Body(default=[]),
                      remove_datasets: List[objects.DatasetStructure] = fastapi.Body(default=[]))\
    -> objects.DataUpdateResponse:
    """ This api updates a dataset version's checksum and size or collection's datasets. """
    postgres = connectors.PostgresConnector.get_instance()

    dataset_info = get_dataset(postgres, bucket=bucket, name=name)

    if dataset_info.is_collection:
        fetch_cmd = '''
            SELECT * FROM collection
            WHERE id = %s;
            '''
        collection_entry = postgres.execute_fetch_command(fetch_cmd, (dataset_info.id,))
        inital_datasets = {entry.dataset_id: entry.version_id for entry in collection_entry}

        new_datasets: Dict[str, str] = build_collection(postgres,
                                                        bucket,
                                                        inital_datasets=inital_datasets,
                                                        remove_datasets=remove_datasets,
                                                        add_datasets=add_datasets)

        # Add Versions into Collection
        collection_versions = [(dataset_info.id, key, value) for key, value in new_datasets.items()]
        versions = []
        if collection_versions:
            insert_cmd = 'BEGIN; ' +\
                             'DELETE FROM collection WHERE id = %s; ' +\
                             'INSERT INTO collection (id, dataset_id, version_id) VALUES ' +\
                                 f'{",".join(["%s"] * len(collection_versions))} ON CONFLICT ' +\
                                 '(id, dataset_id) DO UPDATE SET version_id = ' +\
                                 'EXCLUDED.version_id;' +\
                             'DELETE FROM dataset ' +\
                                 'WHERE is_collection = True ' +\
                                 'AND id = %s ' +\
                                 'AND id NOT IN (SELECT id from collection); ' +\
                         'COMMIT;'
            versions = [objects.DataUpdateEntry(dataset_name=dataset, version=version)
                        for dataset, version in new_datasets.items()]
        else:
            insert_cmd = 'BEGIN; ' +\
                             'DELETE FROM collection WHERE id = %s; ' +\
                             'DELETE FROM dataset ' +\
                                 'WHERE is_collection = True ' +\
                                 'AND id = %s ' +\
                                 'AND id NOT IN (SELECT id from collection); ' +\
                         'COMMIT;'
        postgres.execute_commit_command(
            insert_cmd,
            tuple([dataset_info.id] + collection_versions + [dataset_info.id]))

        return objects.DataUpdateResponse(versions=versions)

    raise osmo_errors.OSMOUserError(f'Cannot recollect {name} in bucket {bucket} because it is '
                                    'a dataset.')
