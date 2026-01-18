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

// Workflow-level status constants for list view.
// Task/group status is in ./[name]/lib/status.tsx (different API types and ReactFlow needs)

import { WorkflowStatus, WorkflowPriority, type WorkflowStatus as WorkflowStatusType } from "@/lib/api/generated";
import {
  WORKFLOW_STATUS_METADATA,
  type StatusCategory as GeneratedStatusCategory,
} from "@/lib/api/status-metadata.generated";

export type StatusCategory = GeneratedStatusCategory | "unknown";

// Derived from WORKFLOW_STATUS_METADATA - stays in sync with backend
export const STATUS_CATEGORY_MAP: Record<WorkflowStatusType, StatusCategory> = Object.fromEntries(
  Object.entries(WORKFLOW_STATUS_METADATA).map(([status, meta]) => [status, meta.category]),
) as Record<WorkflowStatusType, StatusCategory>;

export const STATUS_LABELS: Record<WorkflowStatusType, string> = {
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

export function getStatusDisplay(status: WorkflowStatusType): { category: StatusCategory; label: string } {
  return {
    category: STATUS_CATEGORY_MAP[status] ?? "unknown",
    label: STATUS_LABELS[status] ?? status,
  };
}

export const STATUS_STYLES: Record<
  StatusCategory,
  {
    bg: string;
    text: string;
    icon: string;
    dot: string;
    border: string;
  }
> = {
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
};

export type Priority = (typeof WorkflowPriority)[keyof typeof WorkflowPriority];

const VALID_PRIORITIES: ReadonlySet<string> = new Set(Object.values(WorkflowPriority));

function isPriority(value: string): value is Priority {
  return VALID_PRIORITIES.has(value);
}

export const PRIORITY_STYLES: Record<
  Priority,
  {
    bg: string;
    text: string;
    label: string;
  }
> = {
  [WorkflowPriority.HIGH]: {
    bg: "bg-red-100 dark:bg-red-950/60",
    text: "text-red-700 dark:text-red-400",
    label: "High",
  },
  [WorkflowPriority.NORMAL]: {
    bg: "bg-zinc-100 dark:bg-zinc-800/60",
    text: "text-zinc-600 dark:text-zinc-400",
    label: "Normal",
  },
  [WorkflowPriority.LOW]: {
    bg: "bg-zinc-100 dark:bg-zinc-800/60",
    text: "text-zinc-500 dark:text-zinc-500",
    label: "Low",
  },
};

export function getPriorityDisplay(priority: string): { label: string; bg: string; text: string } {
  const normalized = priority.toUpperCase();
  if (isPriority(normalized)) {
    return PRIORITY_STYLES[normalized];
  }
  return PRIORITY_STYLES[WorkflowPriority.NORMAL];
}

// Static fuzzy search index - all derived from generated enum
export const ALL_WORKFLOW_STATUSES: readonly WorkflowStatusType[] = Object.values(
  WorkflowStatus,
) as WorkflowStatusType[];

const LABEL_TO_STATUS: Readonly<Record<string, WorkflowStatusType>> = {
  pending: WorkflowStatus.PENDING,
  waiting: WorkflowStatus.WAITING,
  running: WorkflowStatus.RUNNING,
  completed: WorkflowStatus.COMPLETED,
  failed: WorkflowStatus.FAILED,
  "failed: submission": WorkflowStatus.FAILED_SUBMISSION,
  "failed: server error": WorkflowStatus.FAILED_SERVER_ERROR,
  "failed: exec timeout": WorkflowStatus.FAILED_EXEC_TIMEOUT,
  "failed: queue timeout": WorkflowStatus.FAILED_QUEUE_TIMEOUT,
  "failed: canceled": WorkflowStatus.FAILED_CANCELED,
  "failed: backend error": WorkflowStatus.FAILED_BACKEND_ERROR,
  "failed: image pull": WorkflowStatus.FAILED_IMAGE_PULL,
  "failed: evicted": WorkflowStatus.FAILED_EVICTED,
  "failed: start error": WorkflowStatus.FAILED_START_ERROR,
  "failed: start timeout": WorkflowStatus.FAILED_START_TIMEOUT,
  "failed: preempted": WorkflowStatus.FAILED_PREEMPTED,
};

const TOKEN_TO_STATUSES: Readonly<Record<string, readonly WorkflowStatusType[]>> = {
  pending: [WorkflowStatus.PENDING],
  waiting: [WorkflowStatus.WAITING],
  running: [WorkflowStatus.RUNNING],
  completed: [WorkflowStatus.COMPLETED],
  failed: [
    WorkflowStatus.FAILED,
    WorkflowStatus.FAILED_SUBMISSION,
    WorkflowStatus.FAILED_SERVER_ERROR,
    WorkflowStatus.FAILED_EXEC_TIMEOUT,
    WorkflowStatus.FAILED_QUEUE_TIMEOUT,
    WorkflowStatus.FAILED_CANCELED,
    WorkflowStatus.FAILED_BACKEND_ERROR,
    WorkflowStatus.FAILED_IMAGE_PULL,
    WorkflowStatus.FAILED_EVICTED,
    WorkflowStatus.FAILED_START_ERROR,
    WorkflowStatus.FAILED_START_TIMEOUT,
    WorkflowStatus.FAILED_PREEMPTED,
  ],
  submission: [WorkflowStatus.FAILED_SUBMISSION],
  server: [WorkflowStatus.FAILED_SERVER_ERROR],
  error: [WorkflowStatus.FAILED_SERVER_ERROR, WorkflowStatus.FAILED_BACKEND_ERROR, WorkflowStatus.FAILED_START_ERROR],
  exec: [WorkflowStatus.FAILED_EXEC_TIMEOUT],
  timeout: [
    WorkflowStatus.FAILED_EXEC_TIMEOUT,
    WorkflowStatus.FAILED_QUEUE_TIMEOUT,
    WorkflowStatus.FAILED_START_TIMEOUT,
  ],
  queue: [WorkflowStatus.FAILED_QUEUE_TIMEOUT],
  canceled: [WorkflowStatus.FAILED_CANCELED],
  backend: [WorkflowStatus.FAILED_BACKEND_ERROR],
  image: [WorkflowStatus.FAILED_IMAGE_PULL],
  pull: [WorkflowStatus.FAILED_IMAGE_PULL],
  evicted: [WorkflowStatus.FAILED_EVICTED],
  start: [WorkflowStatus.FAILED_START_ERROR, WorkflowStatus.FAILED_START_TIMEOUT],
  preempted: [WorkflowStatus.FAILED_PREEMPTED],
};

const STATUS_TOKENS: Readonly<Record<WorkflowStatusType, readonly string[]>> = {
  [WorkflowStatus.PENDING]: ["pending"],
  [WorkflowStatus.WAITING]: ["waiting"],
  [WorkflowStatus.RUNNING]: ["running"],
  [WorkflowStatus.COMPLETED]: ["completed"],
  [WorkflowStatus.FAILED]: ["failed"],
  [WorkflowStatus.FAILED_SUBMISSION]: ["failed", "submission"],
  [WorkflowStatus.FAILED_SERVER_ERROR]: ["failed", "server", "error"],
  [WorkflowStatus.FAILED_EXEC_TIMEOUT]: ["failed", "exec", "timeout"],
  [WorkflowStatus.FAILED_QUEUE_TIMEOUT]: ["failed", "queue", "timeout"],
  [WorkflowStatus.FAILED_CANCELED]: ["failed", "canceled"],
  [WorkflowStatus.FAILED_BACKEND_ERROR]: ["failed", "backend", "error"],
  [WorkflowStatus.FAILED_IMAGE_PULL]: ["failed", "image", "pull"],
  [WorkflowStatus.FAILED_EVICTED]: ["failed", "evicted"],
  [WorkflowStatus.FAILED_START_ERROR]: ["failed", "start", "error"],
  [WorkflowStatus.FAILED_START_TIMEOUT]: ["failed", "start", "timeout"],
  [WorkflowStatus.FAILED_PREEMPTED]: ["failed", "preempted"],
};

const VALID_STATUSES: ReadonlySet<string> = new Set(ALL_WORKFLOW_STATUSES);

function tokenize(str: string): string[] {
  return str
    .toLowerCase()
    .split(/[_:\s]+/)
    .filter((t) => t.length > 0);
}

export interface StatusMatchResult {
  status: WorkflowStatusType | null;
  confidence: number;
  candidates: WorkflowStatusType[];
}

export function matchStatus(input: string): StatusMatchResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { status: null, confidence: 0, candidates: [] };
  }

  const exactUpper = trimmed.toUpperCase();
  if (VALID_STATUSES.has(exactUpper)) {
    const status = exactUpper as WorkflowStatusType;
    return { status, confidence: 1.0, candidates: [status] };
  }

  const labelMatch = LABEL_TO_STATUS[trimmed.toLowerCase()];
  if (labelMatch) {
    return { status: labelMatch, confidence: 1.0, candidates: [labelMatch] };
  }

  const inputTokens = tokenize(trimmed);
  if (inputTokens.length === 0) {
    return { status: null, confidence: 0, candidates: [] };
  }

  let candidates: WorkflowStatusType[] | null = null;

  for (const token of inputTokens) {
    const matching = TOKEN_TO_STATUSES[token];
    if (!matching || matching.length === 0) {
      return { status: null, confidence: 0, candidates: [] };
    }

    if (candidates === null) {
      candidates = [...matching];
    } else {
      candidates = candidates.filter((s) => matching.includes(s));
    }

    if (candidates.length === 0) {
      return { status: null, confidence: 0, candidates: [] };
    }
  }

  const candidateArray = candidates ?? [];

  if (candidateArray.length === 1) {
    const statusTokens = STATUS_TOKENS[candidateArray[0]];
    const coverage = inputTokens.length / statusTokens.length;
    const confidence = coverage >= 1 ? 1.0 : coverage;
    return {
      status: confidence >= 1 ? candidateArray[0] : null,
      confidence,
      candidates: candidateArray,
    };
  }

  let bestStatus: WorkflowStatusType | null = null;
  let bestConfidence = 0;

  for (const status of candidateArray) {
    const statusTokens = STATUS_TOKENS[status];
    const coverage = inputTokens.length / statusTokens.length;
    if (coverage > bestConfidence) {
      bestConfidence = coverage;
      bestStatus = coverage >= 1 ? status : null;
    }
  }

  return {
    status: bestStatus,
    confidence: bestConfidence,
    candidates: candidateArray,
  };
}

export function getStatusSuggestions(input: string, limit = 10): WorkflowStatusType[] {
  const result = matchStatus(input);

  const inputTokens = tokenize(input);
  return result.candidates
    .map((status) => {
      const statusTokens = STATUS_TOKENS[status];
      const matchedTokens = inputTokens.filter((t) => statusTokens.includes(t)).length;
      return { status, score: matchedTokens / statusTokens.length };
    })
    .sort((a, b) => b.score - a.score || a.status.localeCompare(b.status))
    .slice(0, limit)
    .map((s) => s.status);
}

export function shouldTabComplete(input: string): WorkflowStatusType | null {
  const result = matchStatus(input);

  if (result.candidates.length === 1 && result.confidence > 0) {
    return result.candidates[0];
  }

  return null;
}
