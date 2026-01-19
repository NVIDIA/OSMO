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
 * Workflow Generator - Top-Down State Machine Approach
 *
 * Generates workflows using the same status enums from the OpenAPI spec.
 * Uses deterministic seeding for infinite, memory-efficient pagination.
 *
 * ## Architecture: Top-Down Generation
 *
 * Each level constrains the next, ensuring state machine validity:
 *
 * ```
 * WORKFLOW STATUS
 *     ↓ constrains
 * GROUP STATUSES (valid combinations based on workflow status)
 *     ↓ constrains
 * TASK STATUSES (valid combinations based on group status)
 *     ↓ constrains
 * TASK FIELDS (timestamps, exit codes based on task status)
 * ```
 *
 * ## State Machine Rules
 *
 * ### Workflow → Group Status Rules:
 * | Workflow Status | Valid Group Combinations |
 * |-----------------|-------------------------|
 * | PENDING         | All groups: WAITING |
 * | RUNNING         | ≥1 RUNNING, upstream COMPLETED, downstream WAITING |
 * | COMPLETED       | All groups: COMPLETED |
 * | FAILED_*        | Some COMPLETED, 1 primary failure, downstream FAILED_UPSTREAM |
 *
 * ### Group → Task Status Rules:
 * | Group Status    | Valid Task Combinations |
 * |-----------------|------------------------|
 * | WAITING         | All tasks: WAITING |
 * | SCHEDULING      | All tasks: SCHEDULING |
 * | INITIALIZING    | Tasks: SCHEDULING or INITIALIZING |
 * | RUNNING         | ≥1 RUNNING, others INITIALIZING/RUNNING |
 * | COMPLETED       | All tasks: COMPLETED |
 * | FAILED_*        | Lead task has failure, others FAILED |
 * | FAILED_UPSTREAM | All tasks: FAILED_UPSTREAM |
 *
 * Key properties:
 * - generate(index) always returns the same workflow for a given index
 * - No items stored in memory - regenerated on demand
 * - Supports "infinite" pagination (only limited by configured total)
 */

import { faker } from "@faker-js/faker";

// Import status and priority enums from generated API spec - prevents drift!
import { WorkflowStatus, TaskGroupStatus, WorkflowPriority } from "@/lib/api/generated";

import { MOCK_CONFIG, type WorkflowPatterns } from "../seed";
import { hashString } from "../utils";

export { WorkflowStatus, TaskGroupStatus, WorkflowPriority };

export type Priority = (typeof WorkflowPriority)[keyof typeof WorkflowPriority];

export interface MockTask {
  name: string;
  retry_id: number;
  status: TaskGroupStatus;
  lead?: boolean;

  // Identifiers
  task_uuid: string;
  pod_name: string;
  pod_ip?: string;
  node_name?: string;

  // Timeline timestamps (canonical order - linear timeline, no phases can be skipped)
  // Phase: 1. Processing → 2. Scheduling → 3. Initializing → 4. Running (start_time)
  //        Then during RUNNING: Input Download → [Execute] → Output Upload → end_time
  processing_start_time?: string;
  scheduling_start_time?: string;
  initializing_start_time?: string;
  start_time?: string;
  input_download_start_time?: string;
  input_download_end_time?: string;
  output_upload_start_time?: string;
  end_time?: string;

  // Status
  failure_message?: string;
  exit_code?: number;

  // URLs
  logs: string;
  error_logs?: string;
  events: string;
  dashboard_url?: string;
  grafana_url?: string;

  // Resource info
  gpu: number;
  cpu: number;
  memory: number;
  storage: number;
  image?: string;
}

export interface MockGroup {
  name: string;
  status: TaskGroupStatus;
  tasks: MockTask[];
  upstream_groups: string[];
  downstream_groups: string[];
  failure_message?: string;
}

export interface MockWorkflow {
  name: string;
  uuid: string;
  submitted_by: string;
  cancelled_by?: string;
  status: WorkflowStatus;
  priority: Priority;
  pool?: string;
  backend?: string;
  tags: string[];
  submit_time: string;
  start_time?: string;
  end_time?: string;
  queued_time: number;
  duration?: number;
  groups: MockGroup[];
  image?: string;
  // URLs for detail fetching
  spec_url: string;
  logs_url: string;
  events_url: string;
}

interface GeneratorConfig {
  total: number;
  baseSeed: number;
  patterns: WorkflowPatterns;
}

const DEFAULT_CONFIG: GeneratorConfig = {
  total: MOCK_CONFIG.volume.workflows, // 10,000 by default
  baseSeed: 12345,
  patterns: MOCK_CONFIG.workflows,
};

export class WorkflowGenerator {
  private config: GeneratorConfig;
  // Cache for name → index mapping (populated on demand)
  private nameToIndexCache: Map<string, number> = new Map();
  // Track which indices have been cached
  private cachedUpToIndex: number = -1;

  constructor(config: Partial<GeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Clear caches (useful for testing or config changes)
   */
  clearCache(): void {
    this.nameToIndexCache.clear();
    this.cachedUpToIndex = -1;
  }

  /**
   * Total number of workflows available.
   * Can be set to any number - generation is on-demand.
   */
  get total(): number {
    return this.config.total;
  }

  set total(value: number) {
    this.config.total = value;
  }

  /**
   * Generate a workflow at a specific index.
   *
   * DETERMINISTIC: Same index always produces the same workflow.
   * MEMORY EFFICIENT: Only name→index mapping is cached.
   * VALIDATED: Guarantees state machine invariants are satisfied.
   */
  generate(index: number): MockWorkflow {
    // Seed faker deterministically based on index
    faker.seed(this.config.baseSeed + index);

    const status = this.pickWeighted(this.config.patterns.statusDistribution) as WorkflowStatus;
    const priority = this.pickWeighted(this.config.patterns.priorityDistribution) as Priority;
    const pool = faker.helpers.arrayElement(this.config.patterns.pools);
    const user = faker.helpers.arrayElement(this.config.patterns.users);
    const name = this.generateName(index);

    // Cache the name → index mapping for efficient lookup
    this.nameToIndexCache.set(name, index);

    // Timing
    const submitTime = this.generateSubmitTime(index);
    const { startTime, endTime, queuedTime, duration } = this.generateTiming(status, submitTime);

    // Groups and tasks
    const groups = this.generateGroups(status, name);

    // Container image
    const image = `${faker.helpers.arrayElement(MOCK_CONFIG.images.repositories)}:${faker.helpers.arrayElement(MOCK_CONFIG.images.tags)}`;

    const workflow: MockWorkflow = {
      name,
      uuid: faker.string.uuid(),
      submitted_by: user,
      cancelled_by:
        status === WorkflowStatus.FAILED_CANCELED ? faker.helpers.arrayElement(this.config.patterns.users) : undefined,
      status,
      priority,
      pool,
      backend: "kubernetes",
      tags: this.generateTags(),
      submit_time: submitTime,
      start_time: startTime,
      end_time: endTime,
      queued_time: queuedTime,
      duration,
      groups,
      image,
      spec_url: `/api/workflow/${name}/spec`,
      logs_url: `/api/workflow/${name}/logs`,
      events_url: `/api/workflow/${name}/events`,
    };

    // VALIDATE: Ensure state machine invariants are satisfied
    this.enforceInvariants(workflow);

    return workflow;
  }

  /**
   * Enforce state machine invariants on a generated workflow.
   * This is the SINGLE SOURCE OF TRUTH for correctness.
   *
   * Invariants:
   * 1. RUNNING workflow → at least 1 RUNNING group with RUNNING tasks
   * 2. COMPLETED workflow → all groups COMPLETED, all tasks COMPLETED
   * 3. PENDING workflow → all groups WAITING
   * 4. FAILED workflow → at least 1 FAILED group
   *
   * CRITICAL: When changing task status, we MUST also update timestamps.
   * This uses updateTaskStatus() which regenerates timestamps for the new status.
   */
  private enforceInvariants(workflow: MockWorkflow): void {
    if (workflow.groups.length === 0) return;

    if (workflow.status === WorkflowStatus.RUNNING) {
      // INVARIANT: RUNNING workflow MUST have at least one RUNNING group
      const hasRunningGroup = workflow.groups.some((g) => g.status === TaskGroupStatus.RUNNING);

      if (!hasRunningGroup) {
        // FIX: Force the first group that can run to be RUNNING
        for (const group of workflow.groups) {
          const allUpstreamComplete =
            group.upstream_groups.length === 0 ||
            group.upstream_groups.every((upName) => {
              const upGroup = workflow.groups.find((g) => g.name === upName);
              return upGroup && upGroup.status === TaskGroupStatus.COMPLETED;
            });

          if (allUpstreamComplete && group.status !== TaskGroupStatus.COMPLETED) {
            // Use updateGroupStatus - single entry point for group status changes
            this.updateGroupStatus(group, TaskGroupStatus.RUNNING);
            break;
          }
        }
      }

      // INVARIANT: RUNNING groups MUST have at least one RUNNING task
      // (handled by updateGroupStatus via deriveTaskStatusFromGroup)
      for (const group of workflow.groups) {
        if (group.status === TaskGroupStatus.RUNNING) {
          const hasRunningTask = group.tasks.some((t) => t.status === TaskGroupStatus.RUNNING);
          if (!hasRunningTask && group.tasks.length > 0) {
            // Re-apply group status to fix task states
            this.updateGroupStatus(group, TaskGroupStatus.RUNNING);
          }
        }
      }

      // INVARIANT: Not all tasks can be COMPLETED in a RUNNING workflow
      const allTasksCompleted = workflow.groups.every((g) =>
        g.tasks.every((t) => t.status === TaskGroupStatus.COMPLETED),
      );
      if (allTasksCompleted) {
        // Find the first RUNNING group and re-apply its status
        const runningGroup = workflow.groups.find((g) => g.status === TaskGroupStatus.RUNNING);
        if (runningGroup) {
          this.updateGroupStatus(runningGroup, TaskGroupStatus.RUNNING);
        }
      }
    }

    if (workflow.status === WorkflowStatus.COMPLETED) {
      // INVARIANT: All groups and tasks must be COMPLETED
      for (const group of workflow.groups) {
        this.updateGroupStatus(group, TaskGroupStatus.COMPLETED);
      }
    }

    if (workflow.status === WorkflowStatus.PENDING) {
      // INVARIANT: All groups must be WAITING
      for (const group of workflow.groups) {
        this.updateGroupStatus(group, TaskGroupStatus.WAITING);
      }
    }

    if (workflow.status.toString().startsWith("FAILED")) {
      // INVARIANT: At least one group must be in a FAILED state
      const hasFailedGroup = workflow.groups.some((g) => g.status.toString().startsWith("FAILED"));
      if (!hasFailedGroup && workflow.groups.length > 0) {
        const failureStatus = this.mapWorkflowFailureToTaskFailure(workflow.status);
        this.updateGroupStatus(workflow.groups[0], failureStatus);
      }
    }
  }

  /**
   * Update a task's status AND regenerate its timestamps to match.
   *
   * This is the SINGLE SOURCE OF TRUTH for task state transitions.
   * NEVER update task.status directly - always use this method!
   *
   * Timeline state machine (canonical order):
   * | Status        | proc | sched | init | start | inp_dl | out_up | end |
   * |---------------|------|-------|------|-------|--------|--------|-----|
   * | WAITING       | ✗    | ✗     | ✗    | ✗     | ✗      | ✗      | ✗   |
   * | PROCESSING    | ✓    | ✗     | ✗    | ✗     | ✗      | ✗      | ✗   |
   * | SCHEDULING    | ✓    | ✓     | ✗    | ✗     | ✗      | ✗      | ✗   |
   * | INITIALIZING  | ✓    | ✓     | ✓    | ✗     | ✗      | ✗      | ✗   |
   * | RUNNING       | ✓    | ✓     | ✓    | ✓     | ✓      | ✗      | ✗   |
   * | COMPLETED     | ✓    | ✓     | ✓    | ✓     | ✓      | ✓      | ✓   |
   * | FAILED_*      | ✓    | ✓     | ✓    | ✓     | ✓      | ✗      | ✓   |
   */
  private updateTaskStatus(task: MockTask, newStatus: TaskGroupStatus): void {
    task.status = newStatus;

    // Regenerate timestamps based on the new status
    const timestamps = this.generateTaskTimestamps(newStatus, task.pod_name, task.task_uuid);

    // Apply all timestamp fields
    task.processing_start_time = timestamps.processing_start_time;
    task.scheduling_start_time = timestamps.scheduling_start_time;
    task.initializing_start_time = timestamps.initializing_start_time;
    task.start_time = timestamps.start_time;
    task.input_download_start_time = timestamps.input_download_start_time;
    task.input_download_end_time = timestamps.input_download_end_time;
    task.output_upload_start_time = timestamps.output_upload_start_time;
    task.end_time = timestamps.end_time;

    // Also update related fields
    task.pod_ip = timestamps.pod_ip;
    task.node_name = timestamps.node_name;
    task.dashboard_url = timestamps.dashboard_url;
    task.grafana_url = timestamps.grafana_url;
    task.exit_code = timestamps.exit_code;
    task.failure_message = timestamps.failure_message;
  }

  /**
   * Update a group's status AND update all its tasks to match.
   *
   * This is the SINGLE SOURCE OF TRUTH for group state transitions.
   * NEVER update group.status directly - always use this method!
   *
   * Works in both phases:
   * - Phase 2 (before tasks exist): Just sets status + failure_message
   * - Phase 3+ (after tasks exist): Also updates all task statuses/timestamps
   *
   * Group → Task status rules:
   * | Group Status    | Task Status Rules                              |
   * |-----------------|------------------------------------------------|
   * | WAITING         | All tasks: WAITING                             |
   * | SCHEDULING      | All tasks: SCHEDULING                          |
   * | INITIALIZING    | Lead: INITIALIZING, others: SCHEDULING/INIT    |
   * | RUNNING         | Lead: RUNNING, others: RUNNING/INIT            |
   * | COMPLETED       | All tasks: COMPLETED                           |
   * | FAILED_UPSTREAM | All tasks: FAILED_UPSTREAM                     |
   * | FAILED_*        | Lead: specific failure, others: FAILED         |
   */
  private updateGroupStatus(group: MockGroup, newStatus: TaskGroupStatus): void {
    group.status = newStatus;

    // Set failure message if failed
    if (newStatus.toString().startsWith("FAILED") && !group.failure_message) {
      group.failure_message = this.generateFailureMessage(newStatus);
    } else if (!newStatus.toString().startsWith("FAILED")) {
      group.failure_message = undefined;
    }

    // Update all tasks to be consistent with the new group status
    // (skips if no tasks exist yet - Phase 2)
    for (let i = 0; i < group.tasks.length; i++) {
      const taskStatus = this.deriveTaskStatusFromGroup(newStatus, i, group.tasks.length);
      this.updateTaskStatus(group.tasks[i], taskStatus);
    }
  }

  /**
   * Generate a page of workflows.
   *
   * Efficient: Only generates items for the requested page.
   */
  generatePage(offset: number, limit: number): { entries: MockWorkflow[]; total: number } {
    const entries: MockWorkflow[] = [];
    const total = this.config.total;

    // Only generate items in the requested range
    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);

    for (let i = start; i < end; i++) {
      entries.push(this.generate(i));
    }

    return { entries, total };
  }

  /**
   * Find a workflow by name.
   *
   * SINGLE SOURCE OF TRUTH: Returns the same workflow that generate() produces.
   * Uses name→index cache for O(1) lookup after first generation.
   */
  getByName(name: string): MockWorkflow | null {
    // 1. Check cache first (O(1) lookup)
    const cachedIndex = this.nameToIndexCache.get(name);
    if (cachedIndex !== undefined) {
      return this.generate(cachedIndex);
    }

    // 2. Try hash-based guess (O(1) but may miss)
    const hash = hashString(name);
    const guessIndex = Math.abs(hash) % this.config.total;
    const candidate = this.generate(guessIndex);
    if (candidate.name === name) {
      return candidate;
    }

    // 3. Scan first N workflows to populate cache (one-time cost)
    const SCAN_LIMIT = Math.min(1000, this.config.total);
    if (this.cachedUpToIndex < SCAN_LIMIT - 1) {
      for (let i = this.cachedUpToIndex + 1; i < SCAN_LIMIT; i++) {
        const workflow = this.generate(i);
        // generate() already caches the name
        if (workflow.name === name) {
          return workflow;
        }
      }
      this.cachedUpToIndex = SCAN_LIMIT - 1;
    }

    // 4. Check cache again after scan
    const foundIndex = this.nameToIndexCache.get(name);
    if (foundIndex !== undefined) {
      return this.generate(foundIndex);
    }

    // 5. Name not found in generated workflows - create deterministically
    // This handles arbitrary names that weren't generated by any index
    return this.generateForArbitraryName(name);
  }

  /**
   * Generate a workflow for an arbitrary name that wasn't in the generated set.
   * Deterministic: same name always produces same workflow.
   */
  private generateForArbitraryName(name: string): MockWorkflow {
    const nameHash = Math.abs(hashString(name));
    faker.seed(this.config.baseSeed + nameHash);

    const status = this.pickWeighted(this.config.patterns.statusDistribution) as WorkflowStatus;
    const priority = this.pickWeighted(this.config.patterns.priorityDistribution) as Priority;
    const pool = faker.helpers.arrayElement(this.config.patterns.pools);
    const user = faker.helpers.arrayElement(this.config.patterns.users);
    const pseudoIndex = nameHash % this.config.total;

    const submitTime = this.generateSubmitTime(pseudoIndex);
    const { startTime, endTime, queuedTime, duration } = this.generateTiming(status, submitTime);
    const groups = this.generateGroups(status, name);
    const image = `${faker.helpers.arrayElement(MOCK_CONFIG.images.repositories)}:${faker.helpers.arrayElement(MOCK_CONFIG.images.tags)}`;

    const workflow: MockWorkflow = {
      name,
      uuid: faker.string.uuid(),
      submitted_by: user,
      cancelled_by:
        status === WorkflowStatus.FAILED_CANCELED ? faker.helpers.arrayElement(this.config.patterns.users) : undefined,
      status,
      priority,
      pool,
      backend: "kubernetes",
      tags: this.generateTags(),
      submit_time: submitTime,
      start_time: startTime,
      end_time: endTime,
      queued_time: queuedTime,
      duration,
      groups,
      image,
      spec_url: `/api/workflow/${name}/spec`,
      logs_url: `/api/workflow/${name}/logs`,
      events_url: `/api/workflow/${name}/events`,
    };

    this.enforceInvariants(workflow);
    return workflow;
  }

  // --------------------------------------------------------------------------
  // Private: Weighted random selection
  // --------------------------------------------------------------------------

  private pickWeighted(distribution: Record<string, number>): string {
    const rand = faker.number.float({ min: 0, max: 1 });
    let cumulative = 0;

    for (const [value, prob] of Object.entries(distribution)) {
      cumulative += prob;
      if (rand <= cumulative) {
        return value;
      }
    }

    return Object.keys(distribution)[0];
  }

  // --------------------------------------------------------------------------
  // Private: Name generation
  // --------------------------------------------------------------------------

  private generateName(_index: number): string {
    const prefix = faker.helpers.arrayElement(this.config.patterns.namePatterns.prefixes);
    const suffix = faker.helpers.arrayElement(this.config.patterns.namePatterns.suffixes);
    const id = faker.string.alphanumeric(8).toLowerCase();
    return `${prefix}-${suffix}-${id}`;
  }

  // --------------------------------------------------------------------------
  // Private: Timing generation
  // --------------------------------------------------------------------------

  private generateSubmitTime(index: number): string {
    // Spread submissions over the last 30 days, ordered by index
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    // Newer workflows have higher indices (reverse order for typical list view)
    const progress = 1 - index / this.config.total;
    const timestamp = thirtyDaysAgo + progress * (now - thirtyDaysAgo);
    return new Date(timestamp).toISOString();
  }

  private generateTiming(
    status: WorkflowStatus,
    submitTime: string,
  ): {
    startTime?: string;
    endTime?: string;
    queuedTime: number;
    duration?: number;
  } {
    const submitDate = new Date(submitTime);
    const timing = this.config.patterns.timing;

    // Queue time (biased toward p50)
    const queuedTime = faker.number.int({
      min: timing.queueTime.min,
      max: timing.queueTime.p90,
    });

    // Not started yet
    if (status === WorkflowStatus.PENDING || status === WorkflowStatus.WAITING) {
      return { queuedTime };
    }

    // Started
    const startDate = new Date(submitDate.getTime() + queuedTime * 1000);
    const startTime = startDate.toISOString();

    // Still running
    if (status === WorkflowStatus.RUNNING) {
      return { startTime, queuedTime };
    }

    // Completed or failed
    const duration = faker.number.int({
      min: timing.duration.min,
      max: timing.duration.p90,
    });
    const endDate = new Date(startDate.getTime() + duration * 1000);
    const endTime = endDate.toISOString();

    return { startTime, endTime, queuedTime, duration };
  }

  // --------------------------------------------------------------------------
  // Private: Group/Task generation
  // --------------------------------------------------------------------------

  /**
   * DAG topology types for variety in mock data:
   * - linear: a → b → c → d (simple chain)
   * - multi-root: (a, b) → c → d (multiple starting points)
   * - fan-out: a → (b, c, d) (one parent, multiple children)
   * - fan-in: (a, b, c) → d (diamond converge)
   * - diamond: a → (b, c) → d (classic diamond)
   * - complex: mix of patterns
   */
  private generateGroups(status: WorkflowStatus, workflowName: string): MockGroup[] {
    const groupPatterns = this.config.patterns.groupPatterns;
    const numGroups = faker.number.int(groupPatterns.groupsPerWorkflow);

    // Pick a topology based on number of groups
    if (numGroups <= 2) {
      return this.generateLinearGroups(status, numGroups, groupPatterns, workflowName);
    }

    // Randomly pick topology for variety
    const topology = faker.helpers.arrayElement(["linear", "multi-root", "fan-out", "fan-in", "diamond", "complex"]);

    switch (topology) {
      case "multi-root":
        return this.generateMultiRootGroups(status, numGroups, groupPatterns, workflowName);
      case "fan-out":
        return this.generateFanOutGroups(status, numGroups, groupPatterns, workflowName);
      case "fan-in":
        return this.generateFanInGroups(status, numGroups, groupPatterns, workflowName);
      case "diamond":
        return this.generateDiamondGroups(status, numGroups, groupPatterns, workflowName);
      case "complex":
        return this.generateComplexGroups(status, numGroups, groupPatterns, workflowName);
      default:
        return this.generateLinearGroups(status, numGroups, groupPatterns, workflowName);
    }
  }

  /** Linear: a → b → c → d */
  private generateLinearGroups(
    status: WorkflowStatus,
    numGroups: number,
    groupPatterns: WorkflowPatterns["groupPatterns"],
    workflowName: string,
  ): MockGroup[] {
    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );

    // Phase 1: Build DAG structure (no tasks yet)
    const groups: MockGroup[] = [];
    for (let i = 0; i < numGroups; i++) {
      groups.push(
        this.createGroupStructure(
          groupNames[i],
          i > 0 ? [groupNames[i - 1]] : [],
          i < numGroups - 1 ? [groupNames[i + 1]] : [],
        ),
      );
    }

    // Phase 2: Assign group statuses (top-down from workflow status)
    this.assignGroupStatuses(groups, status, workflowName);

    // Phase 3: Generate tasks based on group statuses
    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

  /** Multi-root: (a, b) → c → d (2 roots converging) */
  private generateMultiRootGroups(
    status: WorkflowStatus,
    numGroups: number,
    groupPatterns: WorkflowPatterns["groupPatterns"],
    workflowName: string,
  ): MockGroup[] {
    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );
    const numRoots = Math.min(2, numGroups - 1);

    // Phase 1: Build DAG structure
    const groups: MockGroup[] = [];
    for (let i = 0; i < numRoots; i++) {
      const downstream = numGroups > numRoots ? [groupNames[numRoots]] : [];
      groups.push(this.createGroupStructure(groupNames[i], [], downstream));
    }
    for (let i = numRoots; i < numGroups; i++) {
      const upstream = i === numRoots ? groupNames.slice(0, numRoots) : [groupNames[i - 1]];
      const downstream = i < numGroups - 1 ? [groupNames[i + 1]] : [];
      groups.push(this.createGroupStructure(groupNames[i], upstream, downstream));
    }

    // Phase 2 & 3: Assign statuses and populate tasks
    this.assignGroupStatuses(groups, status, workflowName);
    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

  /** Fan-out: a → (b, c, d) (one parent, multiple children) */
  private generateFanOutGroups(
    status: WorkflowStatus,
    numGroups: number,
    groupPatterns: WorkflowPatterns["groupPatterns"],
    workflowName: string,
  ): MockGroup[] {
    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );

    // Phase 1: Build DAG structure
    const groups: MockGroup[] = [];
    groups.push(this.createGroupStructure(groupNames[0], [], groupNames.slice(1, numGroups)));
    for (let i = 1; i < numGroups; i++) {
      groups.push(this.createGroupStructure(groupNames[i], [groupNames[0]], []));
    }

    // Phase 2 & 3: Assign statuses and populate tasks
    this.assignGroupStatuses(groups, status, workflowName);
    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

  /** Fan-in: (a, b, c) → d (multiple parents converge to one) */
  private generateFanInGroups(
    status: WorkflowStatus,
    numGroups: number,
    groupPatterns: WorkflowPatterns["groupPatterns"],
    workflowName: string,
  ): MockGroup[] {
    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );
    const numParents = numGroups - 1;
    const mergeNodeIdx = numGroups - 1;

    // Phase 1: Build DAG structure
    const groups: MockGroup[] = [];
    for (let i = 0; i < numParents; i++) {
      groups.push(this.createGroupStructure(groupNames[i], [], [groupNames[mergeNodeIdx]]));
    }
    groups.push(this.createGroupStructure(groupNames[mergeNodeIdx], groupNames.slice(0, numParents), []));

    // Phase 2 & 3: Assign statuses and populate tasks
    this.assignGroupStatuses(groups, status, workflowName);
    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

  /** Diamond: a → (b, c) → d */
  private generateDiamondGroups(
    status: WorkflowStatus,
    numGroups: number,
    groupPatterns: WorkflowPatterns["groupPatterns"],
    workflowName: string,
  ): MockGroup[] {
    if (numGroups < 4) {
      return this.generateLinearGroups(status, numGroups, groupPatterns, workflowName);
    }

    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );
    const middleSize = Math.max(2, numGroups - 2);
    const middleStart = 1;
    const middleEnd = middleStart + middleSize;
    const lastIdx = numGroups - 1;
    const middleNames = groupNames.slice(middleStart, Math.min(middleEnd, numGroups - 1));

    // Phase 1: Build DAG structure
    const groups: MockGroup[] = [];
    groups.push(this.createGroupStructure(groupNames[0], [], middleNames));
    for (const middleName of middleNames) {
      groups.push(this.createGroupStructure(middleName, [groupNames[0]], [groupNames[lastIdx]]));
    }
    groups.push(this.createGroupStructure(groupNames[lastIdx], middleNames, []));

    // Phase 2 & 3: Assign statuses and populate tasks
    this.assignGroupStatuses(groups, status, workflowName);
    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

  /** Complex: multi-level with mixed patterns */
  private generateComplexGroups(
    status: WorkflowStatus,
    numGroups: number,
    groupPatterns: WorkflowPatterns["groupPatterns"],
    workflowName: string,
  ): MockGroup[] {
    if (numGroups < 5) {
      return this.generateDiamondGroups(status, numGroups, groupPatterns, workflowName);
    }

    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );

    // Phase 1: Build DAG structure
    const groups: MockGroup[] = [];

    // Level 0: 2 roots
    groups.push(this.createGroupStructure(groupNames[0], [], [groupNames[2], groupNames[3]]));
    groups.push(this.createGroupStructure(groupNames[1], [], [groupNames[3], groupNames[4]]));

    // Level 1: 3 middle nodes with mixed dependencies
    groups.push(this.createGroupStructure(groupNames[2], [groupNames[0]], [groupNames[5]]));
    groups.push(this.createGroupStructure(groupNames[3], [groupNames[0], groupNames[1]], [groupNames[5]]));
    if (numGroups > 5) {
      groups.push(this.createGroupStructure(groupNames[4], [groupNames[1]], [groupNames[5]]));
    }

    // Level 2: merge node
    const mergeUpstream =
      numGroups > 5 ? [groupNames[2], groupNames[3], groupNames[4]] : [groupNames[2], groupNames[3]];
    groups.push(this.createGroupStructure(groupNames[5], mergeUpstream, []));

    // Additional linear chain if more groups
    for (let i = 6; i < numGroups; i++) {
      groups.push(
        this.createGroupStructure(groupNames[i], [groupNames[i - 1]], i < numGroups - 1 ? [groupNames[i + 1]] : []),
      );
    }

    // Phase 2 & 3: Assign statuses and populate tasks
    this.assignGroupStatuses(groups, status, workflowName);
    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

  /**
   * Phase 1: Create group structure (DAG topology only, no tasks yet)
   *
   * Tasks are NOT created here - they're created in Phase 3 after status is assigned.
   * This ensures the top-down flow: Workflow → Group Status → Task Status → Task Fields
   */
  private createGroupStructure(name: string, upstream: string[], downstream: string[]): MockGroup {
    return {
      name,
      status: TaskGroupStatus.WAITING, // Placeholder - set in Phase 2
      tasks: [], // Empty - populated in Phase 3
      upstream_groups: upstream,
      downstream_groups: downstream,
      failure_message: undefined,
    };
  }

  /**
   * Phase 3: Generate tasks for a group based on its FINAL status
   *
   * This is the key to top-down generation: we know the group status
   * before creating tasks, so tasks are created with valid statuses from the start.
   */
  private populateGroupTasks(
    group: MockGroup,
    workflowName: string,
    groupPatterns: WorkflowPatterns["groupPatterns"],
  ): void {
    const numTasks = faker.number.int(groupPatterns.tasksPerGroup);

    // Generate tasks with statuses valid for this group status
    for (let t = 0; t < numTasks; t++) {
      const taskStatus = this.deriveTaskStatusFromGroup(group.status, t, numTasks);
      const task = this.generateTaskWithStatus(workflowName, group.name, t, taskStatus);
      group.tasks.push(task);
    }
  }

  /**
   * State Machine: Group Status → Valid Task Status
   *
   * | Group Status     | Task Status Rules                              |
   * |------------------|------------------------------------------------|
   * | WAITING          | All tasks: WAITING                             |
   * | SUBMITTING       | All tasks: SUBMITTING                          |
   * | SCHEDULING       | All tasks: SCHEDULING                          |
   * | INITIALIZING     | Lead: INITIALIZING, others: SCHEDULING/INIT    |
   * | RUNNING          | At least 1 RUNNING, others: RUNNING/INIT       |
   * | COMPLETED        | All tasks: COMPLETED                           |
   * | FAILED_UPSTREAM  | All tasks: FAILED_UPSTREAM                     |
   * | FAILED_*         | Lead: specific failure, others: FAILED         |
   */
  private deriveTaskStatusFromGroup(
    groupStatus: TaskGroupStatus,
    taskIndex: number,
    _totalTasks: number,
  ): TaskGroupStatus {
    const isLead = taskIndex === 0;

    switch (groupStatus) {
      // Pre-execution states: all tasks have same status as group
      case TaskGroupStatus.WAITING:
      case TaskGroupStatus.SUBMITTING:
      case TaskGroupStatus.SCHEDULING:
        return groupStatus;

      // Initializing: lead is initializing, others may still be scheduling
      case TaskGroupStatus.INITIALIZING:
        if (isLead) return TaskGroupStatus.INITIALIZING;
        // Non-lead tasks: 50% initializing, 50% scheduling
        return faker.datatype.boolean() ? TaskGroupStatus.INITIALIZING : TaskGroupStatus.SCHEDULING;

      // Running: at least lead is running, others may be initializing
      case TaskGroupStatus.RUNNING:
        if (isLead) return TaskGroupStatus.RUNNING;
        // Non-lead tasks: 70% running, 30% initializing
        return faker.number.float({ min: 0, max: 1 }) < 0.7 ? TaskGroupStatus.RUNNING : TaskGroupStatus.INITIALIZING;

      // Completed: all tasks completed
      case TaskGroupStatus.COMPLETED:
        return TaskGroupStatus.COMPLETED;

      // Upstream failure: all tasks get same status
      case TaskGroupStatus.FAILED_UPSTREAM:
        return TaskGroupStatus.FAILED_UPSTREAM;

      // Other failures: lead has the specific failure, others generic FAILED
      default:
        if (groupStatus.toString().startsWith("FAILED")) {
          // Lead task gets the specific failure status
          if (isLead) return groupStatus;
          // Other tasks: could have completed before lead failed, or also failed
          return faker.datatype.boolean() ? TaskGroupStatus.FAILED : TaskGroupStatus.COMPLETED;
        }
        return groupStatus;
    }
  }

  /**
   * Generate a task with a known status (top-down approach)
   */
  private generateTaskWithStatus(
    workflowName: string,
    groupName: string,
    taskIndex: number,
    status: TaskGroupStatus,
  ): MockTask {
    const taskPatterns = MOCK_CONFIG.tasks;
    const name = `${groupName}-${taskIndex}`;

    const gpu = faker.helpers.arrayElement(taskPatterns.gpuCounts);
    const cpu = gpu > 0 ? gpu * faker.number.int({ min: 8, max: 16 }) : faker.number.int({ min: 2, max: 8 });
    const memory = cpu * 4;
    const storage = faker.helpers.arrayElement([10, 50, 100, 200]);

    const taskUuid = faker.string.uuid();
    const podSuffix = faker.string.alphanumeric({ length: 5, casing: "lower" });
    const podName = `${workflowName.slice(0, 20)}-${name}-${podSuffix}`;

    // Generate timestamps based on the KNOWN status (top-down)
    const timestamps = this.generateTaskTimestamps(status, podName, taskUuid);

    return {
      name,
      retry_id: faker.datatype.boolean({ probability: 0.1 }) ? faker.number.int({ min: 1, max: 3 }) : 0,
      status,
      lead: taskIndex === 0,
      task_uuid: taskUuid,
      pod_name: podName,
      ...timestamps,
      logs: `/api/workflow/${workflowName}/task/${name}/logs`,
      error_logs: status.toString().startsWith("FAILED")
        ? `/api/workflow/${workflowName}/task/${name}/error-logs`
        : undefined,
      events: `/api/workflow/${workflowName}/task/${name}/events`,
      storage,
      cpu,
      memory,
      gpu,
      image: `${faker.helpers.arrayElement(MOCK_CONFIG.images.repositories)}:${faker.helpers.arrayElement(MOCK_CONFIG.images.tags)}`,
    };
  }

  /**
   * Generate task timestamps based on status (state machine)
   *
   * Canonical order from backend:
   *   WAITING → PROCESSING → SCHEDULING → INITIALIZING → RUNNING → COMPLETED/FAILED
   *
   * | Status        | Has proc | Has sched | Has init | Has start | Has end | Has node |
   * |---------------|----------|-----------|----------|-----------|---------|----------|
   * | WAITING       | ✗        | ✗         | ✗        | ✗         | ✗       | ✗        |
   * | PROCESSING    | ✓        | ✗         | ✗        | ✗         | ✗       | ✗        |
   * | SCHEDULING    | ✓        | ✓         | ✗        | ✗         | ✗       | ✗        |
   * | INITIALIZING  | ✓        | ✓         | ✓        | ✗         | ✗       | ✓        |
   * | RUNNING       | ✓        | ✓         | ✓        | ✓         | ✗       | ✓        |
   * | COMPLETED     | ✓        | ✓         | ✓        | ✓         | ✓       | ✓        |
   * | FAILED_*      | ✓        | ✓         | ✓        | ✓         | ✓       | ✓        |
   *
   * During RUNNING: input_download_start → input_download_end → [execute] → output_upload_start → end
   */
  private generateTaskTimestamps(status: TaskGroupStatus, podName: string, taskUuid: string): Partial<MockTask> {
    const baseTime = faker.date.recent({ days: 7 });

    // WAITING/SUBMITTING: no timestamps
    if (status === TaskGroupStatus.WAITING || status === TaskGroupStatus.SUBMITTING) {
      return {
        processing_start_time: undefined,
        scheduling_start_time: undefined,
        initializing_start_time: undefined,
        start_time: undefined,
        input_download_start_time: undefined,
        input_download_end_time: undefined,
        output_upload_start_time: undefined,
        end_time: undefined,
        pod_ip: undefined,
        node_name: undefined,
        dashboard_url: undefined,
        grafana_url: undefined,
        exit_code: undefined,
        failure_message: undefined,
      };
    }

    // PROCESSING: only processing time (queue processing - first step)
    if (status === TaskGroupStatus.PROCESSING) {
      return {
        processing_start_time: new Date(baseTime.getTime() - 30000).toISOString(),
        scheduling_start_time: undefined,
        initializing_start_time: undefined,
        start_time: undefined,
        input_download_start_time: undefined,
        input_download_end_time: undefined,
        output_upload_start_time: undefined,
        end_time: undefined,
        pod_ip: undefined,
        node_name: undefined,
        dashboard_url: undefined,
        grafana_url: undefined,
        exit_code: undefined,
        failure_message: undefined,
      };
    }

    // SCHEDULING: processing + scheduling time
    if (status === TaskGroupStatus.SCHEDULING) {
      return {
        processing_start_time: new Date(baseTime.getTime() - 60000).toISOString(),
        scheduling_start_time: new Date(baseTime.getTime() - 30000).toISOString(),
        initializing_start_time: undefined,
        start_time: undefined,
        input_download_start_time: undefined,
        input_download_end_time: undefined,
        output_upload_start_time: undefined,
        end_time: undefined,
        pod_ip: undefined,
        node_name: undefined,
        dashboard_url: undefined,
        grafana_url: undefined,
        exit_code: undefined,
        failure_message: undefined,
      };
    }

    // Generate node info for tasks that have been placed (INITIALIZING+)
    const podIp = `10.${faker.number.int({ min: 0, max: 255 })}.${faker.number.int({ min: 0, max: 255 })}.${faker.number.int({ min: 1, max: 254 })}`;
    const nodeName = this.generateNodeName();
    const dashboardUrl = `https://kubernetes.example.com/pod/${podName}`;
    const grafanaUrl = `https://grafana.example.com/d/task/${taskUuid}`;

    // INITIALIZING: processing + scheduling + init times, has node
    if (status === TaskGroupStatus.INITIALIZING) {
      return {
        processing_start_time: new Date(baseTime.getTime() - 180000).toISOString(), // -3 min
        scheduling_start_time: new Date(baseTime.getTime() - 120000).toISOString(), // -2 min
        initializing_start_time: new Date(baseTime.getTime() - 60000).toISOString(), // -1 min
        start_time: undefined,
        input_download_start_time: undefined,
        input_download_end_time: undefined,
        output_upload_start_time: undefined,
        end_time: undefined,
        pod_ip: podIp,
        node_name: nodeName,
        dashboard_url: dashboardUrl,
        grafana_url: grafanaUrl,
        exit_code: undefined,
        failure_message: undefined,
      };
    }

    // RUNNING: all pre-execution timestamps + start_time + input download
    if (status === TaskGroupStatus.RUNNING) {
      return {
        processing_start_time: new Date(baseTime.getTime() - 300000).toISOString(), // -5 min
        scheduling_start_time: new Date(baseTime.getTime() - 240000).toISOString(), // -4 min
        initializing_start_time: new Date(baseTime.getTime() - 180000).toISOString(), // -3 min
        start_time: new Date(baseTime.getTime() - 120000).toISOString(), // -2 min (RUNNING begins)
        input_download_start_time: new Date(baseTime.getTime() - 110000).toISOString(), // -1:50 (10s after start)
        input_download_end_time: new Date(baseTime.getTime() - 90000).toISOString(), // -1:30 (30s after start)
        output_upload_start_time: undefined, // Not started yet
        end_time: undefined, // Still running
        pod_ip: podIp,
        node_name: nodeName,
        dashboard_url: dashboardUrl,
        grafana_url: grafanaUrl,
        exit_code: undefined,
        failure_message: undefined,
      };
    }

    // COMPLETED: all timestamps, exit_code 0
    if (status === TaskGroupStatus.COMPLETED) {
      return {
        processing_start_time: new Date(baseTime.getTime() - 300000).toISOString(), // -5 min
        scheduling_start_time: new Date(baseTime.getTime() - 240000).toISOString(), // -4 min
        initializing_start_time: new Date(baseTime.getTime() - 180000).toISOString(), // -3 min
        start_time: new Date(baseTime.getTime() - 120000).toISOString(), // -2 min
        input_download_start_time: new Date(baseTime.getTime() - 110000).toISOString(), // -1:50
        input_download_end_time: new Date(baseTime.getTime() - 90000).toISOString(), // -1:30
        output_upload_start_time: new Date(baseTime.getTime() - 30000).toISOString(), // -30s (before end)
        end_time: baseTime.toISOString(), // Now
        pod_ip: podIp,
        node_name: nodeName,
        dashboard_url: dashboardUrl,
        grafana_url: grafanaUrl,
        exit_code: 0,
        failure_message: undefined,
      };
    }

    // FAILED_*: all timestamps except output upload, non-zero exit_code, failure message
    if (status.toString().startsWith("FAILED")) {
      return {
        processing_start_time: new Date(baseTime.getTime() - 300000).toISOString(), // -5 min
        scheduling_start_time: new Date(baseTime.getTime() - 240000).toISOString(), // -4 min
        initializing_start_time: new Date(baseTime.getTime() - 180000).toISOString(), // -3 min
        start_time: new Date(baseTime.getTime() - 120000).toISOString(), // -2 min
        input_download_start_time: new Date(baseTime.getTime() - 110000).toISOString(), // -1:50
        input_download_end_time: new Date(baseTime.getTime() - 90000).toISOString(), // -1:30
        output_upload_start_time: undefined, // Failed before output upload
        end_time: baseTime.toISOString(), // Now
        pod_ip: podIp,
        node_name: nodeName,
        dashboard_url: dashboardUrl,
        grafana_url: grafanaUrl,
        exit_code: faker.helpers.arrayElement([1, 137, 139]),
        failure_message: this.generateFailureMessage(status),
      };
    }

    // Default: return empty
    return {};
  }

  /**
   * Phase 2: Assign group statuses based on workflow status (top-down)
   *
   * State Machine Rules:
   * 1. COMPLETED workflow → all groups COMPLETED
   * 2. PENDING/WAITING workflow → all groups WAITING
   * 3. RUNNING workflow → at least 1 RUNNING, upstream COMPLETED, downstream WAITING
   * 4. FAILED workflow → upstream COMPLETED, one group FAILED, downstream cascade to FAILED_UPSTREAM
   *
   * This ensures logical status flow:
   * - If upstream failed, downstream fails too (FAILED_UPSTREAM)
   * - Nothing comes after pending
   * - Running workflows have at least 1 running group
   */
  private assignGroupStatuses(groups: MockGroup[], workflowStatus: WorkflowStatus, workflowName: string): void {
    if (groups.length === 0) return;

    // Build name → group mapping for efficient lookup
    const groupMap = new Map<string, MockGroup>();
    for (const group of groups) {
      groupMap.set(group.name, group);
    }

    // Topological sort to process groups in dependency order
    const sortedGroups = this.topologicalSort(groups, groupMap);

    // All completed: every group is COMPLETED
    if (workflowStatus === WorkflowStatus.COMPLETED) {
      for (const group of sortedGroups) {
        this.updateGroupStatus(group, TaskGroupStatus.COMPLETED);
      }
      return;
    }

    // Pending/Waiting: every group is WAITING
    if (workflowStatus === WorkflowStatus.PENDING || workflowStatus === WorkflowStatus.WAITING) {
      for (const group of sortedGroups) {
        this.updateGroupStatus(group, TaskGroupStatus.WAITING);
      }
      return;
    }

    // Failed workflow: upstream complete, pick a failure point, downstream cascade
    if (workflowStatus.toString().startsWith("FAILED")) {
      const failureStatus = this.mapWorkflowFailureToTaskFailure(workflowStatus);

      // Pick the failure point - use deterministic selection based on workflow name
      const failureIndex = Math.abs(hashString(workflowName + "failure")) % sortedGroups.length;
      const failedGroupNames = new Set<string>();

      for (let i = 0; i < sortedGroups.length; i++) {
        const group = sortedGroups[i];

        // Check if any upstream has failed
        const hasFailedUpstream = group.upstream_groups.some((upName) => failedGroupNames.has(upName));

        if (hasFailedUpstream) {
          // Downstream of failure: cascade failure using FAILED_UPSTREAM (matches backend behavior)
          this.updateGroupStatus(group, TaskGroupStatus.FAILED_UPSTREAM);
          group.failure_message = "Upstream task failed.";
          failedGroupNames.add(group.name);
        } else if (i === failureIndex) {
          // This is the primary failure point
          this.updateGroupStatus(group, failureStatus);
          group.failure_message = this.generateFailureMessage(failureStatus);
          failedGroupNames.add(group.name);
        } else if (i < failureIndex) {
          // Before failure point: completed
          this.updateGroupStatus(group, TaskGroupStatus.COMPLETED);
        } else {
          // After failure point but not downstream: could be pending (not reachable)
          // In a proper DAG, everything after failure should cascade, but parallel branches might not
          const anyUpstreamCompleted =
            group.upstream_groups.length === 0 ||
            group.upstream_groups.every((upName) => {
              const upGroup = groupMap.get(upName);
              return upGroup && upGroup.status === TaskGroupStatus.COMPLETED;
            });

          if (anyUpstreamCompleted && !hasFailedUpstream) {
            // Parallel branch that didn't get affected
            this.updateGroupStatus(group, TaskGroupStatus.COMPLETED);
          } else {
            // Waiting - upstream not done
            this.updateGroupStatus(group, TaskGroupStatus.WAITING);
          }
        }
      }
      return;
    }

    // Running workflow: simulate DAG execution state
    // INVARIANT: A RUNNING workflow MUST have at least one RUNNING group
    // Backend logic: a group can only run when ALL its upstream groups are COMPLETED
    if (workflowStatus === WorkflowStatus.RUNNING) {
      // Strategy: Pick a "wave front" - groups before it are COMPLETED,
      // the group at the front is RUNNING, groups after are WAITING/SCHEDULING/etc.

      // Step 1: Pick how many groups have completed (0 to n-1, never all)
      // This ensures at least 1 group is NOT completed (the running one)
      const maxCompleted = sortedGroups.length - 1; // Leave room for at least 1 running
      const numCompleted = Math.abs(hashString(workflowName + "progress")) % (maxCompleted + 1);

      // Step 2: Mark the first numCompleted groups as COMPLETED
      const completedGroups = new Set<string>();
      for (let i = 0; i < numCompleted; i++) {
        this.updateGroupStatus(sortedGroups[i], TaskGroupStatus.COMPLETED);
        completedGroups.add(sortedGroups[i].name);
      }

      // Step 3: Find groups that CAN run (all upstream are completed)
      // At least one must exist (the first non-completed group with no incomplete upstream)
      const eligibleToRun: MockGroup[] = [];
      for (let i = numCompleted; i < sortedGroups.length; i++) {
        const group = sortedGroups[i];
        const allUpstreamComplete =
          group.upstream_groups.length === 0 || group.upstream_groups.every((upName) => completedGroups.has(upName));

        if (allUpstreamComplete) {
          eligibleToRun.push(group);
        }
      }

      // Step 4: GUARANTEE at least one group is RUNNING
      // If no groups are eligible (shouldn't happen with topo sort), use first non-completed
      if (eligibleToRun.length === 0) {
        // Fallback: first non-completed group becomes running
        const firstNonCompleted = sortedGroups[numCompleted];
        this.updateGroupStatus(firstNonCompleted, TaskGroupStatus.RUNNING);
        eligibleToRun.push(firstNonCompleted);
      } else {
        // Pick which eligible group is the "primary" running one
        const runningIdx = Math.abs(hashString(workflowName + "running")) % eligibleToRun.length;

        for (let i = 0; i < eligibleToRun.length; i++) {
          const group = eligibleToRun[i];
          if (i === runningIdx) {
            // This is THE running group (guaranteed)
            this.updateGroupStatus(group, TaskGroupStatus.RUNNING);
          } else {
            // Other eligible groups: could be RUNNING, INITIALIZING, or SCHEDULING
            // (all are valid "active" states for a RUNNING workflow)
            const stateHash = Math.abs(hashString(workflowName + group.name)) % 4;
            if (stateHash === 0) {
              this.updateGroupStatus(group, TaskGroupStatus.RUNNING);
            } else if (stateHash === 1) {
              this.updateGroupStatus(group, TaskGroupStatus.INITIALIZING);
            } else if (stateHash === 2) {
              this.updateGroupStatus(group, TaskGroupStatus.SCHEDULING);
            } else {
              // 25% chance of already COMPLETED (just finished)
              this.updateGroupStatus(group, TaskGroupStatus.COMPLETED);
              completedGroups.add(group.name);
            }
          }
        }
      }

      // Step 5: Remaining groups (not completed, not eligible) are WAITING
      for (let i = numCompleted; i < sortedGroups.length; i++) {
        const group = sortedGroups[i];
        if (group.status === TaskGroupStatus.WAITING) {
          // Still has placeholder status - it's waiting for upstream
          this.updateGroupStatus(group, TaskGroupStatus.WAITING);
        }
      }

      return;
    }

    // Fallback: all waiting
    for (const group of sortedGroups) {
      this.updateGroupStatus(group, TaskGroupStatus.WAITING);
    }
  }

  /**
   * Topological sort of groups based on upstream dependencies.
   * Returns groups in order where dependencies come before dependents.
   */
  private topologicalSort(groups: MockGroup[], groupMap: Map<string, MockGroup>): MockGroup[] {
    const sorted: MockGroup[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (group: MockGroup) => {
      if (visited.has(group.name)) return;
      if (visiting.has(group.name)) return; // Cycle detected, skip

      visiting.add(group.name);

      // Visit all upstream groups first
      for (const upstreamName of group.upstream_groups) {
        const upstream = groupMap.get(upstreamName);
        if (upstream) {
          visit(upstream);
        }
      }

      visiting.delete(group.name);
      visited.add(group.name);
      sorted.push(group);
    };

    for (const group of groups) {
      visit(group);
    }

    return sorted;
  }

  /**
   * Map workflow failure status to corresponding task group failure status.
   */
  private mapWorkflowFailureToTaskFailure(workflowStatus: WorkflowStatus): TaskGroupStatus {
    const statusMap: Record<string, TaskGroupStatus> = {
      [WorkflowStatus.FAILED]: TaskGroupStatus.FAILED,
      [WorkflowStatus.FAILED_SUBMISSION]: TaskGroupStatus.FAILED,
      [WorkflowStatus.FAILED_SERVER_ERROR]: TaskGroupStatus.FAILED_SERVER_ERROR,
      [WorkflowStatus.FAILED_EXEC_TIMEOUT]: TaskGroupStatus.FAILED_EXEC_TIMEOUT,
      [WorkflowStatus.FAILED_QUEUE_TIMEOUT]: TaskGroupStatus.FAILED_QUEUE_TIMEOUT,
      [WorkflowStatus.FAILED_CANCELED]: TaskGroupStatus.FAILED_CANCELED,
      [WorkflowStatus.FAILED_BACKEND_ERROR]: TaskGroupStatus.FAILED_BACKEND_ERROR,
      [WorkflowStatus.FAILED_IMAGE_PULL]: TaskGroupStatus.FAILED_IMAGE_PULL,
      [WorkflowStatus.FAILED_EVICTED]: TaskGroupStatus.FAILED_EVICTED,
      [WorkflowStatus.FAILED_START_ERROR]: TaskGroupStatus.FAILED_START_ERROR,
      [WorkflowStatus.FAILED_START_TIMEOUT]: TaskGroupStatus.FAILED_START_TIMEOUT,
      [WorkflowStatus.FAILED_PREEMPTED]: TaskGroupStatus.FAILED_PREEMPTED,
    };
    return statusMap[workflowStatus] || TaskGroupStatus.FAILED;
  }

  private generateNodeName(): string {
    const prefix = faker.helpers.arrayElement(["dgx", "gpu", "node"]);
    const gpuType = faker.helpers.arrayElement(["a100", "h100", "l40s"]);
    const num = faker.number.int({ min: 1, max: 999 });
    return `${prefix}-${gpuType}-${num.toString().padStart(3, "0")}`;
  }

  private generateTags(): string[] {
    const numTags = faker.number.int({ min: 0, max: 3 });
    return faker.helpers.arrayElements(this.config.patterns.tags, numTags);
  }

  private generateFailureMessage(status: TaskGroupStatus): string {
    const messages = this.config.patterns.failures.messages;
    const statusKey = status.toString();

    if (messages[statusKey] && messages[statusKey].length > 0) {
      return faker.helpers.arrayElement(messages[statusKey]);
    }

    return faker.helpers.arrayElement(messages["FAILED"] || ["Unknown error"]);
  }
}

export const workflowGenerator = new WorkflowGenerator();

export function setWorkflowTotal(total: number): void {
  workflowGenerator.total = total;
}

export function getWorkflowTotal(): number {
  return workflowGenerator.total;
}
