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
import {
  WorkflowGenerator,
  WorkflowStatus,
  TaskGroupStatus,
  type MockWorkflow,
} from "@/mocks/generators/workflow-generator";

import type { MockTask } from "@/mocks/generators/workflow-generator";

/**
 * Timeline Phase Invariant Validator
 *
 * Validates that task timestamps follow the strict linear timeline:
 *   Processing → Scheduling → Initializing → Running (start_time)
 *   Then during RUNNING: Input Download → Output Upload → end_time
 *
 * Rules:
 * - You cannot have a later phase without having all earlier phases
 * - Timestamps must be in chronological order
 */
function validateTaskTimeline(task: MockTask, context: string): string[] {
  const errors: string[] = [];

  // Define the phase timeline order (earlier phases first)
  const phases = [
    { name: "processing_start_time", time: task.processing_start_time },
    { name: "scheduling_start_time", time: task.scheduling_start_time },
    { name: "initializing_start_time", time: task.initializing_start_time },
    { name: "start_time", time: task.start_time },
    { name: "input_download_start_time", time: task.input_download_start_time },
    { name: "input_download_end_time", time: task.input_download_end_time },
    { name: "output_upload_start_time", time: task.output_upload_start_time },
    { name: "end_time", time: task.end_time },
  ];

  // Check 1: No gaps in the timeline - if a later phase exists, all earlier phases must exist
  let lastDefinedIndex = -1;
  for (let i = 0; i < phases.length; i++) {
    if (phases[i].time !== undefined) {
      // Check that all phases before this one are also defined (up to the last defined)
      if (lastDefinedIndex >= 0) {
        for (let j = lastDefinedIndex + 1; j < i; j++) {
          // Allow gaps for input_download and output_upload since they're optional sub-phases
          const isOptionalGap =
            phases[j].name === "input_download_start_time" ||
            phases[j].name === "input_download_end_time" ||
            phases[j].name === "output_upload_start_time";

          if (!isOptionalGap && phases[j].time === undefined) {
            errors.push(`${context}: Has ${phases[i].name} but missing required earlier phase ${phases[j].name}`);
          }
        }
      }
      lastDefinedIndex = i;
    }
  }

  // Check 2: Timestamps must be in chronological order
  let previousTime: Date | null = null;
  let previousName = "";
  for (const phase of phases) {
    if (phase.time !== undefined) {
      const currentTime = new Date(phase.time);
      if (previousTime && currentTime < previousTime) {
        errors.push(
          `${context}: ${phase.name} (${phase.time}) is earlier than ${previousName} (${previousTime.toISOString()})`,
        );
      }
      previousTime = currentTime;
      previousName = phase.name;
    }
  }

  // Check 3: Status-specific validations
  const status = task.status;

  // WAITING/SUBMITTING: should have no timestamps
  if (status === TaskGroupStatus.WAITING || status === TaskGroupStatus.SUBMITTING) {
    for (const phase of phases) {
      if (phase.time !== undefined) {
        errors.push(`${context}: ${status} task should not have ${phase.name}`);
      }
    }
  }

  // PROCESSING: should only have processing_start_time
  if (status === TaskGroupStatus.PROCESSING) {
    if (!task.processing_start_time) {
      errors.push(`${context}: PROCESSING task missing processing_start_time`);
    }
    if (task.scheduling_start_time) {
      errors.push(`${context}: PROCESSING task should not have scheduling_start_time`);
    }
  }

  // SCHEDULING: should have processing + scheduling
  if (status === TaskGroupStatus.SCHEDULING) {
    if (!task.processing_start_time) {
      errors.push(`${context}: SCHEDULING task missing processing_start_time`);
    }
    if (!task.scheduling_start_time) {
      errors.push(`${context}: SCHEDULING task missing scheduling_start_time`);
    }
    if (task.initializing_start_time) {
      errors.push(`${context}: SCHEDULING task should not have initializing_start_time`);
    }
  }

  // INITIALIZING: should have processing + scheduling + initializing
  if (status === TaskGroupStatus.INITIALIZING) {
    if (!task.processing_start_time) {
      errors.push(`${context}: INITIALIZING task missing processing_start_time`);
    }
    if (!task.scheduling_start_time) {
      errors.push(`${context}: INITIALIZING task missing scheduling_start_time`);
    }
    if (!task.initializing_start_time) {
      errors.push(`${context}: INITIALIZING task missing initializing_start_time`);
    }
    if (task.start_time) {
      errors.push(`${context}: INITIALIZING task should not have start_time`);
    }
  }

  // RUNNING: should have all pre-running phases + start_time
  if (status === TaskGroupStatus.RUNNING) {
    if (!task.processing_start_time) {
      errors.push(`${context}: RUNNING task missing processing_start_time`);
    }
    if (!task.scheduling_start_time) {
      errors.push(`${context}: RUNNING task missing scheduling_start_time`);
    }
    if (!task.initializing_start_time) {
      errors.push(`${context}: RUNNING task missing initializing_start_time`);
    }
    if (!task.start_time) {
      errors.push(`${context}: RUNNING task missing start_time`);
    }
    if (task.end_time) {
      errors.push(`${context}: RUNNING task should not have end_time`);
    }
  }

  // COMPLETED: should have all phases including end_time
  if (status === TaskGroupStatus.COMPLETED) {
    if (!task.processing_start_time) {
      errors.push(`${context}: COMPLETED task missing processing_start_time`);
    }
    if (!task.scheduling_start_time) {
      errors.push(`${context}: COMPLETED task missing scheduling_start_time`);
    }
    if (!task.initializing_start_time) {
      errors.push(`${context}: COMPLETED task missing initializing_start_time`);
    }
    if (!task.start_time) {
      errors.push(`${context}: COMPLETED task missing start_time`);
    }
    if (!task.end_time) {
      errors.push(`${context}: COMPLETED task missing end_time`);
    }
  }

  return errors;
}

/**
 * Group Timeline Invariant Validator
 *
 * Validates that group timing is consistent with its tasks:
 * - Group start_time comes from first task's start_time
 * - Group end_time comes from last task's end_time
 *
 * Group Status → Task Timeline Rules:
 * | Group Status    | First Task Must Have          | Last Task Must Have |
 * |-----------------|-------------------------------|---------------------|
 * | WAITING         | No timestamps                 | No timestamps       |
 * | SCHEDULING      | scheduling_start_time         | -                   |
 * | INITIALIZING    | initializing_start_time       | -                   |
 * | RUNNING         | start_time (lead task)        | No end_time yet     |
 * | COMPLETED       | start_time                    | end_time            |
 * | FAILED_*        | start_time                    | end_time            |
 */
function validateGroupTimeline(
  group: { name: string; status: TaskGroupStatus; tasks: MockTask[] },
  context: string,
): string[] {
  const errors: string[] = [];
  const status = group.status;

  if (group.tasks.length === 0) return errors;

  const firstTask = group.tasks[0];
  const lastTask = group.tasks[group.tasks.length - 1];

  // WAITING: no task should have any timestamps
  if (status === TaskGroupStatus.WAITING) {
    for (const task of group.tasks) {
      if (task.processing_start_time) {
        errors.push(`${context}: WAITING group has task ${task.name} with processing_start_time`);
      }
    }
  }

  // SCHEDULING: first task must have scheduling_start_time but no init
  if (status === TaskGroupStatus.SCHEDULING) {
    if (!firstTask.scheduling_start_time) {
      errors.push(`${context}: SCHEDULING group's first task missing scheduling_start_time`);
    }
    if (firstTask.initializing_start_time) {
      errors.push(`${context}: SCHEDULING group's first task should not have initializing_start_time`);
    }
  }

  // INITIALIZING: first task must have initializing_start_time but no start_time
  if (status === TaskGroupStatus.INITIALIZING) {
    if (!firstTask.initializing_start_time) {
      errors.push(`${context}: INITIALIZING group's first task missing initializing_start_time`);
    }
    if (firstTask.start_time) {
      errors.push(`${context}: INITIALIZING group's first task should not have start_time`);
    }
  }

  // RUNNING: at least lead task must have start_time, no task should have end_time
  if (status === TaskGroupStatus.RUNNING) {
    const leadTask = group.tasks.find((t) => t.lead) || firstTask;
    if (!leadTask.start_time) {
      errors.push(`${context}: RUNNING group's lead task missing start_time`);
    }
    // No task should have end_time in a RUNNING group
    for (const task of group.tasks) {
      if (task.status === TaskGroupStatus.RUNNING && task.end_time) {
        errors.push(`${context}: RUNNING group has RUNNING task ${task.name} with end_time`);
      }
    }
  }

  // COMPLETED: all tasks must be COMPLETED with end_time
  if (status === TaskGroupStatus.COMPLETED) {
    if (!firstTask.start_time) {
      errors.push(`${context}: COMPLETED group's first task missing start_time`);
    }
    if (!lastTask.end_time) {
      errors.push(`${context}: COMPLETED group's last task missing end_time`);
    }
  }

  // FAILED_*: should have timing up through failure
  if (status.toString().startsWith("FAILED") && status !== TaskGroupStatus.FAILED_UPSTREAM) {
    // Failed groups should have at least started
    const hasStartedTask = group.tasks.some((t) => t.start_time);
    if (!hasStartedTask) {
      errors.push(`${context}: FAILED group has no tasks with start_time`);
    }
  }

  return errors;
}

/**
 * Workflow Timeline Invariant Validator
 *
 * Validates workflow-level timestamps are consistent with status:
 * | Workflow Status | submit_time | start_time | end_time |
 * |-----------------|-------------|------------|----------|
 * | PENDING         | ✓           | ✗          | ✗        |
 * | WAITING         | ✓           | ✗          | ✗        |
 * | RUNNING         | ✓           | ✓          | ✗        |
 * | COMPLETED       | ✓           | ✓          | ✓        |
 * | FAILED_*        | ✓           | ✓          | ✓        |
 *
 * Also validates consistency with group timing.
 */
function validateWorkflowTimeline(workflow: MockWorkflow): string[] {
  const errors: string[] = [];
  const status = workflow.status;

  // All workflows must have submit_time
  if (!workflow.submit_time) {
    errors.push(`Workflow ${workflow.name}: missing submit_time`);
  }

  // PENDING/WAITING: should not have start_time or end_time
  if (status === WorkflowStatus.PENDING || status === WorkflowStatus.WAITING) {
    if (workflow.start_time) {
      errors.push(`Workflow ${workflow.name}: ${status} workflow should not have start_time`);
    }
    if (workflow.end_time) {
      errors.push(`Workflow ${workflow.name}: ${status} workflow should not have end_time`);
    }
  }

  // RUNNING: must have start_time, should not have end_time
  if (status === WorkflowStatus.RUNNING) {
    if (!workflow.start_time) {
      errors.push(`Workflow ${workflow.name}: RUNNING workflow missing start_time`);
    }
    if (workflow.end_time) {
      errors.push(`Workflow ${workflow.name}: RUNNING workflow should not have end_time`);
    }
  }

  // COMPLETED: must have both start_time and end_time
  if (status === WorkflowStatus.COMPLETED) {
    if (!workflow.start_time) {
      errors.push(`Workflow ${workflow.name}: COMPLETED workflow missing start_time`);
    }
    if (!workflow.end_time) {
      errors.push(`Workflow ${workflow.name}: COMPLETED workflow missing end_time`);
    }
  }

  // FAILED_*: must have both start_time and end_time
  if (status.toString().startsWith("FAILED")) {
    if (!workflow.start_time) {
      errors.push(`Workflow ${workflow.name}: FAILED workflow missing start_time`);
    }
    if (!workflow.end_time) {
      errors.push(`Workflow ${workflow.name}: FAILED workflow missing end_time`);
    }
  }

  // Timeline must be chronological
  if (workflow.submit_time && workflow.start_time) {
    if (new Date(workflow.start_time) < new Date(workflow.submit_time)) {
      errors.push(`Workflow ${workflow.name}: start_time before submit_time`);
    }
  }
  if (workflow.start_time && workflow.end_time) {
    if (new Date(workflow.end_time) < new Date(workflow.start_time)) {
      errors.push(`Workflow ${workflow.name}: end_time before start_time`);
    }
  }

  return errors;
}

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

  it("validates task timeline invariants - no phases can be skipped", () => {
    const SEEDS = [12345, 42, 99999];
    const WORKFLOWS_PER_SEED = 50;
    let totalTasksChecked = 0;

    for (const seed of SEEDS) {
      const generator = new WorkflowGenerator({ baseSeed: seed });

      for (let i = 0; i < WORKFLOWS_PER_SEED; i++) {
        const workflow = generator.generate(i);

        for (const group of workflow.groups) {
          for (const task of group.tasks) {
            const errors = validateTaskTimeline(
              task,
              `Workflow ${workflow.name}, Group ${group.name}, Task ${task.name}`,
            );

            if (errors.length > 0) {
              throw new Error(`Timeline invariant violation:\n  ${errors.join("\n  ")}`);
            }
            totalTasksChecked++;
          }
        }
      }
    }

    // Ensure we actually validated a meaningful number of tasks
    expect(totalTasksChecked).toBeGreaterThan(100);
  });

  it("validates group timeline invariants - group status matches task timestamps", () => {
    const SEEDS = [12345, 42, 99999];
    const WORKFLOWS_PER_SEED = 50;
    let totalGroupsChecked = 0;

    for (const seed of SEEDS) {
      const generator = new WorkflowGenerator({ baseSeed: seed });

      for (let i = 0; i < WORKFLOWS_PER_SEED; i++) {
        const workflow = generator.generate(i);

        for (const group of workflow.groups) {
          const errors = validateGroupTimeline(group, `Workflow ${workflow.name}, Group ${group.name}`);

          if (errors.length > 0) {
            throw new Error(`Group timeline invariant violation:\n  ${errors.join("\n  ")}`);
          }
          totalGroupsChecked++;
        }
      }
    }

    expect(totalGroupsChecked).toBeGreaterThan(50);
  });

  it("validates workflow timeline invariants - workflow status matches timestamps", () => {
    const SEEDS = [12345, 42, 99999];
    const WORKFLOWS_PER_SEED = 50;
    let totalWorkflowsChecked = 0;

    for (const seed of SEEDS) {
      const generator = new WorkflowGenerator({ baseSeed: seed });

      for (let i = 0; i < WORKFLOWS_PER_SEED; i++) {
        const workflow = generator.generate(i);
        const errors = validateWorkflowTimeline(workflow);

        if (errors.length > 0) {
          throw new Error(`Workflow timeline invariant violation:\n  ${errors.join("\n  ")}`);
        }
        totalWorkflowsChecked++;
      }
    }

    expect(totalWorkflowsChecked).toBe(SEEDS.length * WORKFLOWS_PER_SEED);
  });

  it("validates ALL invariants together - complete state machine validation", () => {
    const SEEDS = [12345, 0, 42, 99999, 1];
    const WORKFLOWS_PER_SEED = 100;
    let totalChecked = 0;

    for (const seed of SEEDS) {
      const generator = new WorkflowGenerator({ baseSeed: seed });

      for (let i = 0; i < WORKFLOWS_PER_SEED; i++) {
        const workflow = generator.generate(i);
        const allErrors: string[] = [];

        // 1. Workflow status invariants
        allErrors.push(...validateWorkflowInvariants(workflow));

        // 2. Workflow timeline invariants
        allErrors.push(...validateWorkflowTimeline(workflow));

        // 3. Group and task invariants
        for (const group of workflow.groups) {
          // Group timeline invariants
          allErrors.push(...validateGroupTimeline(group, `Workflow ${workflow.name}, Group ${group.name}`));

          // Task timeline invariants
          for (const task of group.tasks) {
            allErrors.push(
              ...validateTaskTimeline(task, `Workflow ${workflow.name}, Group ${group.name}, Task ${task.name}`),
            );
          }
        }

        if (allErrors.length > 0) {
          throw new Error(
            `Complete invariant violation in workflow ${workflow.name} (seed=${seed}, index=${i}):\n  ${allErrors.join("\n  ")}`,
          );
        }
        totalChecked++;
      }
    }

    expect(totalChecked).toBe(SEEDS.length * WORKFLOWS_PER_SEED);
  });
});
