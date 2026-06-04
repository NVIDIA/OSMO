#!/usr/bin/env python3
"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# In-task environment checks: DNS, env vars, mount writability, image pin.
#
# {{output}} is an OSMO template variable resolved at submission time.

import os
import sys

from task_fixture import TaskFixture


class TaskRuntimeEnvironmentCheck(TaskFixture):
    """Validates container environment from inside a task."""

    def run_checks(self):
        # 1. OSMO-injected environment variables
        osmo_vars = {k: v for k, v in os.environ.items()
                     if any(x in k.upper() for x in ["OSMO", "KUBERNETES"])}
        if osmo_vars:
            self.record_pass(
                "env:osmo_vars_present",
                f"Found {len(osmo_vars)} vars: {list(osmo_vars.keys())[:10]}",
            )
        else:
            self.record_fail("env:osmo_vars_present", "no OSMO/KUBERNETES env vars")

        # 2. Mounts writable — OSMO output mount + standard /tmp
        self.check_mounts_writable(["{{output}}", "/tmp"])

        # 3. DNS resolution — verify cluster DNS works
        self.check_dns(["kubernetes.default.svc.cluster.local"])

        # 4. Python runtime sanity — confirms the image pin actually takes effect
        if sys.version_info >= (3, 9):
            self.record_pass(
                "python:version",
                f"Python {sys.version_info.major}.{sys.version_info.minor}",
            )
        else:
            self.record_fail(
                "python:version",
                f"Python {sys.version_info.major}.{sys.version_info.minor} < 3.9",
            )


if __name__ == "__main__":
    TaskRuntimeEnvironmentCheck().execute()
