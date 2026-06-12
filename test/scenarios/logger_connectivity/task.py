#!/usr/bin/env python3
"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# In-task logger connectivity probe: prints a log marker. The external
# test_runner asserts the marker is retrievable via the logs API, proving the
# stdout → ctrl → logger → DB → API pipeline.

import time

from task_fixture import TaskFixture


class LoggerProbe(TaskFixture):
    """Emits a log marker so the runner can assert it surfaces via the logs API."""

    def run_checks(self):
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        log_marker = f"OETF_LOGGER_PROBE_{timestamp}"
        print(f"[OETF-MARKER] {log_marker}", flush=True)
        self.record_pass("log:marker_written", log_marker)


if __name__ == "__main__":
    LoggerProbe().execute()
