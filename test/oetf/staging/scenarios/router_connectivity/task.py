#!/usr/bin/env python3
"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# In-task router probe: writes a sentinel, serves it over HTTP, keeps the task
# alive so the external test_runner.py can exec/port-forward via the router.
#
# Expected terminal status is FAILED_CANCELED — the runner cancels after probing.

import http.server
import os
import socketserver
import threading
import time

from task_fixture import TaskFixture

# Shared with test_runner.py — keep in sync.
OETF_ROUTER_SENTINEL_CONTENT = "OETF_ROUTER_SENTINEL_c5b41e"
OETF_ROUTER_SENTINEL_FILE = "sentinel.txt"
OETF_ROUTER_HTTP_PORT = 8080
OETF_ROUTER_KEEPALIVE_SECONDS = 200
OETF_ROUTER_WORKSPACE_DIR = "/workspace"


class RouterProbe(TaskFixture):
    """Writes a sentinel, serves it over HTTP, and keeps the task alive.

    Emits two checkpoints so the external test_runner can sync before
    exec/port-forward probes:
      - "sentinel_written": sentinel file exists on disk (runner can `cat`).
      - "http_listening":   HTTP server bound (runner can port-forward + curl).
    """

    def run_checks(self):
        # Prepare a workspace directory the HTTP server will serve.
        with self.record_check("workspace:prepare") as check:
            os.makedirs(OETF_ROUTER_WORKSPACE_DIR, exist_ok=True)
            if not os.access(OETF_ROUTER_WORKSPACE_DIR, os.W_OK):
                raise OSError(f"{OETF_ROUTER_WORKSPACE_DIR} not writable")
            check.message = OETF_ROUTER_WORKSPACE_DIR

        sentinel_workspace = os.path.join(
            OETF_ROUTER_WORKSPACE_DIR, OETF_ROUTER_SENTINEL_FILE,
        )
        with self.record_check("sentinel:written") as check:
            with open(sentinel_workspace, "w", encoding="utf-8") as handle:
                handle.write(OETF_ROUTER_SENTINEL_CONTENT)
            check.message = OETF_ROUTER_SENTINEL_CONTENT

        self.checkpoint("sentinel_written", message=sentinel_workspace)

        if _start_http_server(OETF_ROUTER_WORKSPACE_DIR, OETF_ROUTER_HTTP_PORT):
            self.record_pass(
                f"http:listen:{OETF_ROUTER_HTTP_PORT}",
                f"serving {OETF_ROUTER_WORKSPACE_DIR}",
            )
            self.checkpoint(
                "http_listening", message=f"port={OETF_ROUTER_HTTP_PORT}",
            )
        else:
            self.record_fail(
                f"http:listen:{OETF_ROUTER_HTTP_PORT}",
                f"failed to bind {OETF_ROUTER_WORKSPACE_DIR}",
            )

        # Keep task alive for external runner to exec/port-forward into.
        print(
            f"[OETF-ROUTER] probe ready; sleeping {OETF_ROUTER_KEEPALIVE_SECONDS}s",
            flush=True,
        )
        time.sleep(OETF_ROUTER_KEEPALIVE_SECONDS)


def _start_http_server(serve_dir: str, port: int) -> bool:
    """Start SimpleHTTPRequestHandler in a background daemon thread."""
    try:
        os.chdir(serve_dir)
    except OSError as error:
        print(f"[OETF-ROUTER] chdir({serve_dir}) failed: {error}", flush=True)
        return False

    class _QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, format, *args):  # pylint: disable=redefined-builtin
            # Keep logs tidy for test output.
            return

    try:
        httpd = socketserver.TCPServer(("0.0.0.0", port), _QuietHandler)
    except OSError as error:
        print(f"[OETF-ROUTER] bind({port}) failed: {error}", flush=True)
        return False

    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return True


if __name__ == "__main__":
    RouterProbe().execute()
