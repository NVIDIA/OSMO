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
import { WorkflowGenerator, WorkflowStatus, TaskGroupStatus, type MockWorkflow } from "./workflow-generator";

/**
 * State Machine Invariant Validator
 *
 * Single source of truth for what constitutes a valid workflow.
 * Used by both tests and could be used at runtime if needed.
 */
function validateWorkflowInvariants(workflow: MockWorkflow): string[] {
  const errors: string[] = [];

  if (workflow.status === WorkflowStatus.RUNNING) {
    // RUNNING: must have at least one RUNNING group
    const runningGroups = workflow.groups.filter((g) => g.status === TaskGroupStatus.RUNNING);
    if (runningGroups.length === 0) {
      errors.push(`RUNNING workflow has no RUNNING groups`);
    }

    // RUNNING groups must have at least one RUNNING task
    for (const group of runningGroups) {
      const runningTasks = group.tasks.filter((t) => t.status === TaskGroupStatus.RUNNING);
      if (runningTasks.length === 0) {
        errors.push(`RUNNING group ${group.name} has no RUNNING tasks`);
      }
    }

    // Not all tasks can be COMPLETED
    const allCompleted = workflow.groups.every((g) => g.tasks.every((t) => t.status === TaskGroupStatus.COMPLETED));
    if (allCompleted) {
      errors.push(`RUNNING workflow has all COMPLETED tasks`);
    }

    // Not all groups can be WAITING
    const allWaiting = workflow.groups.every((g) => g.status === TaskGroupStatus.WAITING);
    if (allWaiting) {
      errors.push(`RUNNING workflow has all WAITING groups`);
    }
  }

  if (workflow.status === WorkflowStatus.COMPLETED) {
    // COMPLETED: all groups and tasks must be COMPLETED
    for (const group of workflow.groups) {
      if (group.status !== TaskGroupStatus.COMPLETED) {
        errors.push(`COMPLETED workflow has group ${group.name} with status ${group.status}`);
      }
      for (const task of group.tasks) {
        if (task.status !== TaskGroupStatus.COMPLETED) {
          errors.push(`COMPLETED workflow has task ${task.name} with status ${task.status}`);
        }
      }
    }
  }

  if (workflow.status === WorkflowStatus.PENDING) {
    // PENDING: all groups must be WAITING
    for (const group of workflow.groups) {
      if (group.status !== TaskGroupStatus.WAITING) {
        errors.push(`PENDING workflow has group ${group.name} with status ${group.status}`);
      }
    }
  }

  if (workflow.status.toString().startsWith("FAILED")) {
    // FAILED: at least one group must be FAILED
    const failedGroups = workflow.groups.filter((g) => g.status.toString().startsWith("FAILED"));
    if (failedGroups.length === 0) {
      errors.push(`FAILED workflow has no FAILED groups`);
    }

    // Downstream of failed groups must be FAILED_UPSTREAM
    const failedNames = new Set(failedGroups.map((g) => g.name));
    for (const group of workflow.groups) {
      const hasFailedUpstream = group.upstream_groups.some((n) => failedNames.has(n));
      if (hasFailedUpstream && group.status !== TaskGroupStatus.FAILED_UPSTREAM) {
        errors.push(`Group ${group.name} has failed upstream but is ${group.status}`);
      }
    }
  }

  // DAG consistency: RUNNING groups must have all upstream COMPLETED
  const groupMap = new Map(workflow.groups.map((g) => [g.name, g]));
  for (const group of workflow.groups) {
    if (group.status === TaskGroupStatus.RUNNING) {
      for (const upName of group.upstream_groups) {
        const upstream = groupMap.get(upName);
        if (upstream && upstream.status !== TaskGroupStatus.COMPLETED) {
          errors.push(`RUNNING group ${group.name} has upstream ${upName} with status ${upstream.status}`);
        }
      }
    }
  }

  return errors;
}

describe("WorkflowGenerator - State Machine Invariants", () => {
  // Test configuration
  const SEEDS = [12345, 0, 42, 99999, 1];
  const WORKFLOWS_PER_SEED = 100;

  it("validates invariants across multiple seeds and indices", () => {
    let totalChecked = 0;

    for (const seed of SEEDS) {
      const generator = new WorkflowGenerator({ baseSeed: seed });

      for (let i = 0; i < WORKFLOWS_PER_SEED; i++) {
        const workflow = generator.generate(i);
        const errors = validateWorkflowInvariants(workflow);

        if (errors.length > 0) {
          throw new Error(`Seed ${seed}, index ${i}, workflow ${workflow.name}:\n  ${errors.join("\n  ")}`);
        }
        totalChecked++;
      }
    }

    expect(totalChecked).toBe(SEEDS.length * WORKFLOWS_PER_SEED);
  });

  it("validates getByName returns consistent data", () => {
    const generator = new WorkflowGenerator({ baseSeed: 12345 });

    // Test with generated names
    for (let i = 0; i < 50; i++) {
      const original = generator.generate(i);
      const lookedUp = generator.getByName(original.name);

      expect(lookedUp).not.toBeNull();
      expect(lookedUp?.name).toBe(original.name);
      expect(lookedUp?.status).toBe(original.status);

      const errors = validateWorkflowInvariants(lookedUp!);
      if (errors.length > 0) {
        throw new Error(`getByName(${original.name}):\n  ${errors.join("\n  ")}`);
      }
    }

    // Test with arbitrary names
    const arbitraryNames = ["test-workflow-abc", "my-job-123", "finetune-llama-xyz"];
    for (const name of arbitraryNames) {
      const workflow = generator.getByName(name);
      expect(workflow).not.toBeNull();
      expect(workflow?.name).toBe(name);

      const errors = validateWorkflowInvariants(workflow!);
      if (errors.length > 0) {
        throw new Error(`getByName(${name}):\n  ${errors.join("\n  ")}`);
      }
    }
  });

  it("validates generatePage returns consistent data", () => {
    const generator = new WorkflowGenerator({ baseSeed: 12345 });
    const offsets = [0, 100, 500, 1000, 5000];

    for (const offset of offsets) {
      const { entries } = generator.generatePage(offset, 50);

      for (const workflow of entries) {
        const errors = validateWorkflowInvariants(workflow);
        if (errors.length > 0) {
          throw new Error(`generatePage offset=${offset}, workflow ${workflow.name}:\n  ${errors.join("\n  ")}`);
        }
      }
    }
  });

  it("is deterministic - same inputs produce same outputs", () => {
    const gen1 = new WorkflowGenerator({ baseSeed: 12345 });
    const gen2 = new WorkflowGenerator({ baseSeed: 12345 });

    for (let i = 0; i < 20; i++) {
      const w1 = gen1.generate(i);
      const w2 = gen2.generate(i);

      expect(w1.name).toBe(w2.name);
      expect(w1.status).toBe(w2.status);
      expect(w1.groups.length).toBe(w2.groups.length);

      for (let j = 0; j < w1.groups.length; j++) {
        expect(w1.groups[j].status).toBe(w2.groups[j].status);
        expect(w1.groups[j].tasks.length).toBe(w2.groups[j].tasks.length);
      }
    }
  });
});
