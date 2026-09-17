"""Submit a workflow through MCP and verify completion and logs."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0

from pathlib import Path
import unittest

from test.oetf.mcp_probe import McpProbe
from test.oetf.runner_fixture import RunnerFixture, WorkflowHandle


class McpWorkflow(RunnerFixture):
    """A caller can submit, inspect, and read logs of a workflow through MCP."""

    def test_mcp_workflow_round_trip(self):
        probe = McpProbe(self, self.config.url).authenticate_embedded_dex()
        spec = Path(self._resolve_spec_path("test/workflow/mcp_round_trip.yaml")).read_text(
            encoding="utf-8",
        )
        submitted = probe.call_tool("osmo_submit_workflow", {
            "workflow_spec": spec,
            "pool": self.config.pool,
        })
        self.assertIs(submitted.get("submitted"), True)
        workflow_id = submitted.get("workflow_id")
        if not isinstance(workflow_id, str) or not workflow_id:
            self.fail("MCP submission returned no workflow ID")
        handle = WorkflowHandle(self, workflow_id, timeout_seconds=600)
        completed = False
        try:
            handle.expect_outcome("completed")
            completed = True
            workflow = probe.call_tool("osmo_get_workflow", {"workflow_id": workflow_id})
            self.assertEqual(workflow["workflow"]["status"], "COMPLETED", handle.url)
            logs = probe.call_tool("osmo_get_workflow_logs", {
                "workflow_id": workflow_id,
                "task_name": "echo",
                "last_n_lines": 30,
            })
            self.assertEqual(logs.get("workflow_id"), workflow_id)
            self.assertIs(logs.get("truncated"), False)
            self.assertIn("oetf-mcp-workflow-complete", logs.get("logs", ""), handle.url)
        finally:
            if not completed:
                handle.cancel()


if __name__ == "__main__":
    unittest.main()
