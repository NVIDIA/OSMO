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
import json
import unittest

from src.service.core.workflow import objects
from src.utils.job import task


def make_summary_row(
    disk_count: float = 0.0,
    cpu_count: float = 0.0,
    memory_count: float = 0.0,
    gpu_count: float = 0.0,
    pool: str = 'test-pool',
    priority: str = 'NORMAL',
) -> dict:
    return {
        'submitted_by': 'test-user',
        'pool': pool,
        'disk_count': disk_count,
        'cpu_count': cpu_count,
        'memory_count': memory_count,
        'gpu_count': gpu_count,
        'priority': priority,
    }


def make_task_row(
    disk_count: float = 0.0,
    cpu_count: float = 0.0,
    memory_count: float = 0.0,
    gpu_count: float = 0.0,
) -> dict:
    return {
        'workflow_id': 'test-workflow-1',
        'name': 'task-0',
        'node_name': 'node-1',
        'start_time': None,
        'end_time': None,
        'status': task.TaskGroupStatus.WAITING.name,
        'disk_count': disk_count,
        'cpu_count': cpu_count,
        'memory_count': memory_count,
        'gpu_count': gpu_count,
    }


class TestListTaskSummaryEntryResources(unittest.TestCase):

    def test_whole_number_resources(self):
        row = make_summary_row(disk_count=10.0, cpu_count=4.0, memory_count=8.0, gpu_count=2.0)
        entry = objects.ListTaskSummaryEntry.from_db_row(row)
        self.assertEqual(entry.storage, 10.0)
        self.assertEqual(entry.cpu, 4)
        self.assertEqual(entry.memory, 8.0)
        self.assertEqual(entry.gpu, 2)
        self.assertIsInstance(entry.storage, float)
        self.assertIsInstance(entry.cpu, int)
        self.assertIsInstance(entry.memory, float)
        self.assertIsInstance(entry.gpu, int)

    def test_fractional_storage_and_memory(self):
        """500Mi ≈ 0.488 GiB, 1500Mi ≈ 1.465 GiB"""
        row = make_summary_row(
            disk_count=500 / 1024,
            memory_count=1500 / 1024,
            cpu_count=2.0,
            gpu_count=1.0,
        )
        entry = objects.ListTaskSummaryEntry.from_db_row(row)
        self.assertAlmostEqual(entry.storage, 500 / 1024)
        self.assertAlmostEqual(entry.memory, 1500 / 1024)
        self.assertGreater(entry.storage, 0)
        self.assertGreater(entry.memory, 0)

    def test_sub_gib_not_rounded_to_zero(self):
        """100Mi ≈ 0.098 GiB — must not become 0."""
        row = make_summary_row(disk_count=100 / 1024, memory_count=100 / 1024)
        entry = objects.ListTaskSummaryEntry.from_db_row(row)
        self.assertGreater(entry.storage, 0)
        self.assertGreater(entry.memory, 0)

    def test_json_serialization_preserves_floats(self):
        row = make_summary_row(disk_count=0.5, memory_count=1.5, cpu_count=4.0, gpu_count=8.0)
        entry = objects.ListTaskSummaryEntry.from_db_row(row)
        data = json.loads(entry.model_dump_json())
        self.assertEqual(data['storage'], 0.5)
        self.assertEqual(data['memory'], 1.5)
        self.assertEqual(data['cpu'], 4)
        self.assertEqual(data['gpu'], 8)

    def test_aggregated_entry_inherits_float_fields(self):
        row = make_summary_row(disk_count=0.25, memory_count=0.75, cpu_count=1.0, gpu_count=1.0)
        row['workflow_id'] = 'test-workflow-1'
        entry = objects.ListTaskAggregatedEntry.from_db_row(row)
        self.assertAlmostEqual(entry.storage, 0.25)
        self.assertAlmostEqual(entry.memory, 0.75)
        self.assertEqual(entry.cpu, 1)
        self.assertEqual(entry.gpu, 1)
        self.assertEqual(entry.workflow_id, 'test-workflow-1')


class TestTaskEntryResources(unittest.TestCase):

    def test_whole_number_resources(self):
        row = make_task_row(disk_count=10.0, cpu_count=4.0, memory_count=8.0, gpu_count=2.0)
        entry = objects.TaskEntry.from_db_row(row)
        self.assertEqual(entry.storage, 10.0)
        self.assertEqual(entry.cpu, 4)
        self.assertEqual(entry.memory, 8.0)
        self.assertEqual(entry.gpu, 2)
        self.assertIsInstance(entry.storage, float)
        self.assertIsInstance(entry.cpu, int)
        self.assertIsInstance(entry.memory, float)
        self.assertIsInstance(entry.gpu, int)

    def test_fractional_storage_and_memory(self):
        row = make_task_row(
            disk_count=500 / 1024,
            memory_count=1500 / 1024,
            cpu_count=2.0,
            gpu_count=1.0,
        )
        entry = objects.TaskEntry.from_db_row(row)
        self.assertAlmostEqual(entry.storage, 500 / 1024)
        self.assertAlmostEqual(entry.memory, 1500 / 1024)

    def test_sub_gib_not_rounded_to_zero(self):
        row = make_task_row(disk_count=100 / 1024, memory_count=100 / 1024)
        entry = objects.TaskEntry.from_db_row(row)
        self.assertGreater(entry.storage, 0)
        self.assertGreater(entry.memory, 0)

    def test_json_serialization_preserves_floats(self):
        row = make_task_row(disk_count=0.5, memory_count=1.5, cpu_count=4.0, gpu_count=8.0)
        entry = objects.TaskEntry.from_db_row(row)
        data = json.loads(entry.model_dump_json())
        self.assertEqual(data['storage'], 0.5)
        self.assertEqual(data['memory'], 1.5)
        self.assertEqual(data['cpu'], 4)
        self.assertEqual(data['gpu'], 8)


if __name__ == '__main__':
    unittest.main()
