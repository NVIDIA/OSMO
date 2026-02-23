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
 * FileBrowserTable — Google Drive-style file listing for a dataset directory.
 *
 * Renders folders before files with columns for name, size, type,
 * and a per-row copy-path button.
 */

"use client";

import { useMemo, useCallback, memo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Folder, File, FileText, FileImage, FileVideo, Copy } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { TableEmptyState } from "@/components/data-table/table-empty-state";
import { TableLoadingSkeleton } from "@/components/data-table/table-states";
import { Button } from "@/components/shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatBytes } from "@/lib/utils";
import { useCopy } from "@/hooks/use-copy";
import { useCompactMode } from "@/hooks/shared-preferences-hooks";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import { remToPx } from "@/components/data-table/utils/column-sizing";
import { COLUMN_MIN_WIDTHS_REM } from "@/components/data-table/utils/column-constants";
import type { DatasetFile } from "@/lib/api/adapter/datasets";

// =============================================================================
// Types
// =============================================================================

interface FileBrowserTableProps {
  /** Files and folders at the current path */
  files: DatasetFile[];
  /** Current directory path (empty string = root) */
  path: string;
  /** Currently selected file's full path (for row highlight) */
  selectedFile: string | null;
  /** Called when a folder row is clicked */
  onNavigate: (path: string) => void;
  /** Called when a file row is clicked */
  onSelectFile: (filePath: string) => void;
  isLoading?: boolean;
}

// =============================================================================
// File icon helper
// =============================================================================

function FileIcon({ name, type }: { name: string; type: "file" | "folder" }) {
  if (type === "folder") {
    return (
      <Folder
        className="size-4 shrink-0 text-amber-500"
        aria-hidden="true"
      />
    );
  }
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) {
    return (
      <FileImage
        className="size-4 shrink-0 text-blue-500"
        aria-hidden="true"
      />
    );
  }
  if (["mp4", "webm", "mov", "avi"].includes(ext)) {
    return (
      <FileVideo
        className="size-4 shrink-0 text-purple-500"
        aria-hidden="true"
      />
    );
  }
  if (["txt", "md", "json", "yaml", "yml", "csv"].includes(ext)) {
    return (
      <FileText
        className="size-4 shrink-0 text-zinc-500"
        aria-hidden="true"
      />
    );
  }
  return (
    <File
      className="size-4 shrink-0 text-zinc-400"
      aria-hidden="true"
    />
  );
}

// =============================================================================
// Copy path cell (needs hook so defined as component)
// =============================================================================

function CopyPathButton({ url }: { url: string }) {
  const { copied, copy } = useCopy();

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void copy(url);
    },
    [copy, url],
  );

  return (
    <Tooltip open={copied}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
          onClick={handleCopy}
          aria-label={`Copy path: ${url}`}
        >
          <Copy
            className="size-3.5"
            aria-hidden="true"
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copied!</TooltipContent>
    </Tooltip>
  );
}

// =============================================================================
// Column definitions
// =============================================================================

function createColumns(): ColumnDef<DatasetFile>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const { name, type } = row.original;
        return (
          <span className="flex min-w-0 items-center gap-2">
            <FileIcon
              name={name}
              type={type}
            />
            <span className="truncate text-sm text-zinc-900 dark:text-zinc-100">{name}</span>
          </span>
        );
      },
    },
    {
      id: "size",
      accessorKey: "size",
      header: "Size",
      cell: ({ row }) => {
        const { size, type } = row.original;
        if (type === "folder" || size === undefined) {
          return <span className="text-sm text-zinc-400 dark:text-zinc-600">—</span>;
        }
        return (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">{formatBytes(size / 1024 ** 3).display}</span>
        );
      },
    },
    {
      id: "type",
      accessorKey: "name",
      header: "Type",
      cell: ({ row }) => {
        const { name, type } = row.original;
        if (type === "folder") {
          return <span className="text-sm text-zinc-500 dark:text-zinc-400">Folder</span>;
        }
        const ext = name.split(".").pop()?.toUpperCase() ?? "—";
        return <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{ext}</span>;
      },
    },
    {
      id: "copy",
      header: "",
      minSize: remToPx(COLUMN_MIN_WIDTHS_REM.ACTIONS_SMALL),
      maxSize: remToPx(COLUMN_MIN_WIDTHS_REM.ACTIONS_SMALL),
      cell: ({ row }) => {
        const { type, url } = row.original;
        if (type === "folder" || !url) return null;
        return <CopyPathButton url={url} />;
      },
    },
  ];
}

// =============================================================================
// Component
// =============================================================================

export const FileBrowserTable = memo(function FileBrowserTable({
  files,
  path,
  selectedFile,
  onNavigate,
  onSelectFile,
  isLoading = false,
}: FileBrowserTableProps) {
  const compactMode = useCompactMode();
  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

  // Sort: folders first, then files — both groups sorted alphabetically
  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [files],
  );

  // Row ID = full path so it matches selectedFile from URL state
  const getRowId = useCallback((file: DatasetFile) => (path ? `${path}/${file.name}` : file.name), [path]);

  // Single click: folders navigate, files select
  const handleRowClick = useCallback(
    (file: DatasetFile) => {
      if (file.type === "folder") {
        const newPath = path ? `${path}/${file.name}` : file.name;
        onNavigate(newPath);
      } else {
        const filePath = path ? `${path}/${file.name}` : file.name;
        onSelectFile(filePath);
      }
    },
    [path, onNavigate, onSelectFile],
  );

  const columns = useMemo(() => createColumns(), []);

  const emptyContent = useMemo(() => <TableEmptyState message="This directory is empty or does not exist" />, []);

  if (isLoading) {
    return <TableLoadingSkeleton rowHeight={rowHeight} />;
  }

  return (
    <DataTable<DatasetFile>
      data={sortedFiles}
      columns={columns}
      getRowId={getRowId}
      onRowClick={handleRowClick}
      selectedRowId={selectedFile ?? undefined}
      rowHeight={rowHeight}
      compact={compactMode}
      emptyContent={emptyContent}
      className="text-sm"
      scrollClassName="flex-1"
      rowClassName="group"
    />
  );
});
