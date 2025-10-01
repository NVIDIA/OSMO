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
import argparse
import unittest

from src.cli import workflow

class TestPortParse(unittest.TestCase):
    def test_port_parse(self):
        """ Test different cases for port parsing. """
        regular_port = '8000:8000'
        parsed_port = workflow.parse_port(regular_port)
        self.assertEqual(parsed_port[0], [8000])
        self.assertEqual(parsed_port[1], [8000])

        single_port = '8000'
        parsed_port = workflow.parse_port(single_port)
        self.assertEqual(parsed_port[0], [8000])
        self.assertEqual(parsed_port[1], [8000])

        multiple_port = '8000-8002:9000-9002,8005'
        parsed_port = workflow.parse_port(multiple_port)
        self.assertEqual(parsed_port[0], [8000, 8001, 8002, 8005])
        self.assertEqual(parsed_port[1], [9000, 9001, 9002, 8005])

        def test_bad_port(bad_port: str):
            with self.assertRaises(argparse.ArgumentTypeError):
                _ = workflow.parse_port(bad_port)

        # More than 1 colon is not allowed
        test_bad_port('8000:8000:8000')

        # Non-digits are not allowed
        test_bad_port('hello:port')
        test_bad_port('hello')

        # Values below 0 for ports are not allowed
        test_bad_port('-1:8000')
        test_bad_port('8000:-1')

        # Values above 65535 for ports are not allowed
        test_bad_port('70000:8000')
        test_bad_port('8000:70000')

        # Ports not matched
        test_bad_port('8000-8005:9001-9002')


if __name__ == "__main__":
    unittest.main()
