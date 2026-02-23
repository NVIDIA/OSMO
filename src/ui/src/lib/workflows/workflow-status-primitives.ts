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

import { WorkflowStatus, type WorkflowStatus as WorkflowStatusType } from "@/lib/api/generated";

export const WORKFLOW_STATUS_LABELS: Record<WorkflowStatusType, string> = {
  [WorkflowStatus.PENDING]: "Pending",
  [WorkflowStatus.WAITING]: "Waiting",
  [WorkflowStatus.RUNNING]: "Running",
  [WorkflowStatus.COMPLETED]: "Completed",
  [WorkflowStatus.FAILED]: "Failed",
  [WorkflowStatus.FAILED_SUBMISSION]: "Failed: Submission",
  [WorkflowStatus.FAILED_SERVER_ERROR]: "Failed: Server Error",
  [WorkflowStatus.FAILED_EXEC_TIMEOUT]: "Failed: Exec Timeout",
  [WorkflowStatus.FAILED_QUEUE_TIMEOUT]: "Failed: Queue Timeout",
  [WorkflowStatus.FAILED_CANCELED]: "Failed: Canceled",
  [WorkflowStatus.FAILED_BACKEND_ERROR]: "Failed: Backend Error",
  [WorkflowStatus.FAILED_IMAGE_PULL]: "Failed: Image Pull",
  [WorkflowStatus.FAILED_EVICTED]: "Failed: Evicted",
  [WorkflowStatus.FAILED_START_ERROR]: "Failed: Start Error",
  [WorkflowStatus.FAILED_START_TIMEOUT]: "Failed: Start Timeout",
  [WorkflowStatus.FAILED_PREEMPTED]: "Failed: Preempted",
};

export const WORKFLOW_STATUS_UI_STYLES = {
  waiting: {
    bg: "bg-gray-100 dark:bg-zinc-800/60",
    text: "text-gray-600 dark:text-zinc-400",
    icon: "text-gray-500 dark:text-zinc-500",
    dot: "bg-gray-400 dark:bg-zinc-500",
    border: "border-gray-300 dark:border-zinc-600",
  },
  pending: {
    bg: "bg-amber-50 dark:bg-amber-950/60",
    text: "text-amber-700 dark:text-amber-400",
    icon: "text-amber-500 dark:text-amber-400",
    dot: "bg-amber-500",
    border: "border-amber-400 dark:border-amber-500",
  },
  running: {
    bg: "bg-blue-50 dark:bg-blue-950/60",
    text: "text-blue-700 dark:text-blue-400",
    icon: "text-blue-500 dark:text-blue-400",
    dot: "bg-blue-500",
    border: "border-blue-400 dark:border-blue-500",
  },
  completed: {
    bg: "bg-emerald-50 dark:bg-emerald-950/60",
    text: "text-emerald-700 dark:text-emerald-400",
    icon: "text-emerald-500 dark:text-emerald-400",
    dot: "bg-emerald-500",
    border: "border-emerald-400 dark:border-emerald-600",
  },
  failed: {
    bg: "bg-red-50 dark:bg-red-950/60",
    text: "text-red-700 dark:text-red-400",
    icon: "text-red-500 dark:text-red-400",
    dot: "bg-red-500",
    border: "border-red-400 dark:border-red-500",
  },
  unknown: {
    bg: "bg-amber-50 dark:bg-amber-950/60",
    text: "text-amber-700 dark:text-amber-400",
    icon: "text-amber-500 dark:text-amber-400",
    dot: "bg-amber-500",
    border: "border-amber-400 dark:border-amber-500",
  },
} as const;
