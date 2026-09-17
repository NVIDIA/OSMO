"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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

import datetime
import json
import threading
import types
import typing
import unittest
from unittest import mock

import pydantic

from src.lib.utils import osmo_errors
from src.utils.connectors import postgres


def _connector() -> typing.Any:
    """Build a PostgresConnector shell with a stubbed secret manager and no real pool."""
    connector = postgres.PostgresConnector.__new__(postgres.PostgresConnector)
    manager = mock.Mock()
    manager.encrypt.side_effect = lambda plain, uid: postgres.Encrypted(f'enc:{plain}')
    manager.decrypt.return_value = mock.Mock(value='clear')
    connector.secret_manager = manager
    connector.execute_commit_command = mock.Mock()
    connector.execute_fetch_command = mock.Mock(return_value=[])
    return connector


class _FakeCursor:
    """Cursor stand-in: health-check statements succeed, real statements may raise."""

    def __init__(self, error: Exception | None = None,
                 close_error: Exception | None = None,
                 healthcheck_error: Exception | None = None,
                 rows: list | None = None):
        self.error = error
        self.close_error = close_error
        self.healthcheck_error = healthcheck_error
        self.rows = rows if rows is not None else []
        self.rowcount = len(self.rows)
        self.statements: list = []

    def __enter__(self) -> '_FakeCursor':
        return self

    def __exit__(self, *exc_info) -> None:
        del exc_info

    def execute(self, command: str, args: tuple | None = None) -> None:
        del args
        self.statements.append(command)
        if command == 'SELECT 1':
            if self.healthcheck_error is not None:
                raise self.healthcheck_error
            return
        if self.error is not None:
            raise self.error

    def fetchall(self) -> list:
        return self.rows

    def mogrify(self, template: str, entry: tuple) -> bytes:
        return (template % entry).encode()

    def close(self) -> None:
        if self.close_error is not None:
            raise self.close_error


class _FakeConnection:
    """Connection stand-in handing out one shared cursor and recording session changes."""

    def __init__(self, cursor: _FakeCursor, closed: int = 0):
        self._cursor = cursor
        self.closed = closed
        self.commits = 0
        self.autocommit_settings: list = []

    def cursor(self, cursor_factory: typing.Any = None) -> _FakeCursor:
        del cursor_factory
        return self._cursor

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        return None

    def set_session(self, autocommit: bool) -> None:
        self.autocommit_settings.append(autocommit)


class _FakePool:
    """ThreadedConnectionPool stand-in serving a fixed sequence of connections."""

    def __init__(self, connections: list,
                 putconn_error: Exception | None = None,
                 closeall_error: Exception | None = None):
        self.connections = list(connections)
        self.putconn_error = putconn_error
        self.closeall_error = closeall_error
        self.getconn_calls = 0
        self.putconn_closes: list = []

    def getconn(self) -> typing.Any:
        self.getconn_calls += 1
        return self.connections[min(self.getconn_calls - 1, len(self.connections) - 1)]

    def putconn(self, connection: typing.Any, close: bool = False) -> None:
        del connection
        self.putconn_closes.append(close)
        if self.putconn_error is not None:
            raise self.putconn_error

    def closeall(self) -> None:
        if self.closeall_error is not None:
            raise self.closeall_error


def _pooled_connector(pool: typing.Any, retries: int = 1,
                      minconn: int = 1, maxconn: int = 2) -> typing.Any:
    """Attach a fake pool to a PostgresConnector shell so no sockets are opened."""
    connector: typing.Any = postgres.PostgresConnector.__new__(postgres.PostgresConnector)
    connector.config = types.SimpleNamespace(
        postgres_reconnect_retry=retries, method='dev', schema_version='public',
        postgres_pool_minconn=minconn, postgres_pool_maxconn=maxconn,
        postgres_host='db', postgres_port=5432, postgres_database_name='osmo',
        postgres_user='osmo', postgres_password='pw')
    connector._pool = pool
    connector._pool_lock = threading.Lock()
    connector._pool_semaphore = threading.Semaphore(maxconn)
    return connector


def _ctrl_pool(requests: dict, platform_names: list) -> postgres.Pool:
    """Build a Pool whose platforms all declare the same osmo-ctrl resource requests."""
    template = {'spec': {'containers': [
        {'name': 'user'},
        {'name': 'osmo-ctrl', 'resources': {'requests': requests}},
    ]}}
    return postgres.Pool(
        backend='backend-1',
        platforms={name: postgres.Platform(parsed_pod_template=template)
                   for name in platform_names})


def _backend_resource() -> postgres.BackendResource:
    """Build a BackendResource with the allocatable keys exposed_fields reads."""
    return postgres.BackendResource(
        name='node-1', backend='backend-1', label_fields={},
        allocatable_fields={'cpu': '8', 'memory': '16Gi',
                            'ephemeral-storage': '100Gi', 'nvidia.com/gpu': '4'},
        usage_fields={}, non_workflow_usage_fields={}, taint_fields=[],
        pool_platform_labels={'pool-1': ['a100']},
        updated_allocatable_fields={}, updated_workflow_allocatable_fields={},
        available_fields={}, resource_type=postgres.BackendResourceType.SHARED)


class _SecretConfig(postgres.DynamicConfig):
    """Concrete DynamicConfig used to exercise the base serialize/deserialize contract."""

    token: pydantic.SecretStr = pydantic.SecretStr('')
    nested: dict = {}
    items: list = []
    count: int = 0

    def get_type(self) -> postgres.ConfigType:
        return postgres.ConfigType.SERVICE


class _RetryTarget:
    """Minimal object satisfying the retry decorator's `self.config`/`self.connect` contract."""

    def __init__(self, error: Exception | None, retries: int = 3):
        self.config = types.SimpleNamespace(postgres_reconnect_retry=retries)
        self.error = error
        self.attempts = 0
        self.connect_calls = 0

    def connect(self) -> None:
        self.connect_calls += 1

    def _raise_or_return(self) -> str:
        self.attempts += 1
        if self.error is not None:
            raise self.error
        return 'ok'

    @postgres.retry
    def reconnecting_call(self) -> str:
        return self._raise_or_return()

    @postgres.retry(reconnect=False)
    def non_reconnecting_call(self) -> str:
        return self._raise_or_return()


def _assertion(operator: str, left: str, right: str) -> postgres.ResourceAssertion:
    return postgres.ResourceAssertion(
        operator=postgres.ResourceAssertion.OperatorType(operator),
        left_operand=left,
        right_operand=right,
        assert_message='limit exceeded')


def _substitute(template: str, tokens: dict) -> typing.Any:
    """Deterministic stand-in for the sandboxed Jinja renderer."""
    return tokens.get(template, template)


class TestDownloadType(unittest.TestCase):
    """Covers DownloadType.from_str (lines 125-126, 128)."""

    def test_from_str_download_returns_download_member(self):
        self.assertEqual(postgres.DownloadType.from_str('download'),
                         postgres.DownloadType.DOWNLOAD)

    def test_from_str_unknown_label_raises_not_implemented(self):
        with self.assertRaises(NotImplementedError):
            postgres.DownloadType.from_str('upload')


class TestRetryDecorator(unittest.TestCase):
    """Covers retry (lines 254-273, notably 263-266)."""

    def test_successful_call_returns_value_without_reconnecting(self):
        target = _RetryTarget(None)

        self.assertEqual(target.reconnecting_call(), 'ok')
        self.assertEqual(target.connect_calls, 0)

    def test_interface_error_retries_then_raises_database_error(self):
        target = _RetryTarget(postgres.psycopg2.InterfaceError('gone'), retries=3)

        with self.assertRaisesRegex(osmo_errors.OSMODatabaseError, 'gone'):
            target.reconnecting_call()

        self.assertEqual(target.attempts, 3)
        self.assertEqual(target.connect_calls, 3)

    def test_reconnect_disabled_does_not_recreate_pool(self):
        target = _RetryTarget(postgres.psycopg2.DatabaseError('down'), retries=2)

        with self.assertRaises(osmo_errors.OSMODatabaseError):
            target.non_reconnecting_call()

        self.assertEqual(target.connect_calls, 0)

    def test_osmo_error_propagates_without_retrying(self):
        target = _RetryTarget(osmo_errors.OSMOUserError('bad input'))

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'bad input'):
            target.reconnecting_call()

        self.assertEqual(target.attempts, 1)

    def test_unexpected_error_is_wrapped_as_database_error(self):
        target = _RetryTarget(ValueError('boom'))

        with self.assertRaisesRegex(osmo_errors.OSMODatabaseError, 'boom'):
            target.reconnecting_call()

        self.assertEqual(target.attempts, 1)


class TestConnectorSecretHelpers(unittest.TestCase):
    """Covers get_method, decrypt_credential and encrypt_dict (lines 810, 813-846)."""

    def test_get_method_returns_configured_method(self):
        connector = _connector()
        connector.config = types.SimpleNamespace(method='dev')

        self.assertEqual(connector.get_method(), 'dev')

    def test_encrypt_dict_encrypts_every_value(self):
        connector = _connector()

        result = connector.encrypt_dict({'user': 'alice', 'token': 'secret'}, 'alice')

        self.assertEqual(result, {'user': 'enc:alice', 'token': 'enc:secret'})

    def test_encode_and_decode_hstore_round_trip(self):
        encoded = postgres.PostgresConnector.encode_hstore({'user': 'alice'})

        self.assertEqual(encoded, '"user"=>"alice"')
        self.assertEqual(postgres.PostgresConnector.decode_hstore(encoded), {'user': 'alice'})

    def test_decrypt_credential_decrypts_jwe_payload_values(self):
        connector = _connector()
        row = types.SimpleNamespace(
            payload='"token"=>"jwe-blob"', user_name='alice', cred_name='cred-1')

        with mock.patch.object(postgres.jwe, 'JWE'):
            result = connector.decrypt_credential(row)

        self.assertEqual(result, {'token': 'clear'})
        connector.execute_commit_command.assert_not_called()

    def test_decrypt_credential_encrypts_plaintext_payload_in_place(self):
        connector = _connector()
        row = types.SimpleNamespace(
            payload='"token"=>"plaintext"', user_name='alice', cred_name='cred-1')

        result = connector.decrypt_credential(row)

        self.assertEqual(result, {'token': 'plaintext'})
        connector.execute_commit_command.assert_called_once()
        self.assertIn('enc:plaintext', connector.execute_commit_command.call_args.args[1])

    def test_set_config_rejects_postgres_backed_configuration_writes(self):
        connector = _connector()

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-owned'):
            connector.set_config('key', 'value', postgres.ConfigType.SERVICE)


class TestResourceLimitations(unittest.TestCase):
    """Covers ResourceLimitations.format (lines 1973-1982)."""

    def test_format_maps_ephemeral_storage_to_kubernetes_key(self):
        limitations = postgres.ResourceLimitations()

        formatted = limitations.format()

        self.assertEqual(formatted['requests']['ephemeral-storage'], '3Gi')
        self.assertEqual(formatted['limits']['cpu'], '500m')


class TestResourceAssertionEvaluate(unittest.TestCase):
    """Covers ResourceAssertion.evaluate and get_comparison_function
    (lines 1997, 2022-2026, 2028, 2031-2033, 2035-2036, 2038-2039, 2041, 2046-2048)."""

    def setUp(self) -> None:
        patcher = mock.patch.object(
            postgres.jinja_sandbox, 'sandboxed_jinja_substitute', side_effect=_substitute)
        self.substitute = patcher.start()
        self.addCleanup(patcher.stop)

    def test_numeric_operands_satisfying_assertion_do_not_raise(self):
        assertion = _assertion('LT', '2', '3')

        self.assertIsNone(assertion.evaluate({}, 'task-a'))

    def test_numeric_operands_violating_assertion_raise_with_task_name(self):
        assertion = _assertion('GT', '2', '3')

        with self.assertRaisesRegex(AssertionError, 'task-a'):
            assertion.evaluate({}, 'task-a')

    def test_resource_suffix_operands_are_converted_before_comparison(self):
        assertion = _assertion('LE', '4Gi', '2Gi')

        with self.assertRaisesRegex(AssertionError, 'limit exceeded'):
            assertion.evaluate({}, 'task-b')

    def test_resource_suffix_operands_within_limit_pass(self):
        assertion = _assertion('LE', '1Gi', '2Gi')

        self.assertIsNone(assertion.evaluate({}, 'task-b'))

    def test_string_operands_use_equality_comparison(self):
        assertion = _assertion('EQ', 'alpha', 'alpha')

        self.assertIsNone(assertion.evaluate({}, 'task-c'))

    def test_string_operands_that_differ_raise_assertion_error(self):
        assertion = _assertion('EQ', 'alpha', 'beta')

        with self.assertRaises(AssertionError):
            assertion.evaluate({}, 'task-c')

    def test_templated_operand_resolves_from_tokens(self):
        assertion = _assertion('GE', '{{ gpus }}', '2')

        self.assertIsNone(assertion.evaluate({'{{ gpus }}': '4'}, 'task-d'))

    def test_unresolved_operand_skips_the_assertion(self):
        assertion = _assertion('GT', '{{ gpus }}', '99')

        self.assertIsNone(assertion.evaluate({'{{ gpus }}': None}, 'task-e'))

    def test_unresolved_right_operand_skips_the_assertion(self):
        assertion = _assertion('GT', '1', '{{ limit }}')

        self.assertIsNone(assertion.evaluate({'{{ limit }}': None}, 'task-f'))

    def test_get_comparison_function_returns_requested_operator(self):
        assertion = _assertion('GE', '1', '1')

        self.assertTrue(assertion.get_comparison_function('GE')(1, 1))


class TestConstructPath(unittest.TestCase):
    """Covers construct_path (lines 2637-2644)."""

    def test_endpoint_with_trailing_slash_is_not_double_separated(self):
        self.assertEqual(postgres.construct_path('https://s3.local/', 'bucket', 'key'),
                         'https://s3.local/bucket/key')

    def test_endpoint_without_trailing_slash_gains_separator(self):
        self.assertEqual(postgres.construct_path('https://s3.local', 'bucket', 'key'),
                         'https://s3.local/bucket/key')

    def test_repeated_slashes_are_collapsed_and_trailing_slash_stripped(self):
        self.assertEqual(postgres.construct_path('https://s3.local', 'bucket', '//nested//'),
                         'https://s3.local/bucket/nested')


class TestWorkflowInfoValidateName(unittest.TestCase):
    """Covers WorkflowInfo.validate_name (lines 2659-2661)."""

    def test_name_within_limit_is_accepted(self):
        info = postgres.WorkflowInfo(max_name_length=8)

        self.assertIsNone(info.validate_name('short'))

    def test_name_over_limit_raises_user_error(self):
        info = postgres.WorkflowInfo(max_name_length=4)

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'too long'):
            info.validate_name('far-too-long')


class TestExtraArgBaseModelFromDb(unittest.TestCase):
    """Covers ExtraArgBaseModel.from_db and _strip_extra_from_db (lines 1770, 1776-1782)."""

    def test_from_db_drops_columns_that_no_longer_exist_in_code(self):
        info = postgres.WorkflowInfo.from_db({'tags': ['nightly'], 'legacy_column': 1})

        self.assertEqual(info.tags, ['nightly'])

    def test_direct_construction_still_rejects_unknown_fields(self):
        with self.assertRaises(pydantic.ValidationError):
            postgres.WorkflowInfo(**{'legacy_column': 1})

    def test_from_db_keeps_aliased_columns(self):
        field = postgres.ResourceLimitationsField.from_db({'ephemeral-storage': '9Gi'})

        self.assertEqual(field.ephemeral_storage, '9Gi')

    def test_from_db_with_non_mapping_payload_raises_validation_error(self):
        with self.assertRaises(pydantic.ValidationError):
            postgres.WorkflowInfo.from_db(typing.cast(dict, 'not-a-mapping'))


class TestDynamicConfigSerialize(unittest.TestCase):
    """Covers serialize and serialize_helper (lines 2791-2819, 2823-2825)."""

    def test_top_level_secret_field_is_replaced_by_ciphertext(self):
        config = _SecretConfig(token=pydantic.SecretStr('shh'))

        result = config.serialize(_connector())

        self.assertEqual(result['token'], 'enc:shh')

    def test_top_level_mapping_is_encrypted_then_json_encoded(self):
        config = _SecretConfig(nested={'inner': pydantic.SecretStr('shh')})

        result = config.serialize(_connector())

        self.assertEqual(json.loads(typing.cast(str, result['nested'])),
                         {'inner': 'enc:shh'})

    def test_non_string_scalar_is_json_encoded(self):
        config = _SecretConfig(count=7)

        result = config.serialize(_connector())

        self.assertEqual(result['count'], '7')

    def test_unset_fields_are_omitted_from_serialized_output(self):
        config = _SecretConfig(count=7)

        result = config.serialize(_connector())

        self.assertNotIn('token', result)

    def test_serialize_without_exclude_unset_includes_defaults(self):
        config = _SecretConfig(count=7)

        result = config.serialize(_connector(), exclude_unset=False)

        self.assertEqual(result['token'], 'enc:')

    def test_nested_mapping_below_top_level_stays_a_mapping(self):
        config = _SecretConfig()

        result = config.serialize_helper({'outer': {'inner': 1}}, _connector())

        self.assertEqual(result, {'outer': {'inner': '1'}})

    def test_list_of_mappings_is_serialized_element_wise(self):
        config = _SecretConfig()

        result = config.serialize_helper(
            {'items': [{'secret': pydantic.SecretStr('a')}]}, _connector())

        self.assertEqual(result, {'items': [{'secret': 'enc:a'}]})

    def test_nested_list_elements_are_serialized(self):
        config = _SecretConfig()

        result = config.serialize_helper(
            {'items': [[pydantic.SecretStr('a')]]}, _connector())

        self.assertEqual(result, {'items': [['enc:a']]})

    def test_list_of_secrets_is_encrypted_element_wise(self):
        config = _SecretConfig()

        result = config.serialize_helper(
            {'items': [pydantic.SecretStr('a'), 'literal']}, _connector())

        self.assertEqual(result, {'items': ['enc:a', 'literal']})

    def test_none_values_are_preserved(self):
        config = _SecretConfig()

        result = config.serialize_helper({'maybe': None}, _connector())

        self.assertIsNone(result['maybe'])


class TestDynamicConfigPlaintextDict(unittest.TestCase):
    """Covers plaintext_dict (lines 2829-2847)."""

    def test_top_level_secret_is_revealed(self):
        config = _SecretConfig(token=pydantic.SecretStr('shh'))

        self.assertEqual(config.plaintext_dict()['token'], 'shh')

    def test_nested_mapping_secret_is_revealed(self):
        config = _SecretConfig(nested={'inner': pydantic.SecretStr('shh')})

        self.assertEqual(config.plaintext_dict()['nested'], {'inner': 'shh'})

    def test_nested_list_secret_is_revealed(self):
        config = _SecretConfig(items=[[pydantic.SecretStr('shh')]])

        self.assertEqual(config.plaintext_dict()['items'], [['shh']])

    def test_non_secret_leaf_values_are_left_alone(self):
        config = _SecretConfig(count=5)

        self.assertEqual(config.plaintext_dict()['count'], 5)


class TestDynamicConfigDeserialize(unittest.TestCase):
    """Covers deserialize (lines 2693-2703, 2726-2786)."""

    def test_plaintext_secret_is_encrypted_for_persistence(self):
        connector = _connector()

        config = _SecretConfig.deserialize({'token': 'plain'}, connector)

        self.assertEqual(config.token.get_secret_value(), 'plain')
        connector.secret_manager.encrypt.assert_called_once_with('plain', '')

    def test_plaintext_secret_is_not_encrypted_when_persistence_disabled(self):
        connector = _connector()

        config = _SecretConfig.deserialize(
            {'token': 'plain'}, connector, persist_secret_updates=False)

        self.assertEqual(config.token.get_secret_value(), 'plain')
        connector.secret_manager.encrypt.assert_not_called()

    def test_jwe_secret_is_decrypted_through_the_secret_manager(self):
        connector = _connector()

        with mock.patch.object(postgres.jwe, 'JWE'):
            config = _SecretConfig.deserialize({'token': 'jwe-blob'}, connector)

        self.assertEqual(config.token.get_secret_value(), 'clear')
        connector.secret_manager.decrypt.assert_called_once()

    def test_rewrapped_secret_update_callback_is_wired_when_persisting(self):
        connector = _connector()
        rewrapped: list = []

        def decrypt(encrypted, uid, update_secret):
            del encrypted, uid
            update_secret('rewrapped')
            rewrapped.append('called')
            return mock.Mock(value='clear')

        connector.secret_manager.decrypt.side_effect = decrypt

        with mock.patch.object(postgres.jwe, 'JWE'):
            config = _SecretConfig.deserialize({'token': 'jwe-blob'}, connector)

        self.assertEqual(config.token.get_secret_value(), 'clear')
        self.assertEqual(rewrapped, ['called'])

    def test_jwe_secret_skips_update_callback_when_persistence_disabled(self):
        connector = _connector()

        with mock.patch.object(postgres.jwe, 'JWE'):
            _SecretConfig.deserialize(
                {'token': 'jwe-blob'}, connector, persist_secret_updates=False)

        callback = connector.secret_manager.decrypt.call_args.args[2]
        self.assertIsNone(callback('ignored'))

    def test_nested_mapping_values_are_walked_recursively(self):
        config = _SecretConfig.deserialize({'nested': {'inner': 'flat'}}, _connector())

        self.assertEqual(config.nested, {'inner': 'flat'})

    def test_list_values_are_walked_recursively(self):
        config = _SecretConfig.deserialize({'items': ['a', 'b']}, _connector())

        self.assertEqual(config.items, ['a', 'b'])

    def test_unknown_persisted_key_is_ignored(self):
        config = _SecretConfig.deserialize({'retired_key': 1, 'count': 3}, _connector())

        self.assertEqual(config.count, 3)

    def test_runtime_overrides_take_precedence_over_persisted_values(self):
        config = _SecretConfig.deserialize(
            {'count': 1}, _connector(), runtime_overrides={'count': 9})

        self.assertEqual(config.count, 9)


class TestServiceConfig(unittest.TestCase):
    """Covers ServiceConfig.get_type and get_parsed_field (lines 2896, 2902-2912)."""

    def test_get_type_reports_service_config(self):
        self.assertEqual(postgres.ServiceConfig().get_type(), postgres.ConfigType.SERVICE)

    def test_https_base_url_uses_secure_websocket_and_default_port(self):
        config = postgres.ServiceConfig(service_base_url='https://osmo.example.com')

        self.assertEqual(config.get_parsed_field(), ('osmo.example.com', '443', 'wss', 'https'))

    def test_explicit_port_is_preserved(self):
        config = postgres.ServiceConfig(service_base_url='http://osmo.example.com:8080')

        self.assertEqual(config.get_parsed_field(), ('osmo.example.com', '8080', 'ws', 'http'))

    def test_empty_base_url_falls_back_to_insecure_defaults(self):
        config = postgres.ServiceConfig(service_base_url='')

        self.assertEqual(config.get_parsed_field(), ('', '80', 'ws', ''))


class TestWorkflowConfigType(unittest.TestCase):
    """Covers WorkflowConfig.get_type (line 3111)."""

    def test_get_type_reports_workflow_config(self):
        self.assertEqual(postgres.WorkflowConfig().get_type(), postgres.ConfigType.WORKFLOW)


class _ConfigMapTestCase(unittest.TestCase):
    """Installs a ConfigMap snapshot so ConfigMap-owned readers can be exercised."""

    snapshot: dict

    def install_snapshot(self, snapshot: dict) -> None:
        patcher = mock.patch.object(
            postgres.configmap_state, 'require_snapshot', return_value=snapshot)
        patcher.start()
        self.addCleanup(patcher.stop)


class TestResourceValidationConfigMap(_ConfigMapTestCase):
    """Covers ResourceValidation ConfigMap readers and mutation rejection
    (lines 3122-3127, 3132-3137, 3141-3142, 3145-3146)."""

    def setUp(self) -> None:
        self.assertion = _assertion('GT', '1', '0')
        self.install_snapshot({'resource_validations': {
            'gpu-check': [self.assertion],
            'cpu-check': [],
        }})

    def test_list_from_db_returns_all_entries(self):
        items = postgres.ResourceValidation.list_from_db(_connector())

        self.assertEqual(sorted(items), ['cpu-check', 'gpu-check'])

    def test_list_from_db_filters_by_requested_names(self):
        items = postgres.ResourceValidation.list_from_db(_connector(), ['gpu-check'])

        self.assertEqual(list(items), ['gpu-check'])

    def test_fetch_from_db_returns_named_entry(self):
        items = postgres.ResourceValidation.fetch_from_db(_connector(), 'gpu-check')

        self.assertEqual(items, [self.assertion])

    def test_fetch_from_db_unknown_name_raises_user_error(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'does not exist'):
            postgres.ResourceValidation.fetch_from_db(_connector(), 'missing')

    def test_delete_from_db_is_rejected(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            postgres.ResourceValidation.delete_from_db(_connector(), 'gpu-check')

    def test_insert_into_db_is_rejected(self):
        entry = postgres.ResourceValidation(resource_validations=[])

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            entry.insert_into_db(_connector(), 'gpu-check')


class TestPodTemplateConfigMap(_ConfigMapTestCase):
    """Covers PodTemplate ConfigMap readers and mutation rejection
    (lines 3158-3162, 3167-3173, 3177-3193, 3197-3204, 3207-3208, 3211-3212)."""

    def setUp(self) -> None:
        self.install_snapshot({
            'pod_templates': {'base': {'spec': {}}, 'extra': {'spec': {}}},
            'pools': {
                'pool-a': {'common_pod_template': ['base'], 'platforms': {}},
                'pool-b': {'platforms': {'gpu': {'override_pod_template': ['base']}}},
                'pool-c': {'common_pod_template': ['extra'], 'platforms': 'malformed'},
                'pool-d': 'malformed',
            },
            'backend_tests': {
                'smoke': {'common_pod_template': ['base']},
                'other': {'common_pod_template': ['extra']},
                'malformed': 'not-a-mapping',
            },
        })

    def test_list_from_db_filters_by_requested_names(self):
        items = postgres.PodTemplate.list_from_db(_connector(), ['extra'])

        self.assertEqual(list(items), ['extra'])

    def test_fetch_from_db_returns_named_template(self):
        template = postgres.PodTemplate.fetch_from_db(_connector(), 'base')

        self.assertEqual(template, {'spec': {}})

    def test_fetch_from_db_unknown_name_raises_user_error(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'Pod Template missing'):
            postgres.PodTemplate.fetch_from_db(_connector(), 'missing')

    def test_get_pools_reports_common_and_platform_references(self):
        pools = postgres.PodTemplate.get_pools(_connector(), 'base')

        self.assertEqual(pools, [{'name': 'pool-a'}, {'name': 'pool-b'}])

    def test_get_pools_skips_malformed_pool_entries(self):
        pools = postgres.PodTemplate.get_pools(_connector(), 'extra')

        self.assertEqual(pools, [{'name': 'pool-c'}])

    def test_get_tests_reports_referencing_backend_tests(self):
        tests = postgres.PodTemplate.get_tests(_connector(), 'base')

        self.assertEqual(tests, [{'name': 'smoke'}])

    def test_delete_from_db_is_rejected(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            postgres.PodTemplate.delete_from_db(_connector(), 'base')

    def test_insert_into_db_is_rejected(self):
        template = postgres.PodTemplate(pod_template={})

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            template.insert_into_db(_connector(), 'base')


class TestGroupTemplateConfigMap(_ConfigMapTestCase):
    """Covers GroupTemplate ConfigMap readers and mutation rejection
    (lines 3224-3228, 3233-3239, 3243-3244, 3247-3248)."""

    def setUp(self) -> None:
        self.install_snapshot({'group_templates': {
            'group-a': {'metadata': {}},
            'group-b': {},
        }})

    def test_list_from_db_returns_all_entries(self):
        items = postgres.GroupTemplate.list_from_db(_connector())

        self.assertEqual(sorted(items), ['group-a', 'group-b'])

    def test_list_from_db_filters_by_requested_names(self):
        items = postgres.GroupTemplate.list_from_db(_connector(), ['group-b'])

        self.assertEqual(list(items), ['group-b'])

    def test_fetch_from_db_returns_named_entry(self):
        template = postgres.GroupTemplate.fetch_from_db(_connector(), 'group-a')

        self.assertEqual(template, {'metadata': {}})

    def test_fetch_from_db_unknown_name_raises_user_error(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'Group Template missing'):
            postgres.GroupTemplate.fetch_from_db(_connector(), 'missing')

    def test_delete_from_db_is_rejected(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            postgres.GroupTemplate.delete_from_db(_connector(), 'group-a')

    def test_insert_into_db_is_rejected(self):
        template = postgres.GroupTemplate(group_template={})

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            template.insert_into_db(_connector(), 'group-a')


class TestConfigMutationRejection(unittest.TestCase):
    """Covers Platform and Pool mutation rejection (lines 3300-3301, 3375-3386,
    3422-3423, 3428-3429, 3517-3518)."""

    def test_platform_insert_into_db_is_rejected(self):
        platform = postgres.Platform()

        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            platform.insert_into_db(_connector(), 'pool-a', 'gpu')

    def test_pool_update_pod_template_is_rejected(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            postgres.Pool.update_pod_template(_connector(), 'pool-a')

    def test_pool_update_resource_validations_is_rejected(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            postgres.Pool.update_resource_validations(_connector(), 'pool-a')

    def test_pool_update_group_templates_is_rejected(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            postgres.Pool.update_group_templates(_connector(), 'pool-a')

    def test_pool_rename_is_rejected(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            postgres.Pool.rename(_connector(), 'pool-a', 'pool-b')

    def test_pool_rename_platform_is_rejected(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            postgres.Pool.rename_platform(_connector(), 'pool-a', 'gpu', 'cpu')

    def test_pool_delete_from_db_is_rejected(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'ConfigMap-only'):
            postgres.Pool.delete_from_db(_connector(), 'pool-a')


class TestPoolConfigMapRows(_ConfigMapTestCase):
    """Covers Pool.fetch_rows_from_configmap and fetch_from_configmap
    (lines 3391-3393, 3439-3452)."""

    def setUp(self) -> None:
        self.install_snapshot({
            'workflow': {'default_exec_timeout': '7d', 'max_queue_timeout': '9d'},
            'pools': {
                'pool-a': {'backend': 'backend-1', 'platforms': {}},
                'pool-b': {'backend': 'backend-2', 'platforms': {}},
                'pool-bad': 'malformed',
            },
        })

    def test_rows_are_returned_sorted_and_named(self):
        rows = postgres.Pool.fetch_rows_from_configmap()

        self.assertEqual([row['name'] for row in rows], ['pool-a', 'pool-b'])

    def test_rows_can_be_filtered_by_backend(self):
        rows = postgres.Pool.fetch_rows_from_configmap(backend='backend-2')

        self.assertEqual([row['name'] for row in rows], ['pool-b'])

    def test_rows_can_be_filtered_by_pool_name(self):
        rows = postgres.Pool.fetch_rows_from_configmap(pools=['pool-a'])

        self.assertEqual([row['name'] for row in rows], ['pool-a'])

    def test_all_pools_disabled_without_selection_returns_nothing(self):
        rows = postgres.Pool.fetch_rows_from_configmap(all_pools=False)

        self.assertEqual(rows, [])

    def test_configured_pool_names_are_sorted(self):
        self.assertEqual(postgres.Pool.get_all_configured_pool_names(), ['pool-a', 'pool-b'])

    def test_fetch_from_configmap_inherits_workflow_timeout_defaults(self):
        pool = postgres.Pool.fetch_from_configmap('pool-a')

        self.assertEqual(pool.default_exec_timeout, '7d')
        self.assertEqual(pool.max_queue_timeout, '9d')

    def test_fetch_from_configmap_unknown_pool_raises_user_error(self):
        with self.assertRaisesRegex(osmo_errors.OSMOUserError, 'Pool missing not found'):
            postgres.Pool.fetch_from_configmap('missing')


class TestPoolPodTemplateComposition(unittest.TestCase):
    """Covers get_default_mounts, set_pod_template, calculate_pod_template,
    calculate_platforms_pod_template and set_resource_validations
    (lines 3522-3531, 3536-3551, 3555-3557, 3561-3575, 3580-3587)."""

    def setUp(self) -> None:
        self.templates: dict[str, dict] = {
            'base': {'spec': {
                'tolerations': [{'key': 'gpu', 'value': 'true'}],
                'nodeSelector': {'zone': 'a'},
                'containers': [
                    {'name': 'osmo-ctrl', 'volumeMounts': [{'mountPath': '/ctrl'}]},
                    {'name': 'user', 'volumeMounts': [{'mountPath': '/data'}, {}]},
                ],
            }},
            'override': {'spec': {'nodeSelector': {'zone': 'b'}}},
        }
        patcher = mock.patch.object(
            postgres.PodTemplate, 'list_from_db', return_value=self.templates)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_default_mounts_exclude_the_ctrl_container(self):
        pool = postgres.Pool(backend='backend-1')

        mounts = pool.get_default_mounts(self.templates['base'])

        self.assertEqual(mounts, ['/data'])

    def test_set_pod_template_populates_tolerations_labels_and_mounts(self):
        pool = postgres.Pool(backend='backend-1')
        platform = postgres.Platform(override_pod_template=['base'])

        pool.set_pod_template(platform, self.templates)

        self.assertEqual(platform.tolerations[0].key, 'gpu')
        self.assertEqual(platform.labels, {'zone': 'a'})
        self.assertEqual(platform.default_mounts, ['/data'])

    def test_set_pod_template_unknown_template_raises_usage_error(self):
        pool = postgres.Pool(backend='backend-1')
        platform = postgres.Platform(override_pod_template=['absent'])

        with self.assertRaisesRegex(osmo_errors.OSMOUsageError, 'does not exist'):
            pool.set_pod_template(platform, self.templates)

    def test_calculate_pod_template_merges_common_templates(self):
        pool = postgres.Pool(backend='backend-1', common_pod_template=['base'],
                             platforms={'gpu': postgres.Platform()})

        pool.calculate_pod_template(_connector())

        self.assertEqual(pool.parsed_pod_template['spec']['nodeSelector'], {'zone': 'a'})
        self.assertEqual(pool.platforms['gpu'].labels, {'zone': 'a'})

    def test_calculate_pod_template_unknown_common_template_raises_usage_error(self):
        pool = postgres.Pool(backend='backend-1', common_pod_template=['absent'])

        with self.assertRaisesRegex(osmo_errors.OSMOUsageError, 'does not exist'):
            pool.calculate_pod_template(_connector())

    def test_calculate_platforms_pod_template_overrides_pool_template(self):
        pool = postgres.Pool(
            backend='backend-1',
            parsed_pod_template={'spec': {'nodeSelector': {'zone': 'a'}}},
            platforms={'gpu': postgres.Platform(override_pod_template=['override'])})

        pool.calculate_platforms_pod_template(_connector(), 'gpu')

        self.assertEqual(pool.platforms['gpu'].labels, {'zone': 'b'})

    def test_set_resource_validations_appends_platform_assertions(self):
        pool_assertion = _assertion('GT', '1', '0')
        platform_assertion = _assertion('LT', '1', '2')
        pool = postgres.Pool(backend='backend-1',
                             parsed_resource_validations=[pool_assertion])
        platform = postgres.Platform(resource_validations=['gpu-check'])

        pool.set_resource_validations(platform, {'gpu-check': [platform_assertion]})

        self.assertEqual(platform.parsed_resource_validations,
                         [pool_assertion, platform_assertion])

    def test_set_resource_validations_unknown_name_raises_usage_error(self):
        pool = postgres.Pool(backend='backend-1')
        platform = postgres.Platform(resource_validations=['absent'])

        with self.assertRaisesRegex(osmo_errors.OSMOUsageError, 'does not exist'):
            pool.set_resource_validations(platform, {})


class TestUserProfile(unittest.TestCase):
    """Covers UserProfile default_profile, insert_into_db, insert_default_profile
    and fetch_from_db (lines 1695, 1706-1723, 1727-1728, 1736-1751)."""

    def setUp(self) -> None:
        patcher = mock.patch.object(postgres, 'upsert_user')
        self.upsert_user = patcher.start()
        self.addCleanup(patcher.stop)

    def test_default_profile_disables_notifications_and_clears_pool(self):
        profile = postgres.UserProfile.default_profile('alice')

        self.assertFalse(profile.email_notification)
        self.assertIsNone(profile.pool)

    def test_insert_into_db_upserts_user_and_writes_provided_settings(self):
        connector = _connector()

        postgres.UserProfile.insert_into_db(connector, 'alice',
                                            {'email_notification': True})

        self.upsert_user.assert_called_once_with(connector, 'alice')
        command, values = connector.execute_commit_command.call_args.args
        self.assertIn('INSERT INTO profile', command)
        self.assertEqual(values, ('alice', True))

    def test_insert_into_db_validates_requested_pool_against_configmap(self):
        connector = _connector()

        with mock.patch.object(postgres.Pool, 'fetch_from_configmap') as fetch:
            postgres.UserProfile.insert_into_db(connector, 'alice', {'pool': 'pool-a'})

        fetch.assert_called_once_with('pool-a')

    def test_insert_default_profile_writes_notification_defaults(self):
        connector = _connector()

        postgres.UserProfile.insert_default_profile(connector, 'alice')

        _, values = connector.execute_commit_command.call_args.args
        self.assertEqual(values, ('alice', False, False))

    def test_fetch_from_db_without_row_seeds_and_returns_default_profile(self):
        connector = _connector()

        profile = postgres.UserProfile.fetch_from_db(connector, 'alice')

        self.assertEqual(profile.username, 'alice')
        connector.execute_commit_command.assert_called_once()

    def test_fetch_from_db_fills_null_notification_columns_with_defaults(self):
        connector = _connector()
        connector.execute_fetch_command.return_value = [types.SimpleNamespace(
            user_name='alice', email_notification=None, slack_notification=None,
            pool='pool-a')]

        profile = postgres.UserProfile.fetch_from_db(connector, 'alice')

        self.assertFalse(profile.email_notification)
        self.assertEqual(profile.pool, 'pool-a')

    def test_fetch_from_db_preserves_stored_notification_preferences(self):
        connector = _connector()
        connector.execute_fetch_command.return_value = [types.SimpleNamespace(
            user_name='alice', email_notification=True, slack_notification=True,
            pool=None)]

        profile = postgres.UserProfile.fetch_from_db(connector, 'alice')

        self.assertTrue(profile.slack_notification)


class TestConnectionPoolLifecycle(unittest.TestCase):
    """Covers get_instance, _create_pool/connect, connection checkout and close
    (lines 287, 295, 313-315, 323-324, 331, 338-339, 358, 368-372, 390-395, 420,
    475-476, 487)."""

    def test_get_instance_before_construction_raises_osmo_error(self):
        with mock.patch.object(postgres.PostgresConnector, '_instance', None):
            with self.assertRaisesRegex(osmo_errors.OSMOError, 'has not been created'):
                postgres.PostgresConnector.get_instance()

    def test_constructing_a_second_connector_raises_osmo_error(self):
        config = typing.cast(postgres.PostgresConfig, types.SimpleNamespace())

        with mock.patch.object(postgres.PostgresConnector, '_instance', mock.Mock()):
            with self.assertRaisesRegex(osmo_errors.OSMOError, 'Only one instance'):
                postgres.PostgresConnector(config)

    def test_method_property_reports_configured_backend_method(self):
        connector = _pooled_connector(_FakePool([]))

        self.assertEqual(connector.method, 'dev')

    def test_connect_with_minconn_above_maxconn_raises_usage_error(self):
        connector = _pooled_connector(_FakePool([]), minconn=5, maxconn=2)

        with self.assertRaisesRegex(osmo_errors.OSMOUsageError, 'cannot be greater'):
            connector.connect()

    def test_connect_wraps_pool_creation_failure_as_connection_error(self):
        connector = _pooled_connector(_FakePool([]))

        with mock.patch.object(postgres.psycopg2.pool, 'ThreadedConnectionPool',
                               side_effect=postgres.psycopg2.DatabaseError('refused')):
            with self.assertRaisesRegex(osmo_errors.OSMOConnectionError, 'refused'):
                connector.connect()

    def test_connect_recreates_pool_even_when_the_old_pool_fails_to_close(self):
        connector = _pooled_connector(
            _FakePool([], closeall_error=RuntimeError('already gone')))

        with mock.patch.object(postgres.psycopg2.pool,
                               'ThreadedConnectionPool') as factory:
            connector.connect()

        factory.assert_called_once()

    def test_fetch_without_a_pool_raises_connection_error(self):
        connector = _pooled_connector(None)

        with self.assertRaisesRegex(osmo_errors.OSMOConnectionError, 'not initialized'):
            connector.execute_fetch_command('SELECT 1 FROM t;', ())

    def test_fetch_discards_a_closed_connection_before_querying(self):
        cursor = _FakeCursor(rows=[{'id': 1}])
        pool = _FakePool([_FakeConnection(cursor, closed=1), _FakeConnection(cursor)])
        connector = _pooled_connector(pool)

        connector.execute_fetch_command('SELECT id FROM t;', (), True)

        self.assertEqual(pool.getconn_calls, 2)
        self.assertEqual(pool.putconn_closes[0], True)

    def test_fetch_discards_a_connection_that_fails_its_health_check(self):
        unhealthy = _FakeConnection(
            _FakeCursor(healthcheck_error=postgres.psycopg2.InterfaceError('dead')))
        healthy = _FakeConnection(_FakeCursor(rows=[{'id': 2}]))
        pool = _FakePool([unhealthy, healthy])
        connector = _pooled_connector(pool)

        rows = connector.execute_fetch_command('SELECT id FROM t;', (), True)

        self.assertEqual(rows, [{'id': 2}])
        self.assertEqual(pool.getconn_calls, 2)

    def test_fetch_force_closes_a_connection_that_cannot_be_returned(self):
        cursor = _FakeCursor(rows=[{'id': 3}])
        pool = _FakePool([_FakeConnection(cursor)],
                         putconn_error=RuntimeError('pool rejected the connection'))
        connector = _pooled_connector(pool)

        rows = connector.execute_fetch_command('SELECT id FROM t;', (), True)

        self.assertEqual(rows, [{'id': 3}])
        self.assertEqual(pool.putconn_closes, [False, True])

    def test_close_swallows_shutdown_errors_and_drops_the_pool(self):
        connector = _pooled_connector(
            _FakePool([], closeall_error=RuntimeError('shutdown failed')))

        connector.close()

        with self.assertRaisesRegex(osmo_errors.OSMOConnectionError, 'not initialized'):
            connector.mogrify([('a',)])

    def test_fetch_converts_rows_to_attribute_access_objects_by_default(self):
        cursor = _FakeCursor(rows=[{'id': 7, 'name': 'alice'}])
        connector = _pooled_connector(_FakePool([_FakeConnection(cursor)]))

        rows = connector.execute_fetch_command('SELECT id, name FROM t;', ())

        self.assertEqual(rows[0].name, 'alice')


class TestExecuteCommandErrorPaths(_ConfigMapTestCase):
    """Covers the failure branches of the pooled execute helpers and mogrify
    (lines 523-532, 564-565, 567-568, 595-604, 625, 635-644, 680-681, 683-684,
    705-712, 734-737, 761)."""

    def setUp(self) -> None:
        self.install_snapshot({'roles': {'admin': {}}})

    def _connector_raising(self, error: Exception) -> typing.Any:
        cursor = _FakeCursor(error=error, close_error=RuntimeError('cursor already gone'))
        return _pooled_connector(_FakePool([_FakeConnection(cursor)]))

    def test_fetch_command_database_error_is_reported_as_database_error(self):
        connector = self._connector_raising(postgres.psycopg2.DatabaseError('deadlock'))

        with self.assertRaises(osmo_errors.OSMODatabaseError):
            connector.execute_fetch_command('SELECT 1 FROM t;', ())

    def test_fetch_command_unexpected_error_message_includes_the_command(self):
        cursor = _FakeCursor(error=ValueError('bad row'))
        connector = _pooled_connector(_FakePool([_FakeConnection(cursor)]))

        with self.assertRaisesRegex(osmo_errors.OSMODatabaseError, 'SELECT broken FROM t;'):
            connector.execute_fetch_command('SELECT broken FROM t;', ())

    def test_user_locked_fetch_database_error_is_reported_as_database_error(self):
        connector = self._connector_raising(postgres.psycopg2.DatabaseError('deadlock'))

        with self.assertRaises(osmo_errors.OSMODatabaseError):
            connector.execute_user_locked_fetch_command('alice', 'SELECT 1 FROM t;', ())

    def test_user_locked_fetch_unexpected_error_names_the_locked_command(self):
        cursor = _FakeCursor(error=ValueError('bad row'))
        connector = _pooled_connector(_FakePool([_FakeConnection(cursor)]))

        with self.assertRaisesRegex(osmo_errors.OSMODatabaseError, 'user-locked'):
            connector.execute_user_locked_fetch_command('alice', 'SELECT 1 FROM t;', ())

    def test_commit_command_database_error_is_reported_as_database_error(self):
        connector = self._connector_raising(postgres.psycopg2.InterfaceError('closed'))

        with self.assertRaises(osmo_errors.OSMODatabaseError):
            connector.execute_commit_command('UPDATE t SET a = 1;', ())

    def test_commit_command_unexpected_error_message_includes_the_command(self):
        cursor = _FakeCursor(error=ValueError('bad value'))
        connector = _pooled_connector(_FakePool([_FakeConnection(cursor)]))

        with self.assertRaisesRegex(osmo_errors.OSMODatabaseError, 'UPDATE broken SET a = 1;'):
            connector.execute_commit_command('UPDATE broken SET a = 1;', ())

    def test_commit_commands_with_no_commands_does_not_take_a_connection(self):
        pool = _FakePool([_FakeConnection(_FakeCursor())])
        connector = _pooled_connector(pool)

        connector.execute_commit_commands([])

        self.assertEqual(pool.getconn_calls, 0)

    def test_commit_commands_database_error_is_reported_as_database_error(self):
        connector = self._connector_raising(postgres.psycopg2.DatabaseError('deadlock'))

        with self.assertRaises(osmo_errors.OSMODatabaseError):
            connector.execute_commit_commands([('UPDATE t SET a = 1;', ())])

    def test_commit_commands_unexpected_error_is_wrapped_as_database_error(self):
        cursor = _FakeCursor(error=ValueError('bad value'))
        connector = _pooled_connector(_FakePool([_FakeConnection(cursor)]))

        with self.assertRaisesRegex(osmo_errors.OSMODatabaseError,
                                    'Error during executing commands'):
            connector.execute_commit_commands([('UPDATE t SET a = 1;', ())])

    def test_commit_commands_runs_every_command_on_one_connection(self):
        cursor = _FakeCursor()
        pool = _FakePool([_FakeConnection(cursor)])
        connector = _pooled_connector(pool)

        connector.execute_commit_commands([('UPDATE a SET x = 1;', ()),
                                           ('UPDATE b SET y = 2;', ())])

        self.assertEqual(pool.getconn_calls, 1)
        self.assertIn('UPDATE b SET y = 2;', cursor.statements)

    def test_assign_user_role_unknown_role_is_ignored(self):
        pool = _FakePool([_FakeConnection(_FakeCursor())])
        connector = _pooled_connector(pool)

        result = connector.assign_user_role(
            'alice', 'nonexistent', 'admin', datetime.datetime(2026, 1, 1))

        self.assertEqual(result, [])
        self.assertEqual(pool.getconn_calls, 0)

    def test_assign_user_role_database_error_is_reported_as_database_error(self):
        connector = self._connector_raising(postgres.psycopg2.DatabaseError('deadlock'))

        with self.assertRaises(osmo_errors.OSMODatabaseError):
            connector.assign_user_role(
                'alice', 'admin', 'admin', datetime.datetime(2026, 1, 1))

    def test_assign_user_role_unexpected_error_is_wrapped_as_database_error(self):
        cursor = _FakeCursor(error=ValueError('bad value'))
        connector = _pooled_connector(_FakePool([_FakeConnection(cursor)]))

        with self.assertRaisesRegex(osmo_errors.OSMODatabaseError,
                                    'Error during assigning user role'):
            connector.assign_user_role(
                'alice', 'admin', 'admin', datetime.datetime(2026, 1, 1))

    def test_remove_user_role_database_error_is_reported_as_database_error(self):
        connector = self._connector_raising(postgres.psycopg2.DatabaseError('deadlock'))

        with self.assertRaises(osmo_errors.OSMODatabaseError):
            connector.remove_user_role('alice', 'admin')

    def test_autocommit_command_database_error_is_reported_as_database_error(self):
        cursor = _FakeCursor(error=postgres.psycopg2.DatabaseError('deadlock'))
        connector = _pooled_connector(_FakePool([_FakeConnection(cursor)]))

        with self.assertRaises(osmo_errors.OSMODatabaseError):
            connector.execute_autocommit_command('VACUUM t;', ())

    def test_autocommit_command_unexpected_error_message_includes_the_command(self):
        cursor = _FakeCursor(error=ValueError('bad value'))
        connector = _pooled_connector(_FakePool([_FakeConnection(cursor)]))

        with self.assertRaisesRegex(osmo_errors.OSMODatabaseError, 'VACUUM broken;'):
            connector.execute_autocommit_command('VACUUM broken;', ())

    def test_autocommit_command_enables_and_restores_session_autocommit(self):
        connection = _FakeConnection(_FakeCursor())
        connector = _pooled_connector(_FakePool([connection]))

        connector.execute_autocommit_command('VACUUM t;', ())

        self.assertEqual(connection.autocommit_settings, [True, False])

    def test_mogrify_rejects_entries_with_differing_lengths(self):
        connector = _pooled_connector(_FakePool([_FakeConnection(_FakeCursor())]))

        with self.assertRaisesRegex(osmo_errors.OSMOSchemaError,
                                    'same number of elements'):
            connector.mogrify([('a', 'b'), ('c',)])


class TestResourceSpecTokens(unittest.TestCase):
    """Covers ResourceSpec.update, unitless conversion and get_allocatable_tokens
    (lines 1824-1826, 1847, 1875, 1878, 1903-1909, 1928-1941)."""

    def test_update_overlays_fields_from_the_other_spec(self):
        base = postgres.ResourceSpec(cpu=2, memory='8Gi')

        merged = base.update(postgres.ResourceSpec(gpu=1, memory='16Gi'))

        self.assertEqual(merged.cpu, 2)
        self.assertEqual(merged.gpu, 1)
        self.assertEqual(merged.memory, '16Gi')

    def test_unitless_memory_is_normalized_to_kibibytes(self):
        spec = postgres.ResourceSpec(memory='2048')

        self.assertEqual(spec.memory, '2.0Ki')

    def test_invalid_memory_value_raises_resource_error(self):
        with self.assertRaisesRegex(osmo_errors.OSMOResourceError, 'invalid value'):
            postgres.ResourceSpec(memory='lots')

    def test_unsupported_memory_unit_raises_resource_error(self):
        with self.assertRaisesRegex(osmo_errors.OSMOResourceError, 'invalid unit'):
            postgres.ResourceSpec(memory='5Furlongs')

    def test_storage_without_a_unit_is_tokenized_as_bytes(self):
        spec = postgres.ResourceSpec.model_construct(storage='1000')

        tokens = spec.get_allocatable_tokens({})

        self.assertEqual(tokens['USER_STORAGE_UNIT'], 'B')

    def test_unparsable_storage_yields_empty_unit_tokens(self):
        spec = postgres.ResourceSpec.model_construct(storage='not-a-size')

        tokens = spec.get_allocatable_tokens({})

        self.assertIsNone(tokens['USER_STORAGE_VAL'])
        self.assertIsNone(tokens['USER_STORAGE_UNIT'])

    def test_default_variables_are_kept_when_the_spec_leaves_them_unset(self):
        spec = postgres.ResourceSpec(storage='10Gi')

        tokens = spec.get_allocatable_tokens({'USER_CPU': 8, 'SITE': 'lab'})

        self.assertEqual(tokens['USER_CPU'], 8)
        self.assertEqual(tokens['SITE'], 'lab')

    def test_spec_values_override_matching_default_variables(self):
        spec = postgres.ResourceSpec(cpu=4, storage='10Gi')

        tokens = spec.get_allocatable_tokens({'USER_CPU': 8})

        self.assertEqual(tokens['USER_CPU'], 4.0)

    def test_percent_cache_size_is_taken_from_the_requested_storage(self):
        spec = postgres.ResourceSpec(storage='10Gi')

        tokens = spec.get_allocatable_tokens({}, task_cache_size='50%')

        self.assertEqual(tokens['USER_CACHE'], '5Gi')

    def test_cache_percent_above_one_hundred_raises_resource_error(self):
        spec = postgres.ResourceSpec(storage='10Gi')

        with self.assertRaisesRegex(osmo_errors.OSMOResourceError, 'between 0-100'):
            spec.get_allocatable_tokens({}, task_cache_size='150%')

    def test_non_numeric_cache_percent_raises_resource_error(self):
        spec = postgres.ResourceSpec(storage='10Gi')

        with self.assertRaisesRegex(osmo_errors.OSMOResourceError,
                                    'Improperly formatted cache size'):
            spec.get_allocatable_tokens({}, task_cache_size='half%')

    def test_absolute_cache_size_is_validated_and_kept(self):
        spec = postgres.ResourceSpec(storage='10Gi')

        tokens = spec.get_allocatable_tokens({}, task_cache_size='4Gi')

        self.assertEqual(tokens['USER_CACHE'], '4Gi')

    def test_cache_size_falls_back_to_the_default_variable(self):
        spec = postgres.ResourceSpec(storage='10Gi')

        tokens = spec.get_allocatable_tokens({'USER_CACHE': '20%'})

        self.assertEqual(tokens['USER_CACHE'], '2Gi')

    def test_explicit_cache_size_wins_over_the_default_variable(self):
        spec = postgres.ResourceSpec(storage='10Gi')

        tokens = spec.get_allocatable_tokens({'USER_CACHE': '20%'}, task_cache_size='50%')

        self.assertEqual(tokens['USER_CACHE'], '5Gi')

    def test_cache_size_defaults_to_ninety_percent_of_storage(self):
        spec = postgres.ResourceSpec(storage='10Gi')

        tokens = spec.get_allocatable_tokens({})

        self.assertEqual(tokens['USER_CACHE'], '9Gi')

    def test_cache_size_is_derived_from_a_default_storage_variable(self):
        spec = postgres.ResourceSpec(cpu=2)

        tokens = spec.get_allocatable_tokens({'USER_STORAGE': '20Gi'})

        self.assertEqual(tokens['USER_CACHE'], '18Gi')

    def test_unit_tokens_are_derived_from_a_default_storage_variable(self):
        spec = postgres.ResourceSpec(cpu=2)

        tokens = spec.get_allocatable_tokens({'USER_STORAGE': '20Gi'})

        self.assertEqual(tokens['USER_STORAGE_VAL'], '20')
        self.assertEqual(tokens['USER_STORAGE_UNIT'], 'Gi')
        self.assertEqual(tokens['USER_STORAGE_Mi'], 20 * 1024)

    def test_unit_tokens_are_derived_from_a_default_memory_variable(self):
        spec = postgres.ResourceSpec(cpu=2)

        tokens = spec.get_allocatable_tokens({'USER_MEMORY': '4Gi'})

        self.assertEqual(tokens['USER_MEMORY_VAL'], '4')
        self.assertEqual(tokens['USER_MEMORY_UNIT'], 'Gi')
        self.assertEqual(tokens['USER_MEMORY_Mi'], 4 * 1024)


class TestBackendResourceAccounting(_ConfigMapTestCase):
    """Covers exposed_fields verbose output, construct_updated_allocatables and
    list_from_db filtering (lines 2112-2115, 2154-2158, 2167, 2187, 2212-2213,
    2345, 2354, 2359, 2363)."""

    def test_verbose_exposed_fields_include_a_placeholder_driver_version(self):
        resource = _backend_resource()

        fields = resource.exposed_fields(verbose=True)

        self.assertEqual(fields['cuda-driver'], '-')

    def test_non_verbose_exposed_fields_omit_driver_details(self):
        resource = _backend_resource()

        fields = resource.exposed_fields()

        self.assertNotIn('cuda-driver', fields)

    def test_ctrl_cpu_requests_are_subtracted_from_allocatable_cpu(self):
        pool = _ctrl_pool({'cpu': '1', 'memory': '2Gi', 'ephemeral-storage': '4Gi'},
                          ['a100'])

        updated = postgres.BackendResource.construct_updated_allocatables(
            {'pool-1': ['a100']}, {'pool-1': pool},
            {'cpu': '8', 'memory': '16Gi', 'ephemeral-storage': '100Gi',
             'nvidia.com/gpu': '4'})

        self.assertEqual(updated['pool-1']['a100']['cpu'], 7)

    def test_ctrl_memory_requests_are_subtracted_in_kibibytes(self):
        pool = _ctrl_pool({'cpu': '1', 'memory': '2Gi', 'ephemeral-storage': '4Gi'},
                          ['a100'])

        updated = postgres.BackendResource.construct_updated_allocatables(
            {'pool-1': ['a100']}, {'pool-1': pool},
            {'cpu': '8', 'memory': '16Gi', 'ephemeral-storage': '100Gi'})

        self.assertEqual(updated['pool-1']['a100']['memory'], '14680064Ki')

    def test_non_workflow_gpu_usage_is_subtracted_from_allocatable_gpus(self):
        pool = _ctrl_pool({'cpu': '0', 'memory': '0', 'ephemeral-storage': '0'},
                          ['a100'])

        updated = postgres.BackendResource.construct_updated_allocatables(
            {'pool-1': ['a100']}, {'pool-1': pool},
            {'cpu': '8', 'memory': '16Gi', 'ephemeral-storage': '100Gi',
             'nvidia.com/gpu': '4'},
            {'cpu': '0', 'memory': '0', 'ephemeral-storage': '0',
             'nvidia.com/gpu': '1'})

        self.assertEqual(updated['pool-1']['a100']['nvidia.com/gpu'], 3)

    def test_every_platform_of_a_pool_gets_its_own_accounting_entry(self):
        pool = _ctrl_pool({'cpu': '1', 'memory': '2Gi', 'ephemeral-storage': '4Gi'},
                          ['a100', 'h100'])

        updated = postgres.BackendResource.construct_updated_allocatables(
            {'pool-1': ['a100', 'h100']}, {'pool-1': pool},
            {'cpu': '8', 'memory': '16Gi', 'ephemeral-storage': '100Gi'})

        self.assertEqual(sorted(updated['pool-1']), ['a100', 'h100'])

    def test_platform_absent_from_the_pool_config_is_skipped(self):
        pool = _ctrl_pool({'cpu': '1', 'memory': '2Gi', 'ephemeral-storage': '4Gi'},
                          ['a100'])

        updated = postgres.BackendResource.construct_updated_allocatables(
            {'pool-1': ['retired']}, {'pool-1': pool},
            {'cpu': '8', 'memory': '16Gi', 'ephemeral-storage': '100Gi'})

        self.assertEqual(updated, {})

    def test_list_from_db_with_no_configured_backend_match_returns_nothing(self):
        self.install_snapshot({'backends': {'backend-1': {}}, 'pools': {}})

        resources = postgres.BackendResource.list_from_db(backends=['backend-9'])

        self.assertEqual(resources, [])

    def test_list_from_db_skips_pool_entries_that_are_not_mappings(self):
        self.install_snapshot({'backends': {'backend-1': {}},
                               'pools': {'pool-1': 'not-a-mapping'}})

        resources = postgres.BackendResource.list_from_db(pools=['pool-1'])

        self.assertEqual(resources, [])

    def test_list_from_db_skips_pools_owned_by_unselected_backends(self):
        self.install_snapshot({
            'backends': {'backend-1': {}},
            'pools': {'pool-1': {'backend': 'backend-2', 'platforms': {'a100': {}}}}})

        resources = postgres.BackendResource.list_from_db(
            backends=['backend-1'], pools=['pool-1'])

        self.assertEqual(resources, [])

    def test_list_from_db_skips_platforms_outside_the_requested_set(self):
        self.install_snapshot({
            'backends': {'backend-1': {}},
            'pools': {'pool-1': {'backend': 'backend-1', 'platforms': {'a100': {}}}}})

        resources = postgres.BackendResource.list_from_db(
            backends=['backend-1'], pools=['pool-1'], platforms=['h100'])

        self.assertEqual(resources, [])


class TestBackendSnapshotReads(_ConfigMapTestCase):
    """Covers Backend.fetch_from_db and list_from_db (lines 2549, 2619-2620)."""

    def test_fetch_from_db_unknown_backend_raises_backend_error(self):
        self.install_snapshot({'backends': {}})

        with self.assertRaisesRegex(osmo_errors.OSMOBackendError, 'is not found'):
            postgres.Backend.fetch_from_db(_connector(), 'backend-9')

    def test_list_from_db_skips_backends_with_invalid_configuration(self):
        self.install_snapshot({'backends': {
            'good': {},
            'broken': {'scheduler_settings': {'scheduler_timeout': 'soon'}},
        }})

        backends = postgres.Backend.list_from_db(_connector())

        self.assertEqual([backend.name for backend in backends], ['good'])


if __name__ == '__main__':
    unittest.main()
