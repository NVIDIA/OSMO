# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

import unittest

from src.utils.job import rendering


class RenderingTest(unittest.TestCase):

    def test_normalize_preserves_resource_order_and_drops_volatile_metadata(self):
        rendered = rendering.RenderedTaskGroup(
            resources=[
                {
                    'kind': 'Pod',
                    'metadata': {
                        'name': 'pod-a',
                        'uid': 'generated',
                        'resourceVersion': '123',
                        'annotations': {
                            'pod-group-name': 'group-a',
                            'kubectl.kubernetes.io/last-applied-configuration': '{}',
                        },
                    },
                    'status': {'phase': 'Pending'},
                },
                {
                    'kind': 'Secret',
                    'metadata': {'name': 'secret-a', 'creationTimestamp': 'now'},
                },
            ],
            pod_specs={},
        )

        normalized = rendering.normalize_rendered_task_group(rendered)

        self.assertEqual(
            normalized['resources'],
            [
                {
                    'kind': 'Pod',
                    'metadata': {
                        'annotations': {'pod-group-name': 'group-a'},
                        'name': 'pod-a',
                    },
                },
                {
                    'kind': 'Secret',
                    'metadata': {'name': 'secret-a'},
                },
            ],
        )

    def test_runtime_config_uses_deep_copy(self):
        rendered = rendering.RenderedTaskGroup(
            resources=[{'kind': 'Pod', 'metadata': {'name': 'pod-a'}}],
            pod_specs={},
        )

        runtime_config = rendered.as_runtime_config()
        runtime_config['resources'][0]['metadata']['name'] = 'changed'

        self.assertEqual(rendered.resources[0]['metadata']['name'], 'pod-a')


if __name__ == '__main__':
    unittest.main()
