#!/usr/bin/env python3
"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0

Export status metadata from Python enums to TypeScript.

This script generates a TypeScript file with status category information
derived from the Python enum methods. This ensures the UI has the same
semantics as the backend without duplication.

Usage (via Bazel):
    bazel run //src/service:export_status_metadata > ui-next/src/lib/api/status-metadata.generated.ts

Usage (via pnpm from ui-next):
    pnpm generate-api (runs this as part of the generation pipeline)
"""
import argparse
import json
import sys
from typing import Literal

from src.utils.job.task import TaskGroupStatus
from src.utils.job.workflow import WorkflowStatus


def get_task_status_category(status: TaskGroupStatus) -> Literal["waiting", "running", "completed", "failed"]:
    """Derive category from Python enum methods."""
    if status.failed():
        return "failed"
    if status == TaskGroupStatus.COMPLETED or status == TaskGroupStatus.RESCHEDULED:
        return "completed"
    if status == TaskGroupStatus.RUNNING or status == TaskGroupStatus.INITIALIZING:
        return "running"
    return "waiting"


def get_workflow_status_category(status: WorkflowStatus) -> Literal["waiting", "running", "completed", "failed"]:
    """Derive category from Python enum methods."""
    if status.failed():
        return "failed"
    if status == WorkflowStatus.COMPLETED:
        return "completed"
    if status == WorkflowStatus.RUNNING:
        return "running"
    return "waiting"


def generate_typescript() -> str:
    """Generate TypeScript code from Python enum metadata."""
    # Build TaskGroupStatus metadata
    task_metadata = {}
    for status in TaskGroupStatus:
        category = get_task_status_category(status)
        task_metadata[status.value] = {
            "category": category,
            "isTerminal": status.finished(),
            "isOngoing": status == TaskGroupStatus.RUNNING or status == TaskGroupStatus.INITIALIZING,
            "isFailed": status.failed(),
            "isInQueue": status.in_queue(),
        }

    # Build WorkflowStatus metadata
    workflow_metadata = {}
    for status in WorkflowStatus:
        category = get_workflow_status_category(status)
        workflow_metadata[status.value] = {
            "category": category,
            "isTerminal": status.finished(),
            "isOngoing": status.alive() and status != WorkflowStatus.PENDING,
            "isFailed": status.failed(),
        }

    # Format JSON with proper indentation for TypeScript
    task_json = json.dumps(task_metadata, indent=2)
    workflow_json = json.dumps(workflow_metadata, indent=2)

    return f'''// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
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

import {{ TaskGroupStatus, WorkflowStatus }} from "./generated";

// =============================================================================
// Types
// =============================================================================

export type StatusCategory = "waiting" | "running" | "completed" | "failed";

export interface TaskStatusMetadata {{
  category: StatusCategory;
  isTerminal: boolean;
  isOngoing: boolean;
  isFailed: boolean;
  isInQueue: boolean;
}}

export interface WorkflowStatusMetadata {{
  category: StatusCategory;
  isTerminal: boolean;
  isOngoing: boolean;
  isFailed: boolean;
}}

// =============================================================================
// Generated Metadata
// =============================================================================

export const TASK_STATUS_METADATA: Record<TaskGroupStatus, TaskStatusMetadata> = {task_json} as const;

export const WORKFLOW_STATUS_METADATA: Record<WorkflowStatus, WorkflowStatusMetadata> = {workflow_json} as const;

// =============================================================================
// Helper Functions (O(1) lookups)
// =============================================================================

/** Get the category for a task/group status */
export function getTaskStatusCategory(status: TaskGroupStatus): StatusCategory {{
  return TASK_STATUS_METADATA[status]?.category ?? "failed";
}}

/** Get the category for a workflow status */
export function getWorkflowStatusCategory(status: WorkflowStatus): StatusCategory {{
  return WORKFLOW_STATUS_METADATA[status]?.category ?? "failed";
}}

/** Check if a task/group status is terminal (finished) */
export function isTaskTerminal(status: TaskGroupStatus): boolean {{
  return TASK_STATUS_METADATA[status]?.isTerminal ?? true;
}}

/** Check if a task/group status means duration is ongoing (start_time → now) */
export function isTaskOngoing(status: TaskGroupStatus): boolean {{
  return TASK_STATUS_METADATA[status]?.isOngoing ?? false;
}}

/** Check if a task/group status is a failure */
export function isTaskFailed(status: TaskGroupStatus): boolean {{
  return TASK_STATUS_METADATA[status]?.isFailed ?? false;
}}

/** Check if a task/group status is in queue (not yet running) */
export function isTaskInQueue(status: TaskGroupStatus): boolean {{
  return TASK_STATUS_METADATA[status]?.isInQueue ?? false;
}}

/** Check if a workflow status is terminal (finished) */
export function isWorkflowTerminal(status: WorkflowStatus): boolean {{
  return WORKFLOW_STATUS_METADATA[status]?.isTerminal ?? true;
}}

/** Check if a workflow status means duration is ongoing */
export function isWorkflowOngoing(status: WorkflowStatus): boolean {{
  return WORKFLOW_STATUS_METADATA[status]?.isOngoing ?? false;
}}

/** Check if a workflow status is a failure */
export function isWorkflowFailed(status: WorkflowStatus): boolean {{
  return WORKFLOW_STATUS_METADATA[status]?.isFailed ?? false;
}}
'''


def main():
    parser = argparse.ArgumentParser(description='Export status metadata from Python enums to TypeScript')
    parser.add_argument(
        '--output', '-o',
        type=str,
        default=None,
        help='Output file path (default: stdout)'
    )
    args = parser.parse_args()

    ts_output = generate_typescript()

    if args.output:
        with open(args.output, 'w') as f:
            f.write(ts_output)
        print(f"Status metadata written to {args.output}", file=sys.stderr)
    else:
        print(ts_output)


if __name__ == '__main__':
    main()
