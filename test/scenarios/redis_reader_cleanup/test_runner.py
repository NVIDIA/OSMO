"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import os
import subprocess
import time
import unittest

from test.oetf.runner_fixture import RunnerFixture


KUBE_CONTEXT = "kind-osmo"
NAMESPACE = "osmo"
DISCONNECT_COUNT = 20
TASK_NAME = "quiet-logger"


def _kubectl(*args: str, timeout: int = 30) -> str:
    result = subprocess.run(
        ["kubectl", "--context", KUBE_CONTEXT, "-n", NAMESPACE, *args],
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return result.stdout.strip()


def _redis_topology() -> tuple[set[str], str, str]:
    service_ips = set(_kubectl(
        "get", "pods", "-l", "app=osmo-service",
        "-o", "jsonpath={range .items[*]}{.status.podIP}{'\\n'}{end}",
    ).splitlines())
    if not service_ips:
        raise RuntimeError("no osmo-service pod IPs found")

    redis_pod = _kubectl(
        "get", "pods", "-l", "app=redis",
        "-o", "jsonpath={.items[0].metadata.name}",
    )
    service_pod = _kubectl(
        "get", "pods", "-l", "app=osmo-service",
        "-o", "jsonpath={.items[0].metadata.name}",
    )
    return service_ips, redis_pod, service_pod


def _redis_xread_clients_from_service(
    service_ips: set[str], redis_pod: str,
) -> int:
    clients = _kubectl("exec", redis_pod, "--", "redis-cli", "CLIENT", "LIST")
    return sum(
        1 for line in clients.splitlines()
        if "cmd=xread" in line
        and any(f"addr={service_ip}:" in line for service_ip in service_ips)
    )


def _disconnect_local_log_streams(
    service_pod: str, workflow_id: str, username: str,
) -> None:
    script = """
import http.client
import sys

for _ in range(int(sys.argv[3])):
    connection = http.client.HTTPConnection("127.0.0.1", 8000, timeout=2)
    connection.request(
        "GET",
        f"/api/workflow/{sys.argv[1]}/logs",
        headers={"x-osmo-user": sys.argv[2]},
    )
    response = connection.getresponse()
    if response.status != 200:
        raise RuntimeError(f"live log request returned HTTP {response.status}")
    try:
        response.read()
    except TimeoutError:
        pass
    else:
        raise RuntimeError("live log request ended before the forced disconnect")
    finally:
        connection.close()
"""
    _kubectl(
        "exec", service_pod, "-c", "osmo-service", "--",
        "python3", "-c", script, workflow_id, username, str(DISCONNECT_COUNT),
        timeout=60,
    )


class RedisReaderCleanup(RunnerFixture):
    """Disconnected live-log clients do not retain Redis readers."""

    timeout = "5m"

    def test_disconnected_log_streams_release_redis_readers(self):
        if os.environ.get("OETF_ENV") != "kind":
            self.skipTest("Redis client inspection is available only in KIND")

        handle = self.workflow("spec.yaml").submit()
        try:
            handle.wait_for_task_running(TASK_NAME)
            service_ips, redis_pod, service_pod = _redis_topology()
            baseline = _redis_xread_clients_from_service(service_ips, redis_pod)

            _disconnect_local_log_streams(
                service_pod, handle.workflow_id, self.config.auth_username,
            )

            deadline = time.monotonic() + 30
            observed = _redis_xread_clients_from_service(service_ips, redis_pod)
            while observed != baseline and time.monotonic() < deadline:
                time.sleep(1)
                observed = _redis_xread_clients_from_service(service_ips, redis_pod)

            self.assertLessEqual(
                observed,
                baseline,
                f"{observed - baseline} additional Redis XREAD clients remained after "
                f"{DISCONNECT_COUNT} live-log clients disconnected",
            )
        finally:
            handle.cancel()


if __name__ == "__main__":
    unittest.main()
