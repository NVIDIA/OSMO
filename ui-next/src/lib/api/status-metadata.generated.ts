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
 * Status Metadata - AUTO-GENERATED
 *
 * DO NOT EDIT MANUALLY - This file is generated from Python enum definitions.
 * Run "pnpm generate-api" to regenerate.
 *
 * Source: external/src/utils/job/task.py (TaskGroupStatus)
 *         external/src/utils/job/workflow.py (WorkflowStatus)
 */

import { TaskGroupStatus, WorkflowStatus } from "@/lib/api/generated";

export type StatusCategory = "waiting" | "pending" | "running" | "completed" | "failed";

export interface TaskStatusMetadata {
  category: StatusCategory;
  isTerminal: boolean;
  isOngoing: boolean;
  isFailed: boolean;
  isInQueue: boolean;
}

export interface WorkflowStatusMetadata {
  category: StatusCategory;
  isTerminal: boolean;
  isOngoing: boolean;
  isFailed: boolean;
}

export const TASK_STATUS_METADATA: Record<TaskGroupStatus, TaskStatusMetadata> = {
  SUBMITTING: {
    category: "waiting",
    isTerminal: false,
    isOngoing: false,
    isFailed: false,
    isInQueue: true,
  },
  WAITING: {
    category: "waiting",
    isTerminal: false,
    isOngoing: false,
    isFailed: false,
    isInQueue: true,
  },
  PROCESSING: {
    category: "pending",
    isTerminal: false,
    isOngoing: false,
    isFailed: false,
    isInQueue: true,
  },
  SCHEDULING: {
    category: "pending",
    isTerminal: false,
    isOngoing: false,
    isFailed: false,
    isInQueue: true,
  },
  INITIALIZING: {
    category: "pending",
    isTerminal: false,
    isOngoing: true,
    isFailed: false,
    isInQueue: false,
  },
  RUNNING: {
    category: "running",
    isTerminal: false,
    isOngoing: true,
    isFailed: false,
    isInQueue: false,
  },
  COMPLETED: {
    category: "completed",
    isTerminal: true,
    isOngoing: false,
    isFailed: false,
    isInQueue: false,
  },
  RESCHEDULED: {
    category: "completed",
    isTerminal: true,
    isOngoing: false,
    isFailed: false,
    isInQueue: false,
  },
  FAILED: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
  FAILED_CANCELED: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
  FAILED_SERVER_ERROR: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
  FAILED_BACKEND_ERROR: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
  FAILED_EXEC_TIMEOUT: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
  FAILED_QUEUE_TIMEOUT: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
  FAILED_IMAGE_PULL: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
  FAILED_UPSTREAM: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
  FAILED_EVICTED: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
  FAILED_START_ERROR: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
  FAILED_START_TIMEOUT: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
  FAILED_PREEMPTED: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
    isInQueue: false,
  },
} as const;

export const WORKFLOW_STATUS_METADATA: Record<WorkflowStatus, WorkflowStatusMetadata> = {
  PENDING: {
    category: "waiting",
    isTerminal: false,
    isOngoing: false,
    isFailed: false,
  },
  RUNNING: {
    category: "running",
    isTerminal: false,
    isOngoing: true,
    isFailed: false,
  },
  WAITING: {
    category: "waiting",
    isTerminal: false,
    isOngoing: true,
    isFailed: false,
  },
  COMPLETED: {
    category: "completed",
    isTerminal: true,
    isOngoing: false,
    isFailed: false,
  },
  FAILED: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
  FAILED_SUBMISSION: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
  FAILED_SERVER_ERROR: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
  FAILED_EXEC_TIMEOUT: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
  FAILED_QUEUE_TIMEOUT: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
  FAILED_CANCELED: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
  FAILED_BACKEND_ERROR: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
  FAILED_IMAGE_PULL: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
  FAILED_EVICTED: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
  FAILED_START_ERROR: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
  FAILED_START_TIMEOUT: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
  FAILED_PREEMPTED: {
    category: "failed",
    isTerminal: true,
    isOngoing: false,
    isFailed: true,
  },
} as const;

export function getTaskStatusCategory(status: TaskGroupStatus): StatusCategory {
  return TASK_STATUS_METADATA[status]?.category ?? "failed";
}

export function getWorkflowStatusCategory(status: WorkflowStatus): StatusCategory {
  return WORKFLOW_STATUS_METADATA[status]?.category ?? "failed";
}

export function isTaskTerminal(status: TaskGroupStatus): boolean {
  return TASK_STATUS_METADATA[status]?.isTerminal ?? true;
}

export function isTaskOngoing(status: TaskGroupStatus): boolean {
  return TASK_STATUS_METADATA[status]?.isOngoing ?? false;
}

export function isTaskFailed(status: TaskGroupStatus): boolean {
  return TASK_STATUS_METADATA[status]?.isFailed ?? false;
}

export function isTaskInQueue(status: TaskGroupStatus): boolean {
  return TASK_STATUS_METADATA[status]?.isInQueue ?? false;
}

export function isWorkflowTerminal(status: WorkflowStatus): boolean {
  return WORKFLOW_STATUS_METADATA[status]?.isTerminal ?? true;
}

export function isWorkflowOngoing(status: WorkflowStatus): boolean {
  return WORKFLOW_STATUS_METADATA[status]?.isOngoing ?? false;
}

export function isWorkflowFailed(status: WorkflowStatus): boolean {
  return WORKFLOW_STATUS_METADATA[status]?.isFailed ?? false;
}
