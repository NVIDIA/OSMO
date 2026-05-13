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

import os
import unittest

os.environ['OSMO_POSTGRES_PASSWORD'] = 'test'
from src.service.router import router


class RouterServiceConfigTest(unittest.TestCase):

    def test_default_sticky_cookies_include_envoy_router_affinity(self):
        config = router.RouterServiceConfig(postgres_password='test')

        self.assertIn('_osmo_router_affinity', config.sticky_cookies)


if __name__ == '__main__':
    unittest.main()
