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
import { Info } from "lucide-react";
import { remToPx } from "@/components/data-table/utils/column-sizing";
import { cn } from "@/lib/utils";
import { formatDateTimeFull, formatDateTimeSuccinct } from "@/lib/format-date";
import { formatBytes } from "@/lib/utils";
import { MidTruncate } from "@/components/mid-truncate";
import type { Dataset } from "@/lib/api/adapter/datasets";
import { DatasetType } from "@/lib/api/generated";
import {
  DATASET_COLUMN_SIZE_CONFIG,
  COLUMN_LABELS,
  type DatasetColumnId,
} from "@/features/datasets/list/lib/dataset-columns";

function getMinSize(id: DatasetColumnId): number {
  const col = DATASET_COLUMN_SIZE_CONFIG.find((c) => c.id === id);
  return col ? remToPx(col.minWidthRem) : 80;
}

export function createDatasetColumns(
  onOpenDetails?: (bucket: string, name: string) => void,
): ColumnDef<Dataset, unknown>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: COLUMN_LABELS.name,
      minSize: getMinSize("name"),
      enableSorting: true,
      cell: ({ row }) => (
        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          <MidTruncate
            text={row.original.name}
            className="min-w-0 font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100"
          />
          {onOpenDetails && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetails(row.original.bucket, row.original.name);
              }}
              className="shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label={`Open details for ${row.original.name}`}
              title="Open details"
            >
              <Info
                className="size-3.5"
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      ),
    },
    {
      id: "type",
      accessorKey: "type",
      header: COLUMN_LABELS.type,
      minSize: getMinSize("type"),
      enableSorting: true,
      cell: ({ row }) => {
        const isCollection = row.original.type === DatasetType.COLLECTION;
        return (
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
              isCollection
                ? "text-indigo-700 ring-indigo-200 dark:text-indigo-300 dark:ring-indigo-700"
                : "text-zinc-600 ring-zinc-200 dark:text-zinc-400 dark:ring-zinc-700",
            )}
          >
            {isCollection ? "Collection" : "Dataset"}
          </span>
        );
      },
    },
    {
      id: "bucket",
      accessorKey: "bucket",
      header: COLUMN_LABELS.bucket,
      minSize: getMinSize("bucket"),
      enableSorting: true,
      cell: ({ row }) => (
        <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">{row.original.bucket}</span>
      ),
    },
    {
      id: "version",
      accessorKey: "version",
      header: COLUMN_LABELS.version,
      minSize: getMinSize("version"),
      enableSorting: true,
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
      id: "size_bytes",
      accessorKey: "size_bytes",
      header: COLUMN_LABELS.size_bytes,
      minSize: getMinSize("size_bytes"),
      enableSorting: true,
      cell: ({ row }) => {
        const sizeBytes = row.original.size_bytes || 0;
        // Convert bytes to GiB (formatBytes expects GiB)
        const sizeGib = sizeBytes / 1024 ** 3;
        const formatted = formatBytes(sizeGib);
        return (
          <span className="truncate font-mono text-sm text-zinc-600 tabular-nums dark:text-zinc-400">
            {formatted.display}
          </span>
        );
      },
    },
    {
      id: "created_at",
      accessorKey: "created_at",
      header: COLUMN_LABELS.created_at,
      minSize: getMinSize("created_at"),
      enableSorting: true,
      cell: ({ row }) => {
        const createdAt = row.original.created_at;
        if (!createdAt) return <span className="text-sm text-zinc-400">—</span>;
        return (
          <span
            className="truncate text-sm text-zinc-500 dark:text-zinc-400"
            title={formatDateTimeFull(createdAt)}
          >
            {formatDateTimeSuccinct(createdAt)}
          </span>
        );
      },
    },
    {
      id: "updated_at",
      accessorKey: "updated_at",
      header: COLUMN_LABELS.updated_at,
      minSize: getMinSize("updated_at"),
      enableSorting: true,
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
