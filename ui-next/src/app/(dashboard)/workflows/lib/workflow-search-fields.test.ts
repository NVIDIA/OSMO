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

/**
 * Workflow Search Fields Tests
 *
 * Tests the workflow list search functionality:
 * - Field structure and properties
 * - Value extraction (getValues)
 * - Status presets for multi-chip toggling
 *
 * NOTE: Filtering is done server-side. The `match` functions are stubs that
 * always return true. Chips are converted to API params in workflows-shim.ts.
 */

import { describe, it, expect } from "vitest";
import {
  WORKFLOW_SEARCH_FIELDS,
  STATUS_PRESETS,
  createPresetChips,
  isPresetActive,
  togglePreset,
} from "./workflow-search-fields";
import type { SrcServiceCoreWorkflowObjectsListEntry } from "@/lib/api/generated";
import type { SearchChip } from "@/stores";

// =============================================================================
// Test Helpers
// =============================================================================

type WorkflowListEntry = SrcServiceCoreWorkflowObjectsListEntry;

/**
 * Create a minimal workflow entry for testing search.
 */
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

/**
 * Get a search field by ID.
 */
function getField(id: string) {
  const field = WORKFLOW_SEARCH_FIELDS.find((f) => f.id === id);
  if (!field) throw new Error(`Field not found: ${id}`);
  return field;
}

/**
 * Create a status chip for testing.
 */
function statusChip(value: string): SearchChip {
  return { field: "status", value, label: `Status: ${value}` };
}

// =============================================================================
// Field Structure Tests
// =============================================================================

describe("WORKFLOW_SEARCH_FIELDS structure", () => {
  it("contains expected fields", () => {
    const fieldIds = WORKFLOW_SEARCH_FIELDS.map((f) => f.id);

    expect(fieldIds).toContain("name");
    expect(fieldIds).toContain("status");
    expect(fieldIds).toContain("user");
    expect(fieldIds).toContain("pool");
    expect(fieldIds).toContain("priority");
    expect(fieldIds).toContain("app");
    expect(fieldIds).toContain("tag");
  });

  it("all fields have required properties", () => {
    for (const field of WORKFLOW_SEARCH_FIELDS) {
      expect(field).toHaveProperty("id");
      expect(field).toHaveProperty("label");
      expect(field).toHaveProperty("prefix");
      expect(field).toHaveProperty("getValues");
      expect(typeof field.getValues).toBe("function");
    }
  });

  it("fields do not have match functions (server-side filtering)", () => {
    // Filtering is done server-side, so no match functions are needed
    for (const field of WORKFLOW_SEARCH_FIELDS) {
      expect(field.match).toBeUndefined();
    }
  });

  it("fields have correct prefixes", () => {
    expect(getField("name").prefix).toBe("name:");
    expect(getField("status").prefix).toBe("status:");
    expect(getField("user").prefix).toBe("user:");
    expect(getField("pool").prefix).toBe("pool:");
    expect(getField("priority").prefix).toBe("priority:");
    expect(getField("app").prefix).toBe("app:");
    expect(getField("tag").prefix).toBe("tag:");
  });
});

// =============================================================================
// Name Field Tests
// =============================================================================

describe("name field", () => {
  const nameField = getField("name");

  it("extracts values from workflows", () => {
    const workflows = [
      createWorkflow({ name: "alpha" }),
      createWorkflow({ name: "beta" }),
      createWorkflow({ name: "gamma" }),
    ];

    const values = nameField.getValues(workflows);

    expect(values).toContain("alpha");
    expect(values).toContain("beta");
    expect(values).toContain("gamma");
  });

  it("limits values to 20 suggestions", () => {
    const workflows = Array.from({ length: 30 }, (_, i) => createWorkflow({ name: `workflow-${i}` }));

    const values = nameField.getValues(workflows);

    expect(values.length).toBe(20);
  });
});

// =============================================================================
// Status Field Tests
// =============================================================================

describe("status field", () => {
  const statusField = getField("status");

  it("is marked as exhaustive", () => {
    expect(statusField.exhaustive).toBe(true);
  });

  it("requires valid values", () => {
    expect(statusField.requiresValidValue).toBe(true);
  });

  it("returns all workflow statuses", () => {
    const values = statusField.getValues([]);

    expect(values).toContain("RUNNING");
    expect(values).toContain("COMPLETED");
    expect(values).toContain("FAILED");
    expect(values).toContain("FAILED_IMAGE_PULL");
    expect(values.length).toBeGreaterThan(5);
  });
});

// =============================================================================
// User Field Tests
// =============================================================================

describe("user field", () => {
  const userField = getField("user");

  it("extracts unique users from workflows", () => {
    const workflows = [
      createWorkflow({ user: "alice" }),
      createWorkflow({ user: "bob" }),
      createWorkflow({ user: "alice" }), // Duplicate
    ];

    const values = userField.getValues(workflows);
    const uniqueValues = [...new Set(values)];

    expect(uniqueValues.length).toBe(values.length); // Should be deduplicated
    expect(values).toContain("alice");
    expect(values).toContain("bob");
  });
});

// =============================================================================
// Pool Field Tests
// =============================================================================

describe("pool field", () => {
  const poolField = getField("pool");

  it("extracts pools, filtering out undefined", () => {
    const workflows = [
      createWorkflow({ pool: "pool-a" }),
      createWorkflow({ pool: undefined }),
      createWorkflow({ pool: "pool-b" }),
    ];

    const values = poolField.getValues(workflows);

    expect(values).toContain("pool-a");
    expect(values).toContain("pool-b");
    expect(values).not.toContain(undefined);
  });
});

// =============================================================================
// Priority Field Tests
// =============================================================================

describe("priority field", () => {
  const priorityField = getField("priority");

  it("is marked as exhaustive", () => {
    expect(priorityField.exhaustive).toBe(true);
  });

  it("requires valid values", () => {
    expect(priorityField.requiresValidValue).toBe(true);
  });

  it("returns fixed priority values", () => {
    const values = priorityField.getValues([]);

    expect(values).toEqual(["HIGH", "NORMAL", "LOW"]);
  });
});

// =============================================================================
// App Field Tests
// =============================================================================

describe("app field", () => {
  const appField = getField("app");

  it("extracts unique app names, filtering out undefined", () => {
    const workflows = [
      createWorkflow({ app_name: "app-a" }),
      createWorkflow({ app_name: "app-b" }),
      createWorkflow({ app_name: undefined }),
    ];

    const values = appField.getValues(workflows);

    expect(values).toContain("app-a");
    expect(values).toContain("app-b");
    expect(values).not.toContain(undefined);
  });
});

// =============================================================================
// Tag Field Tests
// =============================================================================

describe("tag field", () => {
  const tagField = getField("tag");

  it("returns empty values (tags not in list response)", () => {
    const workflows = [createWorkflow()];

    const values = tagField.getValues(workflows);

    expect(values).toEqual([]);
  });

  it("has freeFormHint for user input", () => {
    expect(tagField.freeFormHint).toBeDefined();
  });
});

// =============================================================================
// Status Preset Tests
// =============================================================================

describe("STATUS_PRESETS", () => {
  it("contains expected preset categories", () => {
    expect(STATUS_PRESETS).toHaveProperty("running");
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

  it("creates chips for waiting preset", () => {
    const chips = createPresetChips("waiting");

    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.value)).toContain("PENDING");
    expect(chips.map((c) => c.value)).toContain("WAITING");
  });

  it("creates chips for failed preset with all failure statuses", () => {
    const chips = createPresetChips("failed");

    expect(chips.length).toBe(STATUS_PRESETS.failed.length);
    expect(chips.every((c) => c.field === "status")).toBe(true);
  });
});

describe("isPresetActive", () => {
  it("returns false when no chips", () => {
    expect(isPresetActive("running", [])).toBe(false);
  });

  it("returns true when all preset chips are present", () => {
    const chips = [statusChip("RUNNING")];

    expect(isPresetActive("running", chips)).toBe(true);
  });

  it("returns true when waiting preset chips are all present", () => {
    const chips = [statusChip("PENDING"), statusChip("WAITING")];

    expect(isPresetActive("waiting", chips)).toBe(true);
  });

  it("returns false when only some preset chips are present", () => {
    const chips = [statusChip("PENDING")]; // Missing WAITING

    expect(isPresetActive("waiting", chips)).toBe(false);
  });

  it("returns true when all failed preset chips are present", () => {
    const chips = STATUS_PRESETS.failed.map((s) => statusChip(s));

    expect(isPresetActive("failed", chips)).toBe(true);
  });

  it("returns false when one failed status is missing", () => {
    const allButOne = STATUS_PRESETS.failed.slice(0, -1);
    const chips = allButOne.map((s) => statusChip(s));

    expect(isPresetActive("failed", chips)).toBe(false);
  });

  it("ignores chips from other fields", () => {
    const chips = [statusChip("RUNNING"), { field: "user", value: "alice", label: "User: alice" }];

    expect(isPresetActive("running", chips)).toBe(true);
  });
});

describe("togglePreset", () => {
  it("adds all preset chips when inactive", () => {
    const result = togglePreset("running", []);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("RUNNING");
  });

  it("removes all preset chips when active", () => {
    const chips = [statusChip("RUNNING")];
    const result = togglePreset("running", chips);

    expect(result).toHaveLength(0);
  });

  it("adds missing waiting chips", () => {
    const chips = [statusChip("PENDING")]; // Has one, missing one
    const result = togglePreset("waiting", chips);

    // Should still add WAITING since preset wasn't fully active
    expect(result.map((c) => c.value)).toContain("PENDING");
    expect(result.map((c) => c.value)).toContain("WAITING");
  });

  it("removes all waiting chips when fully active", () => {
    const chips = [statusChip("PENDING"), statusChip("WAITING")];
    const result = togglePreset("waiting", chips);

    expect(result).toHaveLength(0);
  });

  it("preserves chips from other fields", () => {
    const chips = [statusChip("RUNNING"), { field: "user", value: "alice", label: "User: alice" }];
    const result = togglePreset("running", chips);

    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("user");
  });

  it("adds all failed preset chips", () => {
    const result = togglePreset("failed", []);

    expect(result.length).toBe(STATUS_PRESETS.failed.length);
  });
});
