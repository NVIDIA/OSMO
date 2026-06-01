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

"""
Unit tests for the storage executor module.

Targets the pure schema layer of ``ExecutorParameters`` (resolved properties,
multiplier validator, ``settings_customise_sources`` hook), the abstract bases
(``ThreadWorkerInput.error_key``, ``ThreadWorkerOutput.__add__/__iadd__/__radd__``),
``ExecutorError`` construction, ``validate_picklable``, and the single-process
execution paths of ``run_job`` so the executor's resource-sizing contracts are
locked in without spinning up real I/O.
"""

import os
import unittest
from unittest import mock

import pydantic

from src.lib.data.storage.core import executor
from src.lib.data.storage.tests.executor_test_helpers import (
    TestStorageClientFactory,
    TestWorkerInput,
    TestWorkerOutput,
    test_thread_worker,
    test_worker_inputs,
)


class TestExecutorParametersResolvedProperties(unittest.TestCase):
    """Tests for the derived sizing properties on ``ExecutorParameters``."""

    def test_resolved_num_processes_defaults_to_one_when_unset(self):
        params = executor.ExecutorParameters()

        self.assertEqual(params.resolved_num_processes, 1)

    def test_resolved_num_processes_returns_explicit_value(self):
        params = executor.ExecutorParameters(num_processes=4)

        self.assertEqual(params.resolved_num_processes, 4)

    def test_resolved_num_threads_defaults_to_one_in_single_process(self):
        params = executor.ExecutorParameters(num_processes=1)

        self.assertEqual(params.resolved_num_threads, 1)

    def test_resolved_num_threads_defaults_to_constant_in_multi_process(self):
        params = executor.ExecutorParameters(num_processes=4)

        self.assertEqual(params.resolved_num_threads, executor.DEFAULT_NUM_THREADS)

    def test_resolved_num_threads_returns_explicit_value(self):
        params = executor.ExecutorParameters(num_processes=4, num_threads=7)

        self.assertEqual(params.resolved_num_threads, 7)

    def test_resolved_num_threads_inflight_uses_multiplier(self):
        params = executor.ExecutorParameters(
            num_processes=2,
            num_threads=4,
            num_threads_inflight_multiplier=3,
        )

        # max(4 * 3, 4 + 1) -> 12
        self.assertEqual(params.resolved_num_threads_inflight, 12)

    def test_resolved_num_threads_inflight_floor_is_threads_plus_one(self):
        params = executor.ExecutorParameters(
            num_processes=2,
            num_threads=4,
            num_threads_inflight_multiplier=1,
        )

        # max(4 * 1, 4 + 1) -> 5
        self.assertEqual(params.resolved_num_threads_inflight, 5)

    def test_resolved_chunk_size_equals_num_threads_inflight(self):
        params = executor.ExecutorParameters(
            num_processes=2,
            num_threads=3,
            num_threads_inflight_multiplier=2,
        )

        self.assertEqual(params.resolved_chunk_size, params.resolved_num_threads_inflight)

    def test_resolved_chunk_queue_size_uses_multiplier(self):
        params = executor.ExecutorParameters(
            num_processes=3,
            chunk_queue_size_multiplier=4,
        )

        # max(3 * 4, 3 + 1) -> 12
        self.assertEqual(params.resolved_chunk_queue_size, 12)

    def test_resolved_chunk_queue_size_floor_is_processes_plus_one(self):
        params = executor.ExecutorParameters(
            num_processes=5,
            chunk_queue_size_multiplier=1,
        )

        # max(5 * 1, 5 + 1) -> 6
        self.assertEqual(params.resolved_chunk_queue_size, 6)


class TestExecutorParametersValidators(unittest.TestCase):
    """Tests for the multiplier validator and field constraints."""

    def test_threads_inflight_multiplier_at_max_is_accepted(self):
        params = executor.ExecutorParameters(
            num_threads_inflight_multiplier=executor.MAX_MULTIPLIER,
        )

        self.assertEqual(
            params.num_threads_inflight_multiplier,
            executor.MAX_MULTIPLIER,
        )

    def test_threads_inflight_multiplier_above_max_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            executor.ExecutorParameters(
                num_threads_inflight_multiplier=executor.MAX_MULTIPLIER + 1,
            )

    def test_chunk_queue_size_multiplier_above_max_raises(self):
        with self.assertRaises(pydantic.ValidationError):
            executor.ExecutorParameters(
                chunk_queue_size_multiplier=executor.MAX_MULTIPLIER + 1,
            )

    def test_num_processes_zero_is_rejected(self):
        with self.assertRaises(pydantic.ValidationError):
            executor.ExecutorParameters(num_processes=0)

    def test_num_threads_zero_is_rejected(self):
        with self.assertRaises(pydantic.ValidationError):
            executor.ExecutorParameters(num_threads=0)


class TestExecutorParametersSettingsSources(unittest.TestCase):
    """Tests for the ``settings_customise_sources`` hook that filters None init kwargs."""

    def test_explicit_none_init_kwarg_falls_back_to_env(self):
        with mock.patch.dict(os.environ, {'OSMO_EXECUTOR_NUM_PROCESSES': '7'}):
            params = executor.ExecutorParameters(num_processes=None)

        self.assertEqual(params.num_processes, 7)

    def test_explicit_value_overrides_env(self):
        with mock.patch.dict(os.environ, {'OSMO_EXECUTOR_NUM_PROCESSES': '7'}):
            params = executor.ExecutorParameters(num_processes=4)

        self.assertEqual(params.num_processes, 4)

    def test_no_init_kwargs_uses_env(self):
        with mock.patch.dict(os.environ, {'OSMO_EXECUTOR_NUM_THREADS': '11'}):
            params = executor.ExecutorParameters()

        self.assertEqual(params.num_threads, 11)


class TestThreadWorkerInputAbstract(unittest.TestCase):
    """Tests for the abstract ``error_key`` method on ``ThreadWorkerInput``."""

    def test_error_key_on_base_class_raises_not_implemented(self):
        worker_input = TestWorkerInput(size=1, value=42)

        with self.assertRaises(NotImplementedError):
            # Bypass subclass override to exercise the abstract base body.
            executor.ThreadWorkerInput.error_key(worker_input)


class TestThreadWorkerOutputAbstract(unittest.TestCase):
    """Tests for the abstract dunder methods on ``ThreadWorkerOutput``."""

    def test_add_on_base_class_raises_not_implemented(self):
        worker_output = TestWorkerOutput(total=5)

        with self.assertRaises(NotImplementedError):
            # Bypass subclass override to exercise the abstract base body.
            executor.ThreadWorkerOutput.__add__(  # pylint: disable=unnecessary-dunder-call
                worker_output, None,
            )

    def test_iadd_on_base_class_raises_not_implemented(self):
        worker_output = TestWorkerOutput(total=5)

        with self.assertRaises(NotImplementedError):
            # Bypass subclass override to exercise the abstract base body.
            executor.ThreadWorkerOutput.__iadd__(  # pylint: disable=unnecessary-dunder-call
                worker_output, None,
            )

    def test_radd_returns_self_when_left_operand_is_none(self):
        worker_output = TestWorkerOutput(total=9)

        result = None + worker_output

        self.assertIs(result, worker_output)


class TestExecutorError(unittest.TestCase):
    """Tests for ``ExecutorError`` construction."""

    def test_stores_job_context_attribute(self):
        job_context: executor.JobContext[TestWorkerInput, TestWorkerOutput] = (
            executor.JobContext()
        )

        error = executor.ExecutorError('boom', job_context=job_context)

        self.assertIs(error.job_context, job_context)

    def test_passes_message_to_base_exception(self):
        job_context: executor.JobContext[TestWorkerInput, TestWorkerOutput] = (
            executor.JobContext()
        )

        error = executor.ExecutorError('boom', job_context=job_context)

        self.assertIn('boom', str(error))


class TestValidatePicklable(unittest.TestCase):
    """Tests for ``validate_picklable``."""

    def test_returns_true_for_simple_picklable_value(self):
        self.assertTrue(executor.validate_picklable(42))

    def test_returns_true_for_string(self):
        self.assertTrue(executor.validate_picklable('hello'))

    def test_returns_true_for_dict(self):
        self.assertTrue(executor.validate_picklable({'a': 1, 'b': [2, 3]}))

    def test_returns_false_for_lambda(self):
        self.assertFalse(executor.validate_picklable(lambda x: x))

    def test_returns_false_for_local_function(self):
        def _local_function():
            return 1

        self.assertFalse(executor.validate_picklable(_local_function))


class TestRunJobSingleProcess(unittest.TestCase):
    """Tests for ``run_job`` in single-process mode (``_run_in_process_job``)."""

    def test_run_job_single_process_single_thread_aggregates_outputs(self):
        job_context = executor.run_job(
            thread_worker=test_thread_worker,
            thread_worker_input_gen=test_worker_inputs(),
            client_factory=TestStorageClientFactory(),
            enable_progress_tracker=False,
            executor_params=executor.ExecutorParameters(
                num_processes=1,
                num_threads=1,
            ),
        )

        self.assertEqual(
            job_context.output.total if job_context.output is not None else None,
            6,
        )
        self.assertEqual(job_context.errors, [])

    def test_run_job_single_process_single_thread_records_timing(self):
        job_context = executor.run_job(
            thread_worker=test_thread_worker,
            thread_worker_input_gen=test_worker_inputs(),
            client_factory=TestStorageClientFactory(),
            enable_progress_tracker=False,
            executor_params=executor.ExecutorParameters(
                num_processes=1,
                num_threads=1,
            ),
        )

        self.assertIsNotNone(job_context.start_time)
        self.assertIsNotNone(job_context.end_time)

    def test_run_job_single_process_multi_thread_aggregates_outputs(self):
        job_context = executor.run_job(
            thread_worker=test_thread_worker,
            thread_worker_input_gen=test_worker_inputs(),
            client_factory=TestStorageClientFactory(),
            enable_progress_tracker=False,
            executor_params=executor.ExecutorParameters(
                num_processes=1,
                num_threads=4,
                num_threads_inflight_multiplier=1,
            ),
        )

        self.assertEqual(
            job_context.output.total if job_context.output is not None else None,
            6,
        )
        self.assertEqual(job_context.errors, [])


if __name__ == '__main__':
    unittest.main()
