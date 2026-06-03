"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Smoke: WebSocket handshake against the logger stream endpoint.

import unittest

from test.oetf.smoke_fixture import SmokeFixture


class WebsocketChecks(SmokeFixture):
    """WebSocket connectivity probes."""

    def test_logger_stream_handshake(self):
        self.ws("/api/logger/workflow/oetf-probe/osmo_ctrl/probe/retry_id/0") \
            .timeout(10) \
            .expect_connect()


if __name__ == "__main__":
    unittest.main()
