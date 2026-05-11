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
import os
import tempfile
import unittest

from src.lib.utils import osmo_errors, validation


class TestPositiveInteger(unittest.TestCase):
    """Tests for validation.positive_integer."""

    def test_positive_integer_with_positive_value_returns_int(self):
        self.assertEqual(validation.positive_integer(5), 5)

    def test_positive_integer_with_zero_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_integer(0)

    def test_positive_integer_with_negative_value_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_integer(-1)

    def test_positive_integer_with_non_integer_string_raises_value_error(self):
        with self.assertRaises(ValueError):
            validation.positive_integer('abc')  # type: ignore[arg-type]


class TestPositiveFloat(unittest.TestCase):
    """Tests for validation.positive_float."""

    def test_positive_float_with_positive_value_returns_float(self):
        self.assertEqual(validation.positive_float(2.5), 2.5)

    def test_positive_float_with_zero_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_float(0)

    def test_positive_float_with_negative_value_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_float(-0.01)

    def test_positive_float_with_invalid_string_raises_value_error(self):
        with self.assertRaises(ValueError):
            validation.positive_float('not-a-number')  # type: ignore[arg-type]


class TestNonNegativeInteger(unittest.TestCase):
    """Tests for validation.non_negative_integer."""

    def test_non_negative_integer_with_zero_returns_zero(self):
        self.assertEqual(validation.non_negative_integer(0), 0)

    def test_non_negative_integer_with_positive_value_returns_int(self):
        self.assertEqual(validation.non_negative_integer(7), 7)

    def test_non_negative_integer_with_negative_value_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.non_negative_integer(-1)

    def test_non_negative_integer_with_invalid_string_raises_value_error(self):
        with self.assertRaises(ValueError):
            validation.non_negative_integer('xyz')  # type: ignore[arg-type]


class TestIsRegex(unittest.TestCase):
    """Tests for validation.is_regex."""

    def test_is_regex_with_valid_pattern_returns_pattern(self):
        self.assertEqual(validation.is_regex(r'^abc$'), r'^abc$')

    def test_is_regex_with_empty_pattern_returns_empty(self):
        self.assertEqual(validation.is_regex(''), '')

    def test_is_regex_with_invalid_pattern_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_regex('[unclosed')


class TestIsBucket(unittest.TestCase):
    """Tests for validation.is_bucket."""

    def test_is_bucket_with_alphanumeric_returns_bucket(self):
        self.assertEqual(validation.is_bucket('my-bucket_123'), 'my-bucket_123')

    def test_is_bucket_with_slash_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_bucket('bucket/with/slash')

    def test_is_bucket_with_empty_string_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_bucket('')


class TestIsStoragePath(unittest.TestCase):
    """Tests for validation.is_storage_path."""

    def test_is_storage_path_with_valid_s3_returns_path(self):
        self.assertEqual(validation.is_storage_path('s3://bucket/key'), 's3://bucket/key')

    def test_is_storage_path_with_valid_swift_returns_path(self):
        self.assertEqual(
            validation.is_storage_path('swift://account/container/obj'),
            'swift://account/container/obj',
        )

    def test_is_storage_path_with_invalid_scheme_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_path('http://example.com/path')

    def test_is_storage_path_with_empty_string_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_path('')


class TestIsStorageCredentialPath(unittest.TestCase):
    """Tests for validation.is_storage_credential_path."""

    def test_is_storage_credential_path_with_s3_profile_returns_path(self):
        self.assertEqual(
            validation.is_storage_credential_path('s3://bucket'),
            's3://bucket',
        )

    def test_is_storage_credential_path_with_invalid_scheme_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_credential_path('ftp://host/path')


class TestValidPath(unittest.TestCase):
    """Tests for validation.valid_path."""

    def test_valid_path_with_existing_file_returns_absolute_path(self):
        with tempfile.NamedTemporaryFile() as temp_file:
            result = validation.valid_path(temp_file.name)
            self.assertEqual(result, os.path.abspath(temp_file.name))

    def test_valid_path_with_existing_directory_returns_absolute_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            result = validation.valid_path(temp_dir)
            self.assertEqual(result, os.path.abspath(temp_dir))

    def test_valid_path_with_nonexistent_path_raises_osmo_user_error(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            validation.valid_path('/nonexistent/path/that/does/not/exist/xyz123')


class TestValidFilePath(unittest.TestCase):
    """Tests for validation.valid_file_path."""

    def test_valid_file_path_with_nonexistent_path_returns_path(self):
        path = '/tmp/nonexistent_testbot_file_xyz_12345.txt'
        self.assertEqual(validation.valid_file_path(path), path)

    def test_valid_file_path_with_existing_directory_raises_argument_type_error(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(argparse.ArgumentTypeError):
                validation.valid_file_path(temp_dir)

    def test_valid_file_path_with_existing_file_raises_argument_type_error(self):
        with tempfile.NamedTemporaryFile() as temp_file:
            with self.assertRaises(argparse.ArgumentTypeError):
                validation.valid_file_path(temp_file.name)


class TestDateStr(unittest.TestCase):
    """Tests for validation.date_str."""

    def test_date_str_with_valid_format_returns_date(self):
        self.assertEqual(validation.date_str('2026-05-11'), '2026-05-11')

    def test_date_str_with_invalid_format_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_str('05/11/2026')

    def test_date_str_with_datetime_format_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_str('2026-05-11T12:00:00')


class TestDatetimeStr(unittest.TestCase):
    """Tests for validation.datetime_str."""

    def test_datetime_str_with_valid_format_returns_datetime(self):
        self.assertEqual(
            validation.datetime_str('2026-05-11T12:34:56'),
            '2026-05-11T12:34:56',
        )

    def test_datetime_str_with_date_only_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.datetime_str('2026-05-11')


class TestDateOrDatetimeStr(unittest.TestCase):
    """Tests for validation.date_or_datetime_str."""

    def test_date_or_datetime_str_with_date_returns_date(self):
        self.assertEqual(validation.date_or_datetime_str('2026-05-11'), '2026-05-11')

    def test_date_or_datetime_str_with_datetime_returns_datetime(self):
        self.assertEqual(
            validation.date_or_datetime_str('2026-05-11T12:34:56'),
            '2026-05-11T12:34:56',
        )

    def test_date_or_datetime_str_with_invalid_raises_argument_type_error(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_or_datetime_str('not-a-date')


class TestSanitizedPath(unittest.TestCase):
    """Tests for validation.sanitized_path."""

    def test_sanitized_path_with_empty_string_returns_none(self):
        self.assertIsNone(validation.sanitized_path(''))

    def test_sanitized_path_with_double_slashes_returns_normalized(self):
        self.assertEqual(validation.sanitized_path('/foo//bar'), '/foo/bar')

    def test_sanitized_path_with_leading_dotdot_returns_none(self):
        self.assertIsNone(validation.sanitized_path('../foo'))

    def test_sanitized_path_with_simple_path_returns_normalized(self):
        self.assertEqual(validation.sanitized_path('/foo/bar'), '/foo/bar')


if __name__ == '__main__':
    unittest.main()
