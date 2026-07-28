// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const { customFetch } = vi.hoisted(() => ({ customFetch: vi.fn() }));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/api/fetcher", () => ({ customFetch }));

import { resubmitWorkflow } from "@/features/workflows/list/lib/actions";

const WARN_MISSING_PROJECT_MESSAGE =
  "Workflow is missing label 'project'; add it now to avoid rejected submissions once it is required.";

describe("resubmit workflow labels", () => {
  beforeEach(() => {
    customFetch.mockReset();
  });

  it("returns the raw submit name and warnings and sends repeated labels", async () => {
    customFetch.mockResolvedValue({
      name: "workflow-copy-2",
      warnings: [WARN_MISSING_PROJECT_MESSAGE],
    });

    const result = await resubmitWorkflow({
      workflowId: "workflow-1",
      poolName: "pool-a",
      priority: "NORMAL",
      labels: ["project=robotics", "run=42"],
    });

    const endpoint = new URL(customFetch.mock.calls[0][0], "https://osmo.invalid");
    expect(endpoint.searchParams.getAll("label")).toEqual(["project=robotics", "run=42"]);
    expect(result).toMatchObject({
      success: true,
      newWorkflowName: "workflow-copy-2",
      warnings: [WARN_MISSING_PROJECT_MESSAGE],
    });
  });
});
