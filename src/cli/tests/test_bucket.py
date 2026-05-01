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
import unittest
from unittest import mock

from src.cli import bucket
from src.lib.utils import client


class TestSetupParser(unittest.TestCase):
    """Test cases for the setup_parser function."""

    def test_setup_parser_list_command_default_format(self):
        """Test that list subcommand parses with default format type 'text'."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        bucket.setup_parser(subparsers)

        args = parser.parse_args(['bucket', 'list'])
        self.assertEqual(args.command, 'list')
        self.assertEqual(args.format_type, 'text')

    def test_setup_parser_list_command_json_format(self):
        """Test that list subcommand parses --format-type json."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        bucket.setup_parser(subparsers)

        args = parser.parse_args(['bucket', 'list', '--format-type', 'json'])
        self.assertEqual(args.format_type, 'json')

    def test_setup_parser_list_command_short_format_flag(self):
        """Test that list subcommand parses short -t flag."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        bucket.setup_parser(subparsers)

        args = parser.parse_args(['bucket', 'list', '-t', 'json'])
        self.assertEqual(args.format_type, 'json')

    def test_setup_parser_list_sets_func(self):
        """Test that list subcommand sets the func default to _list_bucket."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        bucket.setup_parser(subparsers)

        args = parser.parse_args(['bucket', 'list'])
        self.assertEqual(args.func, bucket._list_bucket)

    def test_setup_parser_rejects_invalid_format_type(self):
        """Test that invalid format type choice raises SystemExit."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        bucket.setup_parser(subparsers)

        with self.assertRaises(SystemExit):
            parser.parse_args(['bucket', 'list', '-t', 'xml'])

    def test_setup_parser_requires_subcommand(self):
        """Test that omitting the subcommand raises SystemExit."""
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()

        bucket.setup_parser(subparsers)

        with self.assertRaises(SystemExit):
            parser.parse_args(['bucket'])


class TestListBucket(unittest.TestCase):
    """Test cases for the _list_bucket function."""

    def test_list_bucket_json_format(self):
        """Test that json format prints JSON-serialized response."""
        service_client = mock.Mock(spec=client.ServiceClient)
        bucket_info = {
            'default': 'bucket-a',
            'buckets': {
                'bucket-a': {
                    'path': 's3://bucket-a',
                    'description': 'Primary bucket',
                    'mode': 'rw',
                    'default_cred': True,
                }
            }
        }
        service_client.request.return_value = bucket_info
        args = argparse.Namespace(format_type='json')

        with mock.patch('builtins.print') as mock_print:
            bucket._list_bucket(service_client, args)

        service_client.request.assert_called_once_with(
            client.RequestMethod.GET, 'api/bucket'
        )
        mock_print.assert_called_once()
        printed_output = mock_print.call_args[0][0]
        parsed = json.loads(printed_output)
        self.assertEqual(parsed, bucket_info)

    def test_list_bucket_text_format_marks_default_bucket(self):
        """Test that text format annotates the default bucket with '(default)'."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'default': 'primary',
            'buckets': {
                'primary': {
                    'path': 's3://primary-path',
                    'description': 'Primary bucket',
                    'mode': 'rw',
                    'default_cred': True,
                },
                'secondary': {
                    'path': 's3://secondary-path',
                    'description': 'Secondary bucket',
                    'mode': 'ro',
                    'default_cred': False,
                },
            }
        }
        args = argparse.Namespace(format_type='text')

        with mock.patch('builtins.print') as mock_print:
            bucket._list_bucket(service_client, args)

        output = ' '.join(
            str(arg)
            for call in mock_print.call_args_list
            for arg in call.args
        )
        self.assertIn('primary (default)', output)
        self.assertIn('secondary', output)
        self.assertIn('s3://primary-path', output)
        self.assertIn('s3://secondary-path', output)
        self.assertIn('Primary bucket', output)
        self.assertIn('Secondary bucket', output)

    def test_list_bucket_text_format_default_cred_yes(self):
        """Test that 'Yes' is rendered when default_cred is True."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'default': 'only-bucket',
            'buckets': {
                'only-bucket': {
                    'path': 's3://only',
                    'description': 'Only bucket',
                    'mode': 'rw',
                    'default_cred': True,
                }
            }
        }
        args = argparse.Namespace(format_type='text')

        with mock.patch('builtins.print') as mock_print:
            bucket._list_bucket(service_client, args)

        output = ' '.join(
            str(arg)
            for call in mock_print.call_args_list
            for arg in call.args
        )
        self.assertIn('Yes', output)

    def test_list_bucket_text_format_default_cred_missing(self):
        """Test that 'No' is rendered when default_cred key is absent."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'default': 'only-bucket',
            'buckets': {
                'only-bucket': {
                    'path': 's3://only',
                    'description': 'Only bucket',
                    'mode': 'rw',
                }
            }
        }
        args = argparse.Namespace(format_type='text')

        with mock.patch('builtins.print') as mock_print:
            bucket._list_bucket(service_client, args)

        output = ' '.join(
            str(arg)
            for call in mock_print.call_args_list
            for arg in call.args
        )
        self.assertIn('No', output)

    def test_list_bucket_text_format_without_default(self):
        """Test that no bucket is annotated when the default is empty."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'default': '',
            'buckets': {
                'bucket-one': {
                    'path': 's3://one',
                    'description': 'First bucket',
                    'mode': 'rw',
                    'default_cred': False,
                }
            }
        }
        args = argparse.Namespace(format_type='text')

        with mock.patch('builtins.print') as mock_print:
            bucket._list_bucket(service_client, args)

        output = ' '.join(
            str(arg)
            for call in mock_print.call_args_list
            for arg in call.args
        )
        self.assertIn('bucket-one', output)
        self.assertNotIn('(default)', output)

    def test_list_bucket_text_format_empty_buckets(self):
        """Test that only the header row is printed when no buckets exist."""
        service_client = mock.Mock(spec=client.ServiceClient)
        service_client.request.return_value = {
            'default': '',
            'buckets': {}
        }
        args = argparse.Namespace(format_type='text')

        with mock.patch('builtins.print') as mock_print:
            bucket._list_bucket(service_client, args)

        output = ' '.join(
            str(arg)
            for call in mock_print.call_args_list
            for arg in call.args
        )
        self.assertIn('Bucket', output)
        self.assertIn('Description', output)
        self.assertIn('Location', output)
        self.assertIn('Mode', output)
        self.assertIn('Default Cred', output)


if __name__ == '__main__':
    unittest.main()
