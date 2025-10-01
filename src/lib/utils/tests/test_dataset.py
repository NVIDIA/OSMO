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

import re
import unittest

from src.lib.utils import common, osmo_errors


class TestDatasetNames(unittest.TestCase):
    """ Test Dataset Names """

    def test_name(self):
        """ Test when name is only provided. """
        dataset_info = common.DatasetStructure('DS')

        self.assertEqual(dataset_info.bucket, '')
        self.assertEqual(dataset_info.name, 'DS')
        self.assertEqual(dataset_info.tag, '')

    def test_name_tag(self):
        """ Test when name and tag are provided. """
        dataset_info = common.DatasetStructure('DS:tag')

        self.assertEqual(dataset_info.bucket, '')
        self.assertEqual(dataset_info.name, 'DS')
        self.assertEqual(dataset_info.tag, 'tag')

    def test_bucket_name(self):
        """ Test when bucket and name are provided. """
        dataset_info = common.DatasetStructure('bucket/DS')

        self.assertEqual(dataset_info.bucket, 'bucket')
        self.assertEqual(dataset_info.name, 'DS')
        self.assertEqual(dataset_info.tag, '')

    def test_bucket_name_tag(self):
        """ Test when bucket, name, and tag are provided. """
        dataset_info = common.DatasetStructure('bucket/DS:tag')

        self.assertEqual(dataset_info.bucket, 'bucket')
        self.assertEqual(dataset_info.name, 'DS')
        self.assertEqual(dataset_info.tag, 'tag')

    def test_invalid_inputs(self):
        """ Test Inputs have Invalid Characters. """
        with self.assertRaises(osmo_errors.OSMOUserError):
            # No Special Characters
            common.DatasetStructure('Dataset**')

        with self.assertRaises(osmo_errors.OSMOUserError):
            # Only one / allowed
            common.DatasetStructure('bucket1/bucket2/dataset')

        with self.assertRaises(osmo_errors.OSMOUserError):
            # Only one : allowed
            common.DatasetStructure('dataset:tag1:tag2')

        with self.assertRaises(osmo_errors.OSMOUserError):
            # / and : cannot be mixed
            common.DatasetStructure('bucket:dataset/tag')

    def test_valid_input(self):
        # Test Name, Tag, and Bucket can have _ and -
        dataset_info = common.DatasetStructure('bucket__-3/dat_ase--t1:_ta-g3')

        self.assertEqual(dataset_info.bucket, 'bucket__-3')
        self.assertEqual(dataset_info.name, 'dat_ase--t1')
        self.assertEqual(dataset_info.tag, '_ta-g3')

    def test_allowed_characters_only(self):
        test_cases = [
            'abc',
            'abc123',
            '123',
            'abc_def-123'
        ]
        for test_case in test_cases:
            self.assertTrue(re.fullmatch(common.DATASET_NAME_REGEX, test_case))
            self.assertTrue(re.fullmatch(common.DATASET_BUCKET_TAG_REGEX, test_case))
            self.assertTrue(re.fullmatch(common.DATASET_NAME_IN_WORKFLOW_REGEX, test_case))
            self.assertTrue(re.fullmatch(common.DATASET_BUCKET_TAG_IN_WORKFLOW_REGEX, test_case))

    def test_single_workflow_id(self):
        test_cases = [
            '{{workflow_id}}',
            '{{workflow_id}}abc',
            'abc{{workflow_id}}',
            'abc{{workflow_id}}def'
        ]
        for test_case in test_cases:
            self.assertFalse(re.fullmatch(common.DATASET_NAME_REGEX, test_case))
            self.assertFalse(re.fullmatch(common.DATASET_BUCKET_TAG_REGEX, test_case))
            self.assertTrue(re.fullmatch(common.DATASET_NAME_IN_WORKFLOW_REGEX, test_case))
            self.assertTrue(re.fullmatch(common.DATASET_BUCKET_TAG_IN_WORKFLOW_REGEX, test_case))

    def test_multiple_workflow_ids(self):
        test_cases = [
            '{{workflow_id}}{{workflow_id}}',
            'abc{{workflow_id}}def{{workflow_id}}ghi'
        ]
        for test_case in test_cases:
            self.assertFalse(re.fullmatch(common.DATASET_NAME_REGEX, test_case))
            self.assertFalse(re.fullmatch(common.DATASET_BUCKET_TAG_REGEX, test_case))
            self.assertTrue(re.fullmatch(common.DATASET_NAME_IN_WORKFLOW_REGEX, test_case))
            self.assertTrue(re.fullmatch(common.DATASET_BUCKET_TAG_IN_WORKFLOW_REGEX, test_case))

    def test_invalid_strings(self):
        test_cases = [
            'abc {{workflow_id}} def',
            'abc$def',
            '{{workflowids}}',
            'abc{{wrong}}def'
        ]
        for test_case in test_cases:
            self.assertFalse(re.fullmatch(common.DATASET_NAME_REGEX, test_case))
            self.assertFalse(re.fullmatch(common.DATASET_BUCKET_TAG_REGEX, test_case))

    def test_dataset_composite_name(self):
        test_cases = [
            'osmo/workflow_update_DS:{{workflow_id}}',
            'synthetica-test:{{workflow_id}}',
            'osmo_{{workflow_id}}',
            'model-ess-{{model_name}}:{{workflow_id}}',
            '{{workflow_name}}_{{workflow_id}}',
        ]
        for test_case in test_cases:
            self.assertFalse(re.fullmatch(common.DATASET_BUCKET_TAG_REGEX, test_case))
            self.assertTrue(re.fullmatch(
                common.DATASET_BUCKET_NAME_TAG_IN_WORKFLOW_REGEX, test_case), test_case)


if __name__ == '__main__':
    unittest.main()
