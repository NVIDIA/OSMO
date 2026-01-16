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
import abc
import copy
import datetime
import enum
import fnmatch
import json
import logging
import math
import os
import re
import typing
from functools import wraps
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple, Type
from urllib.parse import urlparse

import fastapi
import psycopg2  # type: ignore
import psycopg2.extras  # type: ignore
import pydantic
import yaml
from jwcrypto import jwe  # type: ignore
from jwcrypto.common import JWException  # type: ignore
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from src.lib.data import storage
from src.lib.data.storage import constants
from src.lib.utils import (common, credentials, jinja_sandbox, login,
                           osmo_errors, role)
from src.utils import auth, notify
from src.utils.secret_manager import Encrypted, SecretManager


def backend_action_queue_name(backend_name: str) -> str:
    return f'backend-connections:{backend_name}'


class ExtraType(enum.Enum):
    """ Setting for Pydantic Extra """
    ALLOW = pydantic.Extra.allow
    FORBID = pydantic.Extra.forbid
    IGNORE = pydantic.Extra.ignore


class CredentialType(enum.Enum):
    """ User profile type / table name if exist """
    GENERIC = 'GENERIC'
    REGISTRY = 'REGISTRY'
    DATA = 'DATA'


class ConfigType(enum.Enum):
    """ Type of Config to fetch or set """
    SERVICE = 'SERVICE'
    WORKFLOW = 'WORKFLOW'
    DATASET = 'DATASET'


class ConfigHistoryType(enum.Enum):
    """ Type of configs supported by config history """
    SERVICE = 'SERVICE'
    WORKFLOW = 'WORKFLOW'
    DATASET = 'DATASET'
    BACKEND = 'BACKEND'
    POOL = 'POOL'
    POD_TEMPLATE = 'POD_TEMPLATE'
    RESOURCE_VALIDATION = 'RESOURCE_VALIDATION'
    BACKEND_TEST = 'BACKEND_TEST'
    ROLE = 'ROLE'


class DownloadType(str, enum.Enum):
    """ Type of Config to fetch or set """
    DOWNLOAD = 'download'

    @staticmethod
    def from_str(label) -> 'DownloadType':
        if label == 'download':
            return DownloadType.DOWNLOAD
        else:
            raise NotImplementedError

    def is_mounting(self) -> bool:
        return self.value != 'download'


class PoolType(enum.Enum):
    """ Pool type for amount of info to output """
    VERBOSE = 'VERBOSE'
    EDITABLE = 'EDITABLE'
    MINIMAL = 'MINIMAL'


class PoolStatus(enum.Enum):
    """ Represents the types of statuses a pool can have. """
    ONLINE = 'ONLINE'
    OFFLINE = 'OFFLINE'
    MAINTENANCE = 'MAINTENANCE'


class ClusterResources(pydantic.BaseModel):
    cpus: int = pydantic.Field(4, alias='cpu')
    gpus: int = pydantic.Field(0, alias='nvidia.com/gpu')
    ephemeral_storage: str = pydantic.Field('50Gi', alias='ephemeral-storage')
    memory: str = '20Gi'


class PostgresConfig(pydantic.BaseModel):
    """ Manages the config for the postgres database. """
    postgres_host: str = pydantic.Field(
        command_line='postgres_host',
        env='OSMO_POSTGRES_HOST',
        default='localhost',
        description='The hostname of the postgres server to connect to.')
    postgres_port: int = pydantic.Field(
        command_line='postgres_port',
        env='OSMO_POSTGRES_PORT',
        default=5432,
        description='The port of the postgres server to connect to.')
    postgres_user: str = pydantic.Field(
        command_line='postgres_user',
        env='OSMO_POSTGRES_USER',
        default='postgres',
        description='The user of the postgres server.')
    postgres_password: str = pydantic.Field(
        command_line='postgres_password',
        env='OSMO_POSTGRES_PASSWORD',
        description='The password to connect to the postgres server.')
    postgres_database_name: str = pydantic.Field(
        command_line='postgres_database_name',
        env='OSMO_POSTGRES_DATABASE_NAME',
        default='osmo_db',
        description='The database name for postgres server.')
    postgres_reconnect_retry: int = pydantic.Field(
        command_line='postgres_reconnect_retry',
        env='OSMO_POSTGRES_RECONNECT_RETRY',
        default=5,
        description='Reconnect try count after connection error')
    mek_file: str = pydantic.Field(
        command_line='mek_file',
        env='OSMO_MEK_FILE',
        default='/home/osmo/vault-agent/secrets/vault-secrets.yaml',
        description='Path to the file that stores master encryption keys'
    )
    method: Literal['dev'] | None = pydantic.Field(
        command_line='method',
        default=None,
        description='If set to "dev", use the default local mek file'
                    'ingoring `mek_file` field.')
    dev_user: str = pydantic.Field(
        command_line='dev_user',
        default='testuser',
        description='If method is set to "dev", the browser flow to the service will use this '
                    'user name.')
    # Deployment configuration fields from Helm values for auto-initialization
    osmo_image_location: str | None = pydantic.Field(
        command_line='osmo_image_location',
        default=None,
        description='The image registry location for OSMO images')
    osmo_image_tag: str | None = pydantic.Field(
        command_line='osmo_image_tag',
        default=None,
        description='The image tag for OSMO images')
    service_hostname: str | None = pydantic.Field(
        command_line='service_hostname',
        default=None,
        description='The public hostname for the OSMO service (used for URL generation)')


def retry(func=None, *, reconnect: bool = True):
    """ Retry connection in case of Interface error and try to complete request"""
    def decorator(fn):
        @wraps(fn)
        def retry_wrapper(*args, **kwargs):
            self = args[0]
            last_error: Exception | None = None
            for _ in range(self.config.postgres_reconnect_retry):
                try:
                    return fn(*args, **kwargs)
                except (psycopg2.InterfaceError, psycopg2.DatabaseError) as error:
                    logging.error('Database error while reconnecting to database: %s', str(error))
                    last_error = error
                    if reconnect:
                        self.connect()
                except osmo_errors.OSMOError as error:
                    raise error
                except Exception as error:  # pylint: disable=broad-except
                    raise osmo_errors.OSMODatabaseError(f'Error: {str(error)}')
            if last_error:
                raise osmo_errors.OSMODatabaseError(f'Error: {str(last_error)}')
        return retry_wrapper
    if func is None:
        return decorator
    else:
        return decorator(func)


class PostgresConnector:
    """ Manages the connection to the postgres database. """
    _instance = None

    @staticmethod
    def get_instance():
        """ Static access method. """
        if not PostgresConnector._instance:
            raise osmo_errors.OSMOError(
                'Postgres Connector has not been created!')
        return PostgresConnector._instance

    def connect(self):
        """ connection to database"""
        try:
            self._conn = psycopg2.connect(
                host=self.config.postgres_host,
                port=self.config.postgres_port,
                database=self.config.postgres_database_name,
                user=self.config.postgres_user,
                password=self.config.postgres_password
            )
        except (psycopg2.DatabaseError, psycopg2.OperationalError) as error:
            logging.error('Database Error while connecting: %s', str(error))
            raise osmo_errors.OSMOConnectionError(str(error))

    def __init__(self, config: PostgresConfig):
        if PostgresConnector._instance:
            raise osmo_errors.OSMOError(
                'Only one instance of Postgres Connector can exist!')

        logging.debug('Connecting to postgres server at %s:%s...', config.postgres_host,
                      config.postgres_port)
        self.config = config
        self.connect()
        logging.debug('Finished connecting to postgres database')

        logging.debug('Initializing secret manager')
        PostgresConnector._instance = self
        mek_file = self.config.mek_file
        if self.config.method == 'dev':
            ExtraArgBaseModel.set_extra(ExtraType.ALLOW)
            mek_file = os.path.join(os.path.dirname(__file__), '..', 'secret_manager', 'mek.yaml')
        self.secret_manager = SecretManager(
            mek_file,
            self.read_uek, self.write_uek, self.read_current_kid, self.add_user)
        logging.debug('Secret manager initialized')

        logging.debug('Initializing tables')
        self._init_tables()
        logging.debug('Tables initialized')

        logging.debug('Initializing configs')
        self._init_configs()
        logging.debug('Configs initialized')

    def __del__(self):
        try:
            self._conn.close()
        except Exception:  # pylint: disable=broad-except
            pass

    @property
    def method(self) -> str | None:
        return self.config.method

    @retry
    def execute_fetch_command(self, command: str,
                              args: Tuple, return_raw: bool = False) -> List[Any]:
        """
        Connects and executes a command to fetch info from the database.

        Args:
            command (str): The command to execute.
            args (Tuple): Any args for the command.
            return_raw (bool): Return the psycopg2 RealDictRow objects instead of
                               pydantic DynamicModel objects.

        Raises:
            OSMODatabaseError: Error while executing the database command.

        Returns:
            Any results from the command.
        """
        cur = None
        try:
            cur = self._conn.cursor(
                cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(command, args)
            # Create a pydantic instance from dictionary pairs
            rows = cur.fetchall()
            if not return_raw:
                # Pydantic cannot deep copy memoryview object, so cast it to bytes object
                rows = [
                    pydantic.create_model(
                        'DynamicModel', **{k: common.handle_memoryview(v) or \
                                           (Any, common.handle_memoryview(v))
                                           for k, v in row.items()})()  # type: ignore
                    for row in rows]
            cur.close()
            self._conn.commit()
            return rows
        except (psycopg2.DatabaseError, psycopg2.InterfaceError) as error:
            try:
                if cur is not None:
                    cur.close()
                self._conn.rollback()
            except Exception:  # pylint: disable=broad-except
                pass
            raise error
        except Exception as error:  # pylint: disable=broad-except
            raise osmo_errors.OSMODatabaseError(
                f'Error during executing command {command}: {error}')
        finally:
            if cur is not None:
                cur.close()

    @retry
    def execute_commit_command(self, command: str, args: Tuple):
        """
        Connects and executes a command that updates the database.

        Args:
            command (str): The command to execute.
            args (Tuple): Any args for the command.

        Raises:
            OSMODatabaseError: Error while executing the database command.
        """
        cur = None
        try:
            cur = self._conn.cursor()
            cur.execute(command, args)
            cur.close()
            self._conn.commit()
        except (psycopg2.DatabaseError, psycopg2.InterfaceError) as error:
            try:
                if cur is not None:
                    cur.close()
                self._conn.rollback()
            except Exception:  # pylint: disable=broad-except
                pass
            raise error
        except Exception as error:  # pylint: disable=broad-except
            raise osmo_errors.OSMODatabaseError(
                f'Error during executing command {command}: {error}')
        finally:
            if cur is not None:
                cur.close()

    @retry(reconnect=False)
    def execute_autocommit_command(self, command: str, args: Tuple):
        """
        Connects and executes a command on the database in autocommit mode
        Args:
            command (str): The command to execute.
            args (Tuple): Any args for the command.

        Raises:
            OSMODatabaseError: Error while executing the database command.
        """
        # Create a new connection to the database in autocommit mode
        try:
            connection = psycopg2.connect(
                host=self.config.postgres_host,
                port=self.config.postgres_port,
                database=self.config.postgres_database_name,
                user=self.config.postgres_user,
                password=self.config.postgres_password
            )
        except (psycopg2.DatabaseError, psycopg2.InterfaceError) as error:
            raise error
        except Exception as error:  # pylint: disable=broad-except
            raise osmo_errors.OSMOConnectionError(f'Database error while connecting: {error}')

        # Create a cursor and execute the command
        cursor = None
        try:
            connection.set_session(autocommit=True)
            cursor = connection.cursor()
            cursor.execute(command, args)
        except (psycopg2.DatabaseError, psycopg2.InterfaceError) as error:
            raise error
        except Exception as error:  # pylint: disable=broad-except
            raise osmo_errors.OSMODatabaseError(
                f'Error during executing command {command}: {error}')
        finally:
            if cursor is not None:
                cursor.close()
            connection.close()

    def mogrify(self, entries: List[Tuple]):
        """
        Run mogrify on a list of tuples and turn it into a string that can be used
        for inserting multiple rows. This prevents SQL injections from happening
        when constructing the string that defines these rows.
        All the tuples need to have the same number of elements.

        Args:
            entries (List[tuple]): Each entry defines the attributes for each row.

        Raises:
            OSMODatabaseError: Error while executing the database command.
        """
        cur = self._conn.cursor()
        entry_length = len(entries[0])
        for entry in entries:
            if len(entry) != entry_length:
                raise osmo_errors.OSMOSchemaError(
                    'Mogrify: entries do not have the same number of elements!')
        input_str = f'({", ".join(["%s"] * entry_length)})'
        final_str = ', '.join(cur.mogrify(input_str, entry).decode('utf-8') for entry in entries)
        cur.close()
        return final_str

    def get_configs(self, config_type: ConfigType):
        """ Get all the config values. """
        cmd = 'SELECT * FROM configs WHERE type = %s;'
        result = self.execute_fetch_command(cmd, (config_type.value,))
        if not result:
            raise osmo_errors.OSMODatabaseError('Configs are not found.')

        result_dicts = {}
        primative_types = {str, int, float, pydantic.SecretStr}

        config_class: Type[DynamicConfig]
        if config_type == ConfigType.SERVICE:
            hints = typing.get_type_hints(ServiceConfig)
            config_class = ServiceConfig
        elif config_type == ConfigType.WORKFLOW:
            hints = typing.get_type_hints(WorkflowConfig)
            config_class = WorkflowConfig
        elif config_type == ConfigType.DATASET:
            hints = typing.get_type_hints(DatasetConfig)
            config_class = DatasetConfig
        else:
            raise osmo_errors.OSMOServerError(f'Config type: {config_type.value} unknown')

        for model in result:
            if model.key not in hints:
                continue
            item_type = hints[model.key]
            if item_type in primative_types:
                result_dicts[model.key] = model.value
            else:
                result_dicts[model.key] = json.loads(model.value)
        return config_class.deserialize(result_dicts, self)

    def get_service_configs(self) -> 'ServiceConfig':
        return self.get_configs(ConfigType.SERVICE)

    def get_workflow_configs(self) -> 'WorkflowConfig':
        return self.get_configs(ConfigType.WORKFLOW)

    def get_dataset_configs(self) -> 'DatasetConfig':
        return self.get_configs(ConfigType.DATASET)

    def get_method(self) -> Optional[Literal['dev']]:
        return self.config.method

    def decrypt_credential(self, db_row) -> Dict:
        result = {}
        payload = PostgresConnector.decode_hstore(db_row.payload)
        for key, value in payload.items():
            try:
                jwetoken = jwe.JWE()
                jwetoken.deserialize(value)
                encrypted = Encrypted(value)
                cmd = (
                    f"UPDATE credential SET payload['{key}'] = %s WHERE  "
                    f"user_name = '{db_row.user_name}' AND cred_name = '{db_row.cred_name}' "
                    f"AND payload['{key}'] = '{value}'"
                )
                decrypted = self.secret_manager.decrypt(
                    encrypted, db_row.user_name, self.generate_update_secret_func(cmd))
                result[key] = decrypted.value
            except (JWException, osmo_errors.OSMONotFoundError):
                # Encypt value
                result[key] = value
                encrypted = self.secret_manager.encrypt(value, db_row.user_name)
                cmd = (
                    f"UPDATE credential SET payload['{key}'] = %s WHERE "
                    f"user_name = '{db_row.user_name}' AND cred_name = '{db_row.cred_name}'"
                )
                self.execute_commit_command(cmd, (encrypted.value,))
        return result

    def encrypt_dict(self, input_dict: Dict, user: str) -> Dict:
        result = {}
        for key, value in input_dict.items():
            encrypted = self.secret_manager.encrypt(value, user)
            result[key] = encrypted.value
        return result

    def set_config(self, key: str, value: str | None, config_type: ConfigType):
        """ Set the config value for the given key. """
        cmd = 'UPDATE configs SET value = %s WHERE key = %s and type = %s;'
        return self.execute_commit_command(cmd, (value, key, config_type.value))

    @classmethod
    def encode_hstore(cls, key_val_data: Dict) -> str:
        """ Encodes a dictionary into a hstore string. """
        return ','.join([f'"{key}"=>"{value}"' for key, value in key_val_data.items()])

    @classmethod
    def decode_hstore(cls, hstore_data: str) -> Dict:
        """ Decodes a hstore string into a dictionary. """
        field_regex = r'[^()\'"]+'
        return {tp[0]: tp[1] for tp in re.findall(f'"({field_regex})"=>"({field_regex})"',
                hstore_data)}

    def _set_default_config(self, key: str, value: str, config_type: ConfigType):
        """ Set the default config value for the given key. """
        cmd = 'INSERT INTO configs (key, value, type) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING;'
        return self.execute_commit_command(cmd, (str(key), str(value), config_type.value))

    def _init_tables(self):
        """ Initializes tables if not exist. """
        # Install hstore extension
        create_cmd = 'CREATE EXTENSION IF NOT EXISTS hstore SCHEMA public;'
        self.execute_commit_command(create_cmd, ())

        # Creates table for dynamic configs.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS configs (
                key TEXT,
                value TEXT,
                type TEXT,
                PRIMARY KEY (key, type)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for roles
        create_cmd = """
            CREATE TABLE IF NOT EXISTS roles (
                name TEXT,
                description TEXT,
                policies JSONB[],
                immutable BOOLEAN,
                PRIMARY KEY (name)
            );
        """
        self.execute_commit_command(create_cmd, ())

        # Creates table for dynamic configs.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS backends (
                name TEXT,
                description TEXT,
                k8s_uid TEXT,
                k8s_namespace TEXT,
                dashboard_url TEXT,
                grafana_url TEXT,
                scheduler_settings TEXT,
                tests TEXT[] DEFAULT ARRAY[]::text[],
                last_heartbeat TIMESTAMP,
                created_date TIMESTAMP,
                router_address TEXT,
                version TEXT DEFAULT '',
                node_conditions JSONB DEFAULT '{
                    "rules": {"Ready": "True"},
                    "prefix": "osmo.nvidia.com/"
                }'::jsonb,
                PRIMARY KEY (name)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for dynamic configs.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS resource_validations (
                name TEXT,
                resource_validations JSONB[],
                PRIMARY KEY (name)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for dynamic configs.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS pod_templates (
                name TEXT,
                pod_template JSONB,
                PRIMARY KEY (name)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for dynamic configs.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS pools (
                name TEXT,
                description TEXT,
                backend TEXT,
                download_type TEXT,
                default_platform TEXT,
                platforms JSONB,
                default_exec_timeout TEXT,
                default_queue_timeout TEXT,
                max_exec_timeout TEXT,
                max_queue_timeout TEXT,
                default_exit_actions JSONB,
                common_default_variables JSONB,
                common_resource_validations TEXT[],
                parsed_resource_validations JSONB,
                common_pod_template TEXT[],
                parsed_pod_template JSONB,
                enable_maintenance BOOLEAN,
                action_permissions JSONB,
                resources JSONB,
                PRIMARY KEY (name)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for workflows.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS workflows (
                workflow_name TEXT,
                job_id INT,
                workflow_id TEXT,
                workflow_uuid TEXT,
                submitted_by TEXT,
                cancelled_by TEXT,
                logs TEXT,
                events TEXT,
                submit_time TIMESTAMP,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                exec_timeout INT,
                queue_timeout INT,
                backend TEXT,
                pool TEXT,
                version INT,
                outputs TEXT,
                status TEXT,
                failure_message TEXT,
                parent_name TEXT,
                parent_job_id TEXT,
                app_uuid TEXT,
                app_version INT,
                plugins JSONB,
                priority TEXT DEFAULT 'NORMAL',
                PRIMARY KEY (workflow_uuid),
                CONSTRAINT workflows_name_job UNIQUE(workflow_name, job_id),
                CONSTRAINT workflows_workflow_id UNIQUE(workflow_id)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates indices for workflow table
        index_cmds = [
            '''
            CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_list_index
                ON workflows
                USING btree (submitted_by, pool, status, submit_time ASC);
            ''',
            '''
            CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_list_index_pool_status
                ON workflows
                USING btree (pool, status, submit_time ASC);
            '''
        ]
        for cmd in index_cmds:
            self.execute_autocommit_command(cmd, ())

        # Creates table for workflow tags.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS workflow_tags (
                workflow_uuid TEXT REFERENCES workflows (workflow_uuid),
                tag TEXT,
                PRIMARY KEY (workflow_uuid, tag)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for groups.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS groups (
                workflow_id TEXT,
                name TEXT,
                group_uuid TEXT,
                spec JSONB,
                status TEXT,
                failure_message TEXT,
                processing_start_time TIMESTAMP,
                scheduling_start_time TIMESTAMP,
                initializing_start_time TIMESTAMP,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                remaining_upstream_groups HSTORE,
                downstream_groups HSTORE,
                outputs TEXT,
                cleaned_up BOOLEAN,
                scheduler_settings TEXT,
                PRIMARY KEY (group_uuid),
                CONSTRAINT groups_id_name UNIQUE(workflow_id, name)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for tasks.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS tasks (
                workflow_id TEXT,
                name TEXT,
                retry_id INT,
                task_db_key TEXT,
                task_uuid TEXT,
                group_name TEXT,
                status TEXT,
                failure_message TEXT,
                exit_code INT,
                scheduling_start_time TIMESTAMP,
                initializing_start_time TIMESTAMP,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                input_download_start_time TIMESTAMP,
                input_download_end_time TIMESTAMP,
                output_upload_start_time TIMESTAMP,
                output_upload_end_time TIMESTAMP,
                last_heartbeat TIMESTAMP,
                node_name TEXT,
                gpu_count FLOAT,
                cpu_count FLOAT,
                disk_count FLOAT,
                memory_count FLOAT,
                exit_actions JSONB,
                lead BOOLEAN,
                refresh_token BYTEA,
                pod_name TEXT,
                pod_ip TEXT,
                PRIMARY KEY (task_db_key),
                CONSTRAINT tasks_uuid_retry UNIQUE(task_uuid, retry_id),
                CONSTRAINT tasks_id_name UNIQUE(workflow_id, retry_id, name)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates indices for task table
        index_cmds = [
            '''
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS tasks_status_id_name
                ON tasks
                USING btree (status, workflow_id, retry_id, name);
            '''
        ]
        for cmd in index_cmds:
            self.execute_autocommit_command(cmd, ())

        # Creates table for tasks/groups.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS task_io (
                workflow_id TEXT,
                group_name TEXT,
                task_name TEXT,
                retry_id INT,
                uuid TEXT,
                url TEXT,
                type TEXT,
                storage_bucket TEXT,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                size FLOAT,
                operation_type TEXT,
                download_type TEXT,
                number_of_files INT,
                PRIMARY KEY (uuid)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for apps
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS apps (
                uuid TEXT,
                name TEXT,
                owner TEXT,
                created_date TIMESTAMP,
                description TEXT,
                PRIMARY KEY (uuid),
                CONSTRAINT apps_name UNIQUE(name)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for apps versions
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS app_versions (
                uuid TEXT,
                version INT,
                created_by TEXT,
                created_date TIMESTAMP,
                status TEXT,
                uri TEXT,
                PRIMARY KEY (uuid, version),
                FOREIGN KEY (uuid)
                    REFERENCES apps (uuid)
                    ON DELETE CASCADE
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for resources.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS resources (
                name TEXT,
                backend TEXT,
                available BOOLEAN,
                allocatable_fields HSTORE,
                label_fields HSTORE,
                taints JSONB[],
                usage_fields HSTORE,
                non_workflow_usage_fields HSTORE,
                conditions TEXT[],
                PRIMARY KEY (name, backend)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for matching resource name to corresponding pool and platform
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS resource_platforms (
                resource_name TEXT,
                backend TEXT,
                pool TEXT,
                platform TEXT,
                PRIMARY KEY (resource_name, backend, pool, platform),
                FOREIGN KEY (resource_name, backend)
                    REFERENCES resources(name, backend)
                    ON UPDATE CASCADE
                    ON DELETE CASCADE
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for user keys.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS ueks (
                uid TEXT,
                keys HSTORE,
                PRIMARY KEY (uid)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        create_cmd = '''
            CREATE OR REPLACE FUNCTION jsonb_recursive_merge(receivingJson jsonb, givingJson jsonb)
            RETURNS jsonb LANGUAGE SQL AS $$
            SELECT jsonb_object_agg(coalesce(kr, kg),
                CASE
                WHEN vr isnull THEN vg
                WHEN vg isnull THEN vr
                WHEN jsonb_typeof(vr) <> 'object' OR jsonb_typeof(vg) <> 'object' THEN vg
                ELSE jsonb_recursive_merge(vr, vg) END
            )
            FROM jsonb_each(receivingJson) temptable1(kr, vr)
            FULL JOIN jsonb_each(givingJson) temptable2(kg, vg) ON kr = kg
            $$;
        '''
        self.execute_commit_command(create_cmd, ())

        # Dataset/Collection Table
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS dataset (
                name TEXT,
                id TEXT,
                created_by TEXT,
                created_date TIMESTAMP,
                is_collection BOOLEAN,
                labels JSONB,
                hash_location TEXT,
                hash_location_size BIGINT,
                last_version INT,
                bucket TEXT,
                PRIMARY KEY (id),
                CONSTRAINT dataset_name_bucket_key UNIQUE(name, bucket)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Dataset Version
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS dataset_version (
                dataset_id TEXT REFERENCES dataset (id),
                version_id TEXT,
                location TEXT, -- stores location of manifest file
                status TEXT,
                created_by TEXT,
                created_date TIMESTAMP,
                last_used TIMESTAMP,
                last_updated TIMESTAMP,
                size BIGINT,
                checksum TEXT,
                metadata JSONB,
                retention_policy INTERVAL,
                PRIMARY KEY (dataset_id, version_id)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Dataset Tag
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS dataset_tag (
                dataset_id TEXT,
                version_id TEXT,
                tag TEXT,
                PRIMARY KEY (dataset_id, tag),
                FOREIGN KEY (dataset_id, version_id)
                    REFERENCES dataset_version (dataset_id, version_id)
                    ON UPDATE CASCADE
                    ON DELETE CASCADE
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Collection
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS collection (
                id TEXT REFERENCES dataset (id) ON DELETE CASCADE,
                dataset_id TEXT,
                version_id TEXT,
                PRIMARY KEY (id, dataset_id),
                FOREIGN KEY (dataset_id, version_id)
                    REFERENCES dataset_version (dataset_id, version_id)
                    ON UPDATE CASCADE
                    ON DELETE CASCADE
            );
        '''
        self.execute_commit_command(create_cmd, ())

        create_cmd = '''
            do $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credential_type') THEN
                    CREATE TYPE credential_type AS ENUM (
                        'GENERIC', 'REGISTRY', 'DATA'
                    );
                END IF;
            END
            $$
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for Generic credentials
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS credential (
                user_name TEXT NOT NULL,
                cred_name TEXT NOT NULL,
                cred_type credential_type,
                profile TEXT,
                payload HSTORE NOT NULL,
                PRIMARY KEY (user_name, cred_name),
                CONSTRAINT unique_cred UNIQUE (user_name, profile)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for access token keys.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS access_token (
                user_name TEXT,
                token_name TEXT,
                access_token BYTEA,
                expires_at TIMESTAMP,
                description TEXT,
                access_type TEXT,
                roles TEXT[],
                PRIMARY KEY (user_name, token_name, access_type),
                CONSTRAINT unique_access_token UNIQUE (access_token)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for User profile
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS profile (
                user_name TEXT NOT NULL,
                slack_notification BOOLEAN,
                email_notification BOOLEAN,
                bucket TEXT,
                pool TEXT,
                PRIMARY KEY (user_name)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for config history
        create_cmd = """
            CREATE TABLE IF NOT EXISTS config_history (
                config_type TEXT,
                revision INT,
                name TEXT,
                username TEXT,
                created_at TIMESTAMP,
                tags TEXT[],
                description TEXT,
                data JSONB,
                deleted_by TEXT,
                deleted_at TIMESTAMP,
                PRIMARY KEY (config_type, revision)
            );
        """
        self.execute_commit_command(create_cmd, ())

        # Create index on created_at for faster temporal queries
        index_cmd = """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS config_history_created_at_idx
            ON config_history (created_at DESC);
        """
        self.execute_autocommit_command(index_cmd, ())

        # Creates table for test configs.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS backend_tests (
                name TEXT,
                description TEXT,
                cron_schedule TEXT,
                test_timeout TEXT,
                common_pod_template TEXT[],
                parsed_pod_template JSONB,
                node_conditions TEXT[],
                PRIMARY KEY (name)
            );
        '''
        self.execute_commit_command(create_cmd, ())

    def _init_configs(self):
        """ Initializes configs table. """
        # Create config objects with deployment values if provided
        service_configs = ServiceConfig()

        workflow_configs = WorkflowConfig()

        dataset_configs = DatasetConfig()

        def set_default_values(configs: 'DynamicConfig', config_type: ConfigType):
            for key, value in configs.plaintext_dict(by_alias=True).items():
                if isinstance(value, str):
                    self._set_default_config(key, value, config_type)
                else:
                    self._set_default_config(key, json.dumps(value), config_type)

        set_default_values(service_configs, ConfigType.SERVICE)
        set_default_values(workflow_configs, ConfigType.WORKFLOW)
        set_default_values(dataset_configs, ConfigType.DATASET)

        self.create_default_roles()

        # For each config type, insert the current config into the
        # config history table if there is not a config history entry for it
        for config_type in [
            ConfigHistoryType.SERVICE,
            ConfigHistoryType.WORKFLOW,
            ConfigHistoryType.DATASET,
            ConfigHistoryType.BACKEND,
            ConfigHistoryType.POOL,
            ConfigHistoryType.POD_TEMPLATE,
            ConfigHistoryType.RESOURCE_VALIDATION,
            ConfigHistoryType.BACKEND_TEST,
            ConfigHistoryType.ROLE,
        ]:
            fetch_cmd = """
                SELECT 1 FROM config_history WHERE config_type = %s LIMIT 1;
            """
            data = self.execute_fetch_command(fetch_cmd,
                                              (config_type.value.lower(),),
                                              return_raw=True)
            if data:
                continue

            if config_type == ConfigHistoryType.SERVICE:
                data = self.get_service_configs().plaintext_dict(
                    exclude_unset=True, by_alias=True
                )
            elif config_type == ConfigHistoryType.WORKFLOW:
                data = self.get_workflow_configs().plaintext_dict(
                    exclude_unset=True, by_alias=True
                )
            elif config_type == ConfigHistoryType.DATASET:
                data = self.get_dataset_configs().plaintext_dict(
                    exclude_unset=True, by_alias=True
                )
            elif config_type == ConfigHistoryType.BACKEND:
                data = [
                    backend.dict(by_alias=True, exclude_unset=True)
                    for backend in Backend.list_from_db(self)
                ]
            elif config_type == ConfigHistoryType.POOL:
                data = fetch_editable_pool_config(self)
            elif config_type == ConfigHistoryType.POD_TEMPLATE:
                data = PodTemplate.list_from_db(self)
            elif config_type == ConfigHistoryType.RESOURCE_VALIDATION:
                data = ResourceValidation.list_from_db(self)
            elif config_type == ConfigHistoryType.BACKEND_TEST:
                data = BackendTests.list_from_db(self)
            elif config_type == ConfigHistoryType.ROLE:
                data = Role.list_from_db(self)
            else:
                raise ValueError(
                    f'Invalid config type when initializing config history: {config_type}'
                )

            insert_cmd = """
                INSERT INTO config_history
                    (config_type, revision, name, username, created_at, tags, description, data)
                SELECT %s, 1, %s, %s, NOW(), %s, %s, %s
                WHERE NOT EXISTS (
                    SELECT 1 FROM config_history WHERE config_type = %s
                );
            """
            self.execute_commit_command(
                insert_cmd,
                (
                    config_type.value.lower(),  # config_type
                    '',                         # name
                    'system',                   # username
                    ['initial-config'],         # tags
                    'Initial configuration',    # description
                    json.dumps(data, default=pydantic.json.pydantic_encoder),  # data
                    config_type.value.lower(),  # for WHERE NOT EXISTS
                ),
            )

    def create_default_roles(self):
        # Populate with roles or updated default roles
        roles = Role.list_from_db(self)
        updated_roles = False

        role_objects = {role.name: role for role in roles}
        for default_role_name, default_role_object in DEFAULT_ROLES.items():
            if default_role_name not in role_objects:
                default_role_object.insert_into_db(self, force=True)
            else:
                # Add any action in default_role_object that isn't in role_object's actions,
                # then insert into db
                existing_role = role_objects[default_role_name]
                # Flatten actions for comparison
                def flatten_actions(policies):
                    return set(
                        (action.base, action.path, action.method)
                        for policy in policies
                        for action in getattr(policy, 'actions', [])
                    )
                existing_actions = flatten_actions(existing_role.policies)
                default_actions = flatten_actions(default_role_object.policies)

                # Find actions in default_role_object not in existing_role
                missing_actions = default_actions - existing_actions
                if missing_actions:
                    # Add missing actions to the first policy of the existing role
                    # (or create if none)
                    if not existing_role.policies:
                        # If no policies exist, copy from default
                        existing_role.policies = default_role_object.policies
                    else:
                        # Add missing actions to the first policy
                        for base, path, method in missing_actions:
                            # Find the policy in default_role_object that has this action
                            for policy in default_role_object.policies:
                                for action in getattr(policy, 'actions', []):
                                    if (action.base, action.path, action.method) == \
                                        (base, path, method):
                                        # Add to the first policy of existing_role
                                        existing_role.policies[0].actions.append(action)
                                        break
                    existing_role.insert_into_db(self, force=True)
                    updated_roles = True

        if updated_roles:
            data = Role.list_from_db(self)

            self.create_config_history_entry(
                config_type=ConfigHistoryType.ROLE,
                name='',
                username='system',
                data=data,
                description='Updated roles',
            )

    def read_uek(self, uid: str, kid: str) -> str:
        cmd = 'SELECT keys -> %s as value FROM ueks WHERE uid = %s;'
        uek_value = self.execute_fetch_command(cmd, (kid, uid))
        uek_jwe = uek_value[0].value
        return uek_jwe

    def read_current_kid(self, uid: str) -> str:
        cmd = 'SELECT keys -> %s as value FROM ueks WHERE uid = %s;'
        current_kid_value = self.execute_fetch_command(cmd, ('current', uid))
        current_kid = current_kid_value[0].value
        return current_kid

    def write_uek(self, uid: str, kid: str, new_uek: str, old_uek: str):
        new_key_value = self.encode_hstore({kid: new_uek})
        cmd = 'UPDATE ueks SET keys = keys || %s :: hstore WHERE uid = %s AND keys[%s] = %s;'
        self.execute_commit_command(cmd, (new_key_value, uid, kid, old_uek))

    def add_user(self, uid: str, uek: Dict):
        cmd = 'INSERT INTO ueks (uid, keys) VALUES (%s, %s) ON CONFLICT DO NOTHING;'
        encoded = self.encode_hstore(uek)
        self.execute_commit_command(cmd, (uid, encoded))

    def generate_update_secret_func(self, cmd: str) -> Callable[[str], None]:
        def func(new_encrypted: str):
            self.execute_commit_command(cmd, (new_encrypted,))
        return func

    def get_data_cred(self, user: str, profile: str) -> credentials.StaticDataCredential | None:
        """ Fetch data credentials by profile. """
        select_data_cmd = PostgresSelectCommand(
            table='credential',
            conditions=['user_name = %s', 'cred_type = %s', 'profile = %s'],
            condition_args=[user, CredentialType.DATA.value, profile])
        row = self.execute_fetch_command(*select_data_cmd.get_args())
        if row:
            return credentials.StaticDataCredential(
                endpoint=profile,
                **self.decrypt_credential(row[0]),
            )
        else:
            # Check default bucket creds
            for bucket in self.get_dataset_configs().buckets.values():
                bucket_info = storage.construct_storage_backend(bucket.dataset_path)
                if bucket_info.profile == profile:
                    if bucket.default_credential:
                        return credentials.StaticDataCredential(
                            region=bucket.region,
                            access_key_id=bucket.default_credential.access_key_id,
                            access_key=bucket.default_credential.access_key,
                            endpoint=bucket_info.profile,
                        )
                    break

            return None

    def get_all_data_creds(self, user: str) -> Dict[str, credentials.StaticDataCredential]:
        """ Fetch all data credentials for user. """
        select_data_cmd = PostgresSelectCommand(
            table='credential',
            conditions=['user_name = %s', 'cred_type = %s'],
            condition_args=[user, CredentialType.DATA.value])
        rows = self.execute_fetch_command(*select_data_cmd.get_args())

        user_creds = {
            cred.profile: credentials.StaticDataCredential(
                endpoint=cred.profile,
                **self.decrypt_credential(cred),
            )
            for cred in rows
        }

        # Add default bucket creds
        for bucket in self.get_dataset_configs().buckets.values():
            bucket_info = storage.construct_storage_backend(bucket.dataset_path)
            if bucket_info.profile not in user_creds and bucket.default_credential:
                user_creds[bucket_info.profile] = credentials.StaticDataCredential(
                    region=bucket.region,
                    access_key_id=bucket.default_credential.access_key_id,
                    access_key=bucket.default_credential.access_key,
                    endpoint=bucket_info.profile
                )
        return user_creds

    def get_generic_cred(self, user: str, cred_name: str) -> Any:
        """ Fetch user secrets. """
        select_data_cmd = PostgresSelectCommand(
            table='credential',
            conditions=['user_name = %s', 'cred_name = %s'],
            condition_args=[user, cred_name])
        row = self.execute_fetch_command(*select_data_cmd.get_args())
        if row:
            return self.decrypt_credential(row[0])
        else:
            raise osmo_errors.OSMOCredentialError(f'Could not find the credential: {cred_name}.')

    def get_registry_cred(self, user: str, registry: str) -> Any:
        """ Fetch docker credentials by registry name. """
        select_data_cmd = PostgresSelectCommand(
            table='credential',
            conditions=['user_name = %s', 'profile = %s'],
            condition_args=[user, registry])
        row = self.execute_fetch_command(*select_data_cmd.get_args())
        if row:
            return self.decrypt_credential(row[0])
        else:
            return None

    def get_workflow_service_url(self) -> str:
        """ Get the workflow service url. """
        service_config = self.get_service_configs()
        return service_config.service_base_url

    def create_config_history_entry(
        self,
        config_type: ConfigHistoryType,
        name: str,
        username: str,
        data: Any,
        description: str,
        tags: List[str] | None = None,
    ):
        """Create a new entry in the config history table.

        Args:
            config_type: Type of config being modified (service, workflow, etc)
            name: Name of the config item if applicable
            username: Username of the person making the change
            data: The complete config data after the change
            description: Description of what changed
            tags: Optional list of tags to associate with this change
        """
        # Insert the history entry with calculated revision
        insert_cmd = """
            WITH next_rev AS (
                SELECT COALESCE(MAX(revision), 0) + 1 as next_revision
                FROM config_history
                WHERE config_type = %s
            )
            INSERT INTO config_history
            (config_type, revision, name, username, created_at, tags, description, data)
            SELECT %s, next_revision, %s, %s, NOW(), %s, %s, %s
            FROM next_rev;
        """
        self.execute_commit_command(
            insert_cmd,
            (
                config_type.value.lower(),  # For the WITH clause
                config_type.value.lower(),  # For the INSERT
                name,
                username,
                tags,
                description,
                json.dumps(data, default=pydantic.json.pydantic_encoder),
            ),
        )

    def fetch_user_names(self, user_names: List[str]) -> List[str]:
        """Fetch user names from the profile table.

        Args:
            user_names: List of user names to fetch
        """
        user_cmd = f'''
            WITH normalized_usernames AS (
                SELECT DISTINCT
                    username,
                    SPLIT_PART(username, '@', 1) as base_username
                FROM unnest(ARRAY[{", ".join(["%s"] * len(user_names))}]) as username(username)
            ),
            all_users AS (
                SELECT DISTINCT user_name FROM profile
                UNION
                SELECT DISTINCT submitted_by FROM workflows
                UNION
                SELECT DISTINCT created_by FROM dataset
                UNION
                SELECT DISTINCT created_by FROM dataset_version
                UNION
                SELECT DISTINCT owner FROM apps
                UNION
                SELECT DISTINCT created_by FROM app_versions
            )
            SELECT
                n.username as input_username,
                MIN(u.user_name) as user_name, -- Returns the first match, NULL if no match
                COUNT(u.user_name) as match_count
            FROM normalized_usernames n
            LEFT JOIN all_users u ON
                u.user_name = n.username OR
                (n.username = n.base_username AND u.user_name LIKE n.base_username || %s)
            GROUP BY n.username;
        '''
        fetch_args = user_names + ['@%']
        user_rows = self.execute_fetch_command(user_cmd, tuple(fetch_args), True)
        if user_rows:
            error_str = []
            for user_row in user_rows:
                if user_row['match_count'] == 0:
                    error_str.append(f'{user_row["input_username"]} not found')
                elif user_row['match_count'] > 1:
                    error_str.append(f'{user_row["input_username"]} has multiple matches. ' + \
                                     'Specify the full email address')
            if error_str:
                raise osmo_errors.OSMOUserError(f'Invalid user(s): {", ".join(error_str)}')
        return [user_row['user_name'] for user_row in user_rows]


class UserProfile(pydantic.BaseModel):
    """ Provides all User Profile Information """
    username: str | None = None
    email_notification: bool | None = None
    slack_notification: bool | None = None
    bucket: str | None = None
    pool: str | None = None

    @classmethod
    def default_bucket(cls, database: PostgresConnector) -> Optional[str]:
        return database.get_dataset_configs().default_bucket

    @classmethod
    def default_profile(cls, user_name: str) -> 'UserProfile':
        return UserProfile(
            username=user_name,
            email_notification=False,
            slack_notification=False,
            bucket=None,
            pool=None)

    @classmethod
    def insert_into_db(cls, database: PostgresConnector,
                       user_name: str,
                       setting: Dict[str, Any]):
        fields: List[str] = ['user_name']
        values: List = [user_name]
        for key, value in setting.items():
            fields.append(key)
            values.append(value)

        # Validate bucket is valid
        if 'bucket' in setting:
            postgres = PostgresConnector.get_instance()
            dataset_config = postgres.get_dataset_configs()
            if setting['bucket'] not in dataset_config.buckets:
                raise osmo_errors.OSMOUserError(
                    f'Bucket {setting["bucket"]} does not exist. Use the "osmo bucket list" CLI '
                    ' to see all available buckets.')
        if 'pool' in setting:
            postgres = PostgresConnector.get_instance()
            Pool.fetch_from_db(postgres, setting['pool'])

        insert_cmd = f'''
            INSERT INTO profile ({",".join(fields)})
            VALUES ({",".join(["%s"] * len(values))})
            ON CONFLICT (user_name)
            DO UPDATE SET {",".join(f"{field} = EXCLUDED.{field}" for field in fields)}
        '''
        database.execute_commit_command(insert_cmd, tuple(values))

    @classmethod
    def insert_default_profile(cls, database: PostgresConnector, user_name: str):
        default_profile = UserProfile.default_profile(user_name)
        UserProfile.insert_into_db(
            database, user_name,
            {'email_notification': default_profile.email_notification,
             'slack_notification': default_profile.slack_notification})

    @classmethod
    def fetch_from_db(cls, database: PostgresConnector,
                      user_name: str) -> 'UserProfile':
        fetch_cmd = 'SELECT * FROM profile WHERE user_name = %s;'
        rows = database.execute_fetch_command(fetch_cmd, (user_name,))
        default_profile = UserProfile.default_profile(user_name)
        try:
            row = rows[0]
        except IndexError as _:
            # Default values
            UserProfile.insert_default_profile(database, user_name)
            # Fetch default bucket
            return default_profile

        if row.email_notification is None:
            row.email_notification = default_profile.email_notification
        if row.slack_notification is None:
            row.slack_notification = default_profile.slack_notification
        if not row.bucket:
            row.bucket = default_profile.bucket

        return UserProfile(
            username=row.user_name,
            email_notification=row.email_notification,
            slack_notification=row.slack_notification,
            bucket=row.bucket,
            pool=row.pool
        )

class ExtraArgBaseModel(pydantic.BaseModel):
    """ BaseModel class which can be used to enable validation """
    class Config:
        extra = ExtraType.IGNORE.value

    @classmethod
    def set_extra(cls, extra_type: ExtraType):
        cls.__config__.extra = extra_type.value


class OsmoImageConfig(ExtraArgBaseModel):
    """
    Dynamic Config for storing the image URLs for service images and the credentials needed
    to pull them.
    """
    init: str = ''
    client: str = ''
    credential: credentials.RegistryCredential = credentials.RegistryCredential(
        registry='', username='', auth='')


class ResourceSpec(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Represents the resource spec in an OSMO2 workflow. """
    cpu: int | None = None
    storage: str | None = None
    memory: str | None = None
    gpu: int | None = None
    platform: str | None = None
    nodesExcluded: List[str] = [] # pylint: disable=invalid-name

    def update(self, other: 'ResourceSpec') -> 'ResourceSpec':
        """ Apply all fields from the other resource spec to this one """
        self_dict = self.dict(exclude_none=True)
        other_dict = other.dict(exclude_none=True)
        return ResourceSpec(**common.recursive_dict_update(self_dict, other_dict))

    @classmethod
    def validate_unit_value(cls, value: str | None, allocatable: str) -> str | None:
        if value is None:
            return value
        pattern = common.RESOURCE_REGEX
        match = re.fullmatch(pattern, value)
        if not match:
            raise osmo_errors.OSMOResourceError(
                f'Resource {allocatable} field has invalid value {value}'
            )

        unit = match.group('unit')
        if unit:
            if unit not in common.MEASUREMENTS:
                raise osmo_errors.OSMOResourceError(
                    f'Resource {allocatable} field has invalid unit: {unit}'
                )
        else:
            # Convert to Ki
            value = f'{common.convert_resource_value_str(value, target="Ki")}Ki'
        return value

    @pydantic.validator('memory')
    @classmethod
    def validate_memory(cls, value: str | None) -> str | None:
        return cls.validate_unit_value(value, 'memory')

    @pydantic.validator('storage')
    @classmethod
    def validate_storage(cls, value: str | None) -> str | None:
        return cls.validate_unit_value(value, 'storage')

    def get_allocatable_tokens(self, default_variables: Dict,
                               task_cache_size: str | None = None) -> \
        Dict[str, str | int | float | None]:
        """ Create a mapping for token substitution in pod templating. """
        mapping : Dict[str,  str | int | float | None] = {}

        def split_num_units(value: str | None) -> Tuple[str | None, str | None]:
            pattern = common.RESOURCE_REGEX
            if not value:
                return None, None
            match = re.fullmatch(pattern, value)
            if match:
                num = match.group('size')
                unit = match.group('unit')
                if not unit:
                    unit = 'B'
                return num, unit
            else:
                return None, None

        def store_num_units(num: str | None, unit: str | None, mapping: Dict, key_prefix: str):
            mapping[f'{key_prefix}_VAL'] = num
            mapping[f'{key_prefix}_UNIT'] = unit
            for target_unit in common.MEASUREMENTS_SHORT:
                mapping[f'{key_prefix}_{target_unit}'] = \
                    common.convert_resource_value_str(f'{num}{unit}', target=target_unit) \
                    if num and unit else None

        mapping['USER_CPU'] = float(self.cpu) if self.cpu else None
        mapping['USER_GPU'] = int(self.gpu) if self.gpu else None

        mapping['USER_STORAGE'] = self.storage
        num, unit = split_num_units(self.storage)
        store_num_units(num, unit, mapping, 'USER_STORAGE')

        mapping['USER_MEMORY'] = self.memory
        num, unit = split_num_units(self.memory)
        store_num_units(num, unit, mapping, 'USER_MEMORY')

        mapping['USER_EXCLUDED_NODES'] = f'ARRAY:[{",".join(self.nodesExcluded)}]'

        final_tokens = mapping
        if default_variables:
            final_tokens = copy.deepcopy(default_variables)
            for token_key, token_val in mapping.items():
                # If default variable and mapping has the same key but mapping
                # has value None, use default variable's value instead
                if token_key not in final_tokens or \
                    (token_key in final_tokens and token_val is not None):
                    final_tokens[token_key] = token_val

        # Set num and units after default variable calculation is done
        storage_num, storage_unit = split_num_units(
            str(mapping['USER_STORAGE']) if mapping.get('USER_STORAGE', None) else None)
        store_num_units(storage_num, storage_unit, mapping, 'USER_STORAGE')
        defined_storage_num = storage_num if storage_num else '0'
        defined_storage_unit = storage_unit if storage_unit else 'MiB'

        memory_num, memory_unit = split_num_units(
            str(mapping['USER_MEMORY']) if mapping.get('USER_MEMORY', None) else None)
        store_num_units(memory_num, memory_unit, mapping, 'USER_MEMORY')

        cache_amount = None
        # If user did not specify cache size, use the default variable
        task_cache_size = task_cache_size if task_cache_size\
            else str(mapping['USER_CACHE']) if mapping.get('USER_CACHE', None) else None

        if task_cache_size:
            if task_cache_size.endswith('%'):
                try:
                    cache_percent = math.floor(float(task_cache_size[:-1]))
                    if cache_percent < 0 or cache_percent > 100:
                        raise osmo_errors.OSMOResourceError(
                            f'Cache size must be between 0-100 percent: {task_cache_size}')
                    cache_amount =\
                        f'{math.floor(float(defined_storage_num) * (cache_percent/100))}'+\
                        f'{storage_unit}'
                except ValueError as err:
                    raise osmo_errors.OSMOResourceError(
                        f'Improperly formatted cache size: {task_cache_size}') from err
            else:
                cache_amount = self.validate_unit_value(task_cache_size, 'cache')
        else:
            # If no cache size was specified, use 90% of the storage amount
            cache_amount = f'{math.floor(float(defined_storage_num) * 0.9)}{defined_storage_unit}'
        final_tokens['USER_CACHE'] = cache_amount

        return final_tokens


    def __hash__(self):
        return hash((self.__class__.__name__, str(self.cpu),
                     self.storage, self.memory, str(self.gpu)))

class ResourceLimitationsField(ExtraArgBaseModel):
    cpu: str
    memory: str
    ephemeral_storage: str = pydantic.Field('1Gi', alias='ephemeral-storage')


class ResourceLimitations(ExtraArgBaseModel):
    requests: ResourceLimitationsField = ResourceLimitationsField(cpu='250m',
                                                                  memory='1Gi',
                                                                  ephemeral_storage='3Gi')
    limits: ResourceLimitationsField = ResourceLimitationsField(cpu='500m',
                                                                memory='16Gi',
                                                                ephemeral_storage='3Gi')

    def format(self) -> Dict[str, Any]:
        return {
                'requests': {
                    'cpu': self.requests.cpu,
                    'memory': self.requests.memory,
                    'ephemeral-storage': self.requests.ephemeral_storage},
                'limits': {
                    'cpu': self.limits.cpu,
                    'memory': self.limits.memory,
                    'ephemeral-storage': self.limits.ephemeral_storage}
            }


class ResourceAssertion(pydantic.BaseModel):
    """
    Class for defining resource restrictions.
    """
    class OperatorType(enum.Enum):
        GT = 'GT'
        GE = 'GE'
        LT = 'LT'
        LE = 'LE'
        EQ = 'EQ'

    def get_comparison_function(self, value) -> Callable[[float | str, float | str], bool]:
        return {
            'GT': lambda x, y: x > y,
            'GE': lambda x, y: x >= y,
            'LT': lambda x, y: x < y,
            'LE': lambda x, y: x <= y,
            'EQ': lambda x, y: x == y,
        }[value]

    operator: OperatorType
    left_operand: str
    right_operand: str
    assert_message: str

    class Config:
        use_enum_values = True
        extra = 'forbid'

    def evaluate(self, tokens: Dict[str, Any],
                 task_name: str):
        """
        Evaluate the assertion.

        Returns if the assertion succeeds or if the token referenced in one
        of the operands have a None value.

        AssertionError is raised if the assertion fails.
        """
        def process_operand(operand: str) -> int | float | str | None:
            processed_operand = jinja_sandbox.sandboxed_jinja_substitute(operand, tokens)
            if processed_operand is None:
                return None
            if re.fullmatch(common.RESOURCE_REGEX, processed_operand) \
                and processed_operand.endswith(tuple(common.MEASUREMENTS)):
                return int(common.convert_resource_value_str(
                    processed_operand, target='Ki'
                ))
            if re.fullmatch(r'\d+(\.\d+)?', processed_operand):
                return float(processed_operand)
            return processed_operand

        processed_left_operand = process_operand(self.left_operand)
        processed_right_operand = process_operand(self.right_operand)

        if processed_left_operand is None or processed_right_operand is None:
            return

        processed_assert_msg = (
            f'Assertion failed for task {task_name}: '
            f'{jinja_sandbox.sandboxed_jinja_substitute(self.assert_message, tokens)}'
        )

        comparison_function = self.get_comparison_function(self.operator)
        assert comparison_function(processed_left_operand, \
            processed_right_operand), processed_assert_msg


class BackendResourceConfig(pydantic.BaseModel):
    host_network: bool
    privileged: bool
    default_mounts: List[str] = []
    allowed_mounts: List[str] = []


class BackendResourceType(enum.Enum):
    """ Resource type for BackendResource. """
    RESERVED = 'RESERVED'
    SHARED = 'SHARED'
    UNUSED = 'UNUSED'


class BackendResource(pydantic.BaseModel):
    """ Represents a resource entry in the resource table """
    name: str
    backend: str
    label_fields: Dict[str, str]
    allocatable_fields: Dict[str, str]
    usage_fields: Dict[str, str]
    non_workflow_usage_fields: Dict[str, str]
    taint_fields: List[Dict]
    config_fields: Dict[str, Dict[str, BackendResourceConfig]] | None
    pool_platform_labels: Dict[str, List[str]]
    updated_allocatable_fields: Dict[str, Dict[str, Dict]]
    # Allocatable field accounting for osmo-ctrl usage and non-workflow pod usage
    updated_workflow_allocatable_fields: Dict[str, Dict[str, Dict]]
    available_fields: Dict[str, Dict[str, Dict]]
    resource_type: BackendResourceType

    def exposed_fields(self, verbose: bool = False) -> Dict[str, Any]:

        # Convert disk/cpus/etc into readable values
        disk = str(int(common.convert_resource_value_str(
        self.allocatable_fields['ephemeral-storage'], target='Gi')))
        num_cpus = self.allocatable_fields['cpu']
        cpu_mem = str(int(common.convert_resource_value_str(
            self.allocatable_fields['memory'], target='Gi')))
        num_gpus = str(self.allocatable_fields.get('nvidia.com/gpu', '0'))

        try:
            driver_labels = common.GPU_VERSIONED_LABELS['cuda-driver'].get_all_version_labels()
            driver_version = '.'.join(self.label_fields[label] for label in driver_labels)
        except KeyError:
            driver_version = '-'

        # Add node name, labels, taints, allocatable resources, and gpu labels
        collapsed_pool_platform = []
        for pool in self.pool_platform_labels.keys():
            for platform in self.pool_platform_labels[pool]:
                collapsed_pool_platform.append(f'{pool}/{platform}')
        exposed_fields = {'node': self.name, 'pool/platform': collapsed_pool_platform}

        exposed_fields.update({
            labels.name: value
            for labels, value
            in zip(common.ALLOCATABLE_RESOURCES_LABELS, [disk, num_cpus, cpu_mem, num_gpus])
        })

        if verbose:
            exposed_fields['cuda-driver'] = driver_version
            for driver_label in driver_labels:
                if driver_label not in exposed_fields:
                    exposed_fields[driver_label] = \
                        self.label_fields.get(driver_label, '-')

        return exposed_fields


    @classmethod
    def convert_allocatable(cls, original_fields):
        updated_fields = {}
        for resource_label in common.ALLOCATABLE_RESOURCES_LABELS:
            if resource_label.kube_label in original_fields:
                updated_fields[resource_label.name] = \
                    original_fields[resource_label.kube_label]
        return updated_fields


    @classmethod
    def construct_updated_allocatables(
            cls, pool_platform_labels: Dict[str, List[str]],
            pool_config: Dict[str, 'Pool'],
            allocatable_fields: Dict,
            non_workflow_usage_fields: Dict | None = None) -> Dict[str, Dict]:
        """
        This function constructs the updated allocatables for a node based on each pool and
        platform match. The resource limits defined by osmo-ctrl in the parsed pod template
        of each pool/platform match is subtracted from the total allocatable fields, and stored
        and the results are stored in a 2D dictionary, where the first index is the pool name,
        the second index is the platform name, and the value is the corresponding updated
        allocatables.
        """
        if non_workflow_usage_fields is None:
            non_workflow_usage_fields = \
                {allocatable.kube_label: '0' for allocatable \
                 in common.ALLOCATABLE_RESOURCES_LABELS}

        def check_osmo_data_resource(pod_template: Dict) -> ResourceLimitations:
            resource_limits = ResourceLimitations()
            containers = pod_template.get('spec', {}).get('containers', [])
            if containers:
                for container in containers:
                    if container.get('name', '') == 'osmo-ctrl':
                        if 'resources' in container:
                            resource_limits = ResourceLimitations(**container['resources'])
                            break
            return resource_limits

        ctrl_usage = {}
        for pool, platforms in pool_platform_labels.items():
            if pool in pool_config:
                curr_pool_config = pool_config[pool]
                for platform in platforms:
                    if platform not in curr_pool_config.platforms:
                        continue
                    curr_platform_config = curr_pool_config.platforms[platform]
                    resource_limits = \
                        check_osmo_data_resource(curr_platform_config.parsed_pod_template)
                    updated_allocatable_fields = copy.deepcopy(allocatable_fields)
                    if 'cpu' in updated_allocatable_fields:
                        updated_allocatable_fields['cpu'] = max(0,
                            int(float(updated_allocatable_fields['cpu']) - \
                            common.convert_cpu_unit(
                                resource_limits.requests.cpu) - \
                            common.convert_cpu_unit(
                                non_workflow_usage_fields['cpu'])))
                    if 'nvidia.com/gpu' in updated_allocatable_fields:
                        updated_allocatable_fields['nvidia.com/gpu'] = max(0,
                            int(updated_allocatable_fields.get('nvidia.com/gpu', 0)) - \
                            int(non_workflow_usage_fields.get('nvidia.com/gpu', 0)))
                    if 'ephemeral-storage' in updated_allocatable_fields:
                        # Kubernetes stores ephemeral storage in B
                        updated_allocatable_fields['ephemeral-storage'] = max(0,
                            int(common.convert_resource_value_str(
                                updated_allocatable_fields['ephemeral-storage'], 'B') - \
                            common.convert_resource_value_str(
                                resource_limits.requests.ephemeral_storage, 'B') - \
                            common.convert_resource_value_str(
                                non_workflow_usage_fields['ephemeral-storage'], 'B')))
                    if 'memory' in updated_allocatable_fields:
                        # Kubernetes stores memory in Ki
                        memory_value = \
                            int(common.convert_resource_value_str(
                                updated_allocatable_fields['memory'], 'Ki') - \
                            common.convert_resource_value_str(
                                resource_limits.requests.memory, 'Ki') - \
                            common.convert_resource_value_str(
                                non_workflow_usage_fields['memory'], 'Ki'))
                        updated_allocatable_fields['memory'] = f'{max(memory_value, 0)}Ki'
                    if pool not in ctrl_usage:
                        ctrl_usage[pool] = {platform: updated_allocatable_fields}
                    else:
                        if platform not in ctrl_usage[pool]:
                            ctrl_usage[pool][platform] = updated_allocatable_fields
        return ctrl_usage


    @classmethod
    def construct_available_fields(cls, updated_allocatable_fields: Dict,
                                    usage_fields: Dict) -> Dict[str, Dict]:
        available_fields = copy.deepcopy(updated_allocatable_fields)
        for pool, platforms in available_fields.items():
            for platform in platforms.keys():
                platform_available_fields = available_fields[pool][platform]
                for resource_label in common.ALLOCATABLE_RESOURCES_LABELS:
                    kube_label = resource_label.kube_label

                    if kube_label in platform_available_fields:
                        allocatable = platform_available_fields[kube_label]
                        usage = usage_fields.get(kube_label, '0')

                        if kube_label == 'ephemeral-storage':
                            # Kubernetes stores ephemeral storage in B
                            available = int(common.convert_resource_value_str(allocatable, 'B') - \
                                common.convert_resource_value_str(usage, 'B'))
                            platform_available_fields[kube_label] = max(available, 0)
                        elif kube_label == 'memory':
                            # Kubernetes stores memory in Ki
                            memory_value = \
                                int(common.convert_resource_value_str(allocatable, 'Ki') - \
                                common.convert_resource_value_str(usage, 'Ki'))
                            max_memory_value = max(memory_value, 0)
                            platform_available_fields[kube_label] = f'{max_memory_value}Ki'
                        else:
                            # For non-unit resources like CPU, do direct float comparison
                            allocatable_value = float(allocatable)
                            usage_value = float(usage)
                            platform_available_fields[kube_label] = \
                                int(max(allocatable_value - usage_value, 0))
        return available_fields

    @classmethod
    def _pool_platform_labels_to_dict(cls, pool_platform_labels: List[str]) -> Dict[str, List[str]]:
        labels_dict : Dict[str, List[str]] = {}
        for label in pool_platform_labels:
            if not label:
                continue
            split_label = label.split('/')
            pool, platform = split_label[0], split_label[1]
            if pool not in labels_dict:
                labels_dict[pool] = [platform]
            else:
                labels_dict[pool].append(platform)
        return labels_dict


    @classmethod
    def _create_config_fields(cls, pool_platform_labels: Dict[str, List[str]],
                              pool_config: Dict[str, 'Pool']):
        config_fields = {}
        for pool, platforms in pool_platform_labels.items():
            if pool in pool_config:
                for platform in platforms:
                    platform_config = pool_config[pool].platforms.get(platform, None)
                    if platform_config:
                        resource_config = BackendResourceConfig(
                                host_network=platform_config.host_network_allowed,
                                privileged=platform_config.privileged_allowed,
                                default_mounts=platform_config.default_mounts,
                                allowed_mounts=platform_config.allowed_mounts)
                        if pool not in config_fields:
                            config_fields[pool] = {platform: resource_config}
                        else:
                            config_fields[pool][platform] = resource_config
        return config_fields

    @property
    def converted_allocatable_fields(self) -> Dict[str, str]:
        return self.convert_allocatable(self.allocatable_fields)

    @property
    def converted_usage_fields(self) -> Dict[str, str]:
        return self.convert_allocatable(self.usage_fields)

    @classmethod
    def convert_platform_allocatable_fields(
        cls, updated_allocatable_fields: Dict[str, Dict]) -> Dict[str, Dict]:
        """
        Run the convert_allocatable function on each updated allocatable fields
        based on pool/platform resource limits defined by osmo-ctrl.
        The values are for the resource CLI to easily display.
        """
        updated_platform_allocatable_fields = {}
        for pool, platform_fields in updated_allocatable_fields.items():
            updated_platform_allocatable_fields[pool] = \
                {platform: cls.convert_allocatable(fields)
                 for platform, fields in platform_fields.items()}

        return updated_platform_allocatable_fields

    @property
    def converted_platform_allocatable_fields(self) -> Dict[str, Dict]:
        """
        Property that calls convert_platform_allocatable_fields with
        self.updated_allocatable_fields
        """
        return self.convert_platform_allocatable_fields(self.updated_allocatable_fields)

    @property
    def converted_platform_available_fields(self) -> Dict[str, Dict]:
        """
        Property that calls convert_platform_allocatable_fields with self.available_fields
        """
        return self.convert_platform_allocatable_fields(self.available_fields)

    @property
    def converted_platform_workflow_allocatable_fields(self) -> Dict[str, Dict]:
        """
        Property that calls convert_platform_allocatable_fields with
        self.updated_workflow_allocatable_fields
        """
        return self.convert_platform_allocatable_fields(self.updated_workflow_allocatable_fields)

    @classmethod
    def list_from_db(cls, backends: List[str] | None = None,
                     pools: List[str] | None = None,
                     platforms: List[str] | None = None,
                     resource_name: str | None = None) \
        -> List['BackendResource']:
        pool_filter_clause = ''
        query_params: List[Tuple | str] = []
        # Need to update to filter based on backend
        if backends or pools or resource_name:
            pool_filter_clause = 'WHERE '
            conditions = []
            if backends:
                conditions.append('r.backend IN %s')
                query_params.append(tuple(backends))
            if pools:
                conditions.append('t2.pool IN %s')
                query_params.append(tuple(pools))
                if platforms:
                    conditions.append('t2.platform IN %s')
                    query_params.append(tuple(platforms))
            if resource_name:
                conditions.append('t2.resource_name = %s')
                query_params.append(resource_name)
            pool_filter_clause += ' AND '.join(conditions)
        select_cmd = f'''
            SELECT t1.*,
                COALESCE(sub.pool_platform_labels, ARRAY[]::text[]) AS pool_platform_labels,
                resource_type
            FROM resources t1
            JOIN
                (SELECT
                    r.name,
                    r.backend,
                    array_agg(t2.pool || '/' || t2.platform) AS pool_platform_labels,
                    CASE
                        WHEN pools.count = 1 THEN 'RESERVED'
                        WHEN pools.count is NULL THEN 'UNUSED'
                        ELSE 'SHARED'
                    END AS resource_type
                FROM
                    resources r
                LEFT JOIN
                    resource_platforms t2 ON r.name = t2.resource_name and r.backend = t2.backend
                LEFT JOIN (
                    SELECT resource_name, COUNT(DISTINCT pool) AS count, backend
                    FROM resource_platforms
                    GROUP BY resource_name, backend
                ) pools ON t2.resource_name = pools.resource_name and t2.backend = pools.backend
                {pool_filter_clause}
                GROUP BY
                    r.name, r.backend, pools.count
                ) sub
            ON t1.name = sub.name AND t1.backend = sub.backend
            ORDER BY t1.backend ASC, t1.name ASC;
        '''
        postgres = PostgresConnector.get_instance()
        resources = postgres.execute_fetch_command(select_cmd, tuple(query_params), True)
        all_resources: List['BackendResource'] = []
        if len(resources) == 0:
            return all_resources

        pool_config = fetch_verbose_pool_config(postgres, resources[0]['backend']).pools

        for resource in resources:
            taints = resource.get('taints', [])
            label_fields = PostgresConnector.decode_hstore(resource.get('label_fields') or '')
            if resource['available']:
                label_fields = PostgresConnector.decode_hstore(resource.get('label_fields') or '')
                allocatable_fields = PostgresConnector.decode_hstore(
                    resource.get('allocatable_fields') or '')
                usage_fields = PostgresConnector.decode_hstore(
                    resource.get('usage_fields') or '')
                non_workflow_usage_fields = PostgresConnector.decode_hstore(
                    resource.get('non_workflow_usage_fields') or '')

                pool_platform_labels = \
                    cls._pool_platform_labels_to_dict(resource.get('pool_platform_labels', []))

                updated_allocatable_fields = \
                    cls.construct_updated_allocatables(
                        pool_platform_labels, pool_config,
                        allocatable_fields) \
                    if pool_config else {}

                updated_workflow_allocatable_fields = \
                    cls.construct_updated_allocatables(
                        pool_platform_labels, pool_config,
                        allocatable_fields, non_workflow_usage_fields) \
                    if pool_config else {}

                available_fields = cls.construct_available_fields(
                    updated_allocatable_fields, usage_fields)

                config_fields = cls._create_config_fields(
                    pool_platform_labels, pool_config) \
                    if pool_config else None
                all_resources.append(BackendResource.construct(
                    label_fields=label_fields,
                    taint_fields=taints,
                    allocatable_fields=allocatable_fields,
                    usage_fields=PostgresConnector.decode_hstore(
                        resource.get('usage_fields') or ''
                    ),
                    non_workflow_usage_fields=PostgresConnector.decode_hstore(
                        resource.get('non_workflow_usage_fields') or ''
                    ),
                    config_fields=config_fields,
                    name=resource['name'],
                    pool_platform_labels=pool_platform_labels,
                    updated_allocatable_fields=updated_allocatable_fields,
                    updated_workflow_allocatable_fields=updated_workflow_allocatable_fields,
                    available_fields=available_fields,
                    backend=resource['backend'],
                    resource_type=resource['resource_type']))

        return all_resources


class BackendSchedulerType(enum.Enum):
    """ Defines the type of scheduler used by the backend """
    KAI = 'kai'


class BackendSchedulerSettings(pydantic.BaseModel):
    """Settings that control the how pods are scheduled in a backend"""
    scheduler_type: BackendSchedulerType = BackendSchedulerType.KAI
    scheduler_name: str = 'kai-scheduler'
    scheduler_timeout: int = 30


class BackendNodeConditions(pydantic.BaseModel):
    """ Settings for backend node conditions. """
    rules: Dict[str, str] | None = None
    prefix: str = 'osmo.nvidia.com/'


class Backend(pydantic.BaseModel):
    """ Object storing backend info. """
    name: str
    description: str
    version: str
    k8s_uid: str
    k8s_namespace: str
    dashboard_url: str
    grafana_url: str
    tests: List[str]
    scheduler_settings: BackendSchedulerSettings
    node_conditions: BackendNodeConditions
    last_heartbeat: datetime.datetime
    created_date: datetime.datetime
    router_address: str
    online: bool

    @classmethod
    def fetch_from_db(cls, database: PostgresConnector,
                      name: str) -> 'Backend':
        """
        Creates a Workflow instance from a database workflow entry.

        Args:
            workflow_id (task_common.NamePattern): The workflow id.

        Raises:
            OSMODatabaseError: The workflow is not found in the database.

        Returns:
            Workflow: The workflow.
        """
        fetch_cmd = 'SELECT * FROM backends WHERE name = %s;'
        backend_rows = database.execute_fetch_command(fetch_cmd, (name,))
        try:
            backend_row = backend_rows[0]
        except IndexError as err:
            raise osmo_errors.OSMOBackendError(
                f'Backend {name} is not found.') from err

        return Backend(name=name,
                       description=backend_row.description,
                       version=backend_row.version,
                       k8s_uid=backend_row.k8s_uid,
                       k8s_namespace=backend_row.k8s_namespace,
                       dashboard_url=backend_row.dashboard_url,
                       grafana_url=backend_row.grafana_url,
                       tests=backend_row.tests,
                       scheduler_settings=BackendSchedulerSettings(
                           **yaml.safe_load(backend_row.scheduler_settings)),
                       node_conditions=BackendNodeConditions(**backend_row.node_conditions),
                       last_heartbeat=backend_row.last_heartbeat,
                       created_date=backend_row.created_date,
                       router_address=backend_row.router_address,
                       online=common.heartbeat_online(backend_row.last_heartbeat))

    @classmethod
    def list_names_from_db(cls, database: PostgresConnector) -> List[str]:
        """
        List all backends in the database

        Returns:
            backends: List all backend names in the backend
        """
        fetch_cmd = 'SELECT name FROM backends ORDER BY name;'
        backend_rows = database.execute_fetch_command(fetch_cmd, ())
        return [backend_row.name for backend_row in backend_rows]

    @classmethod
    def list_from_db(cls, database: PostgresConnector) -> List['Backend']:
        """
        Creates a backend instance from a database backend entry.

        Args:
            database (PostgresConnector): The database to fetch the backend from.

        Raises:
            OSMODatabaseError: The backend is not found in the database.

        Returns:
            backends: List of all backends in the database.
        """
        fetch_cmd = 'SELECT * FROM backends ORDER BY name;'
        backend_rows = database.execute_fetch_command(fetch_cmd, ())

        return [Backend(name=backend_row.name,
                        description=backend_row.description,
                        version=backend_row.version,
                        k8s_uid=backend_row.k8s_uid,
                        k8s_namespace=backend_row.k8s_namespace,
                        dashboard_url=backend_row.dashboard_url,
                        grafana_url=backend_row.grafana_url,
                        tests=backend_row.tests,
                        scheduler_settings=BackendSchedulerSettings(
                           **yaml.safe_load(backend_row.scheduler_settings)),
                        node_conditions=BackendNodeConditions(**backend_row.node_conditions),
                        last_heartbeat=backend_row.last_heartbeat,
                        created_date=backend_row.created_date,
                        router_address=backend_row.router_address,
                        online=common.heartbeat_online(backend_row.last_heartbeat))
                        for backend_row in backend_rows]


class BackendConfigCache:
    """A cache for Backend config objects to prevent redundant fetching of backends"""
    def __init__(self):
        self._cache: Dict[str, Backend] = {}

    def get(self, name: str) -> Backend:
        if name not in self._cache:
            self._cache[name] = Backend.fetch_from_db(PostgresConnector.get_instance(), name)
        return self._cache[name]


def construct_path(endpoint: str, bucket: str, path: str):
    if endpoint.endswith('/'):
        bucket_prefix = ''
    else:
        bucket_prefix = '/'
    bucket_prefix += f'{bucket}/{path}'
    bucket_prefix = re.sub(r'/{2,}', '/', bucket_prefix)
    endpoint += bucket_prefix
    return endpoint.rstrip('/')


class LogConfig(ExtraArgBaseModel):
    """ Config for storing information about data. """
    credential: credentials.StaticDataCredential | None = None


class WorkflowInfo(ExtraArgBaseModel):
    """ Config for workflow storage info. """
    tags: List[str] = []

    max_name_length: int = 64

    def validate_name(self, name: str):
        if len(name) > self.max_name_length:
            raise osmo_errors.OSMOUserError(
                f'Name {name} is too long. It must be {self.max_name_length} characters or less.')


class DataConfig(ExtraArgBaseModel):
    """ Config for storing information about data. """
    credential: credentials.StaticDataCredential | None = None

    base_url: str = ''
    # Timeout in mins for osmo-ctrl to retry connecting to the OSMO service until exiting the task
    websocket_timeout: int = 1440 # 24hr
    # Timeout in mins for upload/download messages. If it fails to receive logs
    # in the timeout, it will retry the upload/download
    data_timeout: int = 10

    download_type: DownloadType = DownloadType.DOWNLOAD


class BucketModeAccess(enum.Enum):
    """ Parameter if operation needs read or write access """
    READ = 'read'
    WRITE = 'write'


class BucketMode(enum.Enum):
    """ Permission for read-only, read-write, or write-only on bucket """
    READ_ONLY = 'read-only'
    READ_WRITE = 'read-write'


class BucketConfig(ExtraArgBaseModel):
    """
    Class to store the name of the bucket and the dataset path
    """
    dataset_path: constants.StorageBackendPattern
    region: str = constants.DEFAULT_BOTO3_REGION
    description: str = ''
    # Mode for read-only or read-write or write-only
    mode: str = BucketMode.READ_WRITE.value

    # Default cred to use doesn't have one
    # Only applies to workflow operations, NOT user cli since we cannot forward the credential
    # to the user
    default_credential: credentials.StaticDataCredential | None = None

    def valid_access(self, bucket_name: str, access_type: BucketModeAccess):
        if not ((access_type == BucketModeAccess.READ and\
                self.mode in (BucketMode.READ_ONLY.value, BucketMode.READ_WRITE.value))
            or (access_type == BucketModeAccess.WRITE and\
                self.mode == BucketMode.READ_WRITE.value)):
            raise osmo_errors.OSMOUsageError(f'Bucket {bucket_name} mode is {self.mode}. '
                                             f'Cannot be accessed by {access_type} api.')


class DynamicConfig(ExtraArgBaseModel):
    """ Manages the dynamic configs for the postgres database. """

    class Config:
        validate_assignment = True

    @classmethod
    def deserialize(cls, config_dict: Dict, postgres: PostgresConnector):
        """ Decrypts all secrets in `config_dict` """
        encrypt_keys = set()

        # Define function to pass into secret_manager.decrypt to update secrets
        def re_encrypt(key: str, new_encrypted: List):
            def add_to_encrypt_keys(value):
                new_encrypted.append(value)
                encrypt_keys.add(key)
            return add_to_encrypt_keys

        def _decrypt(result_data: Any,
                     encrypted_data: Any,
                     top_level_key: str) -> Tuple[Any, str | None]:
            """
            Recursively decrypts SecretStr values in `encrypted_data` and updates them in
            `result_data`.

            This helper function decrypts any SecretStr values found within `encrypted_data`.
            The decrypted secrets are stored in `result_data`, which is a copy of `encrypted_data`.
            `top_level_key` is the field in DynamicConfig where `encrypted_data` comes from.
            If `encrypted_data` get updated, `top_level_key` is added to a set and `deserialize`
            will update `top_level_key` in db configs table.

            Args:
                encrypted_data: Data that may contain SecretStr
                result_data: A copy of encrypted_data, used to store decrypted values.
                top_level_key: The field in DynamicConfig where `encrypted_data` comes from

            Returns:
                result: The decrypted data
                new_encrypted: A str of encrypted secret if `encrypted_data` is a SecretStr.
                    Otherwise it is None.
            """
            if isinstance(encrypted_data, dict):
                for key in encrypted_data:
                    decrypted, new_encrypted = _decrypt(
                        result_data[key], encrypted_data[key], top_level_key)
                    if new_encrypted is not None:
                        encrypted_data[key] = new_encrypted
                    result_data[key] = decrypted
                return result_data, None
            elif isinstance(encrypted_data, list):
                for index in range(len(encrypted_data)):
                    decrypted, new_encrypted = _decrypt(
                        result_data[index], result_data[index], top_level_key)
                    result_data[index] = decrypted
                    if new_encrypted is not None:
                        encrypted_data[index] = new_encrypted
                return result_data, None
            elif isinstance(encrypted_data, pydantic.SecretStr):
                secret = encrypted_data.get_secret_value()
                jwetoken = jwe.JWE()
                try:
                    jwetoken.deserialize(secret)
                    encrypted = Encrypted(secret)
                    new_encrypted_list: List = []
                    # If re-encryption is needed, top_level_key will be added to `encrypt_keys`.
                    # New encrypted value will be added to `new_encrypted_list`.
                    decrypted = postgres.secret_manager.decrypt(
                        encrypted, '', re_encrypt(top_level_key, new_encrypted_list))
                    new_encrypted = secret
                    if new_encrypted_list:
                        new_encrypted = new_encrypted_list[0]
                    return decrypted.value, new_encrypted
                except (JWException, osmo_errors.OSMONotFoundError):
                    # Encrypt the plain text secret
                    encrypted = postgres.secret_manager.encrypt(secret, '')
                    encrypt_keys.add(top_level_key)
                    return secret, encrypted.value
            else:
                return encrypted_data, None

        dynamic_config = cls(**config_dict)
        encrypted_dict = dynamic_config.dict(exclude_unset=True)
        decrypted_dict = dynamic_config.dict(exclude_unset=True)

        for key in config_dict:
            if not hasattr(dynamic_config, key):
                continue
            decrypted, new_encrypted = _decrypt(decrypted_dict[key], encrypted_dict[key], key)
            if new_encrypted is not None:
                encrypted_dict[key] = new_encrypted
            decrypted_dict[key] = decrypted
        dynamic_config = cls(**decrypted_dict)

        # Encrypt updated secrets
        for key in encrypt_keys:
            if isinstance(encrypted_dict[key], str):
                postgres.set_config(key, encrypted_dict[key], dynamic_config.get_type())
            else:
                old_value = json.dumps(config_dict[key])
                new_value = json.dumps(encrypted_dict[key])
                cmd = 'UPDATE configs SET value = %s WHERE key = %s AND value = %s;'
                postgres.execute_commit_command(cmd, (new_value, key, old_value))
        return dynamic_config

    def serialize_helper(self, config_dict: Dict, postgres: PostgresConnector,
                         top_level: bool = False) -> Dict[str, str | None]:
        """ Recursively encrypt all secret fields in any dictionary or list. """
        for key, value in config_dict.items():
            value_for_typecheck = value
            if isinstance(value_for_typecheck, dict):
                if top_level:
                    config_dict[key] = json.dumps(self.serialize_helper(value, postgres))
                else:
                    config_dict[key] = self.serialize_helper(value, postgres)
            elif isinstance(value_for_typecheck, list):
                if all(isinstance(v, dict) for v in value_for_typecheck):
                    config_dict[key] = \
                        [self.serialize_helper(v, postgres) for v in value_for_typecheck]
                else:
                    config_dict[key] = value_for_typecheck
            elif isinstance(value_for_typecheck, pydantic.SecretStr):
                if top_level:
                    encrypted = postgres.secret_manager.encrypt(value.get_secret_value(), '')
                    config_dict[key] = encrypted.value
                # TODO: Enable recursive encryption
                else:
                    config_dict[key] = value.get_secret_value()
            elif value_for_typecheck is None:
                config_dict[key] = None
            elif not isinstance(value_for_typecheck, str):
                config_dict[key] = json.dumps(config_dict[key])
        return config_dict

    def serialize(self, postgres: PostgresConnector, exclude_unset=True) -> Dict[str, str | None]:
        """Encrypts all secret fields and returns a dictionary """
        config_dict = self.dict(by_alias=True, exclude_unset=exclude_unset)
        result = self.serialize_helper(config_dict, postgres, top_level=True)
        return result

    def plaintext_dict(self, *args, **kwargs):
        """Returns as a dictionary with all SecretStrs converted to str"""
        data = self.dict(*args, **kwargs)
        def _convert_secrets(node):
            # Recurse for dict and list
            if isinstance(node, dict):
                for key in node:
                    node[key] = _convert_secrets(node[key])
                return node
            if isinstance(node, list):
                for index in range(len(node)):
                    node[index] = _convert_secrets(node[index])
                return node
            # Convert SecretStr to str
            if isinstance(node, pydantic.SecretStr):
                return node.get_secret_value()
            # Leave other leaf nodes alone
            return node

        _convert_secrets(data)
        return data

    @abc.abstractmethod
    def get_type(self) -> ConfigType:
        """ Returns what ConfigType applies to this Dynamic Config """
        pass


class CliConfig(ExtraArgBaseModel):
    """ Config for storing information regarding CLI storage. """
    latest_version: str | None = None
    min_supported_version: str | None = None


class ServiceConfig(DynamicConfig):
    """ Stores any configs OSMO Admins control """
    service_base_url: str = ''

    service_auth: auth.AuthenticationConfig = auth.AuthenticationConfig.generate_default()

    cli_config: CliConfig = CliConfig()

    # Maximum limit on duration allowed for job restarts
    max_pod_restart_limit: str = '30m'

    agent_queue_size: int = 1024

    def get_type(self) -> ConfigType:
        """ Returns what ConfigType applies to this Dynamic Config """
        return ConfigType.SERVICE

    def get_parsed_field(self) -> Tuple[str, str, str, str]:
        """
        Returns host, port, websocket scheme, and http scheme.
        """
        parsed_url = urlparse(self.service_base_url)
        host = parsed_url.hostname if parsed_url.hostname else ''
        ws_scheme = 'ws'
        if parsed_url.scheme == 'https':
            ws_scheme = 'wss'

        if parsed_url.port:
            port = parsed_url.port
        else:
            port = 80 if ws_scheme == 'ws' else 443
        return host, str(port), ws_scheme, parsed_url.scheme


class CredentialConfig(ExtraArgBaseModel):
    """ Stores registries/data which do not do validation """
    disable_registry_validation: List[str] = []

    disable_data_validation: List[str] = []


class UserWorkflowLimitConfig(ExtraArgBaseModel):
    """
    Stores workflow limits per user. Default is None, which means no limit.
    If a limit is set, it must be greater than 0.
    """
    max_num_workflows: int | None = pydantic.Field(None, gt=0)
    max_num_tasks: int | None = pydantic.Field(None, gt=0)

    jinja_sandbox_workers: int = 2
    jinja_sandbox_max_time: float = 0.5
    jinja_sandbox_memory_limit: int = 100*1024*1024


class RsyncAllowedPath(pydantic.BaseModel):
    """ Stores a single allowed path for rsync """
    path: str
    writable: bool = False


class RsyncConfig(ExtraArgBaseModel):
    """ Stores all configs for rsync """
    enabled: bool = False
    enable_telemetry: bool = False
    read_bandwidth_limit: int = pydantic.Field(
        int(2.5 * 1024 * 1024),   # 2.5MB/s
        description='User pod\'s rsync read bandwidth limit in bytes per second, '
                    'zero means no limit',
        ge=0,
    )
    write_bandwidth_limit: int = pydantic.Field(
        int(2.5 * 1024 * 1024),   # 2.5MB/s
        description='User pod\'s rsync write bandwidth limit in bytes per second, '
                    'zero means no limit',
        ge=0,
    )
    allowed_paths: Dict[str, RsyncAllowedPath] = {}
    daemon_debounce_delay: float = pydantic.Field(
        30.0,
        description='Daemon debounce delay for rsync in seconds',
        gt=0,
    )
    daemon_poll_interval: float = pydantic.Field(
        120.0,
        description='Daemon poll interval for rsync in seconds',
        gt=0,
    )
    daemon_reconcile_interval: float = pydantic.Field(
        60.0,
        description='Daemon reconcile interval for rsync in seconds',
        gt=0,
    )
    client_upload_rate_limit: int = pydantic.Field(
        2 * 1024 * 1024,   # 2.0MB/s
        description='Client upload rate limit for rsync in bytes per second, '
                    'zero means no limit',
        ge=0,
    )


class PluginsConfig(ExtraArgBaseModel):
    """ Stores any plugins configs """
    rsync: RsyncConfig = RsyncConfig()


class WorkflowConfig(DynamicConfig):
    """ Stores any workflow configs External Admins control """
    workflow_data: DataConfig = DataConfig()

    workflow_log: LogConfig = LogConfig()

    workflow_app: LogConfig = LogConfig()

    workflow_info: WorkflowInfo = WorkflowInfo()

    backend_images: OsmoImageConfig = OsmoImageConfig()

    # Notification config
    workflow_alerts: notify.NotificationConfig = notify.NotificationConfig()

    credential_config: CredentialConfig = CredentialConfig()

    user_workflow_limits: UserWorkflowLimitConfig = UserWorkflowLimitConfig()

    plugins_config: PluginsConfig = PluginsConfig()

    max_num_tasks: int = 20
    max_num_ports_per_task: int = 30  # Isaac Sim Streaming Client needs 27 ports
    max_retry_per_task: int = 0
    max_retry_per_job: int = 5

    default_schedule_timeout: int = 30
    default_exec_timeout: str = '60d'
    default_queue_timeout: str = '60d'
    max_exec_timeout: str = '60d'
    max_queue_timeout: str = '60d'

    force_cleanup_delay: str = '1h'
    max_log_lines: int = 10000
    max_task_log_lines: int = 1000
    max_error_log_lines: int = 100
    max_event_log_lines: int = 100

    task_heartbeat_frequency: str = '10m'

    def get_type(self) -> ConfigType:
        """ Returns what ConfigType applies to this Dynamic Config """
        return ConfigType.WORKFLOW


class DatasetConfig(DynamicConfig):
    """ Stores any dataset configs External Admins control """
    # Datasets
    buckets: Dict[str, BucketConfig] = {}
    default_bucket: str = ''

    def get_bucket_config(self, bucket: str) -> BucketConfig:
        if not bucket:
            bucket = self.default_bucket
        if bucket in self.buckets:
            return self.buckets[bucket]
        raise osmo_errors.OSMOServerError(f'Bucket {bucket} is not set in the configs')

    def get_type(self) -> ConfigType:
        """ Returns what ConfigType applies to this Dynamic Config """
        return ConfigType.DATASET


class ResourceValidation(pydantic.BaseModel):
    """ Single Pool Entry """
    resource_validations: List[ResourceAssertion]

    @classmethod
    def list_from_db(cls, database: PostgresConnector, names: Optional[List[str]] = None) \
        -> Dict[str, List[ResourceAssertion]]:
        """ Fetches the list of resource validations from the resource validation table """
        list_of_names = ''
        fetch_input: Tuple = ()
        if names:
            list_of_names = 'WHERE name in %s'
            fetch_input = (tuple(names),)
        fetch_cmd = f'SELECT * FROM resource_validations {list_of_names} ORDER BY name;'
        spec_rows = database.execute_fetch_command(fetch_cmd, fetch_input, True)

        return {spec_row['name']: spec_row['resource_validations'] for spec_row in spec_rows}

    @classmethod
    def fetch_from_db(cls, database: PostgresConnector, name: str) -> List[ResourceAssertion]:
        """ Fetches the resource validations from the resource validation table """
        fetch_cmd = 'SELECT * FROM resource_validations WHERE name = %s;'
        spec_rows = database.execute_fetch_command(fetch_cmd, (name,), True)
        if not spec_rows:
            raise osmo_errors.OSMOUserError(f'Resource Validation {name} does not exist.')

        spec_row = spec_rows[0]

        return spec_row['resource_validations']

    @classmethod
    def get_pools(cls, database: PostgresConnector, name: str) -> List[Dict]:
        fetch_cmd = '''
            SELECT name
            FROM pools
            WHERE %s=ANY(common_resource_validations)
            OR EXISTS (
                SELECT 1
                FROM jsonb_each(platforms) as top_level_keys
                WHERE top_level_keys.value->'resource_validations' @> %s
            );
            '''
        return database.execute_fetch_command(fetch_cmd, (name, f'"{name}"'), True)

    @classmethod
    def delete_from_db(cls, database: PostgresConnector, name: str):
        pools = cls.get_pools(database, name)
        if pools:
            raise osmo_errors.OSMOUserError(f'Resource Validation {name} is used in pools ' +\
                                            f'{", ".join([pool["name"] for pool in pools])}')

        delete_cmd = '''
            DELETE FROM resource_validations WHERE name = %s;
            '''
        database.execute_commit_command(delete_cmd, (name,))

    def insert_into_db(self, database: PostgresConnector, name: str):
        """ Create/update an entry in the pools table """
        insert_cmd = '''
            INSERT INTO resource_validations
            (name, resource_validations)
            VALUES (%s, %s::jsonb[])
            ON CONFLICT (name)
            DO UPDATE SET
                resource_validations = EXCLUDED.resource_validations;
            '''
        database.execute_commit_command(
            insert_cmd,
            (name,[json.dumps(validation.dict()) for validation in self.resource_validations]))

        for pool_info in ResourceValidation.get_pools(database, name):
            Pool.update_resource_validations(database, pool_info['name'])


class PodTemplate(pydantic.BaseModel):
    """ Single Pool Entry """
    pod_template: Dict

    @classmethod
    def list_from_db(cls, database: PostgresConnector, names: Optional[List[str]] = None) \
        -> Dict[str, Dict]:
        """ Fetches the list of pod templates from the pod template table """
        list_of_names = ''
        fetch_input: Tuple = ()
        if names:
            list_of_names = 'WHERE name in %s'
            fetch_input = (tuple(names),)
        fetch_cmd = f'SELECT * FROM pod_templates {list_of_names} ORDER BY name;'
        spec_rows = database.execute_fetch_command(fetch_cmd, fetch_input, True)

        return {spec_row['name']: spec_row['pod_template'] for spec_row in spec_rows}

    @classmethod
    def fetch_from_db(cls, database: PostgresConnector, name: str) -> Dict:
        """ Fetches the pod template from the pod template table """
        fetch_cmd = 'SELECT * FROM pod_templates WHERE name = %s;'
        spec_rows = database.execute_fetch_command(fetch_cmd, (name,), True)
        if not spec_rows:
            raise osmo_errors.OSMOUserError(f'Pod Template {name} does not exist.')

        spec_row = spec_rows[0]

        return spec_row['pod_template']

    @classmethod
    def get_pools(cls, database: PostgresConnector, name: str) -> List[Dict]:
        fetch_cmd = '''
            SELECT name
            FROM pools
            WHERE %s=ANY(common_pod_template)
            OR EXISTS (
                SELECT 1
                FROM jsonb_each(platforms) as top_level_keys
                WHERE top_level_keys.value->'override_pod_template' @> %s
            );
            '''
        return database.execute_fetch_command(fetch_cmd, (name, f'"{name}"'), True)

    @classmethod
    def get_tests(cls, database: PostgresConnector, name: str) -> List[Dict]:
        fetch_cmd = '''
            SELECT name
            FROM backend_tests
            WHERE %s=ANY(common_pod_template)
        '''
        return database.execute_fetch_command(fetch_cmd, (name,), True)


    @classmethod
    def delete_from_db(cls, database: PostgresConnector, name: str):
        pools = cls.get_pools(database, name)
        if pools:
            raise osmo_errors.OSMOUserError(f'Pod template {name} is used in pools ' +\
                                            f'{", ".join([pool["name"] for pool in pools])}')
        tests = cls.get_tests(database, name)
        if tests:
            raise osmo_errors.OSMOUserError(f'Pod template {name} is used in tests ' +\
                                            f'{", ".join([test["name"] for test in tests])}')

        delete_cmd = '''
            DELETE FROM pod_templates WHERE name = %s;
            '''
        database.execute_commit_command(delete_cmd, (name,))

    def insert_into_db(self, database: PostgresConnector, name: str):
        """ Create/update an entry in the pools table """
        insert_cmd = '''
            INSERT INTO pod_templates
            (name, pod_template)
            VALUES (%s, %s)
            ON CONFLICT (name)
            DO UPDATE SET
                pod_template = EXCLUDED.pod_template;
            '''
        database.execute_commit_command(insert_cmd, (name, json.dumps(self.pod_template)))

        for pool_info in PodTemplate.get_pools(database, name):
            Pool.update_pod_template(database, pool_info['name'])

        for test_info in PodTemplate.get_tests(database, name):
            BackendTests.update_pod_template(database, test_info['name'])


class Toleration(pydantic.BaseModel):
    """ Single Toleration Entry """
    key: str
    operator: str = 'Equal'
    value: Optional[str] = None
    effect: str | None = None


class PlatformBase(pydantic.BaseModel):
    """ Single Platform Entry """
    description: str = ''

    host_network_allowed: bool = False
    privileged_allowed: bool = False
    allowed_mounts: List[str] = []


class PlatformMinimal(PlatformBase):
    """ Single Platform Entry """

    default_mounts: List[str] = []


class PlatformEditable(PlatformBase, extra=pydantic.Extra.ignore):
    """ Single Platform Entry """

    default_variables: Dict = {}
    resource_validations: List[str] = []
    override_pod_template: List[str] = []


class Platform(PlatformMinimal):
    """ Single Platform Entry """
    # These two fields are filled out automatically by the override spec
    tolerations: List[Toleration] = []
    labels: Dict[str, str] = {}

    default_variables: Dict = {}
    resource_validations: List[str] = []
    parsed_resource_validations: List[ResourceAssertion] = []
    override_pod_template: List[str] = []
    parsed_pod_template: Dict = {}

    def insert_into_db(self, database: PostgresConnector, pool_name: str, platform_name: str):
        """ Create/update an entry in the pools table """
        pool_info = Pool.fetch_from_db(database, pool_name)
        pool_info.platforms[platform_name] = self

        pool_info.calculate_platforms_pod_template(database, platform_name)
        pool_info.calculate_platforms_resource_validations(database, platform_name)

        insert_cmd = '''
            UPDATE pools SET platforms = %s where name = %s;
            '''
        database.execute_commit_command(
            insert_cmd,
            (json.dumps(pool_info.platforms, default=common.pydantic_encoder), pool_name))


class Quota(pydantic.BaseModel):
    """ Quota Entry """
    max_num_gpus: int = 100


class PermissionLevel(enum.Enum):
    """ Permission Level """
    PUBLIC = 'PUBLIC'
    POOL = 'POOL'
    PRIVATE = 'PRIVATE'


class ActionPermissions(pydantic.BaseModel):
    """ Defines permissions for certain actionsfor a pool """
    execute: PermissionLevel = PermissionLevel.PRIVATE
    portforward: PermissionLevel = PermissionLevel.PRIVATE
    cancel: PermissionLevel = PermissionLevel.PRIVATE
    rsync: PermissionLevel = PermissionLevel.PRIVATE

    class Config:
        use_enum_values = True

class PoolResourceCountable(pydantic.BaseModel):
    """
    Resources like GPU or CPU that have a discrete number. For guarantee and maximum, a value of -1
    indicates that there is no limit.
    """
    guarantee: int = -1
    maximum: int = -1
    weight: int = 1

class PoolResources(pydantic.BaseModel):
    """ Resources allocated to the pool, for schedulers that support this feature """
    gpu: PoolResourceCountable | None = None


class PoolBase(pydantic.BaseModel):
    """ Pool schema to expose through API endpoint. """
    name: str = ''
    description: str = ''
    status: PoolStatus | None = None
    download_type: DownloadType | None = None
    enable_maintenance: bool = False
    backend: str
    default_platform: Optional[str] = None
    default_exec_timeout: str = ''
    default_queue_timeout: str = ''
    max_exec_timeout: str = ''
    max_queue_timeout: str = ''
    default_exit_actions: Dict[str, str] = {}
    action_permissions: ActionPermissions = ActionPermissions()
    resources: PoolResources = PoolResources()

class PoolMinimal(PoolBase):
    platforms: Dict[str, PlatformMinimal] = {}


class PoolEditable(PoolBase, extra=pydantic.Extra.ignore):
    common_default_variables: Dict = {}
    common_resource_validations: List[str] = []
    common_pod_template: List[str] = []
    platforms: Dict[str, PlatformEditable] = {}


class Pool(PoolBase, extra=pydantic.Extra.ignore):
    """ Single Pool Entry """
    common_default_variables: Dict = {}
    common_resource_validations: List[str] = []
    parsed_resource_validations: List[ResourceAssertion] = []
    common_pod_template: List[str] = []
    parsed_pod_template: Dict = {}
    platforms: Dict[str, Platform] = {}
    last_heartbeat: datetime.datetime | None = None

    @classmethod
    def update_pod_template(cls, database: PostgresConnector, name: str):
        """ Updates pod_templates """
        pool_info = cls.fetch_from_db(database, name)
        pool_info.calculate_pod_template(database)

        insert_cmd = '''
            UPDATE pools
            SET platforms = %s, parsed_pod_template = %s
            WHERE name = %s;
            '''
        database.execute_commit_command(
            insert_cmd,
            (json.dumps(pool_info.platforms, default=common.pydantic_encoder),
             json.dumps(pool_info.parsed_pod_template),
             name))


    @classmethod
    def update_resource_validations(cls, database: PostgresConnector, name: str):
        """ Update resource_validations """
        pool_info = cls.fetch_from_db(database, name)
        pool_info.calculate_resource_validations(database)

        insert_cmd = '''
            UPDATE pools
            SET platforms = %s, parsed_resource_validations = %s
            WHERE name = %s;
            '''
        database.execute_commit_command(
            insert_cmd,
            (json.dumps(pool_info.platforms, default=common.pydantic_encoder),
             json.dumps(pool_info.parsed_resource_validations),
             name))


    @classmethod
    def fetch_from_db(cls, database: PostgresConnector, name: str) -> 'Pool':
        """ Fetches a pool from the pools table """
        pool_rows = cls.fetch_rows_from_db(database, pools=[name])
        if not pool_rows:
            raise osmo_errors.OSMOUserError(f'Pool {name} not found.')

        pool_info = Pool(**pool_rows[0])

        workflow_configs = database.get_workflow_configs()
        if not pool_info.default_exec_timeout:
            pool_info.default_exec_timeout = workflow_configs.default_exec_timeout
        if not pool_info.default_queue_timeout:
            pool_info.default_queue_timeout = workflow_configs.default_queue_timeout
        if not pool_info.max_exec_timeout:
            pool_info.max_exec_timeout = workflow_configs.max_exec_timeout
        if not pool_info.max_queue_timeout:
            pool_info.max_queue_timeout = workflow_configs.max_queue_timeout

        return pool_info

    @classmethod
    def rename(cls, database: PostgresConnector, old_name: str, new_name: str):
        """ Renames a pool from the pools table """
        update_cmd = 'UPDATE pools SET name = %s WHERE name = %s;'
        database.execute_commit_command(update_cmd, (new_name, old_name))

    @classmethod
    def rename_platform(cls, database: PostgresConnector, name: str, platform_name: str,
                        new_platform_name):
        """ Renames a platform in a pool from the pools table """
        update_cmd = '''
            UPDATE pools SET platforms = jsonb_set(
                platforms - %s, %s,
                platforms->%s
            )
            WHERE name = %s and platforms ? %s;
        '''
        database.execute_commit_command(update_cmd,
                                        (platform_name, f'{{{new_platform_name}}}',
                                         platform_name, name, platform_name))

    @classmethod
    def fetch_platform_from_db(cls, database: PostgresConnector, name: str,
                               platform_name: str) -> Platform:
        """ Fetches a pool from the pools table """
        platforms = Pool.fetch_from_db(database, name).platforms
        if platform_name not in platforms:
            raise osmo_errors.OSMOUserError(
                f'Platform name {platform_name} not found in pool {name}.')
        return platforms[platform_name]

    @classmethod
    def fetch_rows_from_db(cls, database: PostgresConnector,
                           backend: str | None = None,
                           access_names: List[str] | None = None,
                           pools: List[str] | None = None,
                           all_pools: bool = True) -> Any:
        """ Fetches the list of pools from the pools table """
        params : List[str | Tuple] = []
        conditions = []

        if not access_names:
            access_names = []

        if backend:
            conditions.append('pools.backend = %s')
            params.append(backend)

        if pools:
            conditions.append('pools.name IN %s')
            params.append(tuple(pools))
        elif not all_pools:
            # TODO: Derive the pool access based on resource and not the name of the role
            pool_list = [
                f'{access_name[len("osmo-"):]}%' for access_name in access_names
                if access_name.startswith('osmo-')]
            similar_str = f'({"|".join(pool_list)})'
            conditions.append(
                '(pools.name SIMILAR TO %s OR pools.name = %s)')
            params.extend((similar_str, 'default'))

        conditions_clause = '' if not params \
            else f'WHERE {" AND ".join(conditions)}'
        fetch_cmd = 'SELECT pools.*, backends.last_heartbeat ' \
                    'FROM pools LEFT JOIN backends ' \
                    'ON pools.backend = backends.name ' \
                    f'{conditions_clause} ORDER BY pools.name'
        pool_rows = database.execute_fetch_command(
            fetch_cmd, tuple(params), True)
        for pool_row in pool_rows:
            if pool_row.get('enable_maintenance', False):
                pool_row['status'] = PoolStatus.MAINTENANCE
            else:
                if pool_row.get('last_heartbeat', None) and \
                    common.heartbeat_online(pool_row['last_heartbeat']):
                    pool_row['status'] = PoolStatus.ONLINE
                else:
                    pool_row['status'] = PoolStatus.OFFLINE
        return pool_rows

    @classmethod
    def get_pools(cls, access_names: List[str], all_pools: bool = False) -> List[str]:
        """
        Fetch pool names of pools that are available to the user's given access_names.
        If access_names has a string called groot, return all pool names that start with
        'groot'.
        """
        database = PostgresConnector.get_instance()
        return [pool['name'] for pool in cls.fetch_rows_from_db(
            database, access_names=access_names, all_pools=all_pools)]

    @classmethod
    def delete_from_db(cls, database: PostgresConnector, name: str):
        delete_cmd = '''
            BEGIN;
            DELETE FROM pools WHERE name = %s;
            DELETE FROM resource_platforms WHERE pool = %s;
            COMMIT;
        '''
        database.execute_commit_command(delete_cmd, (name, name))

    def get_default_mounts(self, pod_template: Dict) -> List[str]:
        ''' Fetch default mounts from pod template. '''
        default_mounts: List[str] = []
        spec: Dict = pod_template.get('spec', {})
        containers: List[Dict] = spec.get('containers', [])
        for container in containers:
            if container.get('name', '') != 'osmo-ctrl':
                volume_mounts: List[Dict] = container.get('volumeMounts', [])
                for mount in volume_mounts:
                    if mount.get('mountPath', None):
                        default_mounts.append(mount['mountPath'])
        return default_mounts

    def set_pod_template(self, platform_info: Platform,
                         pod_template_specs: Dict[str, Dict]):
        ''' Helper function for parsing pod templates '''
        platform_info.parsed_pod_template = copy.deepcopy(self.parsed_pod_template)
        for pod_template in platform_info.override_pod_template:
            if pod_template not in pod_template_specs:
                raise osmo_errors.OSMOUsageError(f'Pod template {pod_template} does not exist!')
            platform_info.parsed_pod_template = common.recursive_dict_update(
                platform_info.parsed_pod_template,
                pod_template_specs[pod_template],
                common.merge_lists_on_name)
        platform_info.tolerations = [
            Toleration(**toleration) for toleration in
            platform_info.parsed_pod_template.get('spec', {}).get('tolerations', [])
        ]
        platform_info.labels = \
            platform_info.parsed_pod_template.get('spec', {}).get('nodeSelector', {})
        platform_info.default_mounts = \
            self.get_default_mounts(platform_info.parsed_pod_template)

    def calculate_platforms_pod_template(self, database: PostgresConnector, platform_name: str):
        ''' Construct Pool platform pod_template '''
        platform_info = self.platforms[platform_name]
        pod_template_specs = PodTemplate.list_from_db(database, platform_info.override_pod_template)
        self.set_pod_template(platform_info, pod_template_specs)

    def calculate_pod_template(self, database: PostgresConnector):
        ''' Construct Pool pod_template '''
        combined_pod_templates = copy.deepcopy(self.common_pod_template)
        for _, platform_info in self.platforms.items():
            combined_pod_templates += platform_info.override_pod_template

        pod_template_specs = PodTemplate.list_from_db(database, combined_pod_templates)
        self.parsed_pod_template = {}
        for pod_template in self.common_pod_template:
            if pod_template not in pod_template_specs:
                raise osmo_errors.OSMOUsageError(f'Pod template {pod_template} does not exist!')
            self.parsed_pod_template = common.recursive_dict_update(
                self.parsed_pod_template,
                pod_template_specs[pod_template],
                common.merge_lists_on_name)
        for platform_info in self.platforms.values():
            self.set_pod_template(platform_info, pod_template_specs)

    def set_resource_validations(self, platform_info: Platform,
                                 resource_validations: Dict[str, List]):
        ''' Helper function for parsing pod templates '''
        platform_info.parsed_resource_validations = copy.deepcopy(
            self.parsed_resource_validations)
        for resource_validation_name in platform_info.resource_validations:
            if resource_validation_name not in resource_validations:
                raise osmo_errors.OSMOUsageError(
                    f'Resource validation {resource_validation_name} does not exist!')
            platform_info.parsed_resource_validations += \
                resource_validations[resource_validation_name]

    def calculate_platforms_resource_validations(self, database: PostgresConnector,
                                                 platform_name: str):
        ''' Construct Pool platform pod_template '''
        platform_info = self.platforms[platform_name]
        resource_validations = ResourceValidation.list_from_db(
            database, platform_info.resource_validations)
        self.set_resource_validations(platform_info, resource_validations)

    def calculate_resource_validations(self, database: PostgresConnector):
        ''' Construct Pool resource_validations '''
        # Update resource validation
        self.parsed_resource_validations = []
        combined_resource_validations = copy.deepcopy(self.common_resource_validations)
        for _, platform_info in self.platforms.items():
            combined_resource_validations += platform_info.resource_validations

        resource_validations = ResourceValidation.list_from_db(
            database, combined_resource_validations)
        for resource_validation_name in self.common_resource_validations:
            if resource_validation_name not in resource_validations:
                raise osmo_errors.OSMOUsageError(
                    f'Resource validation {resource_validation_name} does not exist!')
            self.parsed_resource_validations += resource_validations[resource_validation_name]
        for _, platform_info in self.platforms.items():
            self.set_resource_validations(platform_info, resource_validations)

    def insert_into_db(self, database: PostgresConnector, name: str):
        """ Create/update an entry in the pools table """
        self.calculate_pod_template(database)
        self.calculate_resource_validations(database)

        if self.default_platform and self.default_platform not in self.platforms:
            raise osmo_errors.OSMOUsageError(
                f'Default platform {self.default_platform} not in platforms')

        insert_cmd = '''
            INSERT INTO pools
            (name, description, backend, download_type, default_platform, platforms,
             default_exec_timeout, default_queue_timeout,
             max_exec_timeout, max_queue_timeout, default_exit_actions,
             common_default_variables, common_resource_validations, parsed_resource_validations,
             common_pod_template, parsed_pod_template, enable_maintenance,
             action_permissions, resources)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (name)
            DO UPDATE SET
                description = EXCLUDED.description,
                backend = EXCLUDED.backend,
                download_type = EXCLUDED.download_type,
                default_platform = EXCLUDED.default_platform,
                platforms = EXCLUDED.platforms,
                default_exec_timeout = EXCLUDED.default_exec_timeout,
                default_queue_timeout = EXCLUDED.default_queue_timeout,
                max_exec_timeout = EXCLUDED.max_exec_timeout,
                max_queue_timeout = EXCLUDED.max_queue_timeout,
                default_exit_actions = EXCLUDED.default_exit_actions,
                common_default_variables = EXCLUDED.common_default_variables,
                common_resource_validations = EXCLUDED.common_resource_validations,
                parsed_resource_validations = EXCLUDED.parsed_resource_validations,
                common_pod_template = EXCLUDED.common_pod_template,
                parsed_pod_template = EXCLUDED.parsed_pod_template,
                enable_maintenance = EXCLUDED.enable_maintenance,
                action_permissions = EXCLUDED.action_permissions,
                resources = EXCLUDED.resources;
            '''
        database.execute_commit_command(
            insert_cmd,
            (name, self.description, self.backend,
             self.download_type.value if self.download_type else None,
             self.default_platform,
             json.dumps(self.platforms, default=common.pydantic_encoder),
             self.default_exec_timeout, self.default_queue_timeout,
             self.max_exec_timeout, self.max_queue_timeout,
             json.dumps(self.default_exit_actions),
             json.dumps(self.common_default_variables),
             self.common_resource_validations, json.dumps(self.parsed_resource_validations),
             self.common_pod_template, json.dumps(self.parsed_pod_template),
             self.enable_maintenance,
             json.dumps(self.action_permissions, default=common.pydantic_encoder),
             json.dumps(self.resources, default=common.pydantic_encoder)))


class VerbosePoolConfig(pydantic.BaseModel):
    """
    Stores verbose pool configs.
    """
    pools: Dict[str, Pool] = {}


class EditablePoolConfig(pydantic.BaseModel):
    """
    Stores editable pool configs.
    """
    pools: Dict[str, PoolEditable] = {}


class MinimalPoolConfig(pydantic.BaseModel):
    """
    Stores minimal pool configs.
    """
    pools: Dict[str, PoolMinimal] = {}


def fetch_verbose_pool_config(database: PostgresConnector,
                              backend: str | None = None,
                              access_names: List[str] | None = None,
                              pools: List[str] | None = None,
                              all_pools: bool = True) -> VerbosePoolConfig:
    pool_rows = Pool.fetch_rows_from_db(database,
                                        backend=backend,
                                        access_names=access_names,
                                        pools=pools,
                                        all_pools=all_pools)
    return VerbosePoolConfig(
        pools={pool_row['name']: Pool(**pool_row) for pool_row in pool_rows})


def fetch_minimal_pool_config(database: PostgresConnector,
                              backend: str | None = None,
                              access_names: List[str] | None = None,
                              pools: List[str] | None = None,
                              all_pools: bool = True) -> MinimalPoolConfig:
    pool_rows = Pool.fetch_rows_from_db(database,
                                        backend=backend,
                                        access_names=access_names,
                                        pools=pools,
                                        all_pools=all_pools)
    return MinimalPoolConfig(
        pools={pool_row['name']: PoolMinimal(**pool_row) for pool_row in pool_rows})


def fetch_editable_pool_config(database: PostgresConnector,
                              backend: str | None = None,
                              access_names: List[str] | None = None,
                              pools: List[str] | None = None,
                              all_pools: bool = True) -> EditablePoolConfig:
    pool_rows = Pool.fetch_rows_from_db(database,
                                        backend=backend,
                                        access_names=access_names,
                                        pools=pools,
                                        all_pools=all_pools)
    return EditablePoolConfig(
        pools={pool_row['name']: PoolEditable(**pool_row) for pool_row in pool_rows})


def fetch_platform_config(name: str,
                          pool_type: PoolType,
                          database: PostgresConnector) \
                          -> Dict[str, Platform] | \
                             Dict[str, PlatformEditable] | \
                             Dict[str, PlatformMinimal]:

    platforms = Pool.fetch_from_db(database, name).platforms
    if pool_type == PoolType.VERBOSE:
        return platforms
    elif pool_type == PoolType.EDITABLE:
        return {platform_name: PlatformEditable(**platform.dict())
                for platform_name, platform in platforms.items()}
    elif pool_type == PoolType.MINIMAL:
        return {platform_name: PlatformMinimal(**platform.dict())
                for platform_name, platform in platforms.items()}
    else:
        raise osmo_errors.OSMOServerError(f'Unknown pool type: {pool_type.name}')


class ListOrder(enum.Enum):
    """ Represents the list order for the database. """
    ASC = 'ASC'
    DESC = 'DESC'


class PostgresUpdateCommand(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ A class for creating database updating command. """
    table: str
    conditions: List[str] = []
    condition_args: List[Any] = []
    keys: List[str] = []
    values: List[Any] = []

    def add_field(self, key: str, value: Any, custom_expression: str = '%s'):
        """
        Adds a field to be updated.

        Args:
            key (str): Key of the field.
            value (Any): Value of the field.
            custom_expression (str): Custom expression to use for right hand side of the assignment.
        """
        self.keys.append(f'{key} = {custom_expression}')
        self.values.append(value)

    def add_condition(self, condition: str, condition_args: List[Any]):
        """
        Adds a condition for the update.

        Args:
            condition (str): The condition statement. Always use 'and' to aggregate conditions.
                             For more complex logics, include them in condition strings directly.
            condition_args (List[Any]): Any condition arguments.
        """
        self.conditions.append(condition)
        self.condition_args += condition_args

    def get_args(self) -> Tuple[str, Tuple[Any, ...]]:
        """
        Gets the database query command and arguments.

        Raises:
            OSMOServerError: Missing keys or values.
        Returns:
            Tuple[str, Tuple[Any]]: The command and the arguments.
        """
        if not self.keys or not self.values:
            raise osmo_errors.OSMOServerError('Missing keys or values.')
        fields = ', '.join(self.keys)
        command = f'UPDATE {self.table} SET {fields}'
        args = self.values

        if self.conditions:
            conditions = ' AND '.join(self.conditions)
            command = f'{command} WHERE {conditions}'
            args += self.condition_args

        command += ';'
        return command, tuple(args)


class PostgresSelectCommand(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ A class for creating database selecting command. """
    table: str
    conditions: List[str] = []
    condition_args: List[Any] = []
    keys: List[str] = []
    limit: int | None = None
    orderby: str = ''  # Order entries by a key
    order: ListOrder = ListOrder.DESC

    def add_field(self, key: str):
        """
        Adds a field to be selected.

        Args:
            key (str): Key of the field
        """
        self.keys.append(key)

    def add_condition(self, condition: str, condition_args: List[Any]):
        """
        Adds a condition for the select.

        Args:
            condition (str): The condition statement. Always use 'and' to aggregate conditions.
                             For more complex logics, include them in condition strings directly.
            condition_args (List[Any]): Any condition arguments.
        """
        self.conditions.append(condition)
        self.condition_args += condition_args

    def add_or_conditions(self, conditions: List[str], condition_args: List[Any]):
        """
        Adds a chain of OR conditions to the rest of the conditions.

        Args:
            conditions (List[str]): The list of conditions that are joined by OR.
            condition_args (List[Any]): Any condition arguments.
        """
        condition_str = '('
        condition_str = f'({" OR ".join(conditions)})'
        self.add_condition(condition_str, condition_args)

    def get_args(self) -> Tuple[str, Tuple[Any, ...]]:
        """
        Gets the database select command and arguments.

        Raises:
            OSMOServerError: Missing keys or values.
        Returns:
            Tuple[str, Tuple[Any]]: The command and the arguments.
        """
        fields = ', '.join(self.keys) or '*'
        command = f'SELECT {fields} FROM {self.table}'
        args = []

        if self.conditions:
            conditions = ' AND '.join(self.conditions)
            command = f'{command} WHERE {conditions}'
            args += self.condition_args

        if self.orderby:
            command += f' ORDER BY {self.orderby} {self.order.name}'
        if self.limit:
            command += f' LIMIT {self.limit}'
        command += ';'
        return command, tuple(args)


def parse_username(
    user_header: Optional[str] = \
        fastapi.Header(alias=login.OSMO_USER_HEADER, default=None)) -> str:
    """ Parses the username from the request. """
    postgres = PostgresConnector.get_instance()
    service_config = postgres.get_service_configs()
    # Auth disabled
    if not service_config.service_auth.login_info.device_endpoint:
        if user_header:
            user = user_header
        else:
            user = postgres.config.dev_user

    # Parse the username from the header
    else:
        if user_header is None:
            raise fastapi.HTTPException(status_code=400,
                detail=f'Could not find header for user, {login.OSMO_USER_HEADER}')
        user = user_header
    return user


async def check_user_access(path: str, request_method: str, request_headers: Headers,
                            method: str | None = None, domain_access_check: Callable | None = None):
    if method == 'dev':
        return None

    postgres = PostgresConnector.get_instance()
    service_config = postgres.get_service_configs()

    # Check if auth is enabled
    # If not, allow all requests
    if not service_config.service_auth.login_info.device_endpoint:
        return None

    allowed = False

    if domain_access_check:
        allowed = bool(domain_access_check(request_headers))
        if allowed:
            return None

    # Determine if the user has access to the path
    roles_header = request_headers.get(login.OSMO_USER_ROLES) or ''
    user_roles = roles_header.split(',') + ['osmo-default']

    # Check if the user has access to the path
    roles_list = Role.list_from_db(postgres, user_roles)
    for role_entry in roles_list:
        allowed = role_entry.has_access(path, request_method)
        if allowed:
            break

    if not allowed:
        return fastapi.responses.JSONResponse(
            status_code=403,
            content={'message': 'Forbidden', 'error_code': 403},
        )

    return None


class BackendTestBase(pydantic.BaseModel):
    """ Represents a test config. """
    name: str = pydantic.Field(..., min_length=1)
    description: str
    cron_schedule: str = pydantic.Field(..., min_length=1)
    test_timeout: str = pydantic.Field(default='300s')
    node_conditions: List[str] = pydantic.Field(min_items=1)

    @pydantic.validator('name')
    @classmethod
    def validate_name_rfc1123(cls, v: str) -> str:
        """
        Validate that the name complies with RFC 1123 subdomain naming rules.
        This ensures compatibility with Kubernetes CronJob names.

        RFC 1123 subdomain rules:
        - Must consist of lowercase alphanumeric characters, '-' or '.'
        - Must start and end with an alphanumeric character
        """
        rfc1123_pattern = r'^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$'

        if not re.match(rfc1123_pattern, v):
            raise osmo_errors.OSMOUserError(
                f'Name "{v}" is invalid. A lowercase RFC 1123 subdomain must consist of '
                'lower case alphanumeric characters, \'-\' or \'.\', and must start and end '
                'with an alphanumeric character (e.g. \'example.com\', '
                'regex used for validation is '
                '\'[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*\')'
            )

        return v

    @pydantic.validator('cron_schedule')
    @classmethod
    def validate_cron_schedule(cls, v: str) -> str:
        """
        Validate that the cron schedule is in a valid format.
        Supports standard 5-field cron format: minute hour day month weekday
        """
        if not v or not v.strip():
            raise osmo_errors.OSMOUserError('Cron schedule cannot be empty')

        # Basic cron format validation (5 fields)
        cron_parts = v.strip().split()
        if len(cron_parts) != 5:
            raise osmo_errors.OSMOUserError(
                f"Invalid cron schedule format '{v}'. Expected 5 fields: "
                "minute hour day month weekday (e.g., '0 2 * * *')"
            )

        # Validate each field contains valid characters
        valid_cron_chars = r'^[0-9\*\-\,\/\?LW#]+$'
        field_names = ['minute', 'hour', 'day', 'month', 'weekday']

        for _, (part, field_name) in enumerate(zip(cron_parts, field_names)):
            if not re.match(valid_cron_chars, part):
                raise osmo_errors.OSMOUserError(
                    f'Invalid characters in cron {field_name} field "{part}". '
                    f'Allowed characters: 0-9, *, -, ,, /, ?, L, W, #'
                )

            # Basic range validation
            if part.isdigit():
                num = int(part)
                if field_name == 'minute' and not 0 <= num <= 59:
                    raise osmo_errors.OSMOUserError(
                        f'Minute field "{part}" must be between 0-59'
                    )
                elif field_name == 'hour' and not 0 <= num <= 23:
                    raise osmo_errors.OSMOUserError(
                        f'Hour field "{part}" must be between 0-23'
                    )
                elif field_name == 'day' and not 1 <= num <= 31:
                    raise osmo_errors.OSMOUserError(
                        f'Day field "{part}" must be between 1-31'
                    )
                elif field_name == 'month' and not 1 <= num <= 12:
                    raise osmo_errors.OSMOUserError(
                        f'Month field "{part}" must be between 1-12'
                    )
                elif field_name == 'weekday' and not 0 <= num <= 7:
                    raise osmo_errors.OSMOUserError(
                        f'Weekday field "{part}" must be between 0-7 (0 and 7 are Sunday)'
                    )

        return v

    @pydantic.validator('test_timeout')
    @classmethod
    def validate_test_timeout(cls, v: str) -> str:
        """
        Validate that the test timeout is in a valid duration format.
        Supports formats like: 300s, 5m, 1h, 1h30m, etc.
        """
        if not v or not v.strip():
            raise osmo_errors.OSMOUserError('Test timeout cannot be empty')

        # Pattern for duration format: number followed by unit (s, m, h, d)
        duration_pattern = r'^(\d+[smhd])+$'

        if not re.match(duration_pattern, v.strip()):
            raise osmo_errors.OSMOUserError(
                f'Invalid timeout format "{v}". Expected format like "300s", "5m", "1h", "1h30m". '
                f'Supported units: s (seconds), m (minutes), h (hours), d (days)'
            )

        # Parse and validate the total duration
        total_seconds = cls._parse_duration_to_seconds(v.strip())

        # Validate reasonable timeout limits
        if total_seconds < 30:  # Minimum 30 seconds
            raise osmo_errors.OSMOUserError(
                f'Test timeout "{v}" is too short. Minimum timeout is 30 seconds.'
            )

        if total_seconds > 86400:  # Maximum 24 hours
            raise osmo_errors.OSMOUserError(
                f'Test timeout "{v}" is too long. Maximum timeout is 24 hours (86400s).'
            )

        return v

    @pydantic.validator('node_conditions')
    @classmethod
    def validate_node_conditions(cls, v: List[str]) -> List[str]:
        """
        Validate that node conditions are properly formatted and not empty.
        Node conditions in Kubernetes are used to indicate the state of a node.
        """
        if not v:
            raise osmo_errors.OSMOUserError('Node conditions list cannot be empty')

        # Validate each condition
        for i, condition in enumerate(v):

            # Validate node condition format
            # Node conditions are typically in format like:
            # - "Ready", "MemoryPressure", "DiskPressure", "PIDPressure", "NetworkUnavailable"
            # - Custom conditions often follow domain/name pattern
            # like "example.com/custom-condition"
            condition = condition.strip()

            # Allow standard Kubernetes node conditions and custom conditions
            # Standard conditions: alphanumeric, can contain hyphens
            # Custom conditions: can contain dots for domain names, slashes for namespacing
            if not re.match(r'^[a-zA-Z0-9]([a-zA-Z0-9\-_.\/]*[a-zA-Z0-9])?$', condition):
                raise osmo_errors.OSMOUserError(
                    f'Invalid node condition "{condition}" at index {i}. '
                    f'Node conditions must start and end with alphanumeric characters, '
                    f'and can contain hyphens, underscores, dots, and forward slashes. '
                    f'Examples: "Ready", "MemoryPressure", "example.com/gpu-available"'
                )

            # Check length limit (Kubernetes condition type limit is typically 316 characters)
            if len(condition) > 316:
                raise osmo_errors.OSMOUserError(
                    f'Node condition "{condition}" at index {i} exceeds 316 character limit'
                )

            # Validate domain part if it contains a slash (custom condition)
            if '/' in condition:
                parts = condition.split('/')
                if len(parts) != 2:
                    raise osmo_errors.OSMOUserError(
                        f'Invalid node condition "{condition}" at index {i}. '
                        f'Custom conditions should have exactly one "/" separating domain and name'
                    )

                domain, name = parts

                # Validate domain part (should be a valid DNS subdomain)
                if not re.match(
                    r'^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$', domain
                    ):
                    raise osmo_errors.OSMOUserError(
                        f'Invalid domain "{domain}" in node condition "{condition}" at index {i}. '
                        'Domain must be a valid DNS subdomain '
                        '(lowercase, alphanumeric, hyphens, dots)'
                    )

                # Validate name part
                if not re.match(r'^[a-zA-Z0-9]([a-zA-Z0-9\-_]*[a-zA-Z0-9])?$', name):
                    raise osmo_errors.OSMOUserError(
                        f'Invalid name {name} in node condition {condition} at index {i}. '
                        'Name must start and end with alphanumeric characters, '
                        'and can contain hyphens and underscores'
                    )

        # Remove duplicates while preserving order
        seen = set()
        unique_conditions = []
        for condition in v:
            condition = condition.strip()
            if condition not in seen:
                seen.add(condition)
                unique_conditions.append(condition)

        if len(unique_conditions) != len(v):
            logging.warning('Removed duplicate node conditions from test configuration')

        return unique_conditions

    @staticmethod
    def _parse_duration_to_seconds(duration: str) -> int:
        """
        Parse a duration string like '1h30m' to total seconds.

        Args:
            duration: Duration string (e.g., '300s', '5m', '1h30m')

        Returns:
            Total duration in seconds
        """
        total_seconds = 0
        current_number = ''

        for char in duration:
            if char.isdigit():
                current_number += char
            elif char in 'smhd':
                if not current_number:
                    raise osmo_errors.OSMOUserError('Invalid duration format: {duration}')

                number = int(current_number)
                if char == 's':
                    total_seconds += number
                elif char == 'm':
                    total_seconds += number * 60
                elif char == 'h':
                    total_seconds += number * 3600
                elif char == 'd':
                    total_seconds += number * 86400

                current_number = ''
            else:
                raise osmo_errors.OSMOUserError(f'Invalid character char in duration: {duration}')

        if current_number:
            raise osmo_errors.OSMOUserError(f'Duration missing unit: {duration}')

        return total_seconds


class BackendTests(BackendTestBase):
    """ Represents a test config. """
    common_pod_template: List[str] = pydantic.Field(min_items=1)
    parsed_pod_template: Dict = {}

    @classmethod
    def get_backends(cls, database: PostgresConnector, name: str) -> List[Dict]:
        """Get backends that use this test in their backend configuration."""
        fetch_cmd = '''
            SELECT name
            FROM backends
            WHERE %s=ANY(tests)
        '''
        return database.execute_fetch_command(fetch_cmd, (name,), True)

    def calculate_pod_template(self, database: PostgresConnector):
        ''' Construct Pool pod_template '''
        combined_pod_templates = copy.deepcopy(self.common_pod_template)

        pod_template_specs = PodTemplate.list_from_db(database, combined_pod_templates)
        self.parsed_pod_template = {}
        for pod_template in self.common_pod_template:
            if pod_template not in pod_template_specs:
                raise osmo_errors.OSMOUsageError(f'Pod template {pod_template} does not exist!')
            self.parsed_pod_template = common.recursive_dict_update(
                self.parsed_pod_template,
                pod_template_specs[pod_template],
                common.merge_lists_on_name)

    @classmethod
    def update_pod_template(cls, database: PostgresConnector, name: str):
        """ Updates pod_templates """
        test_info = cls.fetch_from_db(database, name)
        test_info.calculate_pod_template(database)

        insert_cmd = '''
            UPDATE backend_tests
            SET parsed_pod_template = %s
            WHERE name = %s;
            '''
        database.execute_commit_command(
            insert_cmd,
            (json.dumps(test_info.parsed_pod_template),
             name))

    @classmethod
    def list_from_db(cls, database: 'PostgresConnector', name: str | None = None
                     ) -> Dict[str, dict]:
        list_of_names = ''
        fetch_input: Tuple = ()
        if name:
            list_of_names = 'WHERE name = %s'
            fetch_input = (name,)
        fetch_cmd = f'SELECT * FROM backend_tests {list_of_names} ORDER BY name;'
        spec_rows = database.execute_fetch_command(fetch_cmd, fetch_input, True)
        return {spec_row['name']: spec_row for spec_row in spec_rows}

    @classmethod
    def fetch_from_db(cls, database: 'PostgresConnector', name: str) -> 'BackendTests':
        fetch_cmd = 'SELECT * FROM backend_tests WHERE name = %s;'
        spec_rows = database.execute_fetch_command(fetch_cmd, (name,), True)
        if not spec_rows:
            raise osmo_errors.OSMOUserError(f'Test config {name} does not exist.')
        return cls(**spec_rows[0])

    @classmethod
    def delete_from_db(cls, database: 'PostgresConnector', name: str):
        backends = cls.get_backends(database, name)
        if backends:
            raise osmo_errors.OSMOUserError(
                f'Test {name} is used in Backends ' +\
                f'{", ".join([backend["name"] for backend in backends])}'
            )
        delete_cmd = 'DELETE FROM backend_tests WHERE name = %s;'
        database.execute_commit_command(delete_cmd, (name,))

    def insert_into_db(self, database: 'PostgresConnector', name: str):
        self.calculate_pod_template(database)
        insert_cmd = '''
            INSERT INTO backend_tests
            (name, description, cron_schedule, test_timeout,
            common_pod_template, parsed_pod_template, node_conditions)
            VALUES (%s, %s, %s, %s,
            %s, %s, %s)
            ON CONFLICT (name)
            DO UPDATE SET
                description = EXCLUDED.description,
                cron_schedule = EXCLUDED.cron_schedule,
                test_timeout = EXCLUDED.test_timeout,
                common_pod_template = EXCLUDED.common_pod_template,
                parsed_pod_template = EXCLUDED.parsed_pod_template,
                node_conditions = EXCLUDED.node_conditions;
            '''
        database.execute_commit_command(
            insert_cmd,
            (name, self.description, self.cron_schedule, self.test_timeout,
             self.common_pod_template, json.dumps(self.parsed_pod_template), self.node_conditions))


class Role(role.Role):
    """ Single Role Entry """
    @classmethod
    def list_from_db(cls, database: PostgresConnector, names: Optional[List[str]] = None) \
        -> List['Role']:
        """ Fetches the list of pod templates from the pod template table """
        list_of_names = ''
        fetch_input: Tuple = ()
        if names:
            list_of_names = 'WHERE name in %s'
            fetch_input = (tuple(names),)
        fetch_cmd = f'SELECT * FROM roles {list_of_names} ORDER BY name;'
        spec_rows = database.execute_fetch_command(fetch_cmd, fetch_input, True)

        return [cls(**spec_row) for spec_row in spec_rows]

    @classmethod
    def fetch_from_db(cls, database: PostgresConnector, name: str) -> 'Role':
        """ Fetches the role from the role table """
        fetch_cmd = 'SELECT * FROM roles WHERE name = %s;'
        spec_rows = database.execute_fetch_command(fetch_cmd, (name,), True)
        if not spec_rows:
            raise osmo_errors.OSMOUserError(f'Role {name} does not exist.')
        return cls(**spec_rows[0])

    @classmethod
    def delete_from_db(cls, database: PostgresConnector, name: str):
        cls.fetch_from_db(database, name)

        delete_cmd = '''
            DELETE FROM roles WHERE name = %s;
            '''
        database.execute_commit_command(delete_cmd, (name,))

    def insert_into_db(self, database: PostgresConnector, force: bool = False):
        """ Create/update an entry in the pools table """
        check_immutable = 'WHERE roles.immutable = false' if not force else ''
        insert_cmd = f'''
            INSERT INTO roles
            (name, description, policies, immutable)
            VALUES (%s, %s, %s::jsonb[], %s)
            ON CONFLICT (name)
            DO UPDATE SET
                description = EXCLUDED.description,
                policies = EXCLUDED.policies
            {check_immutable}
            RETURNING policies, immutable;
            '''
        result = database.execute_fetch_command(
            insert_cmd,
            (self.name, self.description,
             [json.dumps(policy.to_dict()) for policy in self.policies],
             False),
            True
        )
        # No result means that immutable was true and nothing was updated
        if not force and (result and result[0].get('immutable') and \
            result[0].get('policies', []) != [policy.to_dict() for policy in self.policies]):
            raise osmo_errors.OSMOUserError(f'Role {self.name} is immutable.')

    def has_access(self, path: str, method: str) -> bool:
        """ Check if the role has access to the path and method """
        allowed = False
        for policy in self.policies:
            for action in policy.actions:
                if action.method.lower() in ['*', method.lower()]:
                    # If the path is not allowed, this policy does not allow access
                    if action.path.startswith('!'):
                        if fnmatch.fnmatch(path, action.path[1:]):
                            allowed = False
                            break
                    else:
                        if fnmatch.fnmatch(path, action.path):
                            allowed = True
            if allowed:
                return True

        return allowed


DEFAULT_ROLES: Dict[str, Role] = {
    'osmo-admin': Role(
        name='osmo-admin',
        description='Administrator role',
        policies=[
            role.RolePolicy(
                actions=[
                    role.RoleAction(base='http', path='*', method='*'),
                    role.RoleAction(base='http', path='!/api/agent/*', method='*'),
                    role.RoleAction(base='http', path='!/api/logger/*', method='*'),
                    role.RoleAction(base='http', path='!/api/router/*/*/backend/*', method='*'),
                ]
            )
        ],
        immutable=True
    ),
    'osmo-user': Role(
        name='osmo-user',
        description='User role',
        policies=[
            role.RolePolicy(
                actions=[
                    role.RoleAction(base='http', path='/api/auth/access_token', method='*'),
                    role.RoleAction(base='http', path='/api/auth/access_token/user', method='*'),
                    role.RoleAction(base='http', path='/api/auth/access_token/user/*', method='*'),
                    role.RoleAction(base='http', path='/api/app', method='*'),
                    role.RoleAction(base='http', path='/api/app/*', method='*'),
                    role.RoleAction(base='http', path='/api/workflow', method='*'),
                    role.RoleAction(base='http', path='/api/workflow/*', method='*'),
                    role.RoleAction(base='http', path='/api/task', method='*'),
                    role.RoleAction(base='http', path='/api/task/*', method='*'),
                    role.RoleAction(base='http', path='/api/bucket', method='*'),
                    role.RoleAction(base='http', path='/api/bucket/*', method='*'),
                    role.RoleAction(base='http', path='/api/credentials', method='*'),
                    role.RoleAction(base='http', path='/api/credentials/*', method='*'),
                    role.RoleAction(base='http', path='/api/resources', method='*'),
                    role.RoleAction(base='http', path='/api/resources/*', method='*'),
                    role.RoleAction(base='http', path='/api/pool/default/*', method='*'),
                    role.RoleAction(base='http', path='/api/pool', method='*'),
                    role.RoleAction(base='http', path='/api/pool_quota', method='*'),
                    role.RoleAction(base='http', path='/api/profile/*', method='*'),
                    role.RoleAction(base='http', path='/api/users', method='*'),
                    role.RoleAction(base='http', path='/api/tag', method='*'),
                    role.RoleAction(base='http', path='/api/plugins/configs', method='*'),
                    # Tailing slash is to exclude path /api/router/webserver/*/backend/*
                    role.RoleAction(base='http', path='/api/router/webserver/*/', method='*'),
                    role.RoleAction(base='http', path='/api/router/*/*/client/*', method='*'),
                ]
            )
        ]
    ),
    'osmo-backend': Role(
        name='osmo-backend',
        description='For backend agents',
        policies=[
            role.RolePolicy(
                actions=[
                    role.RoleAction(base='http', path='/api/agent/listener/*', method='*'),
                    role.RoleAction(base='http', path='/api/agent/worker/*', method='*'),
                    role.RoleAction(base='http', path='/api/pool/*', method='Get'),
                    role.RoleAction(base='http', path='/api/configs/backend', method='Get'),
                    role.RoleAction(base='http', path='/api/configs/backend/*', method='Get'),
                ]
            )
        ]
    ),
    'osmo-ctrl': Role(
        name='osmo-ctrl',
        description='For workflow pods',
        policies=[
            role.RolePolicy(
                actions=[
                    role.RoleAction(base='http', path='/api/logger/workflow/*', method='*'),
                    role.RoleAction(base='http', path='/api/router/*/*/backend/*', method='*'),
                ]
            )
        ]
    ),
    'osmo-default': Role(
        name='osmo-default',
        description='Default role',
        policies=[
            role.RolePolicy(
                actions=[
                    role.RoleAction(base='http', path='/api/version', method='*'),
                    role.RoleAction(base='http', path='/api/router/version', method='*'),
                    role.RoleAction(base='http', path='/api/auth/login', method='Get'),
                    role.RoleAction(base='http', path='/api/auth/keys', method='Get'),
                    role.RoleAction(base='http', path='/api/auth/refresh_token', method='*'),
                    role.RoleAction(base='http', path='/api/auth/jwt/refresh_token', method='*'),
                    role.RoleAction(base='http', path='/api/auth/jwt/access_token', method='*'),
                    role.RoleAction(base='http', path='/api/auth/access_token', method='*'),
                    role.RoleAction(base='http', path='/client/version', method='*'),
                    role.RoleAction(base='http', path='/health', method='*'),
                ]
            )
        ]
    ),
}


class AccessControlMiddleware:
    """Middleware for handling WebSocket connections in the router service."""
    # pylint: disable=redefined-outer-name
    def __init__(self, app: ASGIApp, method: str | None = None,
                 domain_access_check: Callable | None = None):
        self.app = app
        self.method = method
        self.domain_access_check = domain_access_check

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        request_method = scope.get('method', '')
        if scope['type'] == 'websocket':
            websocket = fastapi.WebSocket(scope, receive=receive, send=send)
            request_headers = websocket.headers
            request_method = 'WEBSOCKET'
        elif scope['type'] == 'http':
            request = fastapi.Request(scope, receive=receive, send=send)
            request_headers = request.headers
        else:
            response = fastapi.responses.PlainTextResponse(
                content=f'Invalid scope type: {scope["type"]}',
                status_code=400
            )
            return await response(scope, receive, send)

        response = await check_user_access(
            scope['path'], request_method, request_headers, self.method, self.domain_access_check)

        # Add user profile if it doesn't exist
        username = request_headers.get(login.OSMO_USER_HEADER)
        if username:
            UserProfile.fetch_from_db(PostgresConnector.get_instance(), username)
        if response is not None:
            return await response(scope, receive, send)
        return await self.app(scope, receive, send)
