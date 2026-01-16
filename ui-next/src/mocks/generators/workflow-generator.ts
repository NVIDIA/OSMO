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
 * Workflow Generator
 *
 * Generates workflows using the same status enums from the OpenAPI spec.
 * Uses deterministic seeding for infinite, memory-efficient pagination.
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

// Re-export status and priority enums
export { WorkflowStatus, TaskGroupStatus, WorkflowPriority };

// ============================================================================
// Mock Types (spec-compatible but simplified for mock generation)
// ============================================================================

/** Priority type derived from generated WorkflowPriority enum */
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

  // Timeline timestamps
  scheduling_start_time?: string;
  initializing_start_time?: string;
  input_download_start_time?: string;
  input_download_end_time?: string;
  processing_start_time?: string;
  start_time?: string;
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

// ============================================================================
// Generator Configuration
// ============================================================================

interface GeneratorConfig {
  /** Total items available (for pagination) */
  total: number;
  /** Base seed for deterministic generation */
  baseSeed: number;
  /** Patterns for realistic data */
  patterns: WorkflowPatterns;
}

const DEFAULT_CONFIG: GeneratorConfig = {
  total: MOCK_CONFIG.volume.workflows, // 10,000 by default
  baseSeed: 12345,
  patterns: MOCK_CONFIG.workflows,
};

// ============================================================================
// Generator Class
// ============================================================================

export class WorkflowGenerator {
  private config: GeneratorConfig;

  constructor(config: Partial<GeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
   * MEMORY EFFICIENT: No storage - regenerated on each call.
   */
  generate(index: number): MockWorkflow {
    // Seed faker deterministically based on index
    faker.seed(this.config.baseSeed + index);

    const status = this.pickWeighted(this.config.patterns.statusDistribution) as WorkflowStatus;
    const priority = this.pickWeighted(this.config.patterns.priorityDistribution) as Priority;
    const pool = faker.helpers.arrayElement(this.config.patterns.pools);
    const user = faker.helpers.arrayElement(this.config.patterns.users);
    const name = this.generateName(index);

    // Timing
    const submitTime = this.generateSubmitTime(index);
    const { startTime, endTime, queuedTime, duration } = this.generateTiming(status, submitTime);

    // Groups and tasks
    const groups = this.generateGroups(status, name);

    // Container image
    const image = `${faker.helpers.arrayElement(MOCK_CONFIG.images.repositories)}:${faker.helpers.arrayElement(MOCK_CONFIG.images.tags)}`;

    return {
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
   * Uses hash-based lookup for efficiency.
   */
  getByName(name: string): MockWorkflow | null {
    // Use hash to find probable index
    const hash = this.hashString(name);
    const index = Math.abs(hash) % this.config.total;

    // Regenerate and check
    const candidate = this.generate(index);
    if (candidate.name === name) {
      return candidate;
    }

    // Fallback: regenerate with name as seed for consistent result
    faker.seed(this.config.baseSeed + Math.abs(hash));
    const workflow = this.generate(Math.abs(hash) % this.config.total);
    return { ...workflow, name };
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
    const groups: MockGroup[] = [];
    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );

    for (let i = 0; i < numGroups; i++) {
      groups.push(
        this.createGroup(
          groupNames[i],
          status,
          i,
          numGroups,
          i > 0 ? [groupNames[i - 1]] : [],
          i < numGroups - 1 ? [groupNames[i + 1]] : [],
          groupPatterns,
          workflowName,
        ),
      );
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
    const groups: MockGroup[] = [];
    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );
    const numRoots = Math.min(2, numGroups - 1); // At least 2 roots, leave 1 for merge

    // Create root nodes (no upstream)
    for (let i = 0; i < numRoots; i++) {
      const downstream = numGroups > numRoots ? [groupNames[numRoots]] : [];
      groups.push(this.createGroup(groupNames[i], status, i, numGroups, [], downstream, groupPatterns, workflowName));
    }

    // Create merge node and subsequent linear chain
    for (let i = numRoots; i < numGroups; i++) {
      const upstream = i === numRoots ? groupNames.slice(0, numRoots) : [groupNames[i - 1]];
      const downstream = i < numGroups - 1 ? [groupNames[i + 1]] : [];
      groups.push(
        this.createGroup(groupNames[i], status, i, numGroups, upstream, downstream, groupPatterns, workflowName),
      );
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
    const groups: MockGroup[] = [];
    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );

    // Root node fans out to all children
    groups.push(
      this.createGroup(
        groupNames[0],
        status,
        0,
        numGroups,
        [],
        groupNames.slice(1, numGroups),
        groupPatterns,
        workflowName,
      ),
    );

    // Children (all depend on root, no downstream)
    for (let i = 1; i < numGroups; i++) {
      groups.push(
        this.createGroup(groupNames[i], status, i, numGroups, [groupNames[0]], [], groupPatterns, workflowName),
      );
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
    const groups: MockGroup[] = [];
    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );
    const numParents = numGroups - 1;
    const mergeNodeIdx = numGroups - 1;

    // Parent nodes (no upstream, all downstream to merge node)
    for (let i = 0; i < numParents; i++) {
      groups.push(
        this.createGroup(
          groupNames[i],
          status,
          i,
          numGroups,
          [],
          [groupNames[mergeNodeIdx]],
          groupPatterns,
          workflowName,
        ),
      );
    }

    // Merge node (all parents as upstream)
    groups.push(
      this.createGroup(
        groupNames[mergeNodeIdx],
        status,
        mergeNodeIdx,
        numGroups,
        groupNames.slice(0, numParents),
        [],
        groupPatterns,
        workflowName,
      ),
    );

    return groups;
  }

  /** Diamond: a → (b, c) → d */
  private generateDiamondGroups(
    status: WorkflowStatus,
    numGroups: number,
    groupPatterns: WorkflowPatterns["groupPatterns"],
    workflowName: string,
  ): MockGroup[] {
    const groups: MockGroup[] = [];
    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );

    if (numGroups < 4) {
      return this.generateLinearGroups(status, numGroups, groupPatterns, workflowName);
    }

    // Calculate middle layer size
    const middleSize = Math.max(2, numGroups - 2);
    const middleStart = 1;
    const middleEnd = middleStart + middleSize;
    const lastIdx = numGroups - 1;

    // Root node
    const middleNames = groupNames.slice(middleStart, Math.min(middleEnd, numGroups - 1));
    groups.push(this.createGroup(groupNames[0], status, 0, numGroups, [], middleNames, groupPatterns, workflowName));

    // Middle layer (parallel nodes)
    for (let i = 0; i < middleNames.length; i++) {
      groups.push(
        this.createGroup(
          middleNames[i],
          status,
          middleStart + i,
          numGroups,
          [groupNames[0]],
          [groupNames[lastIdx]],
          groupPatterns,
          workflowName,
        ),
      );
    }

    // Merge node
    groups.push(
      this.createGroup(groupNames[lastIdx], status, lastIdx, numGroups, middleNames, [], groupPatterns, workflowName),
    );

    return groups;
  }

  /** Complex: multi-level with mixed patterns */
  private generateComplexGroups(
    status: WorkflowStatus,
    numGroups: number,
    groupPatterns: WorkflowPatterns["groupPatterns"],
    workflowName: string,
  ): MockGroup[] {
    const groups: MockGroup[] = [];
    const groupNames = faker.helpers.arrayElements(
      groupPatterns.names,
      Math.max(numGroups, groupPatterns.names.length),
    );

    if (numGroups < 5) {
      return this.generateDiamondGroups(status, numGroups, groupPatterns, workflowName);
    }

    // Level 0: 2 roots
    groups.push(
      this.createGroup(
        groupNames[0],
        status,
        0,
        numGroups,
        [],
        [groupNames[2], groupNames[3]],
        groupPatterns,
        workflowName,
      ),
    );
    groups.push(
      this.createGroup(
        groupNames[1],
        status,
        1,
        numGroups,
        [],
        [groupNames[3], groupNames[4]],
        groupPatterns,
        workflowName,
      ),
    );

    // Level 1: 3 middle nodes with mixed dependencies
    groups.push(
      this.createGroup(
        groupNames[2],
        status,
        2,
        numGroups,
        [groupNames[0]],
        [groupNames[5]],
        groupPatterns,
        workflowName,
      ),
    );
    groups.push(
      this.createGroup(
        groupNames[3],
        status,
        3,
        numGroups,
        [groupNames[0], groupNames[1]],
        [groupNames[5]],
        groupPatterns,
        workflowName,
      ),
    );
    if (numGroups > 5) {
      groups.push(
        this.createGroup(
          groupNames[4],
          status,
          4,
          numGroups,
          [groupNames[1]],
          [groupNames[5]],
          groupPatterns,
          workflowName,
        ),
      );
    }

    // Level 2: merge node
    const mergeUpstream =
      numGroups > 5 ? [groupNames[2], groupNames[3], groupNames[4]] : [groupNames[2], groupNames[3]];
    groups.push(this.createGroup(groupNames[5], status, 5, numGroups, mergeUpstream, [], groupPatterns, workflowName));

    // Additional linear chain if more groups
    for (let i = 6; i < numGroups; i++) {
      groups.push(
        this.createGroup(
          groupNames[i],
          status,
          i,
          numGroups,
          [groupNames[i - 1]],
          i < numGroups - 1 ? [groupNames[i + 1]] : [],
          groupPatterns,
          workflowName,
        ),
      );
    }

    return groups;
  }

  /** Helper to create a group with all properties */
  private createGroup(
    name: string,
    workflowStatus: WorkflowStatus,
    index: number,
    totalGroups: number,
    upstream: string[],
    downstream: string[],
    groupPatterns: WorkflowPatterns["groupPatterns"],
    workflowName: string,
  ): MockGroup {
    const numTasks = faker.number.int(groupPatterns.tasksPerGroup);
    const groupStatus = this.deriveGroupStatus(workflowStatus, index, totalGroups);

    const tasks: MockTask[] = [];
    for (let t = 0; t < numTasks; t++) {
      tasks.push(this.generateTask(workflowName, name, t, groupStatus));
    }

    return {
      name,
      status: groupStatus,
      tasks,
      upstream_groups: upstream,
      downstream_groups: downstream,
      failure_message: groupStatus.toString().startsWith("FAILED")
        ? this.generateFailureMessage(groupStatus)
        : undefined,
    };
  }

  private deriveGroupStatus(workflowStatus: WorkflowStatus, groupIndex: number, totalGroups: number): TaskGroupStatus {
    if (workflowStatus === WorkflowStatus.COMPLETED) {
      return TaskGroupStatus.COMPLETED;
    }

    if (workflowStatus.toString().startsWith("FAILED")) {
      if (groupIndex < totalGroups - 1) {
        return TaskGroupStatus.COMPLETED;
      }
      // Map workflow failure to corresponding task failure
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

    if (workflowStatus === WorkflowStatus.RUNNING) {
      if (groupIndex === 0) return TaskGroupStatus.COMPLETED;
      if (groupIndex === 1) return TaskGroupStatus.RUNNING;
      return TaskGroupStatus.WAITING;
    }

    // Pending/Waiting
    return TaskGroupStatus.WAITING;
  }

  private generateTask(
    workflowName: string,
    groupName: string,
    taskIndex: number,
    groupStatus: TaskGroupStatus,
  ): MockTask {
    const taskPatterns = MOCK_CONFIG.tasks;
    const name = `${groupName}-${taskIndex}`;

    const gpu = faker.helpers.arrayElement(taskPatterns.gpuCounts);
    const cpu = gpu > 0 ? gpu * faker.number.int({ min: 8, max: 16 }) : faker.number.int({ min: 2, max: 8 });
    const memory = cpu * 4; // 4GB per CPU
    const storage = faker.helpers.arrayElement([10, 50, 100, 200]);

    // Determine lifecycle phase
    const notStartedStatuses: TaskGroupStatus[] = [
      TaskGroupStatus.WAITING,
      TaskGroupStatus.SUBMITTING,
      TaskGroupStatus.SCHEDULING,
    ];
    const isScheduling = groupStatus === TaskGroupStatus.SCHEDULING;
    const isInitializing = groupStatus === TaskGroupStatus.INITIALIZING;
    const started = !notStartedStatuses.includes(groupStatus);
    const isRunning = groupStatus === TaskGroupStatus.RUNNING;
    const completed = groupStatus === TaskGroupStatus.COMPLETED || groupStatus.toString().startsWith("FAILED");
    const isFailed = groupStatus.toString().startsWith("FAILED");

    // Generate task UUID
    const taskUuid = faker.string.uuid();

    // Generate pod name (format: workflowName-taskName-randomSuffix)
    const podSuffix = faker.string.alphanumeric({ length: 5, casing: "lower" });
    const podName = `${workflowName.slice(0, 20)}-${name}-${podSuffix}`;

    // Generate timeline timestamps based on status
    // Base time for task start (within last 7 days)
    const baseTime = faker.date.recent({ days: 7 });

    // Scheduling start - set for any task that has started scheduling
    const schedulingStartTime =
      isScheduling || isInitializing || started ? new Date(baseTime.getTime() - 120000).toISOString() : undefined;

    // Initializing start - set when past scheduling
    const initializingStartTime =
      isInitializing || started ? new Date(baseTime.getTime() - 60000).toISOString() : undefined;

    // Input download times - set when running or completed
    const inputDownloadStartTime = started ? new Date(baseTime.getTime() - 30000).toISOString() : undefined;
    const inputDownloadEndTime = started ? new Date(baseTime.getTime() - 20000).toISOString() : undefined;

    // Processing start time
    const processingStartTime = started ? new Date(baseTime.getTime() - 15000).toISOString() : undefined;

    // Start time (when task actually begins execution)
    const startTime = started ? baseTime.toISOString() : undefined;

    // Output upload start - only for completed tasks
    const outputUploadStartTime = completed ? new Date(baseTime.getTime() + 3600000).toISOString() : undefined;

    // End time - only for completed tasks
    const endTime = completed ? new Date(baseTime.getTime() + 3660000).toISOString() : undefined;

    return {
      name,
      retry_id: faker.datatype.boolean({ probability: 0.1 }) ? faker.number.int({ min: 1, max: 3 }) : 0,
      status: groupStatus,
      lead: taskIndex === 0, // First task in group is lead

      // Identifiers
      task_uuid: taskUuid,
      pod_name: podName,
      pod_ip: started
        ? `10.${faker.number.int({ min: 0, max: 255 })}.${faker.number.int({ min: 0, max: 255 })}.${faker.number.int({ min: 1, max: 254 })}`
        : undefined,
      node_name: started ? this.generateNodeName() : undefined,

      // Timeline timestamps
      scheduling_start_time: schedulingStartTime,
      initializing_start_time: initializingStartTime,
      input_download_start_time: inputDownloadStartTime,
      input_download_end_time: inputDownloadEndTime,
      processing_start_time: processingStartTime,
      start_time: startTime,
      output_upload_start_time: outputUploadStartTime,
      end_time: endTime,

      // Status
      exit_code:
        groupStatus === TaskGroupStatus.COMPLETED
          ? 0
          : isFailed
            ? faker.helpers.arrayElement([1, 137, 139])
            : undefined,
      failure_message: isFailed ? this.generateFailureMessage(groupStatus) : undefined,

      // URLs
      logs: `/api/workflow/${workflowName}/task/${name}/logs`,
      error_logs: isFailed ? `/api/workflow/${workflowName}/task/${name}/error-logs` : undefined,
      events: `/api/workflow/${workflowName}/task/${name}/events`,
      dashboard_url: started ? `https://kubernetes.example.com/pod/${podName}` : undefined,
      grafana_url: started ? `https://grafana.example.com/d/task/${taskUuid}` : undefined,

      // Resources
      storage,
      cpu,
      memory,
      gpu,
      image: `${faker.helpers.arrayElement(MOCK_CONFIG.images.repositories)}:${faker.helpers.arrayElement(MOCK_CONFIG.images.tags)}`,
    };
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

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash;
  }
}

// ============================================================================
// Singleton instance for convenience
// ============================================================================

export const workflowGenerator = new WorkflowGenerator();

// ============================================================================
// Configuration helpers
// ============================================================================

/**
 * Set the total number of workflows for infinite pagination testing.
 * Can be set to any number - items are generated on demand.
 */
export function setWorkflowTotal(total: number): void {
  workflowGenerator.total = total;
}

/**
 * Get current workflow total.
 */
export function getWorkflowTotal(): number {
  return workflowGenerator.total;
}
