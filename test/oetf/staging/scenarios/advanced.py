"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Advanced / cross-cutting workflows (multi-arch, transfer service, Python SDK).
#
# Kept in one file for convenience — each test stands alone but shares no
# class-level defaults with its neighbors.

import unittest

from test.oetf.runner_fixture import RunnerFixture


class AdvancedWorkflows(RunnerFixture):
    """Misc. cross-cutting workflow scenarios."""

    timeout = "10m"

    # test_python_library_data_test, test_multi_arch_containers, and
    # test_transfer_service_workflow stay in the internal overlay package.
    # They depend on the internal pypi index, heterogeneous pool, or the
    # transfer_service runfiles which aren't shipped publicly.

    def test_folder_input(self):
        """Dataset localpath upload — requires CLI-mode submission (api-mode
        can't upload a directory tree)."""
        self.workflow("test/workflow/folder_input.yaml") \
            .client("cli") \
            .expect_completed()


if __name__ == "__main__":
    unittest.main()
