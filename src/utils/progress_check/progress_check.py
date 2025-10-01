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

import sys

import pydantic

from src.utils import static_config
from src.utils.progress_check import progress


class ProgressCheckConfig(static_config.StaticConfig):
    progress_interval: str = pydantic.Field(
        command_line='progress_interval',
        env='OSMO_PROGRESS_INTERVAL',
        default='10',
        description='Check for progress within the last <progress_interval> seconds. Exit with ' +
                    'code 0 if there was progress, otherwise exit with code 1. To check multiple ' +
                    'files, it may be a list of intervals separated by ":"')
    progress_file: str = pydantic.Field(
        command_line='progress_file',
        env='OSMO_PROGRESS_FILE',
        default='/var/run/osmo/last_progress',
        description='The file to read progress timestamps from (For liveness/startup probes). To ' +
                    'check multiple files, a list may be provided delimited by ":"')


def main():
    config = ProgressCheckConfig.load()
    intervals = config.progress_interval.split(':')
    files = config.progress_file.split(':')

    if len(intervals) != len(files):
        print('Must provide same number of intervals and files!')
        sys.exit(1)

    for interval, file in zip(intervals, files):
        reader = progress.ProgressReader(file)
        if not reader.has_recent_progress(float(interval)):
            sys.exit(1)
    sys.exit(0)

if __name__ == '__main__':
    main()
