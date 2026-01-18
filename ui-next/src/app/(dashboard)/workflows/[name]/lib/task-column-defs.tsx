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

import type { ColumnDef } from "@tanstack/react-table";
import { Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { remToPx } from "@/components/data-table";
import { cn } from "@/lib/utils";
import { formatDuration } from "./workflow-types";
import { getStatusCategory, STATUS_STYLES, type StatusCategory } from "./status";
import type { TaskWithDuration } from "./workflow-types";
import { TASK_COLUMN_SIZE_CONFIG, COLUMN_LABELS, type TaskColumnId } from "./task-columns";

const STATUS_ICONS: Record<StatusCategory, React.ComponentType<{ className?: string }>> = {
  waiting: Clock,
  pending: Loader2,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
};

function getMinSize(id: TaskColumnId): number {
  const col = TASK_COLUMN_SIZE_CONFIG.find((c) => c.id === id);
  return col ? remToPx(col.minWidthRem) : 80;
}

function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "p" : "a";
  const hour12 = hours % 12 || 12;
  return `${month}/${day} ${hour12}:${minutes}${ampm}`;
}

export function createTaskColumns(): ColumnDef<TaskWithDuration, unknown>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: COLUMN_LABELS.name,
      minSize: getMinSize("name"),
      enableSorting: true,
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-gray-900 dark:text-zinc-100">{row.original.name}</span>
          {row.original.lead && (
            <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium tracking-wide text-amber-700 uppercase ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/20 dark:text-amber-400 dark:ring-amber-500/30">
              Lead
            </span>
          )}
        </div>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: COLUMN_LABELS.status,
      minSize: getMinSize("status"),
      enableSorting: true,
      cell: ({ row }) => {
        const status = row.original.status;
        const category = getStatusCategory(status);
        const styles = STATUS_STYLES[category];
        const Icon = STATUS_ICONS[category];

        return (
          <span className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5", styles.bg)}>
            <Icon className={cn("size-3.5", styles.text, category === "running" && "animate-spin")} />
            <span className={cn("text-xs font-semibold", styles.text)}>{status}</span>
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
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-gray-500 tabular-nums dark:text-zinc-400">
          {formatDuration(row.original.duration)}
        </span>
      ),
    },
    {
      id: "node",
      accessorKey: "node_name",
      header: COLUMN_LABELS.node,
      minSize: getMinSize("node"),
      enableSorting: true,
      cell: ({ row }) => (
        <span className="truncate text-gray-500 dark:text-zinc-400">{row.original.node_name ?? "—"}</span>
      ),
    },
    {
      id: "podIp",
      accessorKey: "pod_ip",
      header: COLUMN_LABELS.podIp,
      minSize: getMinSize("podIp"),
      enableSorting: true,
      cell: ({ row }) => (
        <span className="truncate font-mono text-xs whitespace-nowrap text-gray-500 dark:text-zinc-400">
          {row.original.pod_ip ?? "—"}
        </span>
      ),
    },
    {
      id: "exitCode",
      accessorKey: "exit_code",
      header: COLUMN_LABELS.exitCode,
      minSize: getMinSize("exitCode"),
      enableSorting: true,
      cell: ({ row }) => {
        const exitCode = row.original.exit_code;
        return (
          <span
            className={cn(
              "whitespace-nowrap tabular-nums",
              exitCode === 0
                ? "text-gray-500 dark:text-zinc-400"
                : exitCode !== undefined
                  ? "text-red-600 dark:text-red-400"
                  : "text-gray-400 dark:text-zinc-500",
            )}
          >
            {exitCode ?? "—"}
          </span>
        );
      },
    },
    {
      id: "startTime",
      accessorKey: "start_time",
      header: COLUMN_LABELS.startTime,
      minSize: getMinSize("startTime"),
      enableSorting: true,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-gray-500 tabular-nums dark:text-zinc-400">
          {formatTime(row.original.start_time)}
        </span>
      ),
    },
    {
      id: "endTime",
      accessorKey: "end_time",
      header: COLUMN_LABELS.endTime,
      minSize: getMinSize("endTime"),
      enableSorting: true,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-gray-500 tabular-nums dark:text-zinc-400">
          {formatTime(row.original.end_time)}
        </span>
      ),
    },
    {
      id: "retry",
      accessorKey: "retry_id",
      header: COLUMN_LABELS.retry,
      minSize: getMinSize("retry"),
      enableSorting: true,
      cell: ({ row }) => {
        const retryId = row.original.retry_id;
        return (
          <span
            className={cn(
              "whitespace-nowrap tabular-nums",
              retryId > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-zinc-500",
            )}
          >
            {retryId > 0 ? retryId : "—"}
          </span>
        );
      },
    },
  ];
}
