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
import unittest

from src.lib.utils import validation


class TestPositiveInteger(unittest.TestCase):
    """Tests for validation.positive_integer."""

    def test_positive_integer_with_positive_value_returns_int(self):
        self.assertEqual(validation.positive_integer(5), 5)

    def test_positive_integer_with_zero_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_integer(0)

    def test_positive_integer_with_negative_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_integer(-3)


class TestPositiveFloat(unittest.TestCase):
    """Tests for validation.positive_float."""

    def test_positive_float_with_positive_value_returns_float(self):
        self.assertEqual(validation.positive_float(1.5), 1.5)

    def test_positive_float_with_zero_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_float(0.0)

    def test_positive_float_with_negative_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.positive_float(-0.1)


class TestNonNegativeInteger(unittest.TestCase):
    """Tests for validation.non_negative_integer."""

    def test_non_negative_integer_with_zero_returns_zero(self):
        self.assertEqual(validation.non_negative_integer(0), 0)

    def test_non_negative_integer_with_positive_returns_int(self):
        self.assertEqual(validation.non_negative_integer(10), 10)

    def test_non_negative_integer_with_negative_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.non_negative_integer(-1)


class TestIsRegex(unittest.TestCase):
    """Tests for validation.is_regex."""

    def test_is_regex_with_valid_pattern_returns_pattern(self):
        self.assertEqual(validation.is_regex(r'^foo.*bar$'), r'^foo.*bar$')

    def test_is_regex_with_empty_string_returns_empty_string(self):
        self.assertEqual(validation.is_regex(''), '')

    def test_is_regex_with_invalid_pattern_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_regex('[unclosed')

    def test_is_regex_with_bad_repetition_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_regex('*invalid')


class TestIsBucket(unittest.TestCase):
    """Tests for validation.is_bucket."""

    def test_is_bucket_with_alphanumeric_name_returns_name(self):
        self.assertEqual(validation.is_bucket('my-bucket_1'), 'my-bucket_1')

    def test_is_bucket_with_slash_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_bucket('bad/name')

    def test_is_bucket_with_empty_string_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_bucket('')

    def test_is_bucket_with_space_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_bucket('bad name')


class TestIsStoragePath(unittest.TestCase):
    """Tests for validation.is_storage_path."""

    def test_is_storage_path_with_s3_uri_returns_path(self):
        self.assertEqual(validation.is_storage_path('s3://my-bucket'), 's3://my-bucket')

    def test_is_storage_path_with_gs_uri_returns_path(self):
        self.assertEqual(
            validation.is_storage_path('gs://my-bucket/obj'), 'gs://my-bucket/obj')

    def test_is_storage_path_with_swift_uri_returns_path(self):
        self.assertEqual(
            validation.is_storage_path('swift://acct/container/obj'),
            'swift://acct/container/obj')

    def test_is_storage_path_with_plain_path_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_path('/local/path')

    def test_is_storage_path_with_unknown_scheme_raises(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            validation.is_storage_path('ftp://host/path')


if __name__ == '__main__':
    unittest.main()
