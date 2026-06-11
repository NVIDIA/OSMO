"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Smoke: core API endpoints return 2xx.

import unittest

from test.oetf.smoke_fixture import SmokeFixture


class ApiChecks(SmokeFixture):
    """GET probes across health / api / config / data endpoints."""

    def test_health_core(self):
        self.http("GET", "/health").expect_ok()

    def test_api_version(self):
        self.http("GET", "/api/version").expect_ok()

    def test_list_workflows(self):
        self.http("GET", "/api/workflow").params(limit=5).expect_ok()

    def test_list_pools(self):
        self.http("GET", "/api/pool").expect_ok()

    def test_pool_quota(self):
        self.http("GET", "/api/pool_quota").expect_ok()

    def test_profile_settings(self):
        self.http("GET", "/api/profile/settings").expect_ok()

    def test_credentials_list(self):
        self.http("GET", "/api/credentials").expect_ok()

    def test_app_list(self):
        self.http("GET", "/api/app").expect_ok()

    def test_bucket_list(self):
        self.http("GET", "/api/bucket").expect_ok()

    def test_config_service(self):
        self.http("GET", "/api/configs/service").expect_ok()

    def test_config_workflow(self):
        self.http("GET", "/api/configs/workflow").expect_ok()


if __name__ == "__main__":
    unittest.main()
