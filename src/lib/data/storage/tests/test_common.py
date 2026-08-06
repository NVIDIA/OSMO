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
Unit tests for the storage common module.
"""

import contextlib
import datetime
import io
import logging
import os
import re
import tempfile
import unittest

from src.lib.data.storage import common, metrics
from src.lib.data.storage.core import executor
from src.lib.data.storage.tests.executor_test_helpers import (
    TestStorageClientFactory,
    test_thread_worker,
    test_worker_inputs,
)


def _drain_generator(gen):
    """Consume a generator fully and return (yielded_items, StopIteration.value)."""
    items = []
    return_value = None
    try:
        while True:
            items.append(next(gen))
    except StopIteration as stop:
        return_value = stop.value
    return items, return_value


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

    def test_get_upload_relative_path_has_asterisk_flag(self):
        """
        When ``has_asterisk=True`` the base path is treated as the exact directory to
        resolve the file against (no dirname stripping).
        """
        self.assertEqual(
            common.get_upload_relative_path(
                '/a/b/c/d/1.txt',
                '/a/b/c',
                has_asterisk=True,
            ),
            'd/1.txt',
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

    def test_multi_process_executor_runs_job_with_explicit_context(self):
        job_context = executor.run_job(
            thread_worker=test_thread_worker,
            thread_worker_input_gen=test_worker_inputs(),
            client_factory=TestStorageClientFactory(),
            enable_progress_tracker=False,
            executor_params=executor.ExecutorParameters(
                num_processes=2,
                num_threads=1,
                num_threads_inflight_multiplier=1,
                chunk_queue_size_multiplier=1,
            ),
        )

        self.assertEqual(job_context.output.total if job_context.output else None, 6)
        self.assertEqual(job_context.errors, [])


class TestOperationSummary(unittest.TestCase):
    """
    Tests for :class:`common.OperationSummary` — elapsed_time and to_metrics.
    """

    def test_elapsed_time_uses_explicit_end_time(self):
        start = datetime.datetime(2026, 1, 1, 0, 0, 0)
        end = datetime.datetime(2026, 1, 1, 0, 0, 5)
        summary = common.OperationSummary(start_time=start, end_time=end)
        self.assertEqual(summary.elapsed_time, datetime.timedelta(seconds=5))

    def test_elapsed_time_falls_back_to_current_time_when_end_is_none(self):
        """When ``end_time`` is None, ``elapsed_time`` falls back to :func:`current_time`."""
        start = datetime.datetime.utcnow() - datetime.timedelta(seconds=1)
        summary = common.OperationSummary(start_time=start, end_time=None)
        elapsed = summary.elapsed_time
        self.assertGreaterEqual(elapsed.total_seconds(), 1.0)
        self.assertLess(elapsed.total_seconds(), 60.0)

    def test_to_metrics_produces_operation_metrics_with_explicit_end_time(self):
        start = datetime.datetime(2026, 1, 1, 0, 0, 0)
        end = datetime.datetime(2026, 1, 1, 0, 0, 2)
        summary = common.OperationSummary(start_time=start, end_time=end)
        result = summary.to_metrics()
        self.assertIsInstance(result, metrics.OperationMetrics)
        self.assertEqual(result.start_time_ms, int(start.timestamp() * 1000))
        self.assertEqual(result.end_time_ms, int(end.timestamp() * 1000))
        self.assertEqual(result.duration_ms, 2000)

    def test_to_metrics_uses_current_time_when_end_is_none(self):
        start = datetime.datetime.utcnow() - datetime.timedelta(seconds=1)
        summary = common.OperationSummary(start_time=start, end_time=None)
        result = summary.to_metrics()
        self.assertGreaterEqual(result.duration_ms, 1000)


class TestOperationStream(unittest.TestCase):
    """
    Tests for :class:`common.OperationStream` — iteration, send, throw, close.
    """

    @staticmethod
    def _yields_then_returns():
        yield 1
        yield 2
        return 'done'

    def test_iter_yields_items_and_captures_summary(self):
        stream = common.OperationStream(self._yields_then_returns())
        # __iter__ returns self.
        self.assertIs(iter(stream), stream)
        # summary is None before exhaustion.
        self.assertIsNone(stream.summary)

        items = list(stream)
        self.assertEqual(items, [1, 2])
        self.assertEqual(stream.summary, 'done')

    def test_next_captures_summary_on_stop_iteration(self):
        stream = common.OperationStream(self._yields_then_returns())
        self.assertEqual(next(stream), 1)
        self.assertEqual(next(stream), 2)
        with self.assertRaises(StopIteration):
            next(stream)
        self.assertEqual(stream.summary, 'done')

    def test_send_forwards_values_and_captures_summary(self):
        def gen():
            yield 1
            yield 2
            return 'sent-done'

        stream = common.OperationStream(gen())
        # ``send(None)`` is equivalent to next; it advances to each yield in turn.
        self.assertEqual(stream.send(None), 1)
        self.assertEqual(stream.send(None), 2)
        with self.assertRaises(StopIteration):
            stream.send(None)
        self.assertEqual(stream.summary, 'sent-done')

    def test_throw_propagates_and_captures_summary_on_generator_return(self):
        def gen():
            try:
                yield 1
            except ValueError:
                return 'caught'
            yield 2  # pragma: no cover — not reached

        stream = common.OperationStream(gen())
        self.assertEqual(next(stream), 1)
        with self.assertRaises(StopIteration):
            stream.throw(ValueError)
        self.assertEqual(stream.summary, 'caught')

    def test_throw_propagates_exception_when_generator_does_not_catch(self):
        def gen():
            yield 1
            yield 2  # pragma: no cover — throw preempts second yield.

        stream = common.OperationStream(gen())
        self.assertEqual(next(stream), 1)
        with self.assertRaises(RuntimeError):
            stream.throw(RuntimeError)

    def test_close_delegates_to_underlying_generator(self):
        def gen():
            yield 1
            yield 2  # pragma: no cover — close preempts second yield.

        stream = common.OperationStream(gen())
        self.assertEqual(next(stream), 1)
        stream.close()
        # After close, next raises StopIteration.
        with self.assertRaises(StopIteration):
            next(stream)


def _sample_summary(marker: int = 0) -> common.OperationSummary:
    """Build a minimal :class:`OperationSummary` for use as an OperationIO finalize value."""
    base = datetime.datetime(2026, 1, 1, 0, 0, 0)
    return common.OperationSummary(
        start_time=base,
        end_time=base + datetime.timedelta(seconds=marker),
    )


class TestOperationIO(unittest.TestCase):
    """
    Tests for :class:`common.OperationIO` — read/close semantics and summary capture.
    """

    def _make_io(
        self,
        payload: bytes = b'hello world',
        summary_seconds: int = 1,
    ) -> common.OperationIO[io.BytesIO, common.OperationSummary]:
        def open_with_stack(stack: contextlib.ExitStack) -> io.BytesIO:
            del stack  # unused
            return io.BytesIO(payload)

        def finalize(delegate: io.BytesIO) -> common.OperationSummary:
            del delegate  # unused
            return _sample_summary(summary_seconds)

        return common.OperationIO(open_with_stack, finalize)

    def test_read_returns_underlying_bytes(self):
        op_io = self._make_io(b'payload')
        try:
            self.assertEqual(op_io.read(), b'payload')
        finally:
            op_io.close()

    def test_read_rejects_n_less_than_negative_one(self):
        op_io = self._make_io()
        try:
            with self.assertRaises(ValueError):
                op_io.read(-2)
        finally:
            op_io.close()

    def test_readable_returns_true(self):
        op_io = self._make_io()
        try:
            self.assertTrue(op_io.readable())
        finally:
            op_io.close()

    def test_context_manager_closes_and_populates_summary(self):
        op_io = self._make_io(b'ctx-data', summary_seconds=3)
        with op_io as inside:
            self.assertIs(inside, op_io)
            self.assertEqual(inside.read(), b'ctx-data')
            self.assertIsNone(inside.summary)
        # After __exit__, close was called and summary is populated.
        self.assertIsNotNone(op_io.summary)
        self.assertEqual(op_io.summary, _sample_summary(3))

    def test_close_finalizes_via_exit_stack_and_delegate(self):
        """``close`` closes the exit stack and calls ``finalize`` on the delegate."""
        stack_closed = {'called': False}
        finalize_delegate: dict[str, io.BytesIO | None] = {'value': None}

        class _Cleanup:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, exc_type, exc_val, exc_tb):
                stack_closed['called'] = True

        def open_with_stack(stack: contextlib.ExitStack) -> io.BytesIO:
            stack.enter_context(_Cleanup())
            return io.BytesIO(b'x')

        def finalize(delegate: io.BytesIO) -> common.OperationSummary:
            finalize_delegate['value'] = delegate
            return _sample_summary(2)

        op_io = common.OperationIO(open_with_stack, finalize)
        op_io.close()

        self.assertTrue(stack_closed['called'])
        self.assertIsNotNone(finalize_delegate['value'])
        self.assertEqual(op_io.summary, _sample_summary(2))

    def test_close_is_idempotent_no_double_finalize(self):
        finalize_calls = {'n': 0}

        def open_with_stack(stack: contextlib.ExitStack) -> io.BytesIO:
            del stack
            return io.BytesIO(b'')

        def finalize(delegate: io.BytesIO) -> common.OperationSummary:
            del delegate
            finalize_calls['n'] += 1
            return _sample_summary()

        op_io = common.OperationIO(open_with_stack, finalize)
        op_io.close()
        op_io.close()  # Second close should return early on ``super().closed``.
        self.assertEqual(finalize_calls['n'], 1)


class TestOperationError(unittest.TestCase):
    """
    Tests for :class:`common.OperationError`.
    """

    def _make_summary(self):
        start = datetime.datetime(2026, 1, 1, 0, 0, 0)
        end = datetime.datetime(2026, 1, 1, 0, 0, 3)
        return common.TransferSummary(
            start_time=start,
            end_time=end,
            size=10,
            size_transferred=8,
            count=2,
            count_transferred=1,
        )

    def test_init_stores_summary_and_message(self):
        summary = self._make_summary()
        err = common.OperationError('failed', summary=summary)
        self.assertIs(err.summary, summary)
        self.assertIn('failed', str(err))

    def test_to_metrics_delegates_to_summary(self):
        summary = self._make_summary()
        err = common.OperationError('failed', summary=summary)
        self.assertEqual(err.to_metrics(), summary.to_metrics())


class TestTransferWorkerOutput(unittest.TestCase):
    """
    Tests for :class:`common.TransferWorkerOutput` — __add__ and __iadd__.
    """

    @staticmethod
    def _make(**overrides):
        defaults = {
            'retries': 1,
            'size': 100,
            'size_transferred': 80,
            'count': 5,
            'count_transferred': 4,
        }
        defaults.update(overrides)
        return common.TransferWorkerOutput(**defaults)

    def test_add_with_none_returns_self(self):
        left = self._make()
        result = left + None
        self.assertIs(result, left)

    def test_add_with_other_returns_new_instance_with_summed_fields(self):
        left = self._make()
        right = self._make(retries=2, size=50, size_transferred=25, count=3, count_transferred=2)
        result = left + right
        self.assertIsNot(result, left)
        self.assertIsNot(result, right)
        self.assertEqual(result.retries, 3)
        self.assertEqual(result.size, 150)
        self.assertEqual(result.size_transferred, 105)
        self.assertEqual(result.count, 8)
        self.assertEqual(result.count_transferred, 6)
        # Originals are unmodified.
        self.assertEqual(left.retries, 1)
        self.assertEqual(right.retries, 2)

    def test_iadd_with_none_returns_self_unchanged(self):
        left = self._make()
        left += None
        self.assertEqual(left.retries, 1)
        self.assertEqual(left.size, 100)

    def test_iadd_with_other_accumulates_fields_in_place(self):
        left = self._make()
        right = self._make(retries=2, size=50, size_transferred=25, count=3, count_transferred=2)
        left_id = id(left)
        left += right
        self.assertEqual(id(left), left_id)
        self.assertEqual(left.retries, 3)
        self.assertEqual(left.size, 150)
        self.assertEqual(left.size_transferred, 105)
        self.assertEqual(left.count, 8)
        self.assertEqual(left.count_transferred, 6)


class TestTransferSummary(unittest.TestCase):
    """
    Tests for :class:`common.TransferSummary` — from_job_context and to_metrics.
    """

    def test_from_job_context_no_output_returns_zeroed_summary(self):
        """When ``job_context.output`` is None, summary contains only timing + errors."""
        with executor.JobContext[
            executor.ThreadWorkerInput,
            common.TransferWorkerOutput,
        ]() as job_context:
            job_context.output = None
            job_context.errors = [ValueError('failure-1'), RuntimeError('failure-2')]

        summary = common.TransferSummary.from_job_context(job_context)
        self.assertEqual(summary.start_time, job_context.start_time)
        self.assertEqual(summary.end_time, job_context.end_time)
        self.assertEqual(summary.size, 0)
        self.assertEqual(summary.size_transferred, 0)
        self.assertEqual(summary.count, 0)
        self.assertEqual(summary.count_transferred, 0)
        self.assertEqual(summary.retries, 0)
        self.assertEqual(len(summary.failures), 2)
        self.assertIn('failure-1', summary.failures[0])
        self.assertIn('failure-2', summary.failures[1])

    def test_from_job_context_with_output_populates_transfer_fields(self):
        with executor.JobContext[
            executor.ThreadWorkerInput,
            common.TransferWorkerOutput,
        ]() as job_context:
            job_context.output = common.TransferWorkerOutput(
                retries=3,
                size=200,
                size_transferred=150,
                count=10,
                count_transferred=7,
            )
            job_context.errors = [Exception('boom')]

        summary = common.TransferSummary.from_job_context(job_context)
        self.assertEqual(summary.retries, 3)
        self.assertEqual(summary.size, 200)
        self.assertEqual(summary.size_transferred, 150)
        self.assertEqual(summary.count, 10)
        self.assertEqual(summary.count_transferred, 7)
        self.assertEqual(summary.failures, ['boom'])

    def test_to_metrics_returns_transfer_metrics_with_derived_fields(self):
        start = datetime.datetime(2026, 1, 1, 0, 0, 0)
        end = datetime.datetime(2026, 1, 1, 0, 0, 4)  # 4-second window.
        summary = common.TransferSummary(
            start_time=start,
            end_time=end,
            size=1_000_000,
            size_transferred=500_000,
            count=10,
            count_transferred=5,
        )
        result = summary.to_metrics()
        self.assertIsInstance(result, metrics.TransferMetrics)
        self.assertEqual(result.total_bytes_transferred, 500_000)
        self.assertEqual(result.total_number_of_files, 5)
        # OperationMetrics fields are inherited from the parent implementation.
        self.assertEqual(result.duration_ms, 4000)
        # average_mbps = round((500000 * 8) / (1_000_000 * 4)) = 1
        self.assertEqual(result.average_mbps, 1)


class TestListLocalFiles(unittest.TestCase):
    """
    Tests for :func:`common.list_local_files` — filesystem walking, regex, and error paths.
    """

    def test_yields_single_regular_file(self):
        with tempfile.NamedTemporaryFile('wb', delete=False) as tmp_file:
            tmp_file.write(b'hello-file')
            file_path = tmp_file.name
        try:
            items, errors = _drain_generator(common.list_local_files(file_path))
            self.assertEqual(errors, [])
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0].size, len(b'hello-file'))
            self.assertEqual(items[0].abs_path, file_path)
            self.assertEqual(items[0].rel_path, os.path.basename(file_path))
        finally:
            os.unlink(file_path)

    def test_yields_directory_files_in_lexicographic_order(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            # Create files in non-alphabetic order to prove ``files.sort()`` runs.
            for name in ['zeta.txt', 'alpha.txt', 'mid.txt']:
                with open(os.path.join(tmp_dir, name), 'wb') as f:
                    f.write(b'x' * len(name))

            items, errors = _drain_generator(common.list_local_files(tmp_dir))
            self.assertEqual(errors, [])
            rel_paths = [item.rel_path for item in items]
            base = os.path.basename(tmp_dir.rstrip(os.sep))
            self.assertEqual(rel_paths, [
                os.path.join(base, 'alpha.txt'),
                os.path.join(base, 'mid.txt'),
                os.path.join(base, 'zeta.txt'),
            ])
            for item in items:
                self.assertGreater(item.size, 0)
                self.assertTrue(os.path.isabs(item.abs_path))

    def test_regex_pattern_filters_yielded_files(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            for name in ['keep_me.txt', 'skip_me.log', 'also_keep.txt']:
                with open(os.path.join(tmp_dir, name), 'wb') as f:
                    f.write(b'data')

            pattern = re.compile(r'.*\.txt$')
            items, errors = _drain_generator(
                common.list_local_files(tmp_dir, regex_pattern=pattern),
            )
            self.assertEqual(errors, [])
            rel_paths = sorted(item.rel_path for item in items)
            base = os.path.basename(tmp_dir.rstrip(os.sep))
            self.assertEqual(rel_paths, [
                os.path.join(base, 'also_keep.txt'),
                os.path.join(base, 'keep_me.txt'),
            ])

    def test_regex_pattern_with_no_matches_logs_warning(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            with open(os.path.join(tmp_dir, 'a.log'), 'wb') as f:
                f.write(b'not-a-match')

            pattern = re.compile(r'.*\.NOPE$')
            with self.assertLogs(common.__name__, level=logging.WARNING) as log_capture:
                items, errors = _drain_generator(
                    common.list_local_files(tmp_dir, regex_pattern=pattern),
                )
            self.assertEqual(items, [])
            self.assertEqual(errors, [])
            self.assertTrue(
                any('No entries matched regex' in line for line in log_capture.output),
                f'expected "No entries matched regex" warning, got: {log_capture.output}',
            )

    def test_has_asterisk_on_non_directory_records_error(self):
        with tempfile.NamedTemporaryFile('wb', delete=False) as tmp_file:
            tmp_file.write(b'file-content')
            file_path = tmp_file.name
        try:
            items, errors = _drain_generator(
                common.list_local_files(file_path, has_asterisk=True),
            )
            self.assertEqual(items, [])
            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], common.ListLocalFilesError)
            self.assertIn('is not a directory', str(errors[0]))
        finally:
            os.unlink(file_path)

    def test_non_regular_non_directory_records_error(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            fifo_path = os.path.join(tmp_dir, 'named_pipe')
            os.mkfifo(fifo_path)
            items, errors = _drain_generator(common.list_local_files(fifo_path))
            self.assertEqual(items, [])
            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], common.ListLocalFilesError)
            self.assertIn('is not a regular file or directory', str(errors[0]))

    def test_nonexistent_path_records_oserror(self):
        missing_path = os.path.join('/tmp', 'osmo-testbot-nonexistent-path-xyz-123')
        # Ensure the path really is missing.
        self.assertFalse(os.path.exists(missing_path))

        items, errors = _drain_generator(common.list_local_files(missing_path))
        self.assertEqual(items, [])
        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], common.ListLocalFilesError)
        self.assertIn('cannot be accessed by OSMO', str(errors[0]))


if __name__ == '__main__':
    unittest.main()
