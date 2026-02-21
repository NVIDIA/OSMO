//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Dataset Version Column Definitions
 *
 * Column definitions for the versions table using TanStack Table.
 */

import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/shadcn/badge";
import { formatBytes } from "@/lib/utils";
import { formatDateTimeSuccinct } from "@/lib/format-date";
import type { DatasetVersion } from "@/lib/api/adapter/datasets";

export interface DatasetVersionWithMetadata extends DatasetVersion {
  /** Visual row index for zebra striping */
  _visualRowIndex?: number;
  /** Whether this is the current version */
  _isCurrent?: boolean;
}

/**
 * Create column definitions for dataset versions table.
 */
export function createVersionColumns(): ColumnDef<DatasetVersionWithMetadata>[] {
  return [
    {
      id: "version",
      accessorKey: "version",
      header: "Version",
      enableSorting: true,
      cell: ({ row }) => {
        const version = row.original;
        const isCurrent = version._isCurrent;

        return (
          <div className="flex items-center gap-2">
            <span
              className={`font-mono text-sm ${
                isCurrent ? "text-nvidia font-semibold" : "text-zinc-900 dark:text-zinc-100"
              }`}
            >
              {version.version}
            </span>
            {isCurrent && (
              <Badge
                variant="default"
                className="bg-nvidia hover:bg-nvidia-dark text-xs"
              >
                Current
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      enableSorting: true,
      cell: ({ row }) => {
        const { status } = row.original;
        return (
          <Badge
            variant={status === "READY" ? "default" : "secondary"}
            className={
              status === "READY"
                ? "bg-green-600 hover:bg-green-700"
                : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
            }
          >
            {status}
          </Badge>
        );
      },
    },
    {
      id: "created_by",
      accessorKey: "created_by",
      header: "Created By",
      enableSorting: true,
      cell: ({ row }) => {
        return <span className="text-sm text-zinc-600 dark:text-zinc-400">{row.original.created_by}</span>;
      },
    },
    {
      id: "created_date",
      accessorKey: "created_date",
      header: "Created Date",
      enableSorting: true,
      cell: ({ row }) => {
        return (
          <span className="text-sm text-zinc-900 dark:text-zinc-100">
            {formatDateTimeSuccinct(row.original.created_date)}
          </span>
        );
      },
    },
    {
      id: "last_used",
      accessorKey: "last_used",
      header: "Last Used",
      enableSorting: true,
      cell: ({ row }) => {
        return (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatDateTimeSuccinct(row.original.last_used)}
          </span>
        );
      },
    },
    {
      id: "size",
      accessorKey: "size",
      header: "Size",
      enableSorting: true,
      cell: ({ row }) => {
        const sizeGib = row.original.size / 1024 ** 3;
        const formattedSize = formatBytes(sizeGib);
        return <span className="font-mono text-sm text-zinc-900 dark:text-zinc-100">{formattedSize.display}</span>;
      },
    },
    {
      id: "retention",
      accessorKey: "retention_policy",
      header: "Retention",
      enableSorting: true,
      cell: ({ row }) => {
        const retentionDays = Math.floor(row.original.retention_policy / 86400);
        return <span className="font-mono text-sm text-zinc-600 dark:text-zinc-400">{retentionDays}d</span>;
      },
    },
    {
      id: "tags",
      accessorKey: "tags",
      header: "Tags",
      enableSorting: false,
      cell: ({ row }) => {
        const { tags } = row.original;
        if (!tags || tags.length === 0) {
          return <span className="text-sm text-zinc-400">—</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="text-xs"
              >
                {tag}
              </Badge>
            ))}
          </div>
        );
      },
    },
  ];
}
