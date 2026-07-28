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

import { describe, expect, it } from "vitest";
import {
  MAX_WORKFLOW_LABELS,
  formatWorkflowLabels,
  getChangedWorkflowLabelAssignments,
  sortedWorkflowLabelEntries,
  validateWorkflowLabelDrafts,
  type WorkflowLabelDraft,
} from "@/lib/workflow-labels";

const draft = (key: string, value: string): WorkflowLabelDraft => ({ key, value });

describe("workflow label drafts", () => {
  it("sends only labels changed from a resubmitted workflow", () => {
    expect(
      getChangedWorkflowLabelAssignments(
        [draft("project", "robotics"), draft("team", "simulation"), draft("run", "42")],
        {
          project: "robotics",
          team: "robotics",
        },
      ),
    ).toEqual(["team=simulation", "run=42"]);
  });

  it("rejects incomplete and duplicate overrides before submission", () => {
    expect(validateWorkflowLabelDrafts([draft("team", "")])).toMatch(/key and value/i);
    expect(validateWorkflowLabelDrafts([draft("team", "one"), draft("team", "two")])).toMatch(/duplicate/i);
  });

  it("enforces the shared 16-label UI cap", () => {
    const labels = Array.from({ length: MAX_WORKFLOW_LABELS + 1 }, (_, index) => draft(`key${index}`, "value"));

    expect(validateWorkflowLabelDrafts(labels)).toContain(String(MAX_WORKFLOW_LABELS));
  });

  it("formats canonical labels deterministically", () => {
    expect(formatWorkflowLabels({ zeta: "last", alpha: "first" })).toBe("alpha=first, zeta=last");
    expect(formatWorkflowLabels({})).toBe("—");
  });

  it("sorts label entries deterministically and tolerates missing maps", () => {
    expect(sortedWorkflowLabelEntries({ zeta: "last", alpha: "first" })).toEqual([
      ["alpha", "first"],
      ["zeta", "last"],
    ]);
    expect(sortedWorkflowLabelEntries(undefined)).toEqual([]);
  });
});
