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
import argparse
import os
import tempfile
import unittest

from src.lib.utils import osmo_errors, validation


class TestPositiveInteger(unittest.TestCase):
    """ Tests for positive_integer. """

    def test_positive_value_returns_int(self):
        self.assertEqual(validation.positive_integer(5), 5)

    def test_string_digit_returns_int(self):
        # argparse passes strings to type= functions; the function casts via int().
        self.assertEqual(validation.positive_integer('7'),  # type: ignore[arg-type]
                         7)

    def test_zero_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_integer(0)

    def test_negative_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_integer(-3)

    def test_non_integer_raises_value_error(self):
        with self.assertRaises(ValueError):
            validation.positive_integer('abc')  # type: ignore[arg-type]


class TestPositiveFloat(unittest.TestCase):
    """ Tests for positive_float. """

    def test_positive_value_returns_float(self):
        self.assertEqual(validation.positive_float(1.5), 1.5)

    def test_zero_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_float(0)

    def test_negative_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_float(-2.5)

    def test_non_numeric_raises_value_error(self):
        with self.assertRaises(ValueError):
            validation.positive_float('not-a-float')  # type: ignore[arg-type]


class TestNonNegativeInteger(unittest.TestCase):
    """ Tests for non_negative_integer. """

    def test_zero_is_allowed(self):
        self.assertEqual(validation.non_negative_integer(0), 0)

    def test_positive_value_returns_int(self):
        self.assertEqual(validation.non_negative_integer(10), 10)

    def test_negative_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.non_negative_integer(-1)

    def test_non_integer_raises_value_error(self):
        with self.assertRaises(ValueError):
            validation.non_negative_integer('abc')  # type: ignore[arg-type]


class TestIsRegex(unittest.TestCase):
    """ Tests for is_regex. """

    def test_valid_regex_returned_unchanged(self):
        self.assertEqual(validation.is_regex(r'^foo.*$'), r'^foo.*$')

    def test_simple_literal_is_valid(self):
        self.assertEqual(validation.is_regex('plain'), 'plain')

    def test_invalid_regex_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_regex('[unclosed')


class TestIsBucket(unittest.TestCase):
    """ Tests for is_bucket. """

    def test_valid_bucket_returned_unchanged(self):
        self.assertEqual(validation.is_bucket('my-bucket_1'), 'my-bucket_1')

    def test_alphanumeric_is_valid(self):
        self.assertEqual(validation.is_bucket('abc123'), 'abc123')

    def test_invalid_bucket_with_slash_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_bucket('bad/bucket')

    def test_invalid_bucket_with_dot_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_bucket('bad.bucket')

    def test_empty_bucket_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_bucket('')


class TestIsStoragePath(unittest.TestCase):
    """ Tests for is_storage_path. """

    def test_valid_s3_path(self):
        self.assertEqual(
            validation.is_storage_path('s3://bucket/key'), 's3://bucket/key')

    def test_valid_gs_path(self):
        self.assertEqual(
            validation.is_storage_path('gs://bucket'), 'gs://bucket')

    def test_invalid_scheme_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_path('http://example.com/foo')

    def test_empty_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_path('')


class TestIsStorageCredentialPath(unittest.TestCase):
    """ Tests for is_storage_credential_path. """

    def test_valid_profile_path(self):
        self.assertEqual(
            validation.is_storage_credential_path('s3://bucket'),
            's3://bucket')

    def test_invalid_path_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_credential_path('not-a-uri')


class TestValidPath(unittest.TestCase):
    """ Tests for valid_path. """

    def test_existing_file_returns_absolute_path(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(b'data')
            tmp_path = tmp.name
        try:
            result = validation.valid_path(tmp_path)
            self.assertEqual(result, os.path.abspath(tmp_path))
        finally:
            os.unlink(tmp_path)

    def test_existing_directory_returns_absolute_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            result = validation.valid_path(tmpdir)
            self.assertEqual(result, os.path.abspath(tmpdir))

    def test_nonexistent_path_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            validation.valid_path('/nonexistent/path/xyz/123')


class TestValidFilePath(unittest.TestCase):
    """ Tests for valid_file_path. """

    def test_nonexistent_path_returned_as_is(self):
        path = '/tmp/this-file-should-not-exist-xyz123'
        self.assertEqual(validation.valid_file_path(path), path)

    def test_existing_directory_raises(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with self.assertRaises(argparse.ArgumentTypeError):
                validation.valid_file_path(tmpdir)

    def test_existing_file_raises(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp_path = tmp.name
        try:
            with self.assertRaises(argparse.ArgumentTypeError):
                validation.valid_file_path(tmp_path)
        finally:
            os.unlink(tmp_path)


class TestDateStr(unittest.TestCase):
    """ Tests for date_str. """

    def test_valid_date_returned_unchanged(self):
        self.assertEqual(validation.date_str('2026-01-02'), '2026-01-02')

    def test_invalid_date_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_str('not-a-date')

    def test_datetime_format_rejected(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_str('2026-01-02T03:04:05')


class TestDatetimeStr(unittest.TestCase):
    """ Tests for datetime_str. """

    def test_valid_datetime_returned_unchanged(self):
        self.assertEqual(
            validation.datetime_str('2026-01-02T03:04:05'),
            '2026-01-02T03:04:05')

    def test_invalid_datetime_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.datetime_str('garbage')

    def test_date_only_rejected(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.datetime_str('2026-01-02')


class TestDateOrDatetimeStr(unittest.TestCase):
    """ Tests for date_or_datetime_str. """

    def test_accepts_date(self):
        self.assertEqual(
            validation.date_or_datetime_str('2026-01-02'), '2026-01-02')

    def test_accepts_datetime(self):
        self.assertEqual(
            validation.date_or_datetime_str('2026-01-02T03:04:05'),
            '2026-01-02T03:04:05')

    def test_invalid_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.date_or_datetime_str('garbage')


class TestSanitizedPath(unittest.TestCase):
    """ Tests for sanitized_path. """

    def test_empty_string_returns_none(self):
        self.assertIsNone(validation.sanitized_path(''))

    def test_normalizes_double_slashes(self):
        self.assertEqual(validation.sanitized_path('a//b//c'), 'a/b/c')

    def test_dotdot_at_start_returns_none(self):
        # normpath leaves leading '..' intact, which the check catches.
        self.assertIsNone(validation.sanitized_path('../foo'))

    def test_plain_path_returned_normalized(self):
        self.assertEqual(validation.sanitized_path('/a/b'), '/a/b')


if __name__ == '__main__':
    unittest.main()
