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

// NOTE: Only submit_time is sortable (backend limitation)

import type { ColumnDef } from "@tanstack/react-table";
import { remToPx } from "@/components/data-table/utils/column-sizing";
import { cn } from "@/lib/utils";
import { formatDateTimeFull, formatDateTimeSuccinct } from "@/lib/format-date";
import type { WorkflowListEntry } from "@/lib/api/adapter/types";
import {
  WORKFLOW_COLUMN_SIZE_CONFIG,
  COLUMN_LABELS,
  type WorkflowColumnId,
} from "@/features/workflows/list/lib/workflow-columns";
import { getStatusDisplay, STATUS_STYLES } from "@/lib/workflows/workflow-constants";
import { PRIORITY_DISPLAY } from "@/lib/workflows/priority-display";
import { WORKFLOW_STATUS_ICONS } from "@/lib/workflows/workflow-status-icons";
import { formatDuration } from "@/lib/format-date";
import { WorkflowStatus, WorkflowPriority } from "@/lib/api/generated";

function getMinSize(id: WorkflowColumnId): number {
  const col = WORKFLOW_COLUMN_SIZE_CONFIG.find((c) => c.id === id);
  return col ? remToPx(col.minWidthRem) : 80;
}

export function createWorkflowColumns(): ColumnDef<WorkflowListEntry, unknown>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: COLUMN_LABELS.name,
      minSize: getMinSize("name"),
      enableSorting: false, // Backend only sorts by submit_time
      cell: ({ row }) => (
        <span className="truncate font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {row.original.name}
        </span>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: COLUMN_LABELS.status,
      minSize: getMinSize("status"),
      enableSorting: false, // Backend only sorts by submit_time
      cell: ({ row }) => {
        const { category, label } = getStatusDisplay(row.original.status);
        const styles = STATUS_STYLES[category];
        const Icon = WORKFLOW_STATUS_ICONS[category];

        return (
          <span className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5", styles.bg)}>
            <Icon className={cn("size-3.5", styles.icon, category === "running" && "animate-spin")} />
            <span className={cn("text-xs font-semibold", styles.text)}>{label}</span>
          </span>
        );
      },
    },
    {
      id: "user",
      accessorKey: "user",
      header: COLUMN_LABELS.user,
      minSize: getMinSize("user"),
      enableSorting: false, // Backend only sorts by submit_time
      cell: ({ row }) => <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">{row.original.user}</span>,
    },
    {
      id: "submit_time",
      accessorKey: "submit_time",
      header: COLUMN_LABELS.submit_time,
      minSize: getMinSize("submit_time"),
      enableSorting: true, // Only sortable column (server-side)
      cell: ({ row }) => {
        const submitTime = row.original.submit_time;
        if (!submitTime) return <span className="text-sm text-zinc-400">—</span>;
        return (
          <span
            className="truncate text-sm text-zinc-500 dark:text-zinc-400"
            title={formatDateTimeFull(submitTime)}
          >
            {formatDateTimeSuccinct(submitTime)}
          </span>
        );
      },
    },
    {
      id: "start_time",
      accessorKey: "start_time",
      header: COLUMN_LABELS.start_time,
      minSize: getMinSize("start_time"),
      enableSorting: false, // Backend only sorts by submit_time
      cell: ({ row }) => {
        const startTime = row.original.start_time;
        if (!startTime) return <span className="text-sm text-zinc-400">—</span>;
        return (
          <span
            className="truncate text-sm text-zinc-500 dark:text-zinc-400"
            title={formatDateTimeFull(startTime)}
          >
            {formatDateTimeSuccinct(startTime)}
          </span>
        );
      },
    },
    {
      id: "end_time",
      accessorKey: "end_time",
      header: COLUMN_LABELS.end_time,
      minSize: getMinSize("end_time"),
      enableSorting: false, // Backend only sorts by submit_time
      cell: ({ row }) => {
        const endTime = row.original.end_time;
        if (!endTime) return <span className="text-sm text-zinc-400">—</span>;
        return (
          <span
            className="truncate text-sm text-zinc-500 dark:text-zinc-400"
            title={formatDateTimeFull(endTime)}
          >
            {formatDateTimeSuccinct(endTime)}
          </span>
        );
      },
    },
    {
      id: "duration",
      accessorKey: "duration",
      header: COLUMN_LABELS.duration,
      minSize: getMinSize("duration"),
      enableSorting: false, // Backend only sorts by submit_time
      cell: ({ row }) => {
        const duration = row.original.duration ?? null;
        const isRunning = row.original.status === WorkflowStatus.RUNNING;

        return (
          <span
            className={cn(
              "truncate font-mono text-sm tabular-nums",
              isRunning ? "text-blue-600 dark:text-blue-400" : "text-zinc-500 dark:text-zinc-400",
            )}
          >
            {formatDuration(duration)}
          </span>
        );
      },
    },
    {
      id: "queued_time",
      accessorKey: "queued_time",
      header: COLUMN_LABELS.queued_time,
      minSize: getMinSize("queued_time"),
      enableSorting: false, // Backend only sorts by submit_time
      cell: ({ row }) => (
        <span className="truncate font-mono text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
          {formatDuration(row.original.queued_time ?? null)}
        </span>
      ),
    },
    {
      id: "pool",
      accessorKey: "pool",
      header: COLUMN_LABELS.pool,
      minSize: getMinSize("pool"),
      enableSorting: false, // Backend only sorts by submit_time
      cell: ({ row }) => (
        <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">{row.original.pool || "—"}</span>
      ),
    },
    {
      id: "priority",
      accessorKey: "priority",
      header: COLUMN_LABELS.priority,
      minSize: getMinSize("priority"),
      enableSorting: false, // Backend only sorts by submit_time
      cell: ({ row }) => {
        const { bg, text, label, Icon, iconClass } =
          PRIORITY_DISPLAY[row.original.priority.toUpperCase() as keyof typeof PRIORITY_DISPLAY] ??
          PRIORITY_DISPLAY[WorkflowPriority.NORMAL];

        return (
          <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium", bg, text)}>
            <Icon className={iconClass} />
            {label}
          </span>
        );
      },
    },
    {
      id: "app_name",
      accessorKey: "app_name",
      header: COLUMN_LABELS.app_name,
      minSize: getMinSize("app_name"),
      enableSorting: false, // Backend only sorts by submit_time
      cell: ({ row }) => (
        <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">{row.original.app_name || "—"}</span>
      ),
    },
  ];
}
