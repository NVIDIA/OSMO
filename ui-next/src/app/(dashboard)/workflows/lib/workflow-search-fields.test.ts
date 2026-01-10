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
 * - Status matching (exact, fuzzy, category)
 * - Validation logic
 * - Suggestions
 * - Field matching behavior
 *
 * Complements workflow-constants tests by testing the search field integration.
 */

import { describe, it, expect } from "vitest";
import { WORKFLOW_SEARCH_FIELDS } from "./workflow-search-fields";
import type { SrcServiceCoreWorkflowObjectsListEntry } from "@/lib/api/generated";

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
  });

  it("all fields have required properties", () => {
    for (const field of WORKFLOW_SEARCH_FIELDS) {
      expect(field).toHaveProperty("id");
      expect(field).toHaveProperty("label");
      expect(field).toHaveProperty("prefix");
      expect(field).toHaveProperty("getValues");
      expect(field).toHaveProperty("match");
      expect(typeof field.match).toBe("function");
      expect(typeof field.getValues).toBe("function");
    }
  });

  it("fields have correct prefixes", () => {
    expect(getField("name").prefix).toBe("name:");
    expect(getField("status").prefix).toBe("status:");
    expect(getField("user").prefix).toBe("user:");
    expect(getField("pool").prefix).toBe("pool:");
    expect(getField("priority").prefix).toBe("priority:");
    expect(getField("app").prefix).toBe("app:");
  });
});

// =============================================================================
// Name Field Tests
// =============================================================================

describe("name field", () => {
  const nameField = getField("name");

  it("matches substring in workflow name", () => {
    const workflow = createWorkflow({ name: "data-processing-pipeline" });

    expect(nameField.match(workflow, "data")).toBe(true);
    expect(nameField.match(workflow, "processing")).toBe(true);
    expect(nameField.match(workflow, "pipeline")).toBe(true);
  });

  it("matches case-insensitively", () => {
    const workflow = createWorkflow({ name: "DataProcessing" });

    expect(nameField.match(workflow, "dataprocessing")).toBe(true);
    expect(nameField.match(workflow, "DATAPROCESSING")).toBe(true);
    expect(nameField.match(workflow, "DaTaPrOcEsSiNg")).toBe(true);
  });

  it("does not match unrelated strings", () => {
    const workflow = createWorkflow({ name: "data-pipeline" });

    expect(nameField.match(workflow, "workflow")).toBe(false);
    expect(nameField.match(workflow, "xyz")).toBe(false);
  });

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
});

// =============================================================================
// Status Field Tests
// =============================================================================

describe("status field", () => {
  const statusField = getField("status");

  describe("exact status matching", () => {
    it("matches exact status string", () => {
      const workflow = createWorkflow({ status: "FAILED_IMAGE_PULL" });

      expect(statusField.match(workflow, "FAILED_IMAGE_PULL")).toBe(true);
    });
  });

  describe("category matching", () => {
    it("matches 'running' category", () => {
      const runningWorkflow = createWorkflow({ status: "RUNNING" });

      expect(statusField.match(runningWorkflow, "running")).toBe(true);
    });

    it("matches 'failed' category for all failed statuses", () => {
      const failedWorkflow = createWorkflow({ status: "FAILED" });
      const imagePullWorkflow = createWorkflow({ status: "FAILED_IMAGE_PULL" });

      expect(statusField.match(failedWorkflow, "failed")).toBe(true);
      expect(statusField.match(imagePullWorkflow, "failed")).toBe(true);
    });

    it("matches 'completed' category", () => {
      const completedWorkflow = createWorkflow({ status: "COMPLETED" });

      expect(statusField.match(completedWorkflow, "completed")).toBe(true);
    });

    it("matches 'waiting' category", () => {
      const waitingWorkflow = createWorkflow({ status: "WAITING" });
      const pendingWorkflow = createWorkflow({ status: "PENDING" });

      expect(statusField.match(waitingWorkflow, "waiting")).toBe(true);
      expect(statusField.match(pendingWorkflow, "waiting")).toBe(true);
    });
  });

  describe("fuzzy matching", () => {
    it("matches partial status tokens", () => {
      const workflow = createWorkflow({ status: "FAILED_IMAGE_PULL" });

      expect(statusField.match(workflow, "image")).toBe(true);
      expect(statusField.match(workflow, "pull")).toBe(true);
    });
  });

  describe("validation", () => {
    it("accepts valid status values", () => {
      expect(statusField.validate?.("RUNNING")).toBe(true);
      expect(statusField.validate?.("FAILED")).toBe(true);
      expect(statusField.validate?.("COMPLETED")).toBe(true);
    });

    it("accepts category values", () => {
      expect(statusField.validate?.("running")).toBe(true);
      expect(statusField.validate?.("failed")).toBe(true);
      expect(statusField.validate?.("completed")).toBe(true);
      expect(statusField.validate?.("waiting")).toBe(true);
    });

    it("accepts partial matches", () => {
      expect(statusField.validate?.("image")).toBe(true);
      expect(statusField.validate?.("timeout")).toBe(true);
    });

    it("returns error message for invalid status", () => {
      const result = statusField.validate?.("xyz123invalid");

      expect(typeof result).toBe("string");
      expect(result).toContain("Unknown status");
    });
  });

  describe("exhaustive values", () => {
    it("marks status field as exhaustive", () => {
      expect(statusField.exhaustive).toBe(true);
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
});

// =============================================================================
// User Field Tests
// =============================================================================

describe("user field", () => {
  const userField = getField("user");

  it("matches substring in user name", () => {
    const workflow = createWorkflow({ user: "john.doe" });

    expect(userField.match(workflow, "john")).toBe(true);
    expect(userField.match(workflow, "doe")).toBe(true);
    expect(userField.match(workflow, "john.doe")).toBe(true);
  });

  it("matches case-insensitively", () => {
    const workflow = createWorkflow({ user: "JohnDoe" });

    expect(userField.match(workflow, "johndoe")).toBe(true);
    expect(userField.match(workflow, "JOHNDOE")).toBe(true);
  });

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

  it("matches substring in pool name", () => {
    const workflow = createWorkflow({ pool: "production-gpu" });

    expect(poolField.match(workflow, "production")).toBe(true);
    expect(poolField.match(workflow, "gpu")).toBe(true);
  });

  it("handles workflows without pool", () => {
    const workflow = createWorkflow({ pool: undefined });

    expect(poolField.match(workflow, "anything")).toBe(false);
  });

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

  it("matches exact priority (case-insensitive)", () => {
    const highWorkflow = createWorkflow({ priority: "HIGH" });
    const normalWorkflow = createWorkflow({ priority: "NORMAL" });
    const lowWorkflow = createWorkflow({ priority: "LOW" });

    expect(priorityField.match(highWorkflow, "HIGH")).toBe(true);
    expect(priorityField.match(highWorkflow, "high")).toBe(true);
    expect(priorityField.match(normalWorkflow, "normal")).toBe(true);
    expect(priorityField.match(lowWorkflow, "low")).toBe(true);
  });

  it("does not match substring", () => {
    const workflow = createWorkflow({ priority: "NORMAL" });

    // Priority requires exact match (via toUpperCase comparison)
    expect(priorityField.match(workflow, "norm")).toBe(false);
  });

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

  it("matches substring in app name", () => {
    const workflow = createWorkflow({ app_name: "ml-training-v2" });

    expect(appField.match(workflow, "ml")).toBe(true);
    expect(appField.match(workflow, "training")).toBe(true);
    expect(appField.match(workflow, "v2")).toBe(true);
  });

  it("matches case-insensitively", () => {
    const workflow = createWorkflow({ app_name: "MLTraining" });

    expect(appField.match(workflow, "mltraining")).toBe(true);
  });

  it("handles workflows without app_name", () => {
    const workflow = createWorkflow({ app_name: undefined });

    expect(appField.match(workflow, "anything")).toBe(false);
  });

  it("extracts unique app names", () => {
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
