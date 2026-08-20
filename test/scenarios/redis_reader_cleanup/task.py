#!/usr/bin/env python3
"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import time

from task_fixture import TaskFixture


class QuietLogger(TaskFixture):
    """Emit one line, then stay quiet while clients disconnect."""

    def run_checks(self):
        print("OETF_REDIS_READER_READY", flush=True)
        self.record_pass("log:ready", "quiet log stream is available")
        time.sleep(240)


if __name__ == "__main__":
    QuietLogger().execute()
