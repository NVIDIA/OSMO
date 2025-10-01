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

import yaml

from src.utils.job import workflow


class ResourceSpecTest(unittest.TestCase):
    def test_wf_no_resource_spec(self):
        """
        Test to see if a workflow spec without a resource spec creates a default ResourceSpec
        object implicitly
        """
        spec_dict = yaml.safe_load('''
            workflow:
              name: test_workflow
              tasks:
              - name: task1
                command: ['command1']
                image: image1
              - name: task2
                command: ['command2']
                image: image2
                inputs:
                - task: task1
            ''')
        wf_spec_v2_obj = workflow.VersionedWorkflowSpec(**spec_dict).workflow
        wf_spec_obj = wf_spec_v2_obj.convert_to_workflow_spec()
        for group in wf_spec_obj.groups:
            for task in group.tasks:
                self.assertIsNotNone(task.resources)
                self.assertEqual(task.resources.cpu, {})
                self.assertIsNone(task.resources.storage)
                self.assertIsNone(task.resources.memory)
                self.assertEqual(task.resources.labels,
                                 {'kubernetes.io/arch': 'amd64'})
                self.assertEqual(task.resources.gpu, {})

    def test_wf_with_resource_spec(self):
        """
        Test to see if the resource spec is properly created for a workflow spec that has
        a resource spec.
        """
        spec_dict = yaml.safe_load('''
            workflow:
              name: test_workflow
              resources:
                default:
                  cpu:
                    count: 4
                  memory: 4Gi
                  storage: 4Gi
                  labels:
                    kubernetes.io/arch: amd64
              tasks:
              - name: task1
                command: ['command1']
                image: image1
              - name: task2
                command: ['command2']
                image: image2
                inputs:
                - task: task1
            ''')
        wf_spec_v2_obj = workflow.VersionedWorkflowSpec(**spec_dict).workflow
        wf_spec_obj = wf_spec_v2_obj.convert_to_workflow_spec()
        for group in wf_spec_obj.groups:
            for task in group.tasks:
                self.assertIsNotNone(task.resources)
                self.assertEqual(task.resources.cpu, {'count': '4'})
                self.assertEqual(task.resources.storage, '4Gi')
                self.assertEqual(task.resources.memory, '4Gi')
                self.assertEqual(task.resources.labels,
                                 {'kubernetes.io/arch': 'amd64'})
                self.assertEqual(task.resources.gpu, {})

if __name__ == "__main__":
    unittest.main()
