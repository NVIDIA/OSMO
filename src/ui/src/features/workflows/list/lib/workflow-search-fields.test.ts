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

import { describe, it, expect } from "vitest";
import { WORKFLOW_STATIC_FIELDS } from "@/features/workflows/list/lib/workflow-search-fields";
import { STATUS_PRESETS, createPresetChips } from "@/lib/workflows/workflow-status-presets";
import type { WorkflowListEntry } from "@/lib/api/adapter/types";
import { isDateRangeField, getFieldValues } from "@/components/filter-bar/lib/types";

function createWorkflow(overrides: Partial<WorkflowListEntry> = {}): WorkflowListEntry {
  return {
    name: "test-workflow",
    status: "RUNNING",
    user: "testuser",
    pool: "default-pool",
    priority: "NORMAL",
    app_name: "test-app",
    ...overrides,
  } as WorkflowListEntry;
}

function getField(id: string) {
  const field = WORKFLOW_STATIC_FIELDS.find((f) => f.id === id);
  if (!field) throw new Error(`Field not found: ${id}`);
  return field;
}

describe("WORKFLOW_STATIC_FIELDS structure", () => {
  it("contains expected static fields", () => {
    const fieldIds = WORKFLOW_STATIC_FIELDS.map((f) => f.id);

    expect(fieldIds).toContain("name");
    expect(fieldIds).toContain("status");
    expect(fieldIds).toContain("priority");
    expect(fieldIds).toContain("app");
    expect(fieldIds).toContain("tag");
  });

  it("all fields have required properties", () => {
    for (const field of WORKFLOW_STATIC_FIELDS) {
      expect(field).toHaveProperty("id");
      expect(field).toHaveProperty("label");
      expect(field).toHaveProperty("prefix");
      // date-range fields don't have getValues — they show a picker instead
      if (!isDateRangeField(field)) {
        expect(field).toHaveProperty("getValues");
        expect(typeof field.getValues).toBe("function");
      }
    }
  });

  it("fields do not have match functions (server-side filtering)", () => {
    for (const field of WORKFLOW_STATIC_FIELDS) {
      expect(field.match).toBeUndefined();
    }
  });

  it("fields have correct prefixes", () => {
    expect(getField("name").prefix).toBe("name:");
    expect(getField("status").prefix).toBe("status:");
    expect(getField("priority").prefix).toBe("priority:");
    expect(getField("app").prefix).toBe("app:");
    expect(getField("tag").prefix).toBe("tag:");
  });
});

describe("name field", () => {
  const nameField = getField("name");

  it("extracts values from workflows", () => {
    const workflows = [
      createWorkflow({ name: "alpha" }),
      createWorkflow({ name: "beta" }),
      createWorkflow({ name: "gamma" }),
    ];

    const values = getFieldValues(nameField, workflows);

    expect(values).toContain("alpha");
    expect(values).toContain("beta");
    expect(values).toContain("gamma");
  });

  it("returns all values without truncation", () => {
    const workflows = Array.from({ length: 30 }, (_, i) => createWorkflow({ name: `workflow-${i}` }));

    const values = getFieldValues(nameField, workflows);

    expect(values.length).toBe(30);
  });
});

describe("status field", () => {
  const statusField = getField("status");

  it("is marked as exhaustive", () => {
    expect(statusField.exhaustive).toBe(true);
  });

  it("requires valid values", () => {
    expect(statusField.requiresValidValue).toBe(true);
  });

  it("returns all workflow statuses", () => {
    const values = getFieldValues(statusField, []);

    expect(values).toContain("RUNNING");
    expect(values).toContain("COMPLETED");
    expect(values).toContain("FAILED");
    expect(values).toContain("FAILED_IMAGE_PULL");
    expect(values.length).toBeGreaterThan(5);
  });
});

describe("priority field", () => {
  const priorityField = getField("priority");

  it("is marked as exhaustive", () => {
    expect(priorityField.exhaustive).toBe(true);
  });

  it("requires valid values", () => {
    expect(priorityField.requiresValidValue).toBe(true);
  });

  it("returns fixed priority values", () => {
    const values = getFieldValues(priorityField, []);

    expect(values).toEqual(["HIGH", "NORMAL", "LOW"]);
  });
});

describe("app field", () => {
  const appField = getField("app");

  it("extracts unique app names, filtering out undefined", () => {
    const workflows = [
      createWorkflow({ app_name: "app-a" }),
      createWorkflow({ app_name: "app-b" }),
      createWorkflow({ app_name: undefined }),
    ];

    const values = getFieldValues(appField, workflows);

    expect(values).toContain("app-a");
    expect(values).toContain("app-b");
    expect(values).not.toContain(undefined);
  });
});

describe("tag field", () => {
  const tagField = getField("tag");

  it("returns empty values (tags not in list response)", () => {
    const workflows = [createWorkflow()];

    const values = getFieldValues(tagField, workflows);

    expect(values).toEqual([]);
  });

  it("has freeFormHint for user input", () => {
    expect(tagField.freeFormHint).toBeDefined();
  });
});

describe("STATUS_PRESETS", () => {
  it("contains expected preset categories", () => {
    expect(STATUS_PRESETS).toHaveProperty("running");
    expect(STATUS_PRESETS).toHaveProperty("pending");
    expect(STATUS_PRESETS).toHaveProperty("waiting");
    expect(STATUS_PRESETS).toHaveProperty("completed");
    expect(STATUS_PRESETS).toHaveProperty("failed");
  });

  it("running preset contains RUNNING", () => {
    expect(STATUS_PRESETS.running).toContain("RUNNING");
  });

  it("waiting preset contains PENDING and WAITING", () => {
    expect(STATUS_PRESETS.waiting).toContain("PENDING");
    expect(STATUS_PRESETS.waiting).toContain("WAITING");
  });

  it("completed preset contains COMPLETED", () => {
    expect(STATUS_PRESETS.completed).toContain("COMPLETED");
  });

  it("failed preset contains multiple failure statuses", () => {
    expect(STATUS_PRESETS.failed).toContain("FAILED");
    expect(STATUS_PRESETS.failed).toContain("FAILED_IMAGE_PULL");
    expect(STATUS_PRESETS.failed).toContain("FAILED_CANCELED");
    expect(STATUS_PRESETS.failed.length).toBeGreaterThan(5);
  });
});

describe("createPresetChips", () => {
  it("creates chips for running preset", () => {
    const chips = createPresetChips("running");

    expect(chips).toHaveLength(1);
    expect(chips[0].field).toBe("status");
    expect(chips[0].value).toBe("RUNNING");
  });

  it("creates chips for pending preset (empty — PENDING is in waiting)", () => {
    const chips = createPresetChips("pending");

    expect(chips).toHaveLength(0);
  });

  it("creates chips for waiting preset (includes PENDING and WAITING)", () => {
    const chips = createPresetChips("waiting");

    expect(chips).toHaveLength(2);
    expect(chips.every((c) => c.field === "status")).toBe(true);
    const values = chips.map((c) => c.value);
    expect(values).toContain("PENDING");
    expect(values).toContain("WAITING");
  });

  it("creates chips for failed preset with all failure statuses", () => {
    const chips = createPresetChips("failed");

    expect(chips.length).toBe(STATUS_PRESETS.failed.length);
    expect(chips.every((c) => c.field === "status")).toBe(true);
  });
});
