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
import { PanelRightOpen } from "lucide-react";
import { remToPx } from "@/components/data-table/utils/column-sizing";
import { COLUMN_MIN_WIDTHS_REM } from "@/components/data-table/utils/column-constants";
import { formatDateTimeFull, formatDateTimeSuccinct } from "@/lib/format-date";
import { formatBytes } from "@/lib/utils";
import { MidTruncate } from "@/components/mid-truncate";
import type { Dataset } from "@/lib/api/adapter/datasets";
import {
  DATASET_COLUMN_SIZE_CONFIG,
  COLUMN_LABELS,
  type DatasetColumnId,
} from "@/features/datasets/list/lib/dataset-columns";

function getMinSize(id: DatasetColumnId): number {
  const col = DATASET_COLUMN_SIZE_CONFIG.find((c) => c.id === id);
  return col ? remToPx(col.minWidthRem) : 80;
}

export interface CreateDatasetColumnsOptions {
  /** Called when the open-details button is clicked */
  onOpenPanel: (dataset: Dataset) => void;
}

export function createDatasetColumns({ onOpenPanel }: CreateDatasetColumnsOptions): ColumnDef<Dataset, unknown>[] {
  return [
    {
      id: "_open",
      header: "",
      enableResizing: false,
      enableSorting: false,
      size: remToPx(COLUMN_MIN_WIDTHS_REM.ACTIONS_SMALL),
      meta: { cellClassName: "p-0" },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenPanel(row.original);
          }}
          className="flex h-full w-full items-center justify-center text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          aria-label={`Open details for ${row.original.name}`}
        >
          <PanelRightOpen className="size-4" />
        </button>
      ),
    },
    {
      id: "name",
      accessorKey: "name",
      header: COLUMN_LABELS.name,
      minSize: getMinSize("name"),
      enableSorting: true,
      cell: ({ row }) => (
        <MidTruncate
          text={row.original.name}
          className="font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100"
        />
      ),
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
