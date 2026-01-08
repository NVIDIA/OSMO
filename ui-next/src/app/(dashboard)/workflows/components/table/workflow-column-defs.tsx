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
 * Workflow Table Column Definitions
 *
 * TanStack Table column definitions for the workflows table.
 * Contains JSX cell renderers - colocated with workflows-data-table.tsx.
 */

import type { ColumnDef } from "@tanstack/react-table";
import { Clock, CheckCircle2, XCircle, Loader2, AlertTriangle, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { remToPx } from "@/components/data-table";
import { cn } from "@/lib/utils";
import type { WorkflowListEntry } from "../../lib/workflow-search-fields";
import { WORKFLOW_COLUMN_SIZE_CONFIG, COLUMN_LABELS, type WorkflowColumnId } from "../../lib/workflow-columns";
import { getStatusDisplay, STATUS_STYLES, getPriorityDisplay, type StatusCategory } from "../../lib/workflow-constants";

// =============================================================================
// Status Icons
// =============================================================================

const STATUS_ICONS: Record<StatusCategory, React.ComponentType<{ className?: string }>> = {
  waiting: Clock,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
};

// =============================================================================
// Priority Icons
// =============================================================================

const PRIORITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  HIGH: ArrowUp,
  NORMAL: Minus,
  LOW: ArrowDown,
};

// =============================================================================
// Helpers
// =============================================================================

/** Get column minimum size from rem-based config */
function getMinSize(id: WorkflowColumnId): number {
  const col = WORKFLOW_COLUMN_SIZE_CONFIG.find((c) => c.id === id);
  return col ? remToPx(col.minWidthRem) : 80;
}

/**
 * Format duration in seconds to human-readable string.
 */
function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format timestamp to relative time string.
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  // Format as date for older items
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Format timestamp to full date string for tooltip.
 */
function formatFullDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// =============================================================================
// Column Definitions Factory
// =============================================================================

/**
 * Create TanStack Table column definitions for workflows.
 *
 * Uses plain object notation (not helper.accessor) for correct type inference.
 *
 * @returns Array of column definitions compatible with DataTable
 */
export function createWorkflowColumns(): ColumnDef<WorkflowListEntry, unknown>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: COLUMN_LABELS.name,
      minSize: getMinSize("name"),
      enableSorting: true,
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
      enableSorting: true,
      cell: ({ row }) => {
        const { category, label } = getStatusDisplay(row.original.status);
        const styles = STATUS_STYLES[category];
        const Icon = STATUS_ICONS[category];

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
      enableSorting: true,
      cell: ({ row }) => <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">{row.original.user}</span>,
    },
    {
      id: "submit_time",
      accessorKey: "submit_time",
      header: COLUMN_LABELS.submit_time,
      minSize: getMinSize("submit_time"),
      enableSorting: true,
      cell: ({ row }) => {
        const submitTime = row.original.submit_time;
        if (!submitTime) return <span className="text-sm text-zinc-400">—</span>;
        return (
          <span
            className="truncate text-sm text-zinc-500 dark:text-zinc-400"
            title={formatFullDate(submitTime)}
          >
            {formatRelativeTime(submitTime)}
          </span>
        );
      },
    },
    {
      id: "duration",
      accessorKey: "duration",
      header: COLUMN_LABELS.duration,
      minSize: getMinSize("duration"),
      enableSorting: true,
      cell: ({ row }) => {
        const duration = row.original.duration;
        const isRunning = row.original.status === "RUNNING";

        return (
          <span
            className={cn(
              "truncate font-mono text-sm tabular-nums",
              isRunning ? "text-blue-600 dark:text-blue-400" : "text-zinc-500 dark:text-zinc-400",
            )}
          >
            {formatDuration(duration)}
            {isRunning && "..."}
          </span>
        );
      },
    },
    {
      id: "queued_time",
      accessorKey: "queued_time",
      header: COLUMN_LABELS.queued_time,
      minSize: getMinSize("queued_time"),
      enableSorting: true,
      cell: ({ row }) => (
        <span className="truncate font-mono text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
          {formatDuration(row.original.queued_time)}
        </span>
      ),
    },
    {
      id: "pool",
      accessorKey: "pool",
      header: COLUMN_LABELS.pool,
      minSize: getMinSize("pool"),
      enableSorting: true,
      cell: ({ row }) => (
        <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">{row.original.pool || "—"}</span>
      ),
    },
    {
      id: "priority",
      accessorKey: "priority",
      header: COLUMN_LABELS.priority,
      minSize: getMinSize("priority"),
      enableSorting: true,
      cell: ({ row }) => {
        const priority = row.original.priority;
        const display = getPriorityDisplay(priority);
        const Icon = PRIORITY_ICONS[priority.toUpperCase()] ?? AlertTriangle;

        return (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium",
              display.bg,
              display.text,
            )}
          >
            <Icon className="size-3" />
            {display.label}
          </span>
        );
      },
    },
  ];
}
