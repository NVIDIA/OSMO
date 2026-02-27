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
    bazel run //src/service:export_status_metadata \
        > src/ui/src/lib/api/status-metadata.generated.ts

Usage (via pnpm from src/ui):
    pnpm generate-api (runs this as part of the generation pipeline)
"""

import argparse
import json
import sys
from typing import Literal
from typing_extensions import assert_never

from src.utils.job.task import TaskGroupStatus
from src.utils.job.workflow import WorkflowStatus

StatusCategory = Literal[
    'waiting',
    'pending',
    'running',
    'completed',
    'failed',
    'unknown',  # Sentinel value for unknown statuses
]


def get_task_status_category(status: TaskGroupStatus) -> StatusCategory:
    """Derive category from Python enum methods.

    Exhaustive match — mypy will error if a new TaskGroupStatus member is added
    without updating this function.
    """
    match status:
        case (
            TaskGroupStatus.FAILED
            | TaskGroupStatus.FAILED_CANCELED
            | TaskGroupStatus.FAILED_SERVER_ERROR
            | TaskGroupStatus.FAILED_BACKEND_ERROR
            | TaskGroupStatus.FAILED_EXEC_TIMEOUT
            | TaskGroupStatus.FAILED_QUEUE_TIMEOUT
            | TaskGroupStatus.FAILED_IMAGE_PULL
            | TaskGroupStatus.FAILED_UPSTREAM
            | TaskGroupStatus.FAILED_EVICTED
            | TaskGroupStatus.FAILED_START_ERROR
            | TaskGroupStatus.FAILED_START_TIMEOUT
            | TaskGroupStatus.FAILED_PREEMPTED
        ):
            return 'failed'
        case TaskGroupStatus.COMPLETED | TaskGroupStatus.RESCHEDULED:
            return 'completed'
        case TaskGroupStatus.RUNNING | TaskGroupStatus.INITIALIZING:
            return 'running'
        case (
            TaskGroupStatus.SUBMITTING
            | TaskGroupStatus.PROCESSING
            | TaskGroupStatus.SCHEDULING
        ):
            return 'pending'
        case TaskGroupStatus.WAITING:
            return 'waiting'
        case _ as unreachable:
            assert_never(unreachable)


def get_workflow_status_category(status: WorkflowStatus) -> StatusCategory:
    """Derive category from Python enum methods.

    Exhaustive match — mypy will error if a new WorkflowStatus member is added
    without updating this function.
    """
    match status:
        case (
            WorkflowStatus.FAILED
            | WorkflowStatus.FAILED_SUBMISSION
            | WorkflowStatus.FAILED_SERVER_ERROR
            | WorkflowStatus.FAILED_EXEC_TIMEOUT
            | WorkflowStatus.FAILED_QUEUE_TIMEOUT
            | WorkflowStatus.FAILED_CANCELED
            | WorkflowStatus.FAILED_BACKEND_ERROR
            | WorkflowStatus.FAILED_IMAGE_PULL
            | WorkflowStatus.FAILED_EVICTED
            | WorkflowStatus.FAILED_START_ERROR
            | WorkflowStatus.FAILED_START_TIMEOUT
            | WorkflowStatus.FAILED_PREEMPTED
        ):
            return 'failed'
        case WorkflowStatus.COMPLETED:
            return 'completed'
        case WorkflowStatus.RUNNING:
            return 'running'
        case WorkflowStatus.PENDING:
            return 'pending'
        case WorkflowStatus.WAITING:
            return 'waiting'
        case _ as unreachable:
            assert_never(unreachable)


def generate_typescript() -> str:
    """Generate TypeScript code from Python enum metadata."""
    # Build TaskGroupStatus metadata
    task_metadata = {}
    for status in TaskGroupStatus:
        category = get_task_status_category(status)
        task_metadata[status.value] = {
            'category': category,
            'isTerminal': status.finished(),
            'isOngoing': (
                status in (TaskGroupStatus.RUNNING, TaskGroupStatus.INITIALIZING)
            ),
            'isFailed': status.failed(),
            'isInQueue': status.in_queue(),
        }

    # Build WorkflowStatus metadata
    workflow_metadata = {}
    for workflow_status in WorkflowStatus:
        category = get_workflow_status_category(workflow_status)
        workflow_metadata[workflow_status.value] = {
            'category': category,
            'isTerminal': workflow_status.finished(),
            'isOngoing': workflow_status.alive() and workflow_status != WorkflowStatus.PENDING,
            'isFailed': workflow_status.failed(),
        }

    # Format JSON with proper indentation for TypeScript
    task_json = json.dumps(task_metadata, indent=2)
    workflow_json = json.dumps(workflow_metadata, indent=2)

    # pylint: disable=line-too-long
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

import {{ TaskGroupStatus, WorkflowStatus }} from "@/lib/api/generated";

// =============================================================================
// Types
// =============================================================================

export type StatusCategory = "waiting" | "pending" | "running" | "completed" | "failed" | "unknown";

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
    parser = argparse.ArgumentParser(
        description='Export status metadata from Python enums to TypeScript')
    parser.add_argument(
        '--output', '-o',
        type=str,
        default=None,
        help='Output file path (default: stdout)'
    )
    args = parser.parse_args()

    ts_output = generate_typescript()

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(ts_output)
        print(f'Status metadata written to {args.output}', file=sys.stderr)
    else:
        print(ts_output)


if __name__ == '__main__':
    main()
