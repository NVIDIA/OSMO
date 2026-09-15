"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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
import sys
import unittest


def main() -> None:
    """Run one explicitly selected suite and reject empty discovery."""
    parser = argparse.ArgumentParser()
    parser.add_argument('--module', required=True)
    arguments = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromName(arguments.module)
    if suite.countTestCases() == 0:
        parser.error('No unittest cases discovered for the requested module.')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())


if __name__ == '__main__':
    main()
