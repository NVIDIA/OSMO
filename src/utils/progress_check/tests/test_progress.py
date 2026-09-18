# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Liveness contract for ProgressWriter stamps and ProgressReader staleness decisions."""

import asyncio
import builtins
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

from src.utils.progress_check import progress


TERMINATION_LOG = '/dev/termination-log'


class TerminationLogRedirect:
    """Redirect writes of the container termination log to a temporary file."""

    def __init__(self, replacement: str):
        self._replacement = replacement
        self._real_open = builtins.open

    def __call__(self, file, *args, **kwargs):
        if file == TERMINATION_LOG:
            return self._real_open(self._replacement, *args, **kwargs)
        return self._real_open(file, *args, **kwargs)


class ProgressWriterTests(unittest.TestCase):
    """The writer must publish a parseable timestamp and leave no temp files behind."""

    def setUp(self) -> None:
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        self.progress_file = os.path.join(directory, 'nested', 'progress')

    def test_writers_atomically_replace_the_previous_timestamp(self) -> None:
        writer = progress.ProgressWriter(self.progress_file)
        real_replace = os.replace

        def replace(src, dst):
            self.assertEqual(Path(dst).read_text(encoding='utf-8'), '1.0')
            self.assertEqual(Path(src).read_text(encoding='utf-8'), '1000.0')
            self.assertEqual(Path(src).parent, Path(dst).parent)
            real_replace(src, dst)

        for asynchronous in (False, True):
            with self.subTest(asynchronous=asynchronous):
                Path(self.progress_file).write_text('1.0', encoding='utf-8')
                with mock.patch.object(progress.time, 'time', return_value=1000.0):
                    if asynchronous:
                        with mock.patch.object(
                            progress.aiofiles.os, 'replace',
                            new=mock.AsyncMock(side_effect=replace),
                        ) as publish:
                            asyncio.run(writer.report_progress_async())
                    else:
                        with mock.patch.object(
                            progress.os, 'replace', side_effect=replace,
                        ) as publish:
                            writer.report_progress()
                publish.assert_called_once()
                self.assertEqual(
                    Path(self.progress_file).read_text(encoding='utf-8'), '1000.0')
                self.assertEqual(
                    [entry.name for entry in Path(self.progress_file).parent.iterdir()],
                    ['progress'],
                )


class ProgressReaderTests(unittest.TestCase):
    """Staleness decisions must be reported to the termination log in both failure modes."""

    def setUp(self) -> None:
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        self.progress_file = os.path.join(directory, 'progress')
        self.termination_log = os.path.join(directory, 'termination-log')
        redirect = TerminationLogRedirect(self.termination_log)
        patcher = mock.patch('builtins.open', redirect)
        patcher.start()
        self.addCleanup(patcher.stop)
        clock = mock.patch.object(progress.time, 'time', return_value=1000.0)
        clock.start()
        self.addCleanup(clock.stop)

    def termination_message(self) -> str:
        return Path(self.termination_log).read_text(encoding='utf-8')

    def test_fresh_timestamp_does_not_write_termination_log(self) -> None:
        Path(self.progress_file).write_text('940.001', encoding='utf-8')
        reader = progress.ProgressReader(self.progress_file)

        self.assertTrue(reader.has_recent_progress(60.0))
        self.assertFalse(Path(self.termination_log).exists())

    def test_stale_and_exact_boundary_timestamps_report_failure(self) -> None:
        for timestamp in (400.0, 940.0):
            with self.subTest(timestamp=timestamp):
                Path(self.progress_file).write_text(str(timestamp), encoding='utf-8')
                reader = progress.ProgressReader(self.progress_file)
                self.assertFalse(reader.has_recent_progress(60.0))
                self.assertEqual(
                    self.termination_message(),
                    f'Last progress for {self.progress_file} was '
                    f'{1000.0 - timestamp}s ago, expected < 60.0',
                )

    def test_has_recent_progress_reports_missing_file_to_termination_log(self) -> None:
        reader = progress.ProgressReader(self.progress_file)

        self.assertFalse(reader.has_recent_progress(60.0))

        self.assertEqual(
            self.termination_message(),
            f'Progress file {self.progress_file} does not exist',
        )

    def test_has_recent_progress_tolerates_surrounding_whitespace(self) -> None:
        Path(self.progress_file).write_text(
            '  1000.0\n', encoding='utf-8'
        )
        reader = progress.ProgressReader(self.progress_file)

        self.assertTrue(reader.has_recent_progress(60.0))

    def test_has_recent_progress_written_stamp_is_considered_recent(self) -> None:
        writer = progress.ProgressWriter(self.progress_file)
        writer.report_progress()
        reader = progress.ProgressReader(self.progress_file)

        self.assertTrue(reader.has_recent_progress(60.0))

    def test_has_recent_progress_written_stamp_is_stale_for_zero_interval(self) -> None:
        writer = progress.ProgressWriter(self.progress_file)
        writer.report_progress()
        reader = progress.ProgressReader(self.progress_file)

        self.assertFalse(reader.has_recent_progress(0.0))


if __name__ == '__main__':
    unittest.main()
