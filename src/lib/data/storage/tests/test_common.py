# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for the storage common module.
"""

import unittest

from src.lib.data.storage import common


class TestCommon(unittest.TestCase):
    """
    Tests the storage common module.
    """

    def test_get_download_relative_path_no_base_path(self):
        """
        Test that the relative path is the same as the object key when no base path is provided.
        """
        self.assertEqual(
            common.get_download_relative_path('a/b/c/d/1.txt', None),
            'a/b/c/d/1.txt',
        )

    def test_get_download_relative_path_with_base_path(self):
        """
        Test that the relative path is the same as the object key when a base path is provided.
        """
        self.assertEqual(
            common.get_download_relative_path('a/b/c/d/1.txt', 'a/b/c'),
            'd/1.txt',
        )

    def test_get_download_relative_path_with_base_path_trailing_slash(self):
        """
        Test that the relative path is the same as the object key when a base path is provided
        with a trailing slash.
        """
        self.assertEqual(
            common.get_download_relative_path('a/b/c/d/1.txt', 'a/b/c/'),
            'd/1.txt',
        )

    def test_get_download_relative_path_with_base_path_same_as_object_key(self):
        """
        Test that the relative path is the base name of the object key when the base path
        is the same as the object key.
        """
        self.assertEqual(
            common.get_download_relative_path('a/b/c/d/1.txt', 'a/b/c/d/1.txt'),
            '1.txt',
        )

    def test_get_upload_relative_path_local_path(self):
        """
        Test that the relative path contains last directory of the base path when uploading locally.
        """
        self.assertEqual(
            common.get_upload_relative_path('/a/b/c/d/1.txt', '/a/b/c'),
            'c/d/1.txt',
        )

    def test_get_upload_relative_path_local_path_trailing_slash(self):
        """
        Test that the relative path contains last directory of the base path when uploading locally
        with a trailing slash.
        """
        self.assertEqual(
            common.get_upload_relative_path('/a/b/c/d/1.txt', '/a/b/c/'),
            'c/d/1.txt',
        )

    def test_get_upload_relative_path_local_path_asterisk(self):
        """
        Test that the relative path does not contain last directory of the base path when
        uploading locally with an asterisk.
        """
        self.assertEqual(
            common.get_upload_relative_path('/a/b/c/d/1.txt', '/a/b/c/*'),
            'd/1.txt',
        )

    def test_get_upload_relative_path_remote_path(self):
        """
        Test that the relative path contains last directory of the base path when
        uploading remotely.
        """
        self.assertEqual(
            common.get_upload_relative_path('a/b/c/d/1.txt', 'a/b/c'),
            'c/d/1.txt',
        )

    def test_get_upload_relative_path_remote_path_trailing_slash(self):
        """
        Test that the relative path contains last directory of the base path when
        uploading remotely with a trailing slash.
        """
        self.assertEqual(
            common.get_upload_relative_path('a/b/c/d/1.txt', 'a/b/c/'),
            'c/d/1.txt',
        )

    def test_get_upload_relative_path_remote_path_same_as_object_key(self):
        """
        Test that the relative path is the base name of the object key when the base path
        is the same as the object key.
        """
        self.assertEqual(
            common.get_upload_relative_path('a/b/c/d/1.txt', 'a/b/c/d/1.txt'),
            '1.txt',
        )

    def test_remap_destination_name_source_is_dir(self):
        """
        Test destination name remapping when the source is a directory.
        """
        self.assertEqual(
            common.remap_destination_name('a/b/c/d/1.txt', True, 'new_name'),
            'new_name/b/c/d/1.txt',
        )

    def test_remap_destination_name_source_is_file(self):
        """
        Test destination name remapping when the source is a file.
        """
        self.assertEqual(
            common.remap_destination_name('a/b/c/d/1.txt', False, 'new_name'),
            'a/b/c/d/new_name',
        )


if __name__ == '__main__':
    unittest.main()
