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
 * Task Generator
 *
 * Generates task data using status enums from the OpenAPI spec.
 * Uses deterministic seeding for consistent generation.
 */

import { faker } from "@faker-js/faker";

// Import status enum from generated API spec
import { TaskGroupStatus } from "@/lib/api/generated";

import { MOCK_CONFIG, type TaskPatterns } from "../seed";

// Re-export for convenience
export { TaskGroupStatus };

// ============================================================================
// Mock Types (spec-compatible but extended for UI needs)
// ============================================================================

export interface MockTaskDetail {
  name: string;
  workflow_name: string;
  group_name: string;
  status: TaskGroupStatus;
  retry_id: number;
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
  duration?: number;

  // Status
  exit_code?: number;
  failure_message?: string;

  // URLs
  logs: string;
  error_logs?: string;
  events: string;
  dashboard_url?: string;
  grafana_url?: string;

  // Resources
  gpu: number;
  cpu: number;
  memory: number;
  storage: number;

  // Container
  image: string;
  command: string[];
  args: string[];
  env: Record<string, string>;
}

// ============================================================================
// Generator Configuration
// ============================================================================

interface GeneratorConfig {
  baseSeed: number;
  patterns: TaskPatterns;
}

const DEFAULT_CONFIG: GeneratorConfig = {
  baseSeed: 33333,
  patterns: MOCK_CONFIG.tasks,
};

// ============================================================================
// Generator Class
// ============================================================================

export class TaskGenerator {
  private config: GeneratorConfig;

  constructor(config: Partial<GeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate a task.
   * DETERMINISTIC: Same workflow+task name always produces the same task.
   */
  generate(workflowName: string, taskName: string, groupName?: string): MockTaskDetail {
    faker.seed(this.config.baseSeed + this.hashString(workflowName + taskName));

    const status = this.pickStatus();
    const gpu = faker.helpers.arrayElement(this.config.patterns.gpuCounts);
    const cpu = gpu > 0 ? gpu * faker.number.int({ min: 8, max: 16 }) : faker.number.int({ min: 2, max: 8 });
    const memory = cpu * 4; // 4GB per CPU
    const storage = faker.helpers.arrayElement([10, 50, 100, 200]);

    // Determine lifecycle phase
    const notStartedStatuses: TaskGroupStatus[] = [
      TaskGroupStatus.WAITING,
      TaskGroupStatus.SUBMITTING,
      TaskGroupStatus.SCHEDULING,
    ];
    const isScheduling = status === TaskGroupStatus.SCHEDULING;
    const isInitializing = status === TaskGroupStatus.INITIALIZING;
    const started = !notStartedStatuses.includes(status);
    const isRunning = status === TaskGroupStatus.RUNNING;
    const completed = status === TaskGroupStatus.COMPLETED || status.toString().startsWith("FAILED");
    const isFailed = status.toString().startsWith("FAILED");

    // Generate task UUID
    const taskUuid = faker.string.uuid();

    // Generate pod name
    const podSuffix = faker.string.alphanumeric({ length: 5, casing: "lower" });
    const podName = `${workflowName.slice(0, 20)}-${taskName}-${podSuffix}`;

    // Generate timeline timestamps based on status
    const baseTime = started ? faker.date.recent({ days: 7 }) : new Date();

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

    // Duration for completed tasks
    const duration = completed ? faker.number.int(this.config.patterns.timing.duration) : undefined;

    // Output upload start - only for completed tasks
    const outputUploadStartTime = completed ? new Date(baseTime.getTime() + 3600000).toISOString() : undefined;

    // End time - only for completed tasks
    const endTime = completed ? new Date(baseTime.getTime() + 3660000).toISOString() : undefined;

    const command = faker.helpers.arrayElement(this.config.patterns.commands.examples);

    return {
      name: taskName,
      workflow_name: workflowName,
      group_name: groupName || "main",
      status,
      retry_id: faker.datatype.boolean({ probability: 0.1 }) ? faker.number.int({ min: 1, max: 3 }) : 0,
      lead: faker.datatype.boolean({ probability: 0.3 }), // 30% chance of being lead

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
      duration,

      // Status
      exit_code:
        status === TaskGroupStatus.COMPLETED ? 0 : isFailed ? faker.helpers.arrayElement([1, 137, 139]) : undefined,
      failure_message: isFailed ? this.generateFailureReason(status) : undefined,

      // URLs
      logs: `/api/workflow/${workflowName}/task/${taskName}/logs`,
      error_logs: isFailed ? `/api/workflow/${workflowName}/task/${taskName}/error-logs` : undefined,
      events: `/api/workflow/${workflowName}/task/${taskName}/events`,
      dashboard_url: started ? `https://kubernetes.example.com/pod/${podName}` : undefined,
      grafana_url: started ? `https://grafana.example.com/d/task/${taskUuid}` : undefined,

      // Resources
      gpu,
      cpu,
      memory,
      storage,

      // Container
      image: `${faker.helpers.arrayElement(MOCK_CONFIG.images.repositories)}:${faker.helpers.arrayElement(MOCK_CONFIG.images.tags)}`,
      command: [command[0]],
      args: command.slice(1),
      env: {
        CUDA_VISIBLE_DEVICES: gpu > 0 ? Array.from({ length: gpu }, (_, i) => i).join(",") : "",
        PYTHONPATH: "/workspace",
        NCCL_DEBUG: "INFO",
      },
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private pickStatus(): TaskGroupStatus {
    const distribution = this.config.patterns.statusDistribution;
    const rand = faker.number.float({ min: 0, max: 1 });
    let cumulative = 0;

    for (const [status, prob] of Object.entries(distribution)) {
      cumulative += prob;
      if (rand <= cumulative) {
        return status as TaskGroupStatus;
      }
    }

    return TaskGroupStatus.COMPLETED;
  }

  private generateNodeName(): string {
    const prefix = faker.helpers.arrayElement(["dgx", "gpu", "node"]);
    const gpuType = faker.helpers.arrayElement(["a100", "h100", "l40s"]);
    const num = faker.number.int({ min: 1, max: 999 });
    return `${prefix}-${gpuType}-${num.toString().padStart(3, "0")}`;
  }

  private generateFailureReason(status: TaskGroupStatus): string {
    const reasons: Record<string, string[]> = {
      [TaskGroupStatus.FAILED]: ["Process exited with non-zero code", "Segmentation fault", "Python exception"],
      [TaskGroupStatus.FAILED_IMAGE_PULL]: ["Image not found", "Unauthorized access to registry", "Network timeout"],
      [TaskGroupStatus.FAILED_EXEC_TIMEOUT]: ["Task exceeded maximum runtime", "Deadline exceeded"],
      [TaskGroupStatus.FAILED_EVICTED]: ["Node under memory pressure", "Disk pressure eviction"],
      [TaskGroupStatus.FAILED_PREEMPTED]: ["Preempted by higher priority workload"],
    };
    return faker.helpers.arrayElement(reasons[status] || reasons[TaskGroupStatus.FAILED]);
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
// Singleton instance
// ============================================================================

export const taskGenerator = new TaskGenerator();
