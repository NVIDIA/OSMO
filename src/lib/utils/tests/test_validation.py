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

    def test_positive_integer_accepts_positive_int(self):
        self.assertEqual(validation.positive_integer(5), 5)

    def test_positive_integer_rejects_zero(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_integer(0)

    def test_positive_integer_rejects_negative(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_integer(-1)


class TestPositiveFloat(unittest.TestCase):
    """Tests for validation.positive_float."""

    def test_positive_float_accepts_positive_float(self):
        self.assertEqual(validation.positive_float(1.5), 1.5)

    def test_positive_float_rejects_zero(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_float(0.0)

    def test_positive_float_rejects_negative(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_float(-0.1)


class TestNonNegativeInteger(unittest.TestCase):
    """Tests for validation.non_negative_integer."""

    def test_non_negative_integer_accepts_zero(self):
        self.assertEqual(validation.non_negative_integer(0), 0)

    def test_non_negative_integer_accepts_positive(self):
        self.assertEqual(validation.non_negative_integer(10), 10)

    def test_non_negative_integer_rejects_negative(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.non_negative_integer(-1)


class TestIsRegex(unittest.TestCase):
    """Tests for validation.is_regex."""

    def test_is_regex_returns_valid_pattern(self):
        self.assertEqual(validation.is_regex(r'^\d+$'), r'^\d+$')

    def test_is_regex_accepts_empty_string(self):
        self.assertEqual(validation.is_regex(''), '')

    def test_is_regex_rejects_invalid_pattern(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_regex('[invalid')


class TestIsBucket(unittest.TestCase):
    """Tests for validation.is_bucket."""

    def test_is_bucket_accepts_alphanumeric(self):
        self.assertEqual(validation.is_bucket('my-bucket_1'), 'my-bucket_1')

    def test_is_bucket_rejects_with_slash(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_bucket('bucket/path')

    def test_is_bucket_rejects_empty(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_bucket('')

    def test_is_bucket_rejects_space(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_bucket('bad bucket')


class TestIsStoragePath(unittest.TestCase):
    """Tests for validation.is_storage_path."""

    def test_is_storage_path_accepts_s3(self):
        self.assertEqual(validation.is_storage_path('s3://bucket'), 's3://bucket')

    def test_is_storage_path_accepts_swift(self):
        path = 'swift://account/container/object'
        self.assertEqual(validation.is_storage_path(path), path)

    def test_is_storage_path_accepts_gs(self):
        self.assertEqual(validation.is_storage_path('gs://bucket'), 'gs://bucket')

    def test_is_storage_path_rejects_bare_path(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_path('/local/path')

    def test_is_storage_path_rejects_unknown_scheme(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_path('ftp://bucket')


class TestIsStorageCredentialPath(unittest.TestCase):
    """Tests for validation.is_storage_credential_path."""

    def test_is_storage_credential_path_accepts_s3(self):
        self.assertEqual(
            validation.is_storage_credential_path('s3://bucket'),
            's3://bucket',
        )

    def test_is_storage_credential_path_accepts_azure_profile(self):
        path = 'azure://account'
        self.assertEqual(validation.is_storage_credential_path(path), path)

    def test_is_storage_credential_path_rejects_bare_path(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_credential_path('/local/path')


class TestValidPath(unittest.TestCase):
    """Tests for validation.valid_path."""

    def test_valid_path_accepts_existing_file(self):
        with tempfile.NamedTemporaryFile() as tmp:
            self.assertEqual(validation.valid_path(tmp.name), os.path.abspath(tmp.name))

    def test_valid_path_accepts_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            self.assertEqual(validation.valid_path(tmp_dir), os.path.abspath(tmp_dir))

    def test_valid_path_rejects_missing(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            missing_path = os.path.join(tmp_dir, 'does-not-exist')
            with self.assertRaises(osmo_errors.OSMOUserError):
                validation.valid_path(missing_path)


class TestValidFilePath(unittest.TestCase):
    """Tests for validation.valid_file_path."""

    def test_valid_file_path_accepts_nonexistent(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = os.path.join(tmp_dir, 'new-file.txt')
            self.assertEqual(validation.valid_file_path(path), path)

    def test_valid_file_path_rejects_directory(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            with self.assertRaises(argparse.ArgumentTypeError):
                validation.valid_file_path(tmp_dir)

    def test_valid_file_path_rejects_existing_file(self):
        with tempfile.NamedTemporaryFile() as tmp:
            with self.assertRaises(argparse.ArgumentTypeError):
                validation.valid_file_path(tmp.name)


class TestDateStr(unittest.TestCase):
    """Tests for validation.date_str."""

    def test_date_str_accepts_valid_date(self):
        self.assertEqual(validation.date_str('2026-05-13'), '2026-05-13')

    def test_date_str_rejects_invalid_format(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_str('05/13/2026')

    def test_date_str_rejects_datetime(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_str('2026-05-13T12:00:00')


class TestDatetimeStr(unittest.TestCase):
    """Tests for validation.datetime_str."""

    def test_datetime_str_accepts_valid_datetime(self):
        self.assertEqual(
            validation.datetime_str('2026-05-13T12:34:56'),
            '2026-05-13T12:34:56',
        )

    def test_datetime_str_rejects_date_only(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.datetime_str('2026-05-13')

    def test_datetime_str_rejects_invalid(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.datetime_str('not-a-datetime')


class TestDateOrDatetimeStr(unittest.TestCase):
    """Tests for validation.date_or_datetime_str."""

    def test_date_or_datetime_str_accepts_date(self):
        self.assertEqual(
            validation.date_or_datetime_str('2026-05-13'),
            '2026-05-13',
        )

    def test_date_or_datetime_str_accepts_datetime(self):
        self.assertEqual(
            validation.date_or_datetime_str('2026-05-13T12:34:56'),
            '2026-05-13T12:34:56',
        )

    def test_date_or_datetime_str_rejects_invalid(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_or_datetime_str('not-a-date')


class TestSanitizedPath(unittest.TestCase):
    """Tests for validation.sanitized_path."""

    def test_sanitized_path_returns_none_for_empty_string(self):
        self.assertIsNone(validation.sanitized_path(''))

    def test_sanitized_path_collapses_double_slashes(self):
        self.assertEqual(validation.sanitized_path('/foo//bar'), '/foo/bar')

    def test_sanitized_path_strips_trailing_slash(self):
        self.assertEqual(validation.sanitized_path('/foo/bar/'), '/foo/bar')

    def test_sanitized_path_collapses_resolvable_parent(self):
        self.assertEqual(validation.sanitized_path('/foo/../bar'), '/bar')

    def test_sanitized_path_rejects_unresolvable_parent_traversal(self):
        self.assertIsNone(validation.sanitized_path('../etc/passwd'))


if __name__ == '__main__':
    unittest.main()
