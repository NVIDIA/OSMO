"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
import atexit
import contextlib
import copy
import datetime
import enum
import json
import logging
import math
import types
import os
import re
import threading
import time
import typing
from functools import wraps
from typing import Any, Callable, Dict, Generator, List, Literal, Mapping, Optional, Tuple
from urllib.parse import urlparse

import fastapi
import psycopg2  # type: ignore
import psycopg2.extras  # type: ignore
import psycopg2.pool  # type: ignore
import pydantic
from jwcrypto import jwe  # type: ignore
from jwcrypto.common import JWException  # type: ignore

from src.utils import configmap_state
from src.lib.utils import (common, credentials, jinja_sandbox, login,
                           osmo_errors, role, validation, version)
from src.utils import auth, notify
from src.utils.secret_manager import Encrypted, Keyring, SecretManager


def backend_action_queue_name(backend_name: str) -> str:
    return f'backend-connections:{backend_name}'



class CredentialType(enum.Enum):
    """ User profile type / table name if exist """
    GENERIC = 'GENERIC'
    REGISTRY = 'REGISTRY'
    DATA = 'DATA'


class ConfigType(enum.Enum):
    """ Type of Config to fetch or set """
    SERVICE = 'SERVICE'
    WORKFLOW = 'WORKFLOW'


def reject_db_config_mutation() -> typing.NoReturn:
    """Service configuration is immutable and ConfigMap-owned in 6.4."""
    raise osmo_errors.OSMOUserError(
        'Service configuration is ConfigMap-only; update Helm values and redeploy.',
        status_code=409)


# Increment whenever a new database location can persist ciphertext encrypted directly by a MEK.
# UEK-encrypted credential and workflow payloads are covered transitively by the UEK wrapper row.
MEK_PERSISTENCE_REGISTRY_VERSION = 1
MEK_PERSISTENCE_REGISTRY = {
    'ueks.keys.*': 'uek-wrapper-jwe',
}
MEK_RECONCILE_BATCH_SIZE = 100
MEK_MAX_UEK_ROWS = 1000
MEK_REWRAP_DEADLINE_SECONDS = 300


class ConfigHistoryType(enum.Enum):
    """ Type of configs supported by config history """
    DATASET = 'DATASET'
    SERVICE = 'SERVICE'
    WORKFLOW = 'WORKFLOW'
    BACKEND = 'BACKEND'
    POOL = 'POOL'
    POD_TEMPLATE = 'POD_TEMPLATE'
    GROUP_TEMPLATE = 'GROUP_TEMPLATE'
    RESOURCE_VALIDATION = 'RESOURCE_VALIDATION'
    BACKEND_TEST = 'BACKEND_TEST'
    ROLE = 'ROLE'


HISTORY_ONLY_CONFIG_HISTORY_TYPES = frozenset({
    ConfigHistoryType.DATASET,
})

# Mypy requires literal enum members, but deriving this enum keeps ConfigHistoryType
# as the single source of truth for config history type values.
OperableConfigHistoryType = enum.Enum(  # type: ignore[misc]
    'OperableConfigHistoryType',
    {
        config_type.name: config_type.value for config_type in ConfigHistoryType
        if config_type not in HISTORY_ONLY_CONFIG_HISTORY_TYPES
    },
    module=__name__,
)
OperableConfigHistoryType.__doc__ = 'Type of configs supported by config history mutations.'


class DownloadType(str, enum.Enum):
    """ Type of Config to fetch or set """
    DOWNLOAD = 'download'

    @staticmethod
    def from_str(label) -> 'DownloadType':
        if label == 'download':
            return DownloadType.DOWNLOAD
        else:
            raise NotImplementedError


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
        default='localhost',
        description='The hostname of the postgres server to connect to.',
        json_schema_extra={'command_line': 'postgres_host', 'env': 'OSMO_POSTGRES_HOST'})
    postgres_port: int = pydantic.Field(
        default=5432,
        description='The port of the postgres server to connect to.',
        json_schema_extra={'command_line': 'postgres_port', 'env': 'OSMO_POSTGRES_PORT'})
    postgres_user: str = pydantic.Field(
        default='postgres',
        description='The user of the postgres server.',
        json_schema_extra={'command_line': 'postgres_user', 'env': 'OSMO_POSTGRES_USER'})
    postgres_password: str = pydantic.Field(
        description='The password to connect to the postgres server.',
        json_schema_extra={'command_line': 'postgres_password', 'env': 'OSMO_POSTGRES_PASSWORD'})
    postgres_database_name: str = pydantic.Field(
        default='osmo_db',
        description='The database name for postgres server.',
        json_schema_extra={
            'command_line': 'postgres_database_name',
            'env': 'OSMO_POSTGRES_DATABASE_NAME'
        })
    postgres_reconnect_retry: int = pydantic.Field(
        default=5,
        gt=0,
        description='Reconnect try count after connection error',
        json_schema_extra={
            'command_line': 'postgres_reconnect_retry',
            'env': 'OSMO_POSTGRES_RECONNECT_RETRY'
        })
    mek_file: str = pydantic.Field(
        default='/opt/osmo/mek/mek.yaml',
        description='Path to the file that stores master encryption keys',
        json_schema_extra={'command_line': 'mek_file', 'env': 'OSMO_MEK_FILE'})
    service_auth_file: str | None = pydantic.Field(
        default=None,
        description='Path to the required canonical service auth JSON.',
        json_schema_extra={
            'command_line': 'service_auth_file',
            'env': 'OSMO_SERVICE_AUTH_FILE',
        })
    method: Literal['dev'] | None = pydantic.Field(
        default=None,
        description='If set to "dev", use the default local mek file'
                    'ingoring `mek_file` field.',
        json_schema_extra={'command_line': 'method'})
    dev_user: str = pydantic.Field(
        default='testuser',
        description='If method is set to "dev", the browser flow to the service will use this '
                    'user name.',
        json_schema_extra={'command_line': 'dev_user'})
    # Deployment configuration fields from Helm values for auto-initialization
    osmo_image_location: str | None = pydantic.Field(
        default=None,
        description='The image registry location for OSMO images',
        json_schema_extra={'command_line': 'osmo_image_location'})
    osmo_image_tag: str | None = pydantic.Field(
        default=None,
        description='The image tag for OSMO images',
        json_schema_extra={'command_line': 'osmo_image_tag'})
    service_hostname: str | None = pydantic.Field(
        default=None,
        description='The public hostname for the OSMO service (used for URL generation)',
        json_schema_extra={'command_line': 'service_hostname'})
    postgres_pool_minconn: int = pydantic.Field(
        default=1,
        gt=0,
        description='Minimum number of connections to keep in the connection pool',
        json_schema_extra={
            'command_line': 'postgres_pool_minconn',
            'env': 'OSMO_POSTGRES_POOL_MINCONN'
        })
    postgres_pool_maxconn: int = pydantic.Field(
        default=10,
        gt=0,
        description='Maximum number of connections allowed in the connection pool',
        json_schema_extra={
            'command_line': 'postgres_pool_maxconn',
            'env': 'OSMO_POSTGRES_POOL_MAXCONN'
        })
    schema_version: str = pydantic.Field(
        default='public',
        description='pgroll schema version to use. '
                    'Set to "public" to use the default schema without pgroll versioning.',
        json_schema_extra={'command_line': 'schema_version', 'env': 'OSMO_SCHEMA_VERSION'})


def retry(func=None, *, reconnect: bool = True):
    """
    Retry database operations in case of connection/pool errors.

    Handles psycopg2 InterfaceError, DatabaseError, and pool.PoolError.
    When reconnect is True and an error occurs, the connection pool is
    recreated before retrying.
    """
    def decorator(fn):
        @wraps(fn)
        def retry_wrapper(*args, **kwargs):
            self = args[0]
            last_error: Exception | None = None
            for _ in range(self.config.postgres_reconnect_retry):
                try:
                    return fn(*args, **kwargs)
                except (psycopg2.InterfaceError, psycopg2.DatabaseError,
                        psycopg2.pool.PoolError) as error:
                    logging.error('Database/pool error, retrying: %s', str(error))
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
    """ Manages the connection to the postgres database using a ThreadedConnectionPool. """
    _instance: 'PostgresConnector | None' = None
    _pool: psycopg2.pool.ThreadedConnectionPool | None
    _pool_lock: threading.Lock
    _pool_semaphore: threading.Semaphore

    @staticmethod
    def get_instance():
        """ Static access method. """
        if not PostgresConnector._instance:
            raise osmo_errors.OSMOError(
                'Postgres Connector has not been created!')
        return PostgresConnector._instance

    def _create_pool(self, search_path: str | None = None):
        """Create the ThreadedConnectionPool and semaphore."""
        try:
            if self.config.postgres_pool_minconn > self.config.postgres_pool_maxconn:
                raise osmo_errors.OSMOUsageError(
                    'postgres_pool_minconn cannot be greater than postgres_pool_maxconn')

            self._pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=self.config.postgres_pool_minconn,
                # +1 to ensure we never exhaust the pool
                # This leaves 1 connection for retry/recovery scenarios
                maxconn=self.config.postgres_pool_maxconn + 1,
                host=self.config.postgres_host,
                port=self.config.postgres_port,
                database=self.config.postgres_database_name,
                user=self.config.postgres_user,
                password=self.config.postgres_password,
                gssencmode='disable',
                options=f'-csearch_path={search_path}' if search_path else None
            )
            self._pool_semaphore = threading.Semaphore(self.config.postgres_pool_maxconn)

        except (psycopg2.DatabaseError, psycopg2.OperationalError) as error:
            logging.error('Database Error while creating connection pool: %s', str(error))
            raise osmo_errors.OSMOConnectionError(str(error))

    def connect(self):
        """Create or recreate the connection pool."""
        with self._pool_lock:
            if self._pool is not None:
                try:
                    self._pool.closeall()
                except Exception:  # pylint: disable=broad-except
                    pass
            schema = self.config.schema_version
            self._create_pool(search_path=schema if schema != 'public' else None)

    def _is_connection_healthy(self, conn) -> bool:
        """Check if a connection is still healthy."""
        if conn is None or conn.closed:
            return False
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT 1')
            # Rollback to ensure clean state after the check
            conn.rollback()
            return True
        except (psycopg2.DatabaseError, psycopg2.InterfaceError):
            return False

    @contextlib.contextmanager
    def _get_connection(self, autocommit: bool = False) -> Generator:
        """
        Context manager for acquiring a connection from the pool.

        Uses a semaphore to limit concurrent connections and prevent pool exhaustion.
        Threads will block on the semaphore if all connections are in use.

        Args:
            autocommit: If True, set the connection to autocommit mode.

        Yields:
            A database connection from the pool.
        """
        pool = self._pool
        semaphore = self._pool_semaphore
        if pool is None:
            raise osmo_errors.OSMOConnectionError('Connection pool is not initialized.')

        # Acquire semaphore - blocks if all connections are in use
        semaphore.acquire()
        conn = None
        try:
            conn = pool.getconn()
            # Validate the connection
            if not self._is_connection_healthy(conn):
                # Return bad connection and get a fresh one
                try:
                    pool.putconn(conn, close=True)
                except Exception:  # pylint: disable=broad-except
                    pass
                conn = pool.getconn()

            if autocommit:
                # Rollback any pending transaction before setting autocommit
                # set_session cannot be called inside a transaction
                conn.rollback()
                conn.set_session(autocommit=True)

            yield conn
        finally:
            if conn is not None:
                try:
                    # Rollback any uncommitted transaction to ensure clean state
                    conn.rollback()
                    # Reset autocommit mode before returning to pool
                    if autocommit:
                        conn.set_session(autocommit=False)
                    pool.putconn(conn)
                except Exception:  # pylint: disable=broad-except
                    # If we can't return it properly, close it
                    try:
                        pool.putconn(conn, close=True)
                    except Exception:  # pylint: disable=broad-except
                        pass
            # Always release the semaphore
            semaphore.release()

    @contextlib.contextmanager
    def _get_reserved_reconciler_connection(self) -> Generator:
        """Use the pool's reserved +1 connection without consuming the application semaphore."""
        pool = self._pool
        if pool is None:
            raise osmo_errors.OSMOConnectionError('Connection pool is not initialized.')
        connection = pool.getconn()
        try:
            connection.rollback()
            connection.set_session(autocommit=True)
            yield connection
        finally:
            try:
                connection.rollback()
                connection.set_session(autocommit=False)
                pool.putconn(connection)
            except Exception:  # pylint: disable=broad-except
                pool.putconn(connection, close=True)

    def __init__(self, config: PostgresConfig):
        if PostgresConnector._instance:
            raise osmo_errors.OSMOError(
                'Only one instance of Postgres Connector can exist!')

        logging.debug('Connecting to postgres server at %s:%s...', config.postgres_host,
                      config.postgres_port)
        self.config = config
        self._pool_lock = threading.Lock()
        self._create_pool()
        logging.debug('Finished connecting to postgres database')

        logging.debug('Initializing secret manager')
        PostgresConnector._instance = self
        mek_file = self.config.mek_file
        if self.config.method == 'dev':
            mek_file = os.path.join(os.path.dirname(__file__), '..', 'secret_manager', 'mek.yaml')
        self.secret_manager = SecretManager(
            mek_file,
            self.read_uek, self.write_uek, self.read_current_kid, self.add_user)
        logging.info(
            'OSMO_MEK_DESCRIPTOR %s',
            json.dumps({
                'currentKid': self.secret_manager.current_mek_id,
                'loadedKids': sorted(self.secret_manager.meks),
                'generation': self.secret_manager.generation,
                'digest': self.secret_manager.fingerprint_bundle_digest(),
            }, separators=(',', ':'), sort_keys=True))
        self._service_auth: auth.AuthenticationConfig | None = (
            auth.load_authentication_config_file(config.service_auth_file)
            if config.service_auth_file else None)
        self._runtime_service_auth_login_info: auth.LoginInfo | None = None
        logging.debug('Secret manager initialized')

        logging.debug('Initializing tables')
        self._init_tables()
        logging.debug('Tables initialized')

        # Startup authenticates operational UEK persistence only. Legacy
        # ConfigMap-owned rows are deliberately outside the 6.4 runtime.
        self._assert_mek_inventory('startup')

        # Recreate pool with search_path set to the pgroll versioned schema
        if self.config.schema_version != 'public':
            logging.debug('Switching to pgroll schema: %s', self.config.schema_version)
            self.connect()

        # Register cleanup on exit
        atexit.register(self.close)

    def close(self):
        """Close all connections in the pool."""
        with self._pool_lock:
            if self._pool is not None:
                try:
                    self._pool.closeall()
                    logging.debug('Connection pool closed')
                except Exception:  # pylint: disable=broad-except
                    pass
                self._pool = None

    def __del__(self):
        try:
            self.close()
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
        with self._get_connection() as conn:
            cur = None
            try:
                cur = conn.cursor(
                    cursor_factory=psycopg2.extras.RealDictCursor)
                cur.execute(command, args)
                rows = cur.fetchall()
                if not return_raw:
                    # Cast memoryview objects to bytes and provide attribute access
                    rows = [
                        types.SimpleNamespace(**{k: common.handle_memoryview(v)
                                                for k, v in row.items()})
                        for row in rows]
                cur.close()
                conn.commit()
                return rows
            except (psycopg2.DatabaseError, psycopg2.InterfaceError) as error:
                try:
                    if cur is not None:
                        cur.close()
                    conn.rollback()
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
        with self._get_connection() as conn:
            cur = None
            try:
                cur = conn.cursor()
                cur.execute(command, args)
                affected_rows = cur.rowcount
                cur.close()
                conn.commit()
                return affected_rows
            except (psycopg2.DatabaseError, psycopg2.InterfaceError) as error:
                try:
                    if cur is not None:
                        cur.close()
                    conn.rollback()
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
    def execute_commit_commands(self, commands: List[Tuple[str, Tuple]]):
        """
        Executes multiple commands in a single transaction.

        All commands are executed on the same connection and committed
        together.  If any command fails the entire transaction is rolled back.

        Args:
            commands: List of (command, args) tuples to execute.

        Raises:
            OSMODatabaseError: Error while executing a database command.
        """
        if not commands:
            return

        with self._get_connection() as conn:
            cur = None
            try:
                cur = conn.cursor()
                for command, args in commands:
                    cur.execute(command, args)
                cur.close()
                conn.commit()
            except (psycopg2.DatabaseError, psycopg2.InterfaceError) as error:
                try:
                    if cur is not None:
                        cur.close()
                    conn.rollback()
                except Exception:  # pylint: disable=broad-except
                    pass
                raise error
            except Exception as error:  # pylint: disable=broad-except
                raise osmo_errors.OSMODatabaseError(
                    f'Error during executing commands: {error}')
            finally:
                if cur is not None:
                    cur.close()

    @retry
    def assign_user_role(self, user_id: str, role_name: str, assigned_by: str,
                         assigned_at: datetime.datetime) -> List[Dict[str, Any]]:
        roles = configmap_state.require_snapshot().get('roles', {})
        if role_name not in roles:
            return []
        with self._get_connection() as conn:
            cur = None
            try:
                cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
                cur.execute('''
                    INSERT INTO user_roles (user_id, role_name, assigned_by, assigned_at)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (user_id, role_name)
                    DO UPDATE SET user_id = EXCLUDED.user_id
                    RETURNING id, assigned_by, assigned_at;
                ''', (user_id, role_name, assigned_by, assigned_at))
                rows = cur.fetchall()
                cur.close()
                conn.commit()
                return rows
            except (psycopg2.DatabaseError, psycopg2.InterfaceError) as error:
                try:
                    if cur is not None:
                        cur.close()
                    conn.rollback()
                except Exception:  # pylint: disable=broad-except
                    pass
                raise error
            except Exception as error:  # pylint: disable=broad-except
                raise osmo_errors.OSMODatabaseError(
                    f'Error during assigning user role: {error}')
            finally:
                if cur is not None:
                    cur.close()

    @retry(reconnect=False)
    def execute_autocommit_command(self, command: str, args: Tuple):
        """
        Connects and executes a command on the database in autocommit mode.

        Args:
            command (str): The command to execute.
            args (Tuple): Any args for the command.

        Raises:
            OSMODatabaseError: Error while executing the database command.
        """
        with self._get_connection(autocommit=True) as conn:
            cursor = None
            try:
                cursor = conn.cursor()
                cursor.execute(command, args)
            except (psycopg2.DatabaseError, psycopg2.InterfaceError) as error:
                raise error
            except Exception as error:  # pylint: disable=broad-except
                raise osmo_errors.OSMODatabaseError(
                    f'Error during executing command {command}: {error}')
            finally:
                if cursor is not None:
                    cursor.close()

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
        with self._get_connection() as conn:
            cur = conn.cursor()
            entry_length = len(entries[0])
            for entry in entries:
                if len(entry) != entry_length:
                    raise osmo_errors.OSMOSchemaError(
                        'Mogrify: entries do not have the same number of elements!')
            input_str = f'({', '.join(['%s'] * entry_length)})'
            final_str = ', '.join(
                cur.mogrify(input_str, entry).decode('utf-8') for entry in entries)
            cur.close()
            return final_str

    def get_configs(self, config_type: ConfigType):
        """ Get all the config values. """
        snapshot = configmap_state.require_snapshot()
        return self._get_configs_from_snapshot(config_type, snapshot)

    def _get_configs_from_snapshot(self, config_type: ConfigType,
                                   snapshot: dict):
        """Construct a config object from the in-memory ConfigMap snapshot."""
        config_key_map = {
            ConfigType.SERVICE: ('service', ServiceConfig),
            ConfigType.WORKFLOW: ('workflow', WorkflowConfig),
        }
        key, config_class = config_key_map[config_type]
        config_data = snapshot.get(key, {})
        return config_class(**config_data)

    def get_service_configs(self) -> 'ServiceConfig':
        return self.get_configs(ConfigType.SERVICE)

    def set_runtime_service_auth_login_info(self, login_info: auth.LoginInfo) -> None:
        """Overlay deployment-derived login endpoints without persisting them."""
        self._runtime_service_auth_login_info = login_info.model_copy(deep=True)

    def get_service_auth(self) -> auth.AuthenticationConfig:
        """Return the required Kubernetes Secret-backed service identity."""
        if self._service_auth is None:
            raise osmo_errors.OSMOUserError(
                'The service-auth Secret mount is required in 6.4.')
        service_auth = self._service_auth.model_copy(deep=True)

        if self._runtime_service_auth_login_info is not None:
            service_auth = service_auth.model_copy(
                deep=True,
                update={'login_info': self._runtime_service_auth_login_info},
            )
        return service_auth

    def get_workflow_configs(self) -> 'WorkflowConfig':
        return self.get_configs(ConfigType.WORKFLOW)

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
                    'UPDATE credential SET payload[%s] = %s WHERE '
                    'user_name = %s AND cred_name = %s AND '
                    'AND payload[%s] = %s;'
                )
                cmd_args = (key, db_row.user_name, db_row.cred_name, key, value)
                decrypted = self.secret_manager.decrypt(
                    encrypted, db_row.user_name,
                    self.generate_update_secret_func(cmd, cmd_args))
                result[key] = decrypted.value
            except (JWException, osmo_errors.OSMONotFoundError):
                result[key] = value
                encrypted = self.secret_manager.encrypt(value, db_row.user_name)
                cmd = (
                    'UPDATE credential SET payload[%s] = %s WHERE '
                    'user_name = %s AND cred_name = %s;'
                )
                self.execute_commit_command(
                    cmd, (key, encrypted.value, db_row.user_name, db_row.cred_name))
        return result

    def encrypt_dict(self, input_dict: Dict, user: str) -> Dict:
        result = {}
        for key, value in input_dict.items():
            encrypted = self.secret_manager.encrypt(value, user)
            result[key] = encrypted.value
        return result

    def set_config(self, key: str, value: str | None, config_type: ConfigType):
        """Reject obsolete PostgreSQL configuration writes before SQL."""
        del key, value, config_type
        raise osmo_errors.OSMOUserError(
            'Service configuration is ConfigMap-owned; update it through GitOps.',
            status_code=409,
        )

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

    def _init_tables(self):
        """ Initializes tables if not exist. """
        # Install hstore extension
        create_cmd = 'CREATE EXTENSION IF NOT EXISTS hstore SCHEMA public;'
        self.execute_commit_command(create_cmd, ())

        # Creates table for roles
        create_cmd = """
            CREATE TABLE IF NOT EXISTS roles (
                name TEXT,
                description TEXT,
                policies JSONB[],
                immutable BOOLEAN,
                sync_mode TEXT NOT NULL DEFAULT 'import',
                PRIMARY KEY (name)
            );
        """
        self.execute_commit_command(create_cmd, ())

        # Creates table for role external mappings (many-to-many)
        create_cmd = """
            CREATE TABLE IF NOT EXISTS role_external_mappings (
                role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
                external_role TEXT NOT NULL,
                PRIMARY KEY (role_name, external_role)
            );
        """
        self.execute_commit_command(create_cmd, ())

        # Create index for external role lookups
        create_cmd = """
            CREATE INDEX IF NOT EXISTS idx_role_external_mappings_external_role
            ON role_external_mappings (external_role);
        """
        self.execute_commit_command(create_cmd, ())

        # Backend configuration is ConfigMap-owned. PostgreSQL stores only
        # agent runtime identity and liveness state.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS backends (
                name TEXT PRIMARY KEY,
                k8s_uid TEXT,
                last_heartbeat TIMESTAMP,
                created_date TIMESTAMP,
                version TEXT DEFAULT ''
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates current users.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                created_by TEXT
            );
        '''
        self.execute_commit_command(create_cmd, ())

        create_cmd = '''
            CREATE INDEX CONCURRENTLY IF NOT EXISTS users_base_username_id_idx
            ON users ((split_part(id, '@', 1)), id);
        '''
        self.execute_autocommit_command(create_cmd, ())

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
                labels JSONB,
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
            ''',
            '''
            CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_labels_gin_idx
                ON workflows
                USING gin (labels jsonb_ops);
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
                group_template_resource_types JSONB DEFAULT '[]'::jsonb,
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
            ''',
            '''
            CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_endtime_idx
                ON tasks
                USING btree (end_time);
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
                CONSTRAINT unique_cred UNIQUE (user_name, profile),
                CONSTRAINT credential_user_name_fkey
                    FOREIGN KEY (user_name) REFERENCES users(id) ON DELETE CASCADE
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for User profile
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS profile (
                user_name TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                slack_notification BOOLEAN,
                email_notification BOOLEAN,
                bucket TEXT,
                pool TEXT,
                PRIMARY KEY (user_name)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for user keys.
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS ueks (
                uid TEXT REFERENCES users(id) ON DELETE CASCADE,
                keys HSTORE,
                PRIMARY KEY (uid)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for user role assignments
        # Each assignment has a UUID that access_token_roles references for cascading deletes
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS user_roles (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role_name TEXT NOT NULL,
                assigned_by TEXT NOT NULL,
                assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                UNIQUE (user_id, role_name)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Create indices for user_roles table
        index_cmds = [
            '''
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_roles_user
                ON user_roles (user_id);
            ''',
            '''
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_roles_role
                ON user_roles (role_name);
            '''
        ]
        for cmd in index_cmds:
            self.execute_autocommit_command(cmd, ())

        # Creates table for access token keys (Personal Access Tokens).
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS access_token (
                user_name TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_name TEXT NOT NULL,
                access_token BYTEA,
                expires_at TIMESTAMP,
                description TEXT,
                last_seen_at TIMESTAMP WITH TIME ZONE,
                PRIMARY KEY (user_name, token_name),
                CONSTRAINT unique_access_token UNIQUE (access_token)
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Creates table for access_token role assignments (subset of user roles)
        # References user_roles.id so access_token roles are auto-deleted when user loses a role
        create_cmd = '''
            CREATE TABLE IF NOT EXISTS access_token_roles (
                user_name TEXT NOT NULL,
                token_name TEXT NOT NULL,
                user_role_id UUID NOT NULL REFERENCES user_roles(id) ON DELETE CASCADE,
                assigned_by TEXT NOT NULL,
                assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                PRIMARY KEY (user_name, token_name, user_role_id),
                FOREIGN KEY (user_name, token_name)
                    REFERENCES access_token(user_name, token_name) ON DELETE CASCADE
            );
        '''
        self.execute_commit_command(create_cmd, ())

        # Create indices for access_token_roles table
        index_cmds = [
            '''
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_access_token_roles_token
                ON access_token_roles (user_name, token_name);
            ''',
            '''
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_access_token_roles_user_role
                ON access_token_roles (user_role_id);
            '''
        ]
        for cmd in index_cmds:
            self.execute_autocommit_command(cmd, ())

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

    def _scan_mek_references(
            self, deadline: float | None = None) -> Tuple[Dict[str, int], List[str]]:
        """Authenticate every registered ciphertext location within bounded resources."""
        counts = {key_id: 0 for key_id in self.secret_manager.meks}
        blockers: List[str] = []
        cursor_uid, cursor_key = '', ''
        uek_row_count = 0
        while uek_row_count <= MEK_MAX_UEK_ROWS:
            if deadline is not None and time.monotonic() >= deadline:
                return counts, blockers + ['inventory: deadline exceeded']
            uek_rows = self.execute_fetch_command('''
                SELECT uid, entry.key AS key, entry.value AS value
                FROM ueks CROSS JOIN LATERAL each(keys) AS entry
                WHERE entry.key <> 'current' AND (uid, entry.key) > (%s, %s)
                ORDER BY uid, entry.key
                LIMIT %s;
            ''', (cursor_uid, cursor_key, MEK_RECONCILE_BATCH_SIZE), return_raw=True)
            uek_row_count += len(uek_rows)
            if uek_row_count > MEK_MAX_UEK_ROWS:
                return counts, blockers + ['ueks: row limit exceeded']
            for row in uek_rows:
                try:
                    key_id = self.secret_manager.authenticate_uek_wrapper(
                        row['value'], row['key'])
                    counts[key_id] += 1
                except (KeyError, osmo_errors.OSMOError):
                    user_id = row['uid']
                    user_key_id = row['key']
                    blockers.append(f'ueks/{user_id}/{user_key_id}: authentication failed')
            if len(uek_rows) < MEK_RECONCILE_BATCH_SIZE:
                break
            cursor_uid, cursor_key = uek_rows[-1]['uid'], uek_rows[-1]['key']

        return counts, blockers

    def _assert_mek_inventory(self, boundary: str) -> None:
        """Fail readiness when any registered persistence location is unreadable."""
        counts, blockers = self._scan_mek_references()
        if blockers:
            for blocker in blockers:
                logging.error('MEK %s inventory blocker: %s', boundary, blocker)
            raise osmo_errors.OSMOError(
                'Mounted MEK keyring cannot authenticate persisted ciphertext.')
        logging.info('MEK %s inventory references=%s', boundary, counts)

    def _rewrap_ueks(self, snapshot: Keyring, deadline: float | None = None) -> bool:
        """Rewrap all UEKs in bounded pages, restarting from zero on every invocation."""
        cursor_uid, cursor_key = '', ''
        row_count = 0
        while row_count <= MEK_MAX_UEK_ROWS:
            if deadline is not None and time.monotonic() >= deadline:
                raise osmo_errors.OSMOError('UEK rewrap deadline exceeded.')
            rows = self.execute_fetch_command('''
                SELECT uid, entry.key AS key
                FROM ueks CROSS JOIN LATERAL each(keys) AS entry
                WHERE entry.key <> 'current' AND (uid, entry.key) > (%s, %s)
                ORDER BY uid, entry.key
                LIMIT %s;
            ''', (cursor_uid, cursor_key, MEK_RECONCILE_BATCH_SIZE), return_raw=True)
            row_count += len(rows)
            if row_count > MEK_MAX_UEK_ROWS:
                raise osmo_errors.OSMOError('UEK rewrap row limit exceeded.')
            for row in rows:
                try:
                    self.secret_manager.rewrap_uek(row['uid'], row['key'], snapshot)
                except osmo_errors.OSMOError as error:
                    logging.error(
                        'UEK rewrap authentication failed for uid=%s slot=%s.',
                        row['uid'], row['key'])
                    raise osmo_errors.OSMOError(
                        'A persisted UEK wrapper failed authentication; inspect service logs.'
                    ) from error
            if len(rows) < MEK_RECONCILE_BATCH_SIZE:
                return True
            cursor_uid, cursor_key = rows[-1]['uid'], rows[-1]['key']
        raise osmo_errors.OSMOError('UEK rewrap row limit exceeded.')

    def rewrap_mek_references(
            self, deadline_seconds: int = MEK_REWRAP_DEADLINE_SECONDS,
            expected_generation: str = '', expected_current_kid: str = '',
            expected_registry_digest: str = '') -> Dict[str, int]:
        """Restart from zero, CAS-rewrap every registered MEK reference, and inventory it.

        This operation intentionally keeps every old MEK. The final inventory is
        point-in-time completion evidence, not permission to retire a key.
        """
        deadline = time.monotonic() + deadline_seconds
        snapshot = self.secret_manager.rewrap_snapshot()
        snapshot_digest = self.secret_manager.rewrap_snapshot_digest(snapshot)
        if (
            (expected_generation and snapshot.generation != expected_generation)
            or (expected_current_kid and snapshot.current_mek_id != expected_current_kid)
            or (expected_registry_digest and snapshot_digest != expected_registry_digest)
        ):
            raise osmo_errors.OSMOError(
                'Mounted MEK keyring does not match the requested rewrap snapshot.')

        with self._get_reserved_reconciler_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute('SELECT pg_try_advisory_lock(%s);', (0x4F534D4F4D454B,))
                if not cursor.fetchone()[0]:
                    raise osmo_errors.OSMOError('Another MEK rewrap is already running.')
            try:
                while time.monotonic() < deadline:
                    self._rewrap_ueks(snapshot, deadline)
                    counts, blockers = self._scan_mek_references(deadline)
                    if blockers:
                        for blocker in blockers:
                            logging.error('MEK inventory blocker: %s', blocker)
                        raise osmo_errors.OSMOError(
                            'MEK inventory contains authenticated coverage blockers.')
                    noncurrent = sum(
                        count for key_id, count in counts.items()
                        if key_id != snapshot.current_mek_id)
                    if noncurrent:
                        continue

                    # A second restart-from-zero inventory makes completion
                    # insensitive to page boundaries and confirms a stable
                    # point-in-time result. Old keys remain mandatory because
                    # there is deliberately no database write fence.
                    confirmed, blockers = self._scan_mek_references(deadline)
                    if blockers:
                        for blocker in blockers:
                            logging.error('MEK inventory blocker: %s', blocker)
                        raise osmo_errors.OSMOError(
                            'MEK inventory contains authenticated coverage blockers.')
                    if any(
                        count for key_id, count in confirmed.items()
                        if key_id != snapshot.current_mek_id
                    ):
                        continue
                    logging.info(
                        'MEK rewrap complete current_kid=%s references=%s '
                        'retirement_supported=false',
                        snapshot.current_mek_id, confirmed)
                    return confirmed
                raise osmo_errors.OSMOError('MEK rewrap deadline exceeded.')
            finally:
                with connection.cursor() as cursor:
                    cursor.execute('SELECT pg_advisory_unlock(%s);', (0x4F534D4F4D454B,))


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

    def write_uek(self, uid: str, kid: str, new_uek: str, old_uek: str) -> bool:
        new_key_value = self.encode_hstore({kid: new_uek})
        cmd = 'UPDATE ueks SET keys = keys || %s :: hstore WHERE uid = %s AND keys[%s] = %s;'
        return self.execute_commit_command(cmd, (new_key_value, uid, kid, old_uek)) == 1

    def add_user(self, uid: str, uek: Dict):
        cmd = 'INSERT INTO ueks (uid, keys) VALUES (%s, %s) ON CONFLICT DO NOTHING;'
        encoded = self.encode_hstore(uek)
        self.execute_commit_command(cmd, (uid, encoded))

    def generate_update_secret_func(self, cmd: str,
                                    cmd_args: Tuple = ()) -> Callable[[str], None]:
        def func(new_encrypted: str):
            self.execute_commit_command(cmd, (cmd_args[0], new_encrypted) + cmd_args[1:])
        return func

    def get_data_cred(self, user: str, profile: str) -> credentials.DataCredential | None:
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
        return None

    def get_all_data_creds(self, user: str) -> Dict[str, credentials.StaticDataCredential]:
        """ Fetch all data credentials for user. """
        select_data_cmd = PostgresSelectCommand(
            table='credential',
            conditions=['user_name = %s', 'cred_type = %s'],
            condition_args=[user, CredentialType.DATA.value])
        rows = self.execute_fetch_command(*select_data_cmd.get_args())

        user_creds: Dict[str, credentials.StaticDataCredential] = {
            cred.profile: credentials.StaticDataCredential(
                endpoint=cred.profile,
                **self.decrypt_credential(cred),
            )
            for cred in rows
        }

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
        registry = common.normalize_registry_scope(registry)
        select_data_cmd = PostgresSelectCommand(
            table='credential',
            conditions=['user_name = %s', 'cred_type = %s', 'profile = %s'],
            condition_args=[user, CredentialType.REGISTRY.value, registry])
        row = self.execute_fetch_command(*select_data_cmd.get_args())
        if row:
            return self.decrypt_credential(row[0])
        else:
            return None

    def get_all_registry_creds(self, user: str) -> Dict[str, Dict[str, str]]:
        """ Fetch all Docker registry credentials for a user by scope. """
        select_data_cmd = PostgresSelectCommand(
            table='credential',
            conditions=['user_name = %s', 'cred_type = %s'],
            condition_args=[user, CredentialType.REGISTRY.value])
        rows = self.execute_fetch_command(*select_data_cmd.get_args())
        registry_creds: Dict[str, Dict[str, str]] = {}
        for row in rows:
            if row.profile:
                registry_scope = common.normalize_registry_scope(row.profile)
                registry_creds[registry_scope] = self.decrypt_credential(row)
        return registry_creds

    def get_matching_registry_creds(
        self,
        user: str,
        image_info: common.DockerImageInfo,
    ) -> List[Tuple[str, Dict[str, str]]]:
        """ Fetch all Docker registry credentials matching an image. """
        select_data_cmd = PostgresSelectCommand(
            table='credential',
            conditions=['user_name = %s', 'cred_type = %s'],
            condition_args=[user, CredentialType.REGISTRY.value])
        rows = self.execute_fetch_command(*select_data_cmd.get_args())

        registry_rows: Dict[str, List[Any]] = {}
        for row in rows:
            if row.profile:
                registry_scope = common.normalize_registry_scope(row.profile)
                registry_rows.setdefault(registry_scope, []).append(row)

        return [
            (registry_scope, self.decrypt_credential(row))
            for registry_scope in common.matching_registry_scopes(
                image_info, registry_rows.keys())
            for row in registry_rows[registry_scope]
        ]

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
        """Reject writes to obsolete DB-backed configuration history.

        Args:
            config_type: Type of config being modified (service, workflow, etc)
            name: Name of the config item if applicable
            username: Username of the person making the change
            data: The complete config data after the change
            description: Description of what changed
            tags: Optional list of tags to associate with this change
        """
        del config_type, name, username, data, description, tags
        reject_db_config_mutation()

    def fetch_user_names(self, user_names: List[str]) -> List[str]:
        """Resolve requested names to current user identities.

        Args:
            user_names: List of user names to fetch
        """
        user_cmd = '''
            WITH normalized_usernames AS (
                SELECT DISTINCT
                    username,
                    split_part(username, '@', 1) AS base_username
                FROM unnest(%s::text[]) AS input(username)
            ),
            resolved AS (
                SELECT normalized.username AS input_username, matches.id AS user_name
                FROM normalized_usernames AS normalized
                LEFT JOIN LATERAL (
                    SELECT id
                    FROM users
                    WHERE normalized.username <> normalized.base_username
                      AND id = normalized.username

                    UNION ALL

                    SELECT id
                    FROM users
                    WHERE normalized.username = normalized.base_username
                      AND split_part(id, '@', 1) = normalized.base_username
                ) AS matches ON TRUE
            )
            SELECT input_username, user_name
            FROM resolved
            ORDER BY input_username, user_name;
        '''
        user_rows = self.execute_fetch_command(user_cmd, (user_names,), True)
        missing_users = [
            f'{user_row['input_username']} not found'
            for user_row in user_rows
            if user_row['user_name'] is None
        ]
        if missing_users:
            raise osmo_errors.OSMOUserError(
                f'Invalid user(s): {', '.join(missing_users)}')
        return sorted({user_row['user_name'] for user_row in user_rows})


def upsert_user(database: PostgresConnector, user_name: str) -> None:
    """
    Create a user in the users table if they don't exist.
    If the user already exists, this is a no-op.
    """
    upsert_cmd = '''
        INSERT INTO users (id, created_at, created_by)
        VALUES (%s, NOW(), %s)
        ON CONFLICT (id) DO NOTHING;
    '''
    database.execute_commit_command(upsert_cmd, (user_name, user_name))



class UserProfile(pydantic.BaseModel):
    """ Provides all User Profile Information """
    username: str | None = None
    email_notification: bool | None = None
    slack_notification: bool | None = None
    pool: str | None = None

    @classmethod
    def default_profile(cls, user_name: str) -> 'UserProfile':
        return UserProfile(
            username=user_name,
            email_notification=False,
            slack_notification=False,
            pool=None)

    @classmethod
    def insert_into_db(cls, database: PostgresConnector,
                       user_name: str,
                       setting: Dict[str, Any]):
        # Ensure user exists in users table before creating profile
        upsert_user(database, user_name)

        fields: List[str] = ['user_name']
        values: List = [user_name]
        for key, value in setting.items():
            fields.append(key)
            values.append(value)

        if 'pool' in setting:
            Pool.fetch_from_configmap(setting['pool'])

        insert_cmd = f'''
            INSERT INTO profile ({','.join(fields)})
            VALUES ({','.join(['%s'] * len(values))})
            ON CONFLICT (user_name)
            DO UPDATE SET {','.join(f'{field} = EXCLUDED.{field}' for field in fields)}
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
            return default_profile

        if row.email_notification is None:
            row.email_notification = default_profile.email_notification
        if row.slack_notification is None:
            row.slack_notification = default_profile.slack_notification

        return UserProfile(
            username=row.user_name,
            email_notification=row.email_notification,
            slack_notification=row.slack_notification,
            pool=row.pool
        )

class ExtraArgBaseModel(pydantic.BaseModel):
    """BaseModel that rejects unknown fields by default.

    User input is validated strictly (extra='forbid').  Database reads go
    through ``from_db`` which constructs with extra='ignore' so that legacy
    columns that no longer exist in code are silently dropped.
    """
    model_config = pydantic.ConfigDict(extra='forbid', populate_by_name=True)

    @classmethod
    def from_db(cls, data: Dict):
        """Construct from database data, tolerating unknown fields at all nesting levels."""
        return cls.model_validate(data, context={'_from_db': True})

    @pydantic.model_validator(mode='before')
    @classmethod
    def _strip_extra_from_db(cls, values: Any, info: pydantic.ValidationInfo) -> Any:
        if not isinstance(values, dict):
            return values
        if info.context and info.context.get('_from_db'):
            allowed_keys = set(cls.model_fields.keys())
            for field_info in cls.model_fields.values():
                if field_info.alias:
                    allowed_keys.add(field_info.alias)
            return {k: v for k, v in values.items() if k in allowed_keys}
        return values


class OsmoImageConfig(ExtraArgBaseModel):
    """
    Dynamic Config for storing the image URLs for service images and the credentials needed
    to pull them.
    """
    init: str = ''
    client: str = ''
    credential: credentials.RegistryCredential = credentials.RegistryCredential(
        registry='', username='', auth='')


class TopologyRequirementType(str, enum.Enum):
    """Specifies whether requirement blocks scheduling or is best-effort"""
    REQUIRED = 'required'
    PREFERRED = 'preferred'


class TopologyRequirement(pydantic.BaseModel, extra='forbid'):
    """Single topology requirement for a resource"""
    key: str  # References pool's topology_keys[].key
    group: str = 'default'  # Logical grouping of tasks
    requirementType: TopologyRequirementType = TopologyRequirementType.REQUIRED  # pylint: disable=invalid-name


class ResourceSpec(pydantic.BaseModel):
    """ Represents the resource spec in an OSMO2 workflow. """
    model_config = pydantic.ConfigDict(extra='forbid', coerce_numbers_to_str=True)

    cpu: int | None = None
    storage: str | None = None
    memory: str | None = None
    gpu: int | None = None
    platform: str | None = None
    nodesExcluded: List[str] = []  # pylint: disable=invalid-name
    topology: List[TopologyRequirement] = []

    def update(self, other: 'ResourceSpec') -> 'ResourceSpec':
        """ Apply all fields from the other resource spec to this one """
        self_dict = self.model_dump(exclude_none=True)
        other_dict = other.model_dump(exclude_none=True)
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
            value = f'{common.convert_resource_value_str(value, target='Ki')}Ki'
        return value

    @pydantic.field_validator('memory')
    @classmethod
    def validate_memory(cls, value: str | None) -> str | None:
        return cls.validate_unit_value(value, 'memory')

    @pydantic.field_validator('storage')
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

        mapping['USER_EXCLUDED_NODES'] = f'ARRAY:[{','.join(self.nodesExcluded)}]'

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
    # Defaults of '0' let pod templates omit individual fields without
    # failing strict validation in pool-quota accounting. The math in
    # check_osmo_data_resource subtracts requests as ctrl-pod overhead,
    # so '0' is the right neutral value when fields are omitted.
    cpu: str = '0'
    memory: str = '0'
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

    model_config = pydantic.ConfigDict(use_enum_values=True, extra='forbid')

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
        if not comparison_function(processed_left_operand, processed_right_operand):
            raise AssertionError(processed_assert_msg)


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
    config_fields: Dict[str, Dict[str, BackendResourceConfig]] | None = None
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
                    # Prefer the accounting copy where osmo-ctrl resource
                    # templates have been Jinja-rendered with default
                    # variables. The plain parsed template is retained as a
                    # defensive fallback for directly constructed test data.
                    accounting_template = (
                        curr_platform_config.parsed_pod_template_for_accounting
                        or curr_platform_config.parsed_pod_template)
                    resource_limits = \
                        check_osmo_data_resource(accounting_template)
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
        snapshot = configmap_state.require_snapshot()
        configured_backends = set(snapshot.get('backends', {}))
        requested_backends = (
            set(backends) if backends is not None else configured_backends)
        selected_backends = sorted(configured_backends & requested_backends)
        if not selected_backends:
            return []

        requested_pools = set(pools) if pools is not None else None
        requested_platforms = (
            set(platforms)
            if pools is not None and platforms is not None else None)
        configured_pool_platforms = []
        for pool_name, pool_config in snapshot.get('pools', {}).items():
            if not isinstance(pool_config, dict):
                continue
            if requested_pools is not None and pool_name not in requested_pools:
                continue
            backend_name = pool_config.get('backend')
            if backend_name not in selected_backends:
                continue
            for platform_name in pool_config.get('platforms', {}):
                if (requested_platforms is not None and
                        platform_name not in requested_platforms):
                    continue
                configured_pool_platforms.append(
                    (pool_name, platform_name, backend_name))

        if requested_pools is not None and not configured_pool_platforms:
            return []

        if configured_pool_platforms:
            values_clause = ', '.join(
                ['(%s, %s, %s)'] * len(configured_pool_platforms))
            configured_pool_platforms_query = f'VALUES {values_clause}'
        else:
            configured_pool_platforms_query = (
                'SELECT NULL::text, NULL::text, NULL::text WHERE FALSE')

        query_params: List[Any] = []
        for pool_name, platform_name, backend_name in configured_pool_platforms:
            query_params.extend((pool_name, platform_name, backend_name))
        conditions = ['r.backend IN %s']
        query_params.append(tuple(selected_backends))
        if requested_pools is not None:
            conditions.append('t2.pool IS NOT NULL')
        if resource_name:
            conditions.append('r.name = %s')
            query_params.append(resource_name)
        resource_filter_clause = 'WHERE ' + ' AND '.join(conditions)

        select_cmd = f'''
            WITH configured_pool_platforms(pool, platform, backend) AS (
                {configured_pool_platforms_query}
            )
            SELECT t1.*,
                COALESCE(sub.pool_platform_labels, ARRAY[]::text[]) AS pool_platform_labels,
                resource_type
            FROM resources t1
            JOIN
                (SELECT
                    r.name,
                    r.backend,
                    COALESCE(
                        array_remove(
                            array_agg(t2.pool || '/' || t2.platform), NULL),
                        ARRAY[]::text[]
                    ) AS pool_platform_labels,
                    CASE
                        WHEN COUNT(DISTINCT t2.pool) = 1 THEN 'RESERVED'
                        WHEN COUNT(DISTINCT t2.pool) = 0 THEN 'UNUSED'
                        ELSE 'SHARED'
                    END AS resource_type
                FROM
                    resources r
                LEFT JOIN
                    (SELECT resource_platforms.*
                     FROM resource_platforms
                     JOIN configured_pool_platforms
                       ON configured_pool_platforms.pool = resource_platforms.pool
                      AND configured_pool_platforms.platform = resource_platforms.platform
                      AND configured_pool_platforms.backend = resource_platforms.backend
                    ) t2
                  ON r.name = t2.resource_name AND r.backend = t2.backend
                {resource_filter_clause}
                GROUP BY
                    r.name, r.backend
                ) sub
            ON t1.name = sub.name AND t1.backend = sub.backend
            ORDER BY t1.backend ASC, t1.name ASC;
        '''
        postgres = PostgresConnector.get_instance()
        resources = postgres.execute_fetch_command(select_cmd, tuple(query_params), True)
        all_resources: List['BackendResource'] = []
        if len(resources) == 0:
            return all_resources

        pool_configs: Dict[str, Dict[str, 'Pool']] = {}

        for resource in resources:
            taints = resource.get('taints', [])
            label_fields = PostgresConnector.decode_hstore(resource.get('label_fields') or '')
            if resource['available']:
                backend = resource['backend']
                if backend not in pool_configs:
                    pool_configs[backend] = fetch_verbose_pool_config(postgres, backend).pools
                pool_config = pool_configs[backend]
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
                all_resources.append(BackendResource.model_construct(
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
                    resource_type=BackendResourceType(resource['resource_type'])))

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
    last_heartbeat: datetime.datetime | None
    created_date: datetime.datetime
    router_address: str
    online: bool

    @classmethod
    def fetch_from_db(cls, database: PostgresConnector,
                      name: str) -> 'Backend':
        """Fetch a backend by name.

        Configuration fields come from the immutable snapshot; operational
        fields (heartbeat, k8s_uid) come from PostgreSQL.
        """
        snapshot = configmap_state.require_snapshot()
        return cls._fetch_from_snapshot(database, name, snapshot)

    @classmethod
    def _fetch_from_snapshot(cls, database: PostgresConnector,
                             name: str, snapshot: dict) -> 'Backend':
        """Build a Backend by merging ConfigMap config + DB runtime."""
        items = snapshot.get('backends', {})
        if name not in items:
            raise osmo_errors.OSMOBackendError(
                f'Backend {name} is not found.')
        config = items[name]

        # Runtime fields from DB (agent writes these)
        runtime_cmd = (
            'SELECT k8s_uid, version, '
            'last_heartbeat, created_date '
            'FROM backends WHERE name = %s;')
        runtime_rows = database.execute_fetch_command(
            runtime_cmd, (name,), True)

        if runtime_rows:
            row = runtime_rows[0]
            runtime = {
                'k8s_uid': row['k8s_uid'],
                'version': row['version'],
                'last_heartbeat': row['last_heartbeat'],
                'created_date': row['created_date'],
            }
        else:
            # Agent hasn't connected yet — defaults
            now = common.current_time()
            runtime = {
                'k8s_uid': '',
                'version': '', 'last_heartbeat': None,
                'created_date': now,
            }

        scheduler = config.get('scheduler_settings', {})
        node_cond = config.get('node_conditions', {})
        return Backend(
            name=name,
            description=config.get('description', ''),
            version=runtime['version'],
            k8s_uid=runtime['k8s_uid'],
            k8s_namespace=config.get('k8s_namespace', ''),
            dashboard_url=config.get('dashboard_url', ''),
            grafana_url=config.get('grafana_url', ''),
            tests=config.get('tests', []),
            scheduler_settings=BackendSchedulerSettings(**scheduler),
            node_conditions=BackendNodeConditions(**node_cond),
            last_heartbeat=runtime['last_heartbeat'],
            created_date=runtime['created_date'],
            router_address=config.get('router_address', ''),
            online=(runtime['last_heartbeat'] is not None
                    and common.heartbeat_online(runtime['last_heartbeat'])),
        )

    @classmethod
    def list_names_from_db(cls, database: PostgresConnector) -> List[str]:
        """List all backend names."""
        del database
        snapshot = configmap_state.require_snapshot()
        items = snapshot.get('backends', {})
        return sorted(items.keys())

    @classmethod
    def list_from_db(cls, database: PostgresConnector) -> List['Backend']:
        """List all backends.

        Iterate snapshot backends, merging operational PostgreSQL data for each.
        """
        snapshot = configmap_state.require_snapshot()
        items = snapshot.get('backends', {})
        backends = []
        for name in sorted(items.keys()):
            try:
                backends.append(
                    cls._fetch_from_snapshot(database, name, snapshot))
            except (osmo_errors.OSMOError, pydantic.ValidationError) as error:
                logging.warning(
                    'Skipping backend %s: %s', name, error)
        return backends


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
    credential: credentials.DataCredential | None = None


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
    credential: credentials.DataCredential | None = None

    base_url: str = ''
    # Timeout in mins for osmo-ctrl to retry connecting to the OSMO service until exiting the task
    websocket_timeout: int = 1440 # 24hr
    # Timeout in mins for upload/download messages. If it fails to receive logs
    # in the timeout, it will retry the upload/download
    data_timeout: int = 10

    download_type: DownloadType = DownloadType.DOWNLOAD


class DynamicConfig(ExtraArgBaseModel):
    """Base model for ConfigMap-owned service configuration."""

    model_config = pydantic.ConfigDict(validate_assignment=True)

    @classmethod
    def deserialize(
        cls,
        config_dict: Dict,
        postgres: PostgresConnector,
        *,
        runtime_overrides: Dict[str, Any] | None = None,
        persist_secret_updates: bool = True,
    ):
        """ Decrypts all secrets in `config_dict` """
        runtime_overrides = runtime_overrides or {}
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
            If `encrypted_data` is re-encrypted, `top_level_key` is added to a set so callers can
            identify that conversion while deserializing retained historical data.

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
                        result_data[index], encrypted_data[index], top_level_key)
                    result_data[index] = decrypted
                    if new_encrypted is not None:
                        encrypted_data[index] = new_encrypted
                return result_data, None
            elif isinstance(encrypted_data, pydantic.SecretStr):
                secret = encrypted_data.get_secret_value()
                jwetoken = jwe.JWE()
                try:
                    jwetoken.deserialize(secret)
                except JWException:
                    # Encrypt the plain text secret
                    if persist_secret_updates:
                        encrypted = postgres.secret_manager.encrypt(secret, '')
                        encrypt_keys.add(top_level_key)
                        return secret, encrypted.value
                    return secret, None

                encrypted = Encrypted(secret)
                new_encrypted_list: List = []
                # If re-encryption is needed, top_level_key will be added to `encrypt_keys`.
                # New encrypted value will be added to `new_encrypted_list`.
                update_callback = (
                    re_encrypt(top_level_key, new_encrypted_list)
                    if persist_secret_updates else lambda _value: None)
                decrypted = postgres.secret_manager.decrypt(
                    encrypted, '', update_callback)
                new_encrypted = secret
                if new_encrypted_list:
                    new_encrypted = new_encrypted_list[0]
                return decrypted.value, new_encrypted
            else:
                return encrypted_data, None

        construction_data = {**config_dict, **runtime_overrides}
        dynamic_config = cls.from_db(construction_data)
        encrypted_dict = dynamic_config.model_dump(exclude_unset=True)
        decrypted_dict = dynamic_config.model_dump(exclude_unset=True)

        for key in config_dict:
            if not hasattr(dynamic_config, key):
                continue
            decrypted, new_encrypted = _decrypt(decrypted_dict[key], encrypted_dict[key], key)
            if new_encrypted is not None:
                encrypted_dict[key] = new_encrypted
            decrypted_dict[key] = decrypted
        decrypted_dict.update(runtime_overrides)
        dynamic_config = cls(**decrypted_dict)

        return dynamic_config

    def serialize_helper(self, config_dict: Dict, postgres: PostgresConnector,
                         top_level: bool = False) -> Dict[str, Any]:
        """ Recursively encrypt all secret fields in any dictionary or list. """
        for key, value in config_dict.items():
            value_for_typecheck = value
            if isinstance(value_for_typecheck, dict):
                if top_level:
                    config_dict[key] = json.dumps(self.serialize_helper(value, postgres))
                else:
                    config_dict[key] = self.serialize_helper(value, postgres)
            elif isinstance(value_for_typecheck, list):
                serialized_values: List[Any] = []
                for item in value_for_typecheck:
                    if isinstance(item, dict):
                        serialized_values.append(self.serialize_helper(item, postgres))
                    elif isinstance(item, list):
                        nested = self.serialize_helper({'value': item}, postgres)
                        serialized_values.append(nested['value'])
                    elif isinstance(item, pydantic.SecretStr):
                        serialized_values.append(postgres.secret_manager.encrypt(
                            item.get_secret_value(), '').value)
                    else:
                        serialized_values.append(item)
                config_dict[key] = serialized_values
            elif isinstance(value_for_typecheck, pydantic.SecretStr):
                encrypted = postgres.secret_manager.encrypt(value.get_secret_value(), '')
                config_dict[key] = encrypted.value
            elif value_for_typecheck is None:
                config_dict[key] = None
            elif not isinstance(value_for_typecheck, str):
                config_dict[key] = json.dumps(config_dict[key])
        return config_dict

    def serialize(self, postgres: PostgresConnector, exclude_unset=True) -> Dict[str, str | None]:
        """Encrypts all secret fields and returns a dictionary """
        config_dict = self.model_dump(by_alias=True, exclude_unset=exclude_unset)
        result = self.serialize_helper(config_dict, postgres, top_level=True)
        return result

    def plaintext_dict(self, *args, **kwargs):
        """Returns as a dictionary with all SecretStrs converted to str"""
        data = self.model_dump(*args, **kwargs)
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
    client_install_url: str | None = None

    @pydantic.field_validator('latest_version', 'min_supported_version')
    @classmethod
    def validate_version_format(
            cls, v: str | None, info: pydantic.ValidationInfo) -> str | None:
        """ Reject malformed version strings at write time so the version-check
        middleware can trust the persisted value. None and empty pass through
        unchanged (treated as "not configured" by callers). """
        if not v:
            return v
        try:
            version.Version.from_string(v)
        except osmo_errors.OSMOError as exc:
            raise osmo_errors.OSMOUserError(
                f'Invalid {info.field_name} "{v}": '
                'must be of the format major.minor.revision'
            ) from exc
        return v


class ServiceConfig(DynamicConfig):
    """ Stores any configs OSMO Admins control """
    service_base_url: str = ''

    service_auth: auth.AuthenticationConfig = pydantic.Field(
        default_factory=auth.AuthenticationConfig.generate_default)

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


class LabelEnforcement(str, enum.Enum):
    """Per-key policy strictness: 'off' skips checking, 'warn' surfaces
    missing or unlisted values as submission warnings, and 'enforce'
    rejects them."""
    OFF = 'off'
    WARN = 'warn'
    ENFORCE = 'enforce'


class LabelPolicy(ExtraArgBaseModel):
    """Configuration for one admin-designated workflow label key.

    An empty allow_list accepts any well-formed value; enforcement then
    applies only to the key being present.
    """
    key: str
    allow_list: List[str] = []
    enforcement: LabelEnforcement = LabelEnforcement.OFF
    # Optional single line appended to this key's warn/enforce messages, e.g.
    # where to look up valid values. Empty by default so the OSS default and
    # messages stay deployment-neutral.
    assert_message: str = ''

    @pydantic.field_validator('key')
    @classmethod
    def validate_key(cls, key: str) -> str:
        return validation.validate_workflow_label_key(key)

    @pydantic.field_validator('allow_list')
    @classmethod
    def validate_allow_list(cls, allow_list: List[str]) -> List[str]:
        return [validation.validate_workflow_label_value(value) for value in allow_list]

    @pydantic.field_validator('assert_message')
    @classmethod
    def validate_assert_message(cls, assert_message: str) -> str:
        assert_message = assert_message.strip()
        if len(assert_message) > 256:
            raise ValueError('Label policy assert_message must be at most 256 characters.')
        if any(character in assert_message for character in '\r\n'):
            raise ValueError('Label policy assert_message must be a single line.')
        return assert_message


class LabelsConfig(ExtraArgBaseModel):
    """Curated workflow label policy; empty by default, so no policy
    applies until configured."""
    policy: List[LabelPolicy] = []
    # Prepended to every workflow label key before it is stamped onto pod
    # labels, so operators can namespace user labels (e.g. 'example.com/')
    # without users typing the prefix on every spec or query. Empty by default
    # to keep the OSS default deployment-neutral. Not assumed to be a DNS
    # prefix: the merged key is validated at submission, not this field.
    pod_label_prefix: str = ''

    @pydantic.field_validator('policy')
    @classmethod
    def validate_policy(cls, policy: List[LabelPolicy]) -> List[LabelPolicy]:
        # Deliberately reuses the per-workflow label cap: curating more keys
        # than one workflow can carry would make the policy unsatisfiable.
        if len(policy) > validation.MAX_WORKFLOW_LABELS:
            raise ValueError(
                f'Configure at most {validation.MAX_WORKFLOW_LABELS} label policies.')
        keys = [label_policy.key for label_policy in policy]
        if len(keys) != len(set(keys)):
            raise ValueError('Duplicate label policy key.')
        return policy

    @pydantic.field_validator('pod_label_prefix')
    @classmethod
    def validate_pod_label_prefix(cls, pod_label_prefix: str) -> str:
        # Structure-agnostic sanity only; a whitespace-bearing or oversized
        # prefix would make every label key invalid. Full validity is checked
        # per-key at submission once the prefix is merged with the user's key.
        if any(character in pod_label_prefix for character in ' \t\r\n'):
            raise ValueError('Label pod_label_prefix must not contain whitespace.')
        if len(pod_label_prefix) > 253:
            raise ValueError('Label pod_label_prefix must be at most 253 characters.')
        return pod_label_prefix


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

    labels_config: LabelsConfig = LabelsConfig()

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


class ResourceValidation(pydantic.BaseModel):
    """ Single Pool Entry """
    resource_validations: List[ResourceAssertion]

    @classmethod
    def list_from_db(cls, database: PostgresConnector, names: Optional[List[str]] = None) \
        -> Dict[str, List[ResourceAssertion]]:
        """ Fetches the list of resource validations from the resource validation table """
        del database
        snapshot = configmap_state.require_snapshot()
        items = snapshot.get('resource_validations', {})
        if names:
            items = {k: v for k, v in items.items() if k in names}
        return items

    @classmethod
    def fetch_from_db(cls, database: PostgresConnector, name: str) -> List[ResourceAssertion]:
        """ Fetches the resource validations from the resource validation table """
        del database
        snapshot = configmap_state.require_snapshot()
        items = snapshot.get('resource_validations', {})
        if name not in items:
            raise osmo_errors.OSMOUserError(f'Resource Validation {name} does not exist.')
        return items[name]

    @classmethod
    def delete_from_db(cls, database: PostgresConnector, name: str):
        del database, name
        reject_db_config_mutation()

    def insert_into_db(self, database: PostgresConnector, name: str):
        del database, name
        reject_db_config_mutation()


class PodTemplate(pydantic.BaseModel):
    """ Single Pool Entry """
    pod_template: Dict

    @classmethod
    def list_from_db(cls, database: PostgresConnector, names: Optional[List[str]] = None) \
        -> Dict[str, Dict]:
        """ Fetches the list of pod templates from the pod template table """
        del database
        snapshot = configmap_state.require_snapshot()
        items = snapshot.get('pod_templates', {})
        if names:
            items = {k: v for k, v in items.items() if k in names}
        return items

    @classmethod
    def fetch_from_db(cls, database: PostgresConnector, name: str) -> Dict:
        """ Fetches the pod template from the pod template table """
        del database
        snapshot = configmap_state.require_snapshot()
        items = snapshot.get('pod_templates', {})
        if name not in items:
            raise osmo_errors.OSMOUserError(
                f'Pod Template {name} does not exist.')
        return items[name]

    @classmethod
    def get_pools(cls, database: PostgresConnector, name: str) -> List[Dict]:
        del database
        pools = configmap_state.require_snapshot().get('pools', {})
        matches = []
        for pool_name, pool in pools.items():
            if not isinstance(pool, dict):
                continue
            referenced = name in pool.get('common_pod_template', [])
            platforms = pool.get('platforms', {})
            if isinstance(platforms, dict):
                referenced = referenced or any(
                    isinstance(platform, dict)
                    and name in platform.get('override_pod_template', [])
                    for platform in platforms.values()
                )
            if referenced:
                matches.append({'name': pool_name})
        return matches

    @classmethod
    def get_tests(cls, database: PostgresConnector, name: str) -> List[Dict]:
        del database
        tests = configmap_state.require_snapshot().get('backend_tests', {})
        return [
            {'name': test_name}
            for test_name, test in tests.items()
            if isinstance(test, dict)
            and name in test.get('common_pod_template', [])
        ]
    @classmethod
    def delete_from_db(cls, database: PostgresConnector, name: str):
        del database, name
        reject_db_config_mutation()

    def insert_into_db(self, database: PostgresConnector, name: str):
        del database, name
        reject_db_config_mutation()


class GroupTemplate(pydantic.BaseModel):
    """ Group Template Entry """
    group_template: Dict[str, Any]

    @classmethod
    def list_from_db(cls, database: PostgresConnector, names: List[str] | None = None) \
        -> Dict[str, Dict[str, Any]]:
        """ Fetches the list of group templates from the group template table """
        del database
        snapshot = configmap_state.require_snapshot()
        items = snapshot.get('group_templates', {})
        if names:
            items = {k: v for k, v in items.items() if k in names}
        return items

    @classmethod
    def fetch_from_db(cls, database: PostgresConnector, name: str) -> Dict[str, Any]:
        """ Fetches the group template from the group template table """
        del database
        snapshot = configmap_state.require_snapshot()
        items = snapshot.get('group_templates', {})
        if name not in items:
            raise osmo_errors.OSMOUserError(
                f'Group Template {name} does not exist.')
        return items[name]

    @classmethod
    def delete_from_db(cls, database: PostgresConnector, name: str) -> None:
        del database, name
        reject_db_config_mutation()

    def insert_into_db(self, database: PostgresConnector, name: str) -> None:
        del database, name
        reject_db_config_mutation()


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


class PlatformEditable(PlatformBase):
    """ Single Platform Entry """

    model_config = pydantic.ConfigDict(extra='ignore')

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
    # Pod template with Jinja in osmo-ctrl resources pre-rendered using
    # pool/platform default variables. Populated by the ConfigMap loader.
    parsed_pod_template_for_accounting: Dict = {}

    def insert_into_db(self, database: PostgresConnector, pool_name: str, platform_name: str):
        del database, pool_name, platform_name
        reject_db_config_mutation()


class Quota(pydantic.BaseModel):
    """ Quota Entry """
    max_num_gpus: int = 100


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


class TopologyKey(pydantic.BaseModel):
    """Defines a topology key for pool configuration"""
    key: str  # User-friendly name (e.g., "rack", "zone", "gpu-clique")
    label: str  # Kubernetes node label (e.g., "topology.kubernetes.io/rack")


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
    resources: PoolResources = PoolResources()
    topology_keys: List[TopologyKey] = []

class PoolMinimal(PoolBase):
    platforms: Dict[str, PlatformMinimal] = {}


class PoolEditable(PoolBase, extra='ignore'):
    common_default_variables: Dict = {}
    common_resource_validations: List[str] = []
    common_pod_template: List[str] = []
    common_group_templates: List[str] = []
    platforms: Dict[str, PlatformEditable] = {}


class Pool(PoolBase, extra='ignore'):
    """ Single Pool Entry """
    common_default_variables: Dict = {}
    common_resource_validations: List[str] = []
    parsed_resource_validations: List[ResourceAssertion] = []
    common_pod_template: List[str] = []
    parsed_pod_template: Dict = {}
    # Pod template with Jinja in osmo-ctrl resources pre-rendered using
    # the pool's common_default_variables. See Platform for rationale.
    parsed_pod_template_for_accounting: Dict = {}
    common_group_templates: List[str] = []
    parsed_group_templates: List[Dict] = []
    platforms: Dict[str, Platform] = {}
    last_heartbeat: datetime.datetime | None = None

    @classmethod
    def update_pod_template(cls, database: PostgresConnector, name: str):
        del database, name
        reject_db_config_mutation()

    @classmethod
    def update_resource_validations(cls, database: PostgresConnector, name: str):
        del database, name
        reject_db_config_mutation()

    @classmethod
    def update_group_templates(cls, database: PostgresConnector, name: str) -> None:
        del database, name
        reject_db_config_mutation()

    @classmethod
    def fetch_from_configmap(cls, name: str) -> 'Pool':
        """Fetch one pool definition from the active ConfigMap snapshot."""
        pool_rows = cls.fetch_rows_from_configmap(pools=[name])
        if not pool_rows:
            raise osmo_errors.OSMOUserError(f'Pool {name} not found.')

        pool_info = Pool(**pool_rows[0])

        workflow_configs = WorkflowConfig(
            **configmap_state.require_snapshot().get('workflow', {}))
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
    def _compute_pool_status(cls, pool_data: dict,
                             heartbeat: datetime.datetime | None) -> PoolStatus:
        """Compute pool status from maintenance flag and heartbeat."""
        if pool_data.get('enable_maintenance', False):
            return PoolStatus.MAINTENANCE
        if heartbeat and common.heartbeat_online(heartbeat):
            return PoolStatus.ONLINE
        return PoolStatus.OFFLINE

    @classmethod
    def rename(cls, database: PostgresConnector, old_name: str, new_name: str):
        del database, old_name, new_name
        reject_db_config_mutation()

    @classmethod
    def rename_platform(cls, database: PostgresConnector, name: str, platform_name: str,
                        new_platform_name):
        del database, name, platform_name, new_platform_name
        reject_db_config_mutation()

    @classmethod
    def fetch_rows_from_configmap(
        cls,
        backend: str | None = None,
        pools: List[str] | None = None,
        all_pools: bool = True,
    ) -> List[dict]:
        """Build pool rows exclusively from the active ConfigMap snapshot."""
        items = configmap_state.require_snapshot().get('pools', {})
        selected_pool_names = set(pools or [])
        result = []
        for name in sorted(items):
            pool_data = items[name]
            if not isinstance(pool_data, dict):
                continue
            pool_backend = pool_data.get('backend', '')
            if backend and pool_backend != backend:
                continue
            if (selected_pool_names or not all_pools) and name not in selected_pool_names:
                continue
            result.append({**pool_data, 'name': name})
        return result

    @classmethod
    def fetch_runtime_rows(
        cls, database: PostgresConnector,
        backend: str | None, pools: List[str] | None,
        all_pools: bool,
    ) -> List[dict]:
        """Add DB-backed heartbeat status to ConfigMap-owned pool definitions."""
        configured_rows = cls.fetch_rows_from_configmap(
            backend=backend, pools=pools, all_pools=all_pools)

        # Batch-fetch heartbeats for all referenced backends
        backend_names = {
            row.get('backend', '') for row in configured_rows
        }
        heartbeat_map: Dict[str, datetime.datetime | None] = {}
        if backend_names:
            hb_cmd = (
                'SELECT name, last_heartbeat FROM backends '
                'WHERE name IN %s;')
            hb_rows = database.execute_fetch_command(
                hb_cmd, (tuple(backend_names),), True)
            heartbeat_map = {
                r['name']: r['last_heartbeat'] for r in hb_rows
            }

        result = []
        for pool_data in configured_rows:
            pool_backend = pool_data.get('backend', '')
            heartbeat = heartbeat_map.get(pool_backend)
            row = {**pool_data,
                   'last_heartbeat': heartbeat,
                   'status': cls._compute_pool_status(
                       pool_data, heartbeat)}
            result.append(row)
        return result

    @classmethod
    def fetch_runtime_from_configmap(
        cls, database: PostgresConnector, name: str,
    ) -> 'Pool':
        """Fetch a ConfigMap-owned pool with DB-backed heartbeat status."""
        pool_info = cls.fetch_from_configmap(name)
        hb_cmd = (
            'SELECT name, last_heartbeat FROM backends '
            'WHERE name = %s;')
        hb_rows = database.execute_fetch_command(
            hb_cmd, (pool_info.backend,), True)
        heartbeat = next((
            row['last_heartbeat'] for row in hb_rows
            if row['name'] == pool_info.backend
        ), None)
        pool_info.last_heartbeat = heartbeat
        pool_info.status = cls._compute_pool_status(
            pool_info.model_dump(), heartbeat)
        return pool_info

    @classmethod
    def get_all_configured_pool_names(cls) -> List[str]:
        """Return sorted pool names from the active ConfigMap snapshot."""
        return [pool['name'] for pool in cls.fetch_rows_from_configmap()]

    @classmethod
    def delete_from_db(cls, database: PostgresConnector, name: str):
        del database, name
        reject_db_config_mutation()

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

    def calculate_group_templates(self, database: PostgresConnector) -> None:
        ''' Merges common_group_templates into parsed_group_templates,
        combining entries with matching (apiVersion, kind, metadata.name) keys. '''
        group_template_specs = GroupTemplate.list_from_db(database, self.common_group_templates)

        merged_templates: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

        for template_name in self.common_group_templates:
            if template_name not in group_template_specs:
                raise osmo_errors.OSMOUsageError(
                    f'Group template {template_name} does not exist!')

            template = group_template_specs[template_name]
            api_version = template.get('apiVersion')
            kind = template.get('kind')
            resource_name = template.get('metadata', {}).get('name')

            if not api_version:
                raise osmo_errors.OSMOUsageError(
                    f'Group template {template_name} is missing required field "apiVersion".')
            if not kind:
                raise osmo_errors.OSMOUsageError(
                    f'Group template {template_name} is missing required field "kind".')
            if not resource_name:
                raise osmo_errors.OSMOUsageError(
                    f'Group template {template_name} is missing required field "metadata.name".')

            key = (api_version, kind, resource_name)

            if key in merged_templates:
                merged_templates[key] = common.recursive_dict_update(
                    merged_templates[key],
                    template,
                    common.merge_lists_on_name)
            else:
                merged_templates[key] = copy.deepcopy(template)

        self.parsed_group_templates = list(merged_templates.values())

    def insert_into_db(self, database: PostgresConnector, name: str):
        del database, name
        reject_db_config_mutation()


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
                              pools: List[str] | None = None,
                              all_pools: bool = True) -> VerbosePoolConfig:
    pool_rows = Pool.fetch_runtime_rows(
        database, backend, pools, all_pools)
    return VerbosePoolConfig(
        pools={pool_row['name']: Pool(**pool_row) for pool_row in pool_rows})


def fetch_minimal_pool_config(database: PostgresConnector,
                              backend: str | None = None,
                              pools: List[str] | None = None,
                              all_pools: bool = True) -> MinimalPoolConfig:
    pool_rows = Pool.fetch_runtime_rows(
        database, backend, pools, all_pools)
    return MinimalPoolConfig(
        pools={pool_row['name']: PoolMinimal(**pool_row) for pool_row in pool_rows})


def fetch_editable_pool_config(database: PostgresConnector,
                              backend: str | None = None,
                              pools: List[str] | None = None,
                              all_pools: bool = True) -> EditablePoolConfig:
    pool_rows = Pool.fetch_runtime_rows(
        database, backend, pools, all_pools)
    return EditablePoolConfig(
        pools={pool_row['name']: PoolEditable(**pool_row) for pool_row in pool_rows})


def fetch_platform_config(
    name: str,
    pool_type: PoolType,
) -> Mapping[str, Platform | PlatformEditable | PlatformMinimal]:

    platforms = Pool.fetch_from_configmap(name).platforms
    if pool_type == PoolType.VERBOSE:
        return platforms
    elif pool_type == PoolType.EDITABLE:
        return {platform_name: PlatformEditable(**platform.model_dump())
                for platform_name, platform in platforms.items()}
    elif pool_type == PoolType.MINIMAL:
        return {platform_name: PlatformMinimal(**platform.model_dump())
                for platform_name, platform in platforms.items()}
    else:
        raise osmo_errors.OSMOServerError(f'Unknown pool type: {pool_type.name}')


class ListOrder(enum.Enum):
    """ Represents the list order for the database. """
    ASC = 'ASC'
    DESC = 'DESC'


class PostgresUpdateCommand(pydantic.BaseModel, extra='forbid'):
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


class PostgresSelectCommand(pydantic.BaseModel, extra='forbid'):
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
        condition_str = f'({' OR '.join(conditions)})'
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



class BackendTestBase(pydantic.BaseModel):
    """ Represents a test config. """
    name: str = pydantic.Field(..., min_length=1)
    description: str
    cron_schedule: str = pydantic.Field(..., min_length=1)
    test_timeout: str = pydantic.Field(default='300s')
    node_conditions: List[str] = pydantic.Field(min_length=1)

    @pydantic.field_validator('name')
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

    @pydantic.field_validator('cron_schedule')
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

    @pydantic.field_validator('test_timeout')
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

    @pydantic.field_validator('node_conditions')
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
    common_pod_template: List[str] = pydantic.Field(min_length=1)
    parsed_pod_template: Dict = {}

    @classmethod
    def get_backends(cls, database: PostgresConnector, name: str) -> List[Dict]:
        del database
        backends = configmap_state.require_snapshot().get('backends', {})
        return [
            {'name': backend_name}
            for backend_name, backend in backends.items()
            if isinstance(backend, dict) and name in backend.get('tests', [])
        ]

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
        del database, name
        reject_db_config_mutation()

    @classmethod
    def list_from_db(cls, database: 'PostgresConnector', name: str | None = None
                     ) -> Dict[str, dict]:
        del database
        snapshot = configmap_state.require_snapshot()
        items = snapshot.get('backend_tests', {})
        if name:
            items = {k: v for k, v in items.items() if k == name}
        return items

    @classmethod
    def fetch_from_db(cls, database: 'PostgresConnector', name: str) -> 'BackendTests':
        del database
        snapshot = configmap_state.require_snapshot()
        items = snapshot.get('backend_tests', {})
        if name not in items:
            raise osmo_errors.OSMOUserError(
                f'Test config {name} does not exist.')
        return cls(**items[name])

    @classmethod
    def delete_from_db(cls, database: 'PostgresConnector', name: str):
        del database, name
        reject_db_config_mutation()

    def insert_into_db(self, database: 'PostgresConnector', name: str):
        del database, name
        reject_db_config_mutation()


class Role(role.Role):
    """ConfigMap-owned role definition used by read and validation APIs."""
    @classmethod
    def list_from_db(cls, database: PostgresConnector, names: Optional[List[str]] = None) \
        -> List['Role']:
        """Return ConfigMap-owned role definitions."""
        del database
        snapshot = configmap_state.require_snapshot()
        items = snapshot.get('roles', {})
        return [
            cls(name=role_name, **role_data)
            for role_name, role_data in sorted(items.items())
            if (not names or role_name in names) and isinstance(role_data, dict)
        ]

    @classmethod
    def fetch_from_db(cls, database: PostgresConnector, name: str) -> 'Role':
        """Return one ConfigMap-owned role definition."""
        del database
        items = configmap_state.require_snapshot().get('roles', {})
        if name not in items or not isinstance(items[name], dict):
            raise osmo_errors.OSMOUserError(f'Role {name} does not exist.')
        return cls(name=name, **items[name])

    @classmethod
    def get_roles_by_external_roles(cls, database: PostgresConnector,
                                    external_roles: List[str]) -> List[str]:
        """Resolve external role names from the ConfigMap snapshot."""
        del database
        if not external_roles:
            return []
        requested_roles = set(external_roles)
        snapshot = configmap_state.require_snapshot()

        def mapped_external_roles(role_name: str,
                                  role_data: Dict[str, Any]) -> List[str]:
            configured_roles = role_data.get('external_roles')
            if isinstance(configured_roles, list):
                return configured_roles
            return [role_name]

        return sorted(
            role_name
            for role_name, role_data in snapshot.get('roles', {}).items()
            if isinstance(role_data, dict)
            and requested_roles.intersection(
                mapped_external_roles(role_name, role_data))
        )

    @classmethod
    def delete_from_db(cls, database: PostgresConnector, name: str):
        del database, name
        reject_db_config_mutation()

    def insert_into_db(self, database: PostgresConnector, force: bool = False):
        """Reject runtime changes to ConfigMap-owned role definitions."""
        del database, force
        reject_db_config_mutation()

    @classmethod
    def replace_all_in_db(
        cls, database: PostgresConnector, roles: List['Role'],
    ) -> None:
        del database, roles
        reject_db_config_mutation()
