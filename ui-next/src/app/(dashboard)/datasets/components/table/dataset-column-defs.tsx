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
import { remToPx } from "@/components/data-table/utils/column-sizing";
import { formatDateTimeFull, formatDateTimeSuccinct } from "@/lib/format-date";
import { formatBytes } from "@/lib/utils";
import type { Dataset } from "@/lib/api/adapter/datasets";
import {
  DATASET_COLUMN_SIZE_CONFIG,
  COLUMN_LABELS,
  type DatasetColumnId,
} from "@/app/(dashboard)/datasets/lib/dataset-columns";

function getMinSize(id: DatasetColumnId): number {
  const col = DATASET_COLUMN_SIZE_CONFIG.find((c) => c.id === id);
  return col ? remToPx(col.minWidthRem) : 80;
}

export function createDatasetColumns(): ColumnDef<Dataset, unknown>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: COLUMN_LABELS.name,
      minSize: getMinSize("name"),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="truncate font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {row.original.name}
        </span>
      ),
    },
    {
      id: "bucket",
      accessorKey: "bucket",
      header: COLUMN_LABELS.bucket,
      minSize: getMinSize("bucket"),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">{row.original.bucket}</span>
      ),
    },
    {
      id: "version",
      accessorKey: "version",
      header: COLUMN_LABELS.version,
      minSize: getMinSize("version"),
      enableSorting: false,
      cell: ({ row }) => {
        const version = row.original.version || 0;
        return (
          <span className="truncate font-mono text-sm text-zinc-600 tabular-nums dark:text-zinc-400">
            {version > 0 ? `v${version}` : "—"}
          </span>
        );
      },
    },
    {
      id: "format",
      accessorKey: "format",
      header: COLUMN_LABELS.format,
      minSize: getMinSize("format"),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">{row.original.format}</span>
      ),
    },
    {
      id: "size_bytes",
      accessorKey: "size_bytes",
      header: COLUMN_LABELS.size_bytes,
      minSize: getMinSize("size_bytes"),
      enableSorting: false,
      cell: ({ row }) => {
        const sizeBytes = row.original.size_bytes || 0;
        const formatted = formatBytes(sizeBytes);
        return (
          <span className="truncate font-mono text-sm text-zinc-600 tabular-nums dark:text-zinc-400">
            {formatted.display}
          </span>
        );
      },
    },
    {
      id: "num_files",
      accessorKey: "num_files",
      header: COLUMN_LABELS.num_files,
      minSize: getMinSize("num_files"),
      enableSorting: false,
      cell: ({ row }) => {
        const numFiles = row.original.num_files || 0;
        return (
          <span className="truncate font-mono text-sm text-zinc-600 tabular-nums dark:text-zinc-400">
            {numFiles > 0 ? numFiles.toLocaleString() : "—"}
          </span>
        );
      },
    },
    {
      id: "labels",
      accessorKey: "labels",
      header: COLUMN_LABELS.labels,
      minSize: getMinSize("labels"),
      enableSorting: false,
      cell: ({ row }) => {
        const labels = row.original.labels || {};
        const entries = Object.entries(labels);

        if (entries.length === 0) {
          return <span className="text-sm text-zinc-400">—</span>;
        }

        return (
          <div className="flex flex-wrap gap-1">
            {entries.slice(0, 3).map(([key, value]) => (
              <span
                key={key}
                className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {key}: {value}
              </span>
            ))}
            {entries.length > 3 && (
              <span className="inline-flex items-center text-xs text-zinc-500">+{entries.length - 3} more</span>
            )}
          </div>
        );
      },
    },
    {
      id: "updated_at",
      accessorKey: "updated_at",
      header: COLUMN_LABELS.updated_at,
      minSize: getMinSize("updated_at"),
      enableSorting: false,
      cell: ({ row }) => {
        const updatedAt = row.original.updated_at;
        if (!updatedAt) return <span className="text-sm text-zinc-400">—</span>;
        return (
          <span
            className="truncate text-sm text-zinc-500 dark:text-zinc-400"
            title={formatDateTimeFull(updatedAt)}
          >
            {formatDateTimeSuccinct(updatedAt)}
          </span>
        );
      },
    },
  ];
}
