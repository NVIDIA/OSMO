// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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

  // Timing
  start_time?: string;
  end_time?: string;
  duration?: number;

  // Node info
  node?: string;
  pod_name?: string;
  pod_ip?: string;

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

  // Exit info
  exit_code?: number;
  failure_reason?: string;

  // URLs
  logs_url: string;
  events_url: string;
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

    const notStartedStatuses: TaskGroupStatus[] = [
      TaskGroupStatus.WAITING,
      TaskGroupStatus.SUBMITTING,
      TaskGroupStatus.SCHEDULING,
    ];
    const started = !notStartedStatuses.includes(status);
    const completed = status === TaskGroupStatus.COMPLETED || status.toString().startsWith("FAILED");

    const startTime = started ? faker.date.recent({ days: 7 }) : undefined;
    const duration = completed ? faker.number.int(this.config.patterns.timing.duration) : undefined;
    const endTime = startTime && duration ? new Date(startTime.getTime() + duration * 1000) : undefined;

    const command = faker.helpers.arrayElement(this.config.patterns.commands.examples);

    return {
      name: taskName,
      workflow_name: workflowName,
      group_name: groupName || "main",
      status,
      retry_id: faker.datatype.boolean({ probability: 0.1 }) ? faker.number.int({ min: 1, max: 3 }) : 0,

      start_time: startTime?.toISOString(),
      end_time: endTime?.toISOString(),
      duration,

      node: started ? this.generateNodeName() : undefined,
      pod_name: started ? `${workflowName}-${taskName}-${faker.string.alphanumeric(5)}` : undefined,
      pod_ip: started
        ? `10.${faker.number.int({ min: 0, max: 255 })}.${faker.number.int({ min: 0, max: 255 })}.${faker.number.int({ min: 1, max: 254 })}`
        : undefined,

      gpu,
      cpu,
      memory,
      storage,

      image: `${faker.helpers.arrayElement(MOCK_CONFIG.images.repositories)}:${faker.helpers.arrayElement(MOCK_CONFIG.images.tags)}`,
      command: [command[0]],
      args: command.slice(1),
      env: {
        CUDA_VISIBLE_DEVICES: gpu > 0 ? Array.from({ length: gpu }, (_, i) => i).join(",") : "",
        PYTHONPATH: "/workspace",
        NCCL_DEBUG: "INFO",
      },

      exit_code:
        status === TaskGroupStatus.COMPLETED
          ? 0
          : status.toString().startsWith("FAILED")
            ? faker.helpers.arrayElement([1, 137, 139])
            : undefined,
      failure_reason: status.toString().startsWith("FAILED") ? this.generateFailureReason(status) : undefined,

      logs_url: `/api/workflow/${workflowName}/task/${taskName}/logs`,
      events_url: `/api/workflow/${workflowName}/task/${taskName}/events`,
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
