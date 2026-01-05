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

// Import status enums from generated API spec - prevents drift!
import { WorkflowStatus, TaskGroupStatus } from "@/lib/api/generated";

import { MOCK_CONFIG, type WorkflowPatterns } from "../seed";

// Re-export status enums
export { WorkflowStatus, TaskGroupStatus };

// ============================================================================
// Mock Types (spec-compatible but simplified for mock generation)
// ============================================================================

export type Priority = "LOW" | "NORMAL" | "HIGH";

export interface MockTask {
  name: string;
  retry_id: number;
  status: TaskGroupStatus;
  node?: string;
  start_time?: string;
  end_time?: string;
  failure_message?: string;
  exit_code?: number;
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

  private generateGroups(status: WorkflowStatus, _workflowName: string): MockGroup[] {
    const groupPatterns = this.config.patterns.groupPatterns;
    const numGroups = faker.number.int(groupPatterns.groupsPerWorkflow);
    const groups: MockGroup[] = [];

    const groupNames = faker.helpers.arrayElements(groupPatterns.names, numGroups);

    for (let i = 0; i < numGroups; i++) {
      const groupName = groupNames[i];
      const numTasks = faker.number.int(groupPatterns.tasksPerGroup);

      // Group status based on workflow status and position
      const groupStatus = this.deriveGroupStatus(status, i, numGroups);

      const tasks: MockTask[] = [];
      for (let t = 0; t < numTasks; t++) {
        tasks.push(this.generateTask(groupName, t, groupStatus));
      }

      groups.push({
        name: groupName,
        status: groupStatus,
        tasks,
        upstream_groups: i > 0 ? [groupNames[i - 1]] : [],
        downstream_groups: i < numGroups - 1 ? [groupNames[i + 1]] : [],
        failure_message: groupStatus.toString().startsWith("FAILED")
          ? this.generateFailureMessage(groupStatus)
          : undefined,
      });
    }

    return groups;
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

  private generateTask(groupName: string, taskIndex: number, groupStatus: TaskGroupStatus): MockTask {
    const taskPatterns = MOCK_CONFIG.tasks;
    const name = `${groupName}-${taskIndex}`;

    const gpu = faker.helpers.arrayElement(taskPatterns.gpuCounts);
    const cpu = gpu > 0 ? gpu * faker.number.int({ min: 8, max: 16 }) : faker.number.int({ min: 2, max: 8 });
    const memory = cpu * 4; // 4GB per CPU
    const storage = faker.helpers.arrayElement([10, 50, 100, 200]);

    const notStartedStatuses: TaskGroupStatus[] = [
      TaskGroupStatus.WAITING,
      TaskGroupStatus.SUBMITTING,
      TaskGroupStatus.SCHEDULING,
    ];
    const started = !notStartedStatuses.includes(groupStatus);
    const completed = groupStatus === TaskGroupStatus.COMPLETED || groupStatus.toString().startsWith("FAILED");

    return {
      name,
      retry_id: 0,
      status: groupStatus,
      node: started ? this.generateNodeName() : undefined,
      start_time: started ? faker.date.recent({ days: 7 }).toISOString() : undefined,
      end_time: completed ? faker.date.recent({ days: 1 }).toISOString() : undefined,
      exit_code:
        groupStatus === TaskGroupStatus.COMPLETED ? 0 : groupStatus.toString().startsWith("FAILED") ? 1 : undefined,
      failure_message: groupStatus.toString().startsWith("FAILED")
        ? this.generateFailureMessage(groupStatus)
        : undefined,
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
