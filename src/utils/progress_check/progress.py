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

import os
import time
import uuid

import aiofiles  # type: ignore
import aiofiles.os  # type: ignore


class ProgressWriter:
    '''Reports progress by writing the current time to a given progress file'''
    def __init__(self, filename: str):
        self._filename = filename
        self._dir = os.path.dirname(filename)
        os.makedirs(self._dir, exist_ok=True)

    def report_progress(self):
        temp_file = f'{self._filename}-{uuid.uuid4()}.tmp'
        # Write the current time to a temporary file
        with open(temp_file, 'w', encoding='utf-8') as file:
            file.write(str(time.time()))
        # Atomically replace the current file with the temp file
        os.replace(src=temp_file, dst=self._filename)

    async def report_progress_async(self):
        temp_file = f'{self._filename}-{uuid.uuid4()}.tmp'
        # Write the current time to a temporary file
        async with aiofiles.open(temp_file, mode='w', encoding='utf-8') as file:
            await file.write(str(time.time()))
        # Atomically replace the current file with the temp file
        await aiofiles.os.replace(temp_file, self._filename)

class ProgressReader:
    '''
    Reads the given progress file to determine if progress has been made within the given interval
    '''
    def __init__(self, filename: str):
        self._filename = filename

    def has_recent_progress(self, seconds: float) -> bool:
        '''Returns true if progress was made within the last N seconds, otherwise false'''
        try:
            with open(self._filename, encoding='utf-8') as file:
                last_progress = float(file.read().strip())
        except FileNotFoundError:
            print(f'Progress file {self._filename} does not exist')
            with open('/dev/termination-log', 'w', encoding='utf-8') as exit_file:
                exit_file.write(f'Progress file {self._filename} does not exist')
            return False
        current_time = time.time()
        progress = last_progress > current_time - seconds
        if not progress:
            print(f'Last progress for {self._filename} was {current_time - last_progress}s ago, ' \
                  f'expected < {seconds}')
            with open('/dev/termination-log', 'w', encoding='utf-8') as exit_file:
                exit_file.write(f'Last progress for {self._filename} was ' \
                                f'{current_time - last_progress}s ago, expected < {seconds}')
        return progress
