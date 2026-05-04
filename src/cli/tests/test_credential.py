"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import argparse
import json
import os
import tempfile
import unittest
from unittest import mock

import pydantic
import yaml

from src.cli import credential
from src.lib.utils import client, credentials, osmo_errors


def _make_static_data_credential(
    endpoint: str = 's3://test-bucket',
    access_key_id: str = 'key-id',
    access_key: str = 'secret',
    region: str | None = None,
    override_url: str | None = None,
) -> credentials.StaticDataCredential:
    return credentials.StaticDataCredential(
        endpoint=endpoint,
        access_key_id=access_key_id,
        access_key=pydantic.SecretStr(access_key),
        region=region,
        override_url=override_url,
    )


class TestSaveConfig(unittest.TestCase):
    """Test cases for the _save_config helper."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        patcher = mock.patch(
            'src.cli.credential.client_configs.get_client_config_dir',
            return_value=self.tmp_dir,
        )
        self.mock_get_dir = patcher.start()
        self.addCleanup(patcher.stop)

    def test_save_config_creates_new_file(self):
        """Test that _save_config creates a new config file when none exists."""
        data_cred = _make_static_data_credential(region='us-east-1')

        credential._save_config(data_cred)

        config_path = os.path.join(self.tmp_dir, 'config.yaml')
        self.assertTrue(os.path.exists(config_path))
        with open(config_path, 'r', encoding='utf-8') as file:
            config = yaml.safe_load(file.read())
        self.assertEqual(
            config['auth']['data']['s3://test-bucket'],
            {
                'access_key_id': 'key-id',
                'access_key': 'secret',
                'region': 'us-east-1',
            },
        )

    def test_save_config_with_override_url(self):
        """Test that _save_config persists override_url when set."""
        data_cred = _make_static_data_credential(override_url='http://minio:9000')

        credential._save_config(data_cred)

        config_path = os.path.join(self.tmp_dir, 'config.yaml')
        with open(config_path, 'r', encoding='utf-8') as file:
            config = yaml.safe_load(file.read())
        self.assertEqual(
            config['auth']['data']['s3://test-bucket']['override_url'],
            'http://minio:9000',
        )

    def test_save_config_appends_to_existing_file(self):
        """Test that _save_config merges new entries into an existing config file."""
        config_path = os.path.join(self.tmp_dir, 'config.yaml')
        with open(config_path, 'w', encoding='utf-8') as file:
            yaml.dump(
                {'auth': {'data': {'s3://other': {'access_key_id': 'other'}}}},
                file,
            )

        data_cred = _make_static_data_credential()
        credential._save_config(data_cred)

        with open(config_path, 'r', encoding='utf-8') as file:
            config = yaml.safe_load(file.read())
        self.assertIn('s3://other', config['auth']['data'])
        self.assertIn('s3://test-bucket', config['auth']['data'])


class TestDeleteConfig(unittest.TestCase):
    """Test cases for the _delete_config helper."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        patcher = mock.patch(
            'src.cli.credential.client_configs.get_client_config_dir',
            return_value=self.tmp_dir,
        )
        self.mock_get_dir = patcher.start()
        self.addCleanup(patcher.stop)

    def test_delete_config_no_file(self):
        """Test that _delete_config returns silently when no config file exists."""
        credential._delete_config('s3://no-file')

        self.assertFalse(os.path.exists(os.path.join(self.tmp_dir, 'config.yaml')))

    def test_delete_config_removes_endpoint(self):
        """Test that _delete_config removes the credential entry for an endpoint."""
        config_path = os.path.join(self.tmp_dir, 'config.yaml')
        with open(config_path, 'w', encoding='utf-8') as file:
            yaml.dump(
                {
                    'auth': {
                        'data': {
                            's3://remove-me': {'access_key_id': 'x'},
                            's3://keep-me': {'access_key_id': 'y'},
                        }
                    }
                },
                file,
            )

        credential._delete_config('s3://remove-me')

        with open(config_path, 'r', encoding='utf-8') as file:
            config = yaml.safe_load(file.read())
        self.assertNotIn('s3://remove-me', config['auth']['data'])
        self.assertIn('s3://keep-me', config['auth']['data'])


class TestCredNameRegex(unittest.TestCase):
    """Test cases for the cred_name_regex validator."""

    def test_valid_name(self):
        """Test that a valid credential name is returned as-is."""
        self.assertEqual(credential.cred_name_regex('my_cred-1'), 'my_cred-1')

    def test_invalid_name_starts_with_digit(self):
        """Test that names starting with a digit are rejected."""
        with self.assertRaises(argparse.ArgumentTypeError):
            credential.cred_name_regex('1bad_name')

    def test_invalid_name_special_chars(self):
        """Test that names with disallowed special characters are rejected."""
        with self.assertRaises(argparse.ArgumentTypeError):
            credential.cred_name_regex('bad name!')


class TestRunSetCommand(unittest.TestCase):
    """Test cases for the _run_set_command function."""

    def _args(self, **overrides) -> argparse.Namespace:
        defaults = {
            'name': 'mycred',
            'type': 'GENERIC',
            'payload': ['key=value'],
            'payload_file': None,
            'format_type': 'text',
        }
        defaults.update(overrides)
        return argparse.Namespace(**defaults)

    def test_invalid_payload_format_no_equals(self):
        """Test that a payload item without '=' triggers SystemExit."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._args(payload=['badpair'])

        with mock.patch('builtins.print'):
            with self.assertRaises(SystemExit):
                credential._run_set_command(service_client, args)

    def test_invalid_payload_empty_value(self):
        """Test that a payload item with an empty value triggers SystemExit."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._args(payload=['key='])

        with mock.patch('builtins.print'):
            with self.assertRaises(SystemExit):
                credential._run_set_command(service_client, args)

    def test_invalid_payload_empty_key(self):
        """Test that a payload item with an empty key triggers SystemExit."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._args(payload=['=value'])

        with mock.patch('builtins.print'):
            with self.assertRaises(SystemExit):
                credential._run_set_command(service_client, args)

    def test_payload_file_missing_file_exits(self):
        """Test that a missing payload file exits the process."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._args(
            payload=None,
            payload_file=['key=/nonexistent/path/to/file.txt'],
        )

        with mock.patch('builtins.print'):
            with self.assertRaises(SystemExit):
                credential._run_set_command(service_client, args)

    def test_payload_file_reads_contents(self):
        """Test that payload-file mode reads each file into the credential payload."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'status': 'ok'}

        with tempfile.NamedTemporaryFile('w', delete=False, encoding='utf-8') as temp:
            temp.write('file-contents')
            temp_path = temp.name
        self.addCleanup(os.unlink, temp_path)

        args = self._args(
            type='REGISTRY',
            payload=None,
            payload_file=[f'auth={temp_path}'],
        )

        with mock.patch('builtins.print'):
            credential._run_set_command(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/credentials/mycred',
            payload={'registry_credential': {'auth': 'file-contents'}},
        )

    def test_generic_wraps_in_credential_key(self):
        """Test that GENERIC type wraps payload into a nested 'credential' dict."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'status': 'ok'}
        args = self._args(type='GENERIC', payload=['user=bob', 'pass=secret'])

        with mock.patch('builtins.print'):
            credential._run_set_command(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/credentials/mycred',
            payload={'generic_credential': {
                'credential': {'user': 'bob', 'pass': 'secret'},
            }},
        )

    def test_registry_sends_payload_directly(self):
        """Test that REGISTRY type sends the payload keys unwrapped."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'status': 'ok'}
        args = self._args(
            type='REGISTRY',
            payload=['auth=xxxx', 'username=alice', 'registry=docker.io'],
        )

        with mock.patch('builtins.print'):
            credential._run_set_command(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.POST,
            'api/credentials/mycred',
            payload={'registry_credential': {
                'auth': 'xxxx',
                'username': 'alice',
                'registry': 'docker.io',
            }},
        )

    def test_data_credential_invalid_raises_osmo_user_error(self):
        """Test that invalid DATA payloads raise OSMOUserError."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = self._args(type='DATA', payload=['access_key_id=x', 'access_key=y'])

        with mock.patch('builtins.print'):
            with self.assertRaises(osmo_errors.OSMOUserError):
                credential._run_set_command(service_client, args)

    def test_data_credential_success_saves_config(self):
        """Test that a valid DATA credential is posted and saved locally."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'status': 'ok'}
        args = self._args(
            type='DATA',
            payload=[
                'access_key_id=ak',
                'access_key=sk',
                'endpoint=s3://bucket',
            ],
        )

        with mock.patch('builtins.print'), \
                mock.patch('src.cli.credential._save_config') as mock_save:
            credential._run_set_command(service_client, args)

        service_client.request.assert_called_once()
        mock_save.assert_called_once()
        saved_cred = mock_save.call_args[0][0]
        self.assertEqual(saved_cred.access_key_id, 'ak')
        self.assertEqual(saved_cred.endpoint, 's3://bucket')

    def test_set_command_json_output(self):
        """Test that json format prints the server response serialized."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'id': 'abc'}
        args = self._args(format_type='json')

        with mock.patch('builtins.print') as mock_print:
            credential._run_set_command(service_client, args)

        printed = mock_print.call_args[0][0]
        self.assertEqual(json.loads(printed), {'id': 'abc'})

    def test_set_command_text_output(self):
        """Test that text format prints a human-readable confirmation."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'id': 'abc'}
        args = self._args(format_type='text', type='REGISTRY',
                          payload=['auth=pw'])

        with mock.patch('builtins.print') as mock_print:
            credential._run_set_command(service_client, args)

        output = ' '.join(
            str(arg) for call in mock_print.call_args_list for arg in call.args
        )
        self.assertIn('Set REGISTRY credential mycred', output)


class TestRunListCommand(unittest.TestCase):
    """Test cases for the _run_list_command function."""

    def test_list_json_format(self):
        """Test that json format serializes the API response directly."""
        service_client = mock.Mock(spec=client.ServiceClient)
        payload = {'credentials': [
            {'cred_name': 'c1', 'cred_type': 'REGISTRY', 'profile': 'p1'},
        ]}
        service_client.request.return_value = payload
        args = argparse.Namespace(format_type='json')

        with mock.patch('builtins.print') as mock_print:
            credential._run_list_command(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.GET, 'api/credentials'
        )
        printed = mock_print.call_args[0][0]
        self.assertEqual(json.loads(printed), payload)

    def test_list_text_format_registry_cred(self):
        """Test that non-DATA credentials show 'N/A' for local availability."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'credentials': [
            {'cred_name': 'reg1', 'cred_type': 'REGISTRY', 'profile': 'docker.io'},
        ]}
        args = argparse.Namespace(format_type='text')

        with mock.patch('builtins.print') as mock_print:
            credential._run_list_command(service_client, args)

        output = ' '.join(
            str(arg) for call in mock_print.call_args_list for arg in call.args
        )
        self.assertIn('reg1', output)
        self.assertIn('REGISTRY', output)
        self.assertIn('N/A', output)

    def test_list_text_format_data_cred_local_yes(self):
        """Test that 'Yes' is shown when a matching local DATA credential exists."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'credentials': [
            {'cred_name': 'd1', 'cred_type': 'DATA', 'profile': 's3://b'},
        ]}
        args = argparse.Namespace(format_type='text')

        with mock.patch('builtins.print') as mock_print, \
                mock.patch(
                    'src.cli.credential.credentials.'
                    'get_static_data_credential_from_config',
                    return_value=_make_static_data_credential(),
                ):
            credential._run_list_command(service_client, args)

        output = ' '.join(
            str(arg) for call in mock_print.call_args_list for arg in call.args
        )
        self.assertIn('Yes', output)

    def test_list_text_format_data_cred_local_no(self):
        """Test that 'No' is shown when no local DATA credential exists."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'credentials': [
            {'cred_name': 'd1', 'cred_type': 'DATA', 'profile': 's3://b'},
        ]}
        args = argparse.Namespace(format_type='text')

        with mock.patch('builtins.print') as mock_print, \
                mock.patch(
                    'src.cli.credential.credentials.'
                    'get_static_data_credential_from_config',
                    return_value=None,
                ):
            credential._run_list_command(service_client, args)

        output = ' '.join(
            str(arg) for call in mock_print.call_args_list for arg in call.args
        )
        self.assertIn('No', output)


class TestRunDeleteCommand(unittest.TestCase):
    """Test cases for the _run_delete_command function."""

    def test_delete_non_data_cred(self):
        """Test that deleting a non-DATA credential skips local config cleanup."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'credentials': [
            {'cred_type': 'REGISTRY', 'profile': 'docker.io'},
        ]}
        args = argparse.Namespace(name='regcred')

        with mock.patch('builtins.print'), \
                mock.patch('src.cli.credential._delete_config') as mock_delete:
            credential._run_delete_command(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.DELETE, 'api/credentials/regcred'
        )
        mock_delete.assert_not_called()

    def test_delete_data_cred_cleans_local_config(self):
        """Test that deleting a DATA credential also clears the local config."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {'credentials': [
            {'cred_type': 'DATA', 'profile': 's3://bucket'},
        ]}
        args = argparse.Namespace(name='datacred')

        with mock.patch('builtins.print'), \
                mock.patch('src.cli.credential._delete_config') as mock_delete:
            credential._run_delete_command(service_client, args)

        mock_delete.assert_called_once_with('s3://bucket')


class TestSetupParser(unittest.TestCase):
    """Test cases for the credential setup_parser function."""

    def _build_parser(self) -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        credential.setup_parser(subparsers)
        return parser

    def test_set_command_parses(self):
        """Test that 'set' subcommand parses and sets defaults correctly."""
        parser = self._build_parser()
        args = parser.parse_args([
            'credential', 'set', 'my-cred', '--payload', 'auth=xxx',
        ])
        self.assertEqual(args.command, 'set')
        self.assertEqual(args.name, 'my-cred')
        self.assertEqual(args.type, 'GENERIC')
        self.assertEqual(args.payload, ['auth=xxx'])
        self.assertEqual(args.func, credential._run_set_command)

    def test_set_command_type_choice(self):
        """Test that --type accepts the documented choices."""
        parser = self._build_parser()
        args = parser.parse_args([
            'credential', 'set', 'mycred', '--type', 'DATA',
            '--payload', 'access_key_id=x',
        ])
        self.assertEqual(args.type, 'DATA')

    def test_set_command_invalid_name_rejected(self):
        """Test that invalid credential names trigger SystemExit."""
        parser = self._build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args([
                'credential', 'set', '1bad', '--payload', 'a=b',
            ])

    def test_set_command_requires_payload(self):
        """Test that 'set' without --payload or --payload-file exits."""
        parser = self._build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args(['credential', 'set', 'mycred'])

    def test_set_command_payload_file(self):
        """Test that --payload-file is parsed into the payload_file attribute."""
        parser = self._build_parser()
        args = parser.parse_args([
            'credential', 'set', 'mycred',
            '--payload-file', 'auth=/tmp/secret',
        ])
        self.assertEqual(args.payload_file, ['auth=/tmp/secret'])

    def test_set_command_payload_and_payload_file_mutex(self):
        """Test that --payload and --payload-file are mutually exclusive."""
        parser = self._build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args([
                'credential', 'set', 'mycred',
                '--payload', 'a=b',
                '--payload-file', 'a=/tmp/x',
            ])

    def test_list_command_parses(self):
        """Test that 'list' subcommand parses and wires up the handler."""
        parser = self._build_parser()
        args = parser.parse_args(['credential', 'list'])
        self.assertEqual(args.command, 'list')
        self.assertEqual(args.func, credential._run_list_command)

    def test_delete_command_parses(self):
        """Test that 'delete' subcommand parses name and handler."""
        parser = self._build_parser()
        args = parser.parse_args(['credential', 'delete', 'cred_x'])
        self.assertEqual(args.command, 'delete')
        self.assertEqual(args.name, 'cred_x')
        self.assertEqual(args.func, credential._run_delete_command)

    def test_format_type_default_and_choice(self):
        """Test --format-type default text and valid choice json."""
        parser = self._build_parser()
        args = parser.parse_args(['credential', 'list'])
        self.assertEqual(args.format_type, 'text')

        args = parser.parse_args([
            'credential', '--format-type', 'json', 'list',
        ])
        self.assertEqual(args.format_type, 'json')

    def test_subcommand_required(self):
        """Test that omitting the credential subcommand exits."""
        parser = self._build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args(['credential'])


if __name__ == '__main__':
    unittest.main()
