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
import { delay, HttpResponse } from "msw";

import {
  WorkflowStatus,
  TaskGroupStatus,
  WorkflowPriority,
  type SrcServiceCoreWorkflowObjectsListEntry,
  type SrcServiceCoreWorkflowObjectsListResponse,
  type WorkflowQueryResponse,
  type TaskQueryResponse,
  type SubmitResponse,
} from "@/lib/api/generated";

import { MOCK_CONFIG, type WorkflowPatterns } from "@/mocks/seed/types";
import { hashString, getMockDelay, parsePagination, parseWorkflowFilters, hasActiveFilters } from "@/mocks/utils";
import { getGlobalMockConfig } from "@/mocks/global-config";
import { MOCK_WORKFLOWS, getMockWorkflow } from "@/mocks/mock-workflows";

export { WorkflowStatus, TaskGroupStatus, WorkflowPriority };

export type Priority = (typeof WorkflowPriority)[keyof typeof WorkflowPriority];

export interface MockTask {
  name: string;
  retry_id: number;
  status: TaskGroupStatus;
  lead?: boolean;

  task_uuid: string;
  pod_name: string;
  pod_ip?: string;
  node_name?: string;

  processing_start_time?: string;
  scheduling_start_time?: string;
  initializing_start_time?: string;
  start_time?: string;
  input_download_start_time?: string;
  input_download_end_time?: string;
  output_upload_start_time?: string;
  end_time?: string;

  failure_message?: string;
  exit_code?: number;

  logs: string;
  error_logs?: string;
  events: string;
  dashboard_url?: string;
  grafana_url?: string;

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
  spec_url: string;
  template_spec_url: string;
  logs_url: string;
  events_url: string;
}

interface GeneratorConfig {
  baseSeed: number;
  patterns: WorkflowPatterns;
}

const DEFAULT_CONFIG: GeneratorConfig = {
  baseSeed: 12345,
  patterns: MOCK_CONFIG.workflows,
};

export class WorkflowGenerator {
  private config: GeneratorConfig;
  private nameToIndexCache: Map<string, number> = new Map();
  private cachedUpToIndex: number = -1;

  constructor(config: Partial<GeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  clearCache(): void {
    this.nameToIndexCache.clear();
    this.cachedUpToIndex = -1;
  }

  get total(): number {
    const globalConfig = getGlobalMockConfig();
    return globalConfig.workflows;
  }

  set total(value: number) {
    const globalConfig = getGlobalMockConfig();
    globalConfig.workflows = value;
  }

  generate(index: number): MockWorkflow {
    faker.seed(this.config.baseSeed + index);
    const name = this.generateName(index);
    this.nameToIndexCache.set(name, index);
    return this.buildWorkflowBody(name, index);
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
      const hasRunningGroup = workflow.groups.some((g) => g.status === TaskGroupStatus.RUNNING);

      if (!hasRunningGroup) {
        for (const group of workflow.groups) {
          const allUpstreamComplete =
            group.upstream_groups.length === 0 ||
            group.upstream_groups.every((upName) => {
              const upGroup = workflow.groups.find((g) => g.name === upName);
              return upGroup && upGroup.status === TaskGroupStatus.COMPLETED;
            });

          if (allUpstreamComplete && group.status !== TaskGroupStatus.COMPLETED) {
            this.updateGroupStatus(group, TaskGroupStatus.RUNNING);
            break;
          }
        }
      }

      for (const group of workflow.groups) {
        if (group.status === TaskGroupStatus.RUNNING) {
          const hasRunningTask = group.tasks.some((t) => t.status === TaskGroupStatus.RUNNING);
          if (!hasRunningTask && group.tasks.length > 0) {
            this.updateGroupStatus(group, TaskGroupStatus.RUNNING);
          }
        }
      }

      const allTasksCompleted = workflow.groups.every((g) =>
        g.tasks.every((t) => t.status === TaskGroupStatus.COMPLETED),
      );
      if (allTasksCompleted) {
        const runningGroup = workflow.groups.find((g) => g.status === TaskGroupStatus.RUNNING);
        if (runningGroup) {
          this.updateGroupStatus(runningGroup, TaskGroupStatus.RUNNING);
        }
      }
    }

    if (workflow.status === WorkflowStatus.COMPLETED) {
      for (const group of workflow.groups) {
        this.updateGroupStatus(group, TaskGroupStatus.COMPLETED);
      }
    }

    if (workflow.status === WorkflowStatus.PENDING) {
      for (const group of workflow.groups) {
        this.updateGroupStatus(group, TaskGroupStatus.WAITING);
      }
    }

    if (workflow.status.toString().startsWith("FAILED")) {
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

    const timestamps = this.generateTaskTimestamps(newStatus, task.pod_name, task.task_uuid);
    task.processing_start_time = timestamps.processing_start_time;
    task.scheduling_start_time = timestamps.scheduling_start_time;
    task.initializing_start_time = timestamps.initializing_start_time;
    task.start_time = timestamps.start_time;
    task.input_download_start_time = timestamps.input_download_start_time;
    task.input_download_end_time = timestamps.input_download_end_time;
    task.output_upload_start_time = timestamps.output_upload_start_time;
    task.end_time = timestamps.end_time;

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

    if (newStatus.toString().startsWith("FAILED") && !group.failure_message) {
      group.failure_message = this.generateFailureMessage(newStatus);
    } else if (!newStatus.toString().startsWith("FAILED")) {
      group.failure_message = undefined;
    }

    for (let i = 0; i < group.tasks.length; i++) {
      const taskStatus = this.deriveTaskStatusFromGroup(newStatus, i, group.tasks.length);
      this.updateTaskStatus(group.tasks[i], taskStatus);
    }
  }

  generatePage(offset: number, limit: number): { entries: MockWorkflow[]; total: number } {
    const entries: MockWorkflow[] = [];
    const total = this.total;
    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);

    for (let i = start; i < end; i++) {
      entries.push(this.generate(i));
    }

    return { entries, total };
  }

  getByName(name: string): MockWorkflow {
    const cachedIndex = this.nameToIndexCache.get(name);
    if (cachedIndex !== undefined) {
      return this.generate(cachedIndex);
    }

    const hash = hashString(name);
    const guessIndex = Math.abs(hash) % this.total;
    const candidate = this.generate(guessIndex);
    if (candidate.name === name) {
      return candidate;
    }

    const SCAN_LIMIT = Math.min(1000, this.total);
    if (this.cachedUpToIndex < SCAN_LIMIT - 1) {
      for (let i = this.cachedUpToIndex + 1; i < SCAN_LIMIT; i++) {
        const workflow = this.generate(i);
        if (workflow.name === name) {
          return workflow;
        }
      }
      this.cachedUpToIndex = SCAN_LIMIT - 1;
    }

    const foundIndex = this.nameToIndexCache.get(name);
    if (foundIndex !== undefined) {
      return this.generate(foundIndex);
    }

    return this.generateForArbitraryName(name);
  }

  private buildWorkflowBody(name: string, pseudoIndex: number): MockWorkflow {
    const status = this.pickWeighted(this.config.patterns.statusDistribution) as WorkflowStatus;
    const priority = this.pickWeighted(this.config.patterns.priorityDistribution) as Priority;
    const pool = faker.helpers.arrayElement(this.config.patterns.pools);
    const user = faker.helpers.arrayElement(this.config.patterns.users);
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
      template_spec_url: `/api/workflow/${name}/template-spec`,
      logs_url: `/api/workflow/${name}/logs`,
      events_url: `/api/workflow/${name}/events`,
    };

    this.enforceInvariants(workflow);
    return workflow;
  }

  private generateForArbitraryName(name: string): MockWorkflow {
    const nameHash = Math.abs(hashString(name));
    faker.seed(this.config.baseSeed + nameHash);
    return this.buildWorkflowBody(name, nameHash % this.total);
  }

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

  private generateName(_index: number): string {
    const prefix = faker.helpers.arrayElement(this.config.patterns.namePatterns.prefixes);
    const suffix = faker.helpers.arrayElement(this.config.patterns.namePatterns.suffixes);
    const id = faker.string.alphanumeric(8).toLowerCase();
    return `${prefix}-${suffix}-${id}`;
  }

  private generateSubmitTime(index: number): string {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const progress = 1 - index / this.total;
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

    const queuedTime = faker.number.int({
      min: timing.queueTime.min,
      max: timing.queueTime.p90,
    });

    if (status === WorkflowStatus.PENDING || status === WorkflowStatus.WAITING) {
      return { queuedTime };
    }

    const startDate = new Date(submitDate.getTime() + queuedTime * 1000);
    const startTime = startDate.toISOString();

    if (status === WorkflowStatus.RUNNING) {
      return { startTime, queuedTime };
    }

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

    if (numGroups <= 2) {
      return this.generateLinearGroups(status, numGroups, groupPatterns, workflowName);
    }

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

    this.assignGroupStatuses(groups, status, workflowName);

    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

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

    this.assignGroupStatuses(groups, status, workflowName);
    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

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

    const groups: MockGroup[] = [];
    groups.push(this.createGroupStructure(groupNames[0], [], groupNames.slice(1, numGroups)));
    for (let i = 1; i < numGroups; i++) {
      groups.push(this.createGroupStructure(groupNames[i], [groupNames[0]], []));
    }

    this.assignGroupStatuses(groups, status, workflowName);
    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

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

    const groups: MockGroup[] = [];
    for (let i = 0; i < numParents; i++) {
      groups.push(this.createGroupStructure(groupNames[i], [], [groupNames[mergeNodeIdx]]));
    }
    groups.push(this.createGroupStructure(groupNames[mergeNodeIdx], groupNames.slice(0, numParents), []));

    this.assignGroupStatuses(groups, status, workflowName);
    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

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

    const groups: MockGroup[] = [];
    groups.push(this.createGroupStructure(groupNames[0], [], middleNames));
    for (const middleName of middleNames) {
      groups.push(this.createGroupStructure(middleName, [groupNames[0]], [groupNames[lastIdx]]));
    }
    groups.push(this.createGroupStructure(groupNames[lastIdx], middleNames, []));

    this.assignGroupStatuses(groups, status, workflowName);
    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

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

    const groups: MockGroup[] = [];

    groups.push(this.createGroupStructure(groupNames[0], [], [groupNames[2], groupNames[3]]));
    groups.push(this.createGroupStructure(groupNames[1], [], [groupNames[3], groupNames[4]]));

    groups.push(this.createGroupStructure(groupNames[2], [groupNames[0]], [groupNames[5]]));
    groups.push(this.createGroupStructure(groupNames[3], [groupNames[0], groupNames[1]], [groupNames[5]]));
    if (numGroups > 5) {
      groups.push(this.createGroupStructure(groupNames[4], [groupNames[1]], [groupNames[5]]));
    }

    const mergeUpstream =
      numGroups > 5 ? [groupNames[2], groupNames[3], groupNames[4]] : [groupNames[2], groupNames[3]];
    groups.push(this.createGroupStructure(groupNames[5], mergeUpstream, []));

    for (let i = 6; i < numGroups; i++) {
      groups.push(
        this.createGroupStructure(groupNames[i], [groupNames[i - 1]], i < numGroups - 1 ? [groupNames[i + 1]] : []),
      );
    }

    this.assignGroupStatuses(groups, status, workflowName);
    for (const group of groups) {
      this.populateGroupTasks(group, workflowName, groupPatterns);
    }

    return groups;
  }

  private createGroupStructure(name: string, upstream: string[], downstream: string[]): MockGroup {
    return {
      name,
      status: TaskGroupStatus.WAITING,
      tasks: [],
      upstream_groups: upstream,
      downstream_groups: downstream,
      failure_message: undefined,
    };
  }

  private populateGroupTasks(
    group: MockGroup,
    workflowName: string,
    groupPatterns: WorkflowPatterns["groupPatterns"],
  ): void {
    const numTasks = faker.number.int(groupPatterns.tasksPerGroup);

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
      case TaskGroupStatus.WAITING:
      case TaskGroupStatus.SUBMITTING:
      case TaskGroupStatus.SCHEDULING:
        return groupStatus;

      case TaskGroupStatus.INITIALIZING:
        if (isLead) return TaskGroupStatus.INITIALIZING;
        return faker.datatype.boolean() ? TaskGroupStatus.INITIALIZING : TaskGroupStatus.SCHEDULING;

      case TaskGroupStatus.RUNNING:
        if (isLead) return TaskGroupStatus.RUNNING;
        return faker.number.float({ min: 0, max: 1 }) < 0.7 ? TaskGroupStatus.RUNNING : TaskGroupStatus.INITIALIZING;

      case TaskGroupStatus.COMPLETED:
        return TaskGroupStatus.COMPLETED;

      case TaskGroupStatus.FAILED_UPSTREAM:
        return TaskGroupStatus.FAILED_UPSTREAM;

      default:
        if (groupStatus.toString().startsWith("FAILED")) {
          if (isLead) return groupStatus;
          return faker.datatype.boolean() ? TaskGroupStatus.FAILED : TaskGroupStatus.COMPLETED;
        }
        return groupStatus;
    }
  }

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

    const podIp = `10.${faker.number.int({ min: 0, max: 255 })}.${faker.number.int({ min: 0, max: 255 })}.${faker.number.int({ min: 1, max: 254 })}`;
    const nodeName = this.generateNodeName();
    const dashboardUrl = `https://kubernetes.example.com/pod/${podName}`;
    const grafanaUrl = `https://grafana.example.com/d/task/${taskUuid}`;

    if (status === TaskGroupStatus.INITIALIZING) {
      return {
        processing_start_time: new Date(baseTime.getTime() - 180000).toISOString(),
        scheduling_start_time: new Date(baseTime.getTime() - 120000).toISOString(),
        initializing_start_time: new Date(baseTime.getTime() - 60000).toISOString(),
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

    if (status === TaskGroupStatus.RUNNING) {
      return {
        processing_start_time: new Date(baseTime.getTime() - 300000).toISOString(),
        scheduling_start_time: new Date(baseTime.getTime() - 240000).toISOString(),
        initializing_start_time: new Date(baseTime.getTime() - 180000).toISOString(),
        start_time: new Date(baseTime.getTime() - 120000).toISOString(),
        input_download_start_time: new Date(baseTime.getTime() - 110000).toISOString(),
        input_download_end_time: new Date(baseTime.getTime() - 90000).toISOString(),
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

    if (status === TaskGroupStatus.COMPLETED) {
      return {
        processing_start_time: new Date(baseTime.getTime() - 300000).toISOString(),
        scheduling_start_time: new Date(baseTime.getTime() - 240000).toISOString(),
        initializing_start_time: new Date(baseTime.getTime() - 180000).toISOString(),
        start_time: new Date(baseTime.getTime() - 120000).toISOString(),
        input_download_start_time: new Date(baseTime.getTime() - 110000).toISOString(),
        input_download_end_time: new Date(baseTime.getTime() - 90000).toISOString(),
        output_upload_start_time: new Date(baseTime.getTime() - 30000).toISOString(),
        end_time: baseTime.toISOString(),
        pod_ip: podIp,
        node_name: nodeName,
        dashboard_url: dashboardUrl,
        grafana_url: grafanaUrl,
        exit_code: 0,
        failure_message: undefined,
      };
    }

    if (status.toString().startsWith("FAILED")) {
      return {
        processing_start_time: new Date(baseTime.getTime() - 300000).toISOString(),
        scheduling_start_time: new Date(baseTime.getTime() - 240000).toISOString(),
        initializing_start_time: new Date(baseTime.getTime() - 180000).toISOString(),
        start_time: new Date(baseTime.getTime() - 120000).toISOString(),
        input_download_start_time: new Date(baseTime.getTime() - 110000).toISOString(),
        input_download_end_time: new Date(baseTime.getTime() - 90000).toISOString(),
        output_upload_start_time: undefined,
        end_time: baseTime.toISOString(),
        pod_ip: podIp,
        node_name: nodeName,
        dashboard_url: dashboardUrl,
        grafana_url: grafanaUrl,
        exit_code: faker.helpers.arrayElement([1, 137, 139]),
        failure_message: this.generateFailureMessage(status),
      };
    }

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

    const groupMap = new Map<string, MockGroup>();
    for (const group of groups) {
      groupMap.set(group.name, group);
    }

    const sortedGroups = this.topologicalSort(groups, groupMap);

    if (workflowStatus === WorkflowStatus.COMPLETED) {
      for (const group of sortedGroups) {
        this.updateGroupStatus(group, TaskGroupStatus.COMPLETED);
      }
      return;
    }

    if (workflowStatus === WorkflowStatus.PENDING || workflowStatus === WorkflowStatus.WAITING) {
      for (const group of sortedGroups) {
        this.updateGroupStatus(group, TaskGroupStatus.WAITING);
      }
      return;
    }

    if (workflowStatus.toString().startsWith("FAILED")) {
      const failureStatus = this.mapWorkflowFailureToTaskFailure(workflowStatus);

      const failureIndex = Math.abs(hashString(workflowName + "failure")) % sortedGroups.length;
      const failedGroupNames = new Set<string>();

      for (let i = 0; i < sortedGroups.length; i++) {
        const group = sortedGroups[i];

        const hasFailedUpstream = group.upstream_groups.some((upName) => failedGroupNames.has(upName));

        if (hasFailedUpstream) {
          this.updateGroupStatus(group, TaskGroupStatus.FAILED_UPSTREAM);
          group.failure_message = "Upstream task failed.";
          failedGroupNames.add(group.name);
        } else if (i === failureIndex) {
          this.updateGroupStatus(group, failureStatus);
          group.failure_message = this.generateFailureMessage(failureStatus);
          failedGroupNames.add(group.name);
        } else if (i < failureIndex) {
          this.updateGroupStatus(group, TaskGroupStatus.COMPLETED);
        } else {
          const anyUpstreamCompleted =
            group.upstream_groups.length === 0 ||
            group.upstream_groups.every((upName) => {
              const upGroup = groupMap.get(upName);
              return upGroup && upGroup.status === TaskGroupStatus.COMPLETED;
            });

          if (anyUpstreamCompleted && !hasFailedUpstream) {
            this.updateGroupStatus(group, TaskGroupStatus.COMPLETED);
          } else {
            this.updateGroupStatus(group, TaskGroupStatus.WAITING);
          }
        }
      }
      return;
    }

    if (workflowStatus === WorkflowStatus.RUNNING) {
      const maxCompleted = sortedGroups.length - 1;
      const numCompleted = Math.abs(hashString(workflowName + "progress")) % (maxCompleted + 1);

      const completedGroups = new Set<string>();
      for (let i = 0; i < numCompleted; i++) {
        this.updateGroupStatus(sortedGroups[i], TaskGroupStatus.COMPLETED);
        completedGroups.add(sortedGroups[i].name);
      }

      const eligibleToRun: MockGroup[] = [];
      for (let i = numCompleted; i < sortedGroups.length; i++) {
        const group = sortedGroups[i];
        const allUpstreamComplete =
          group.upstream_groups.length === 0 || group.upstream_groups.every((upName) => completedGroups.has(upName));

        if (allUpstreamComplete) {
          eligibleToRun.push(group);
        }
      }

      if (eligibleToRun.length === 0) {
        const firstNonCompleted = sortedGroups[numCompleted];
        this.updateGroupStatus(firstNonCompleted, TaskGroupStatus.RUNNING);
        eligibleToRun.push(firstNonCompleted);
      } else {
        const runningIdx = Math.abs(hashString(workflowName + "running")) % eligibleToRun.length;

        for (let i = 0; i < eligibleToRun.length; i++) {
          const group = eligibleToRun[i];
          if (i === runningIdx) {
            this.updateGroupStatus(group, TaskGroupStatus.RUNNING);
          } else {
            const stateHash = Math.abs(hashString(workflowName + group.name)) % 4;
            if (stateHash === 0) {
              this.updateGroupStatus(group, TaskGroupStatus.RUNNING);
            } else if (stateHash === 1) {
              this.updateGroupStatus(group, TaskGroupStatus.INITIALIZING);
            } else if (stateHash === 2) {
              this.updateGroupStatus(group, TaskGroupStatus.SCHEDULING);
            } else {
              this.updateGroupStatus(group, TaskGroupStatus.COMPLETED);
              completedGroups.add(group.name);
            }
          }
        }
      }

      for (let i = numCompleted; i < sortedGroups.length; i++) {
        const group = sortedGroups[i];
        if (group.status === TaskGroupStatus.WAITING) {
          this.updateGroupStatus(group, TaskGroupStatus.WAITING);
        }
      }

      return;
    }

    for (const group of sortedGroups) {
      this.updateGroupStatus(group, TaskGroupStatus.WAITING);
    }
  }

  private topologicalSort(groups: MockGroup[], groupMap: Map<string, MockGroup>): MockGroup[] {
    const sorted: MockGroup[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (group: MockGroup) => {
      if (visited.has(group.name)) return;
      if (visiting.has(group.name)) return;

      visiting.add(group.name);

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

  toListEntry(w: MockWorkflow): SrcServiceCoreWorkflowObjectsListEntry {
    return {
      user: w.submitted_by,
      name: w.name,
      workflow_uuid: w.uuid,
      submit_time: w.submit_time,
      start_time: w.start_time,
      end_time: w.end_time,
      queued_time: w.queued_time,
      duration: w.duration,
      status: w.status,
      overview: `${w.groups.length} groups, ${w.groups.reduce((sum, g) => sum + g.tasks.length, 0)} tasks`,
      logs: w.logs_url,
      error_logs: w.status.toString().startsWith("FAILED") ? `/api/workflow/${w.name}/logs?type=error` : undefined,
      grafana_url: `https://grafana.example.com/d/workflow/${w.name}`,
      dashboard_url: `https://dashboard.example.com/workflow/${w.name}`,
      pool: w.pool,
      app_owner: undefined,
      app_name: undefined,
      app_version: undefined,
      priority: w.priority,
    };
  }

  toWorkflowQueryResponse(w: MockWorkflow): WorkflowQueryResponse {
    const groups = w.groups.map((g) => ({
      name: g.name,
      status: g.status,
      start_time: g.tasks[0]?.start_time,
      end_time: g.tasks[g.tasks.length - 1]?.end_time,
      remaining_upstream_groups: g.upstream_groups.length > 0 ? g.upstream_groups : undefined,
      downstream_groups: g.downstream_groups.length > 0 ? g.downstream_groups : undefined,
      failure_message: g.failure_message,
      tasks: g.tasks.map((t) => ({
        name: t.name,
        retry_id: t.retry_id,
        status: t.status,
        lead: t.lead,
        task_uuid: t.task_uuid,
        pod_name: t.pod_name,
        pod_ip: t.pod_ip,
        node_name: t.node_name,
        scheduling_start_time: t.scheduling_start_time,
        initializing_start_time: t.initializing_start_time,
        input_download_start_time: t.input_download_start_time,
        input_download_end_time: t.input_download_end_time,
        processing_start_time: t.processing_start_time,
        start_time: t.start_time,
        output_upload_start_time: t.output_upload_start_time,
        end_time: t.end_time,
        exit_code: t.exit_code,
        failure_message: t.failure_message,
        logs: t.logs,
        error_logs: t.error_logs,
        events: t.events,
        dashboard_url: t.dashboard_url,
        grafana_url: t.grafana_url,
      })),
    }));

    return {
      name: w.name,
      uuid: w.uuid,
      submitted_by: w.submitted_by,
      cancelled_by: w.cancelled_by,
      spec: w.spec_url,
      template_spec: w.template_spec_url,
      logs: w.logs_url,
      events: w.events_url,
      overview: `${w.groups.length} groups, ${w.groups.reduce((sum, g) => sum + g.tasks.length, 0)} tasks`,
      dashboard_url: `https://dashboard.example.com/workflow/${w.name}`,
      grafana_url: `https://grafana.example.com/d/workflow/${w.name}`,
      tags: w.tags,
      submit_time: w.submit_time,
      start_time: w.start_time,
      end_time: w.end_time,
      duration: w.duration,
      queued_time: w.queued_time,
      status: w.status,
      groups,
      pool: w.pool,
      backend: w.backend,
      plugins: {},
      priority: w.priority,
    };
  }

  handleGetUsers = async (): Promise<Response> => {
    await delay(getMockDelay());
    return HttpResponse.json(this.config.patterns.users);
  };

  handleListWorkflows = async ({
    request,
  }: {
    request: Request;
  }): Promise<SrcServiceCoreWorkflowObjectsListResponse> => {
    await delay(getMockDelay());
    const url = new URL(request.url);
    const { offset, limit } = parsePagination(url, { limit: 20 });
    const filters = parseWorkflowFilters(url);

    // Convert hardcoded mock workflows to list entries so they participate in filtering/pagination
    const mockListEntries: SrcServiceCoreWorkflowObjectsListEntry[] = Object.values(MOCK_WORKFLOWS).map((mw) => ({
      user: mw.submitted_by,
      name: mw.name,
      workflow_uuid: mw.uuid,
      submit_time: mw.submit_time,
      start_time: mw.start_time,
      end_time: mw.end_time,
      queued_time: mw.queued_time,
      duration: mw.duration,
      status: mw.status,
      overview: `${mw.groups.length} groups, ${mw.groups.reduce((sum, g) => sum + (g.tasks?.length ?? 0), 0)} tasks`,
      logs: mw.logs,
      error_logs: mw.status.toString().startsWith("FAILED") ? `/api/workflow/${mw.name}/logs?type=error` : undefined,
      grafana_url: `https://grafana.example.com/d/workflow/${mw.name}`,
      dashboard_url: `https://dashboard.example.com/workflow/${mw.name}`,
      pool: mw.pool,
      app_owner: undefined,
      app_name: undefined,
      app_version: undefined,
      priority: mw.priority as Priority,
    }));

    if (hasActiveFilters(filters)) {
      // When filtering, generate the full scannable set, filter, then paginate
      const { entries } = this.generatePage(0, this.total);
      const allEntries = [...mockListEntries, ...entries.map((w) => this.toListEntry(w))];
      let filtered = allEntries;
      if (filters.statuses.length > 0) filtered = filtered.filter((w) => filters.statuses.includes(w.status));
      if (filters.pools.length > 0) filtered = filtered.filter((w) => w.pool && filters.pools.includes(w.pool));
      if (filters.users.length > 0) filtered = filtered.filter((w) => w.user && filters.users.includes(w.user));

      const page = filtered.slice(offset, offset + limit);
      return {
        workflows: page,
        more_entries: offset + limit < filtered.length,
      };
    }

    // Mock entries are prepended to the virtual list, shifting generated entries down.
    // Compute which portion of the combined list falls within [offset, offset+limit).
    const mockCount = mockListEntries.length;
    const totalCombined = mockCount + this.total;

    // Slice mock entries for this page
    const mockStart = Math.min(offset, mockCount);
    const mockEnd = Math.min(offset + limit, mockCount);
    const mockSlice = mockListEntries.slice(mockStart, mockEnd);

    // Fill remaining page slots from generated entries
    const remainingSlots = limit - mockSlice.length;
    const generatedOffset = Math.max(0, offset - mockCount);
    const { entries } = this.generatePage(generatedOffset, remainingSlots);
    const generatedSlice = entries.map((w) => this.toListEntry(w));

    return {
      workflows: [...mockSlice, ...generatedSlice],
      more_entries: offset + limit < totalCombined,
    };
  };

  handleGetTask = async ({
    params,
  }: {
    params: Record<string, string | readonly string[] | undefined>;
  }): Promise<Response> => {
    await delay(getMockDelay());
    const workflowName = params.name as string;
    const taskName = params.taskName as string;

    // Check hardcoded mock workflows first so retry/logs state is preserved
    const mockWorkflow = getMockWorkflow(workflowName);
    if (mockWorkflow) {
      for (const group of mockWorkflow.groups ?? []) {
        const task = group.tasks?.find((t) => t.name === taskName);
        if (task) {
          return HttpResponse.json(task);
        }
      }
      return new HttpResponse(null, { status: 404 });
    }

    const workflow = this.getByName(workflowName);
    for (const group of workflow.groups) {
      const task = group.tasks.find((t) => t.name === taskName);
      if (task) {
        const response: TaskQueryResponse = {
          name: task.name,
          retry_id: task.retry_id,
          status: task.status,
          lead: task.lead,
          task_uuid: task.task_uuid,
          pod_name: task.pod_name,
          pod_ip: task.pod_ip,
          node_name: task.node_name,
          scheduling_start_time: task.scheduling_start_time,
          initializing_start_time: task.initializing_start_time,
          input_download_start_time: task.input_download_start_time,
          input_download_end_time: task.input_download_end_time,
          processing_start_time: task.processing_start_time,
          start_time: task.start_time,
          output_upload_start_time: task.output_upload_start_time,
          end_time: task.end_time,
          exit_code: task.exit_code,
          failure_message: task.failure_message,
          logs: task.logs,
          error_logs: task.error_logs,
          events: task.events,
          dashboard_url: task.dashboard_url,
        };
        return HttpResponse.json(response);
      }
    }
    return new HttpResponse(null, { status: 404 });
  };

  handleSubmitWorkflow = async ({
    request,
  }: {
    params: Record<string, string | readonly string[] | undefined>;
    request: Request;
  }): Promise<SubmitResponse> => {
    await delay(getMockDelay());
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("workflow_id");
    const seed = workflowId ? hashString(workflowId + Date.now()) : Math.floor(Math.random() * 1000000);
    faker.seed(seed);
    const prefix = faker.helpers.arrayElement(this.config.patterns.namePatterns.prefixes);
    const suffix = faker.helpers.arrayElement(this.config.patterns.namePatterns.suffixes);
    const id = faker.string.alphanumeric(8).toLowerCase();
    const newWorkflowName = `${prefix}-${suffix}-${id}`;
    return {
      name: newWorkflowName,
      overview: `/api/workflow/${newWorkflowName}`,
      logs: `/api/workflow/${newWorkflowName}/logs`,
      spec: `/api/workflow/${newWorkflowName}/spec`,
      dashboard_url: `/workflows/${newWorkflowName}`,
    };
  };
}

export const workflowGenerator = new WorkflowGenerator();
