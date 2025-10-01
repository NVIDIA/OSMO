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
import unittest

from src.utils.job import kb_objects


class KbObjectTest(unittest.TestCase):
    def test_simple_host_mounts(self):
        """
        Test if the generated outputs from a host mount with a single path are correct.
        """
        test_path = '/opt/data'
        host_mount = kb_objects.HostMount(name='my-mount', path=test_path)
        self.assertEquals(host_mount.src_path, test_path)
        self.assertEquals(host_mount.dest_path, test_path)

        self.assertEquals(host_mount.volume()['hostPath']['path'], test_path)
        self.assertEquals(host_mount.volume_mount()['mountPath'], test_path)

    def test_src_dest_host_mounts(self):
        """
        Test if the generated outputs from a host mount with source and destination paths are correct.
        """
        src_test_path = '/opt/data'
        dest_test_path = '/home/data'
        host_mount = kb_objects.HostMount(name='my-mount', path=f'{src_test_path}:{dest_test_path}')
        self.assertEquals(host_mount.src_path, src_test_path)
        self.assertEquals(host_mount.dest_path, dest_test_path)
        self.assertEquals(host_mount.volume()['hostPath']['path'], src_test_path)
        self.assertEquals(host_mount.volume_mount()['mountPath'], dest_test_path)

if __name__ == "__main__":
    unittest.main()
