"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Router-connectivity scenario: exec + port-forward through the OSMO router.
#
# Once `router-target` reaches RUNNING, exercise both router-backed CLI paths
# from outside the cluster, then cancel — expected outcome is FAILED_CANCELED.

import unittest

from test.oetf.runner_fixture import RunnerFixture, curl_until

# Kept in sync with staging/scenarios/router_connectivity/task.py.
SENTINEL_CONTENT = "OETF_ROUTER_SENTINEL_c5b41e"
SENTINEL_FILE = "sentinel.txt"
TASK_NAME = "router-target"
IN_TASK_HTTP_PORT = 8080
LOCAL_HTTP_PORT = 18080
IN_TASK_WORKSPACE = "/workspace"


class RouterConnectivity(RunnerFixture):
    """Router scenario: exec + port-forward probes, then cancel."""

    timeout = "10m"

    def test_router_connectivity(self):
        self.login_cli()
        handle = self.workflow("spec.yaml").submit()
        handle.wait_for_task_running(TASK_NAME)

        # Probe 1: exec — fetch the sentinel file via `osmo workflow exec`.
        # Wait for the in-task checkpoint so the sentinel is guaranteed on
        # disk before we `cat` it (RUNNING alone doesn't imply task.py has
        # written anything yet).
        handle.wait_for_task_checkpoint("sentinel_written", task_name=TASK_NAME)
        output = handle.cli_exec(
            TASK_NAME, f"cat {IN_TASK_WORKSPACE}/{SENTINEL_FILE}",
        )
        self.assertIn(
            SENTINEL_CONTENT, output,
            f"sentinel missing from exec output: {output[:300]!r}",
        )

        # Probe 2: port-forward + curl — fetch the sentinel file over HTTP
        # via `osmo workflow port-forward`. Wait for the in-task HTTP server
        # to be bound before starting the forward.
        handle.wait_for_task_checkpoint("http_listening", task_name=TASK_NAME)
        with handle.cli_port_forward(TASK_NAME, LOCAL_HTTP_PORT, IN_TASK_HTTP_PORT):
            curl_until(
                f"http://localhost:{LOCAL_HTTP_PORT}/{SENTINEL_FILE}",
                match=SENTINEL_CONTENT,
                deadline_seconds=30,
            )

        handle.cancel()
        handle.expect_outcome("failed")


if __name__ == "__main__":
    unittest.main()
