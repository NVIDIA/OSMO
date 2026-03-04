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
 * Renders folders before files with columns for name, size, and type.
 * A trailing copy-path button is shown for each file row.
 */

"use client";

import { useMemo, useCallback, memo, useRef, useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Folder, File, FileText, FileImage, FileVideo, Copy, Database } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { TableEmptyState } from "@/components/data-table/table-empty-state";
import { TableLoadingSkeleton, TableErrorState } from "@/components/data-table/table-states";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatBytes } from "@/lib/utils";
import { useCopy } from "@/hooks/use-copy";
import { useCompactMode } from "@/hooks/shared-preferences-hooks";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import { MidTruncate } from "@/components/mid-truncate";
import type { DatasetFile } from "@/lib/api/adapter/datasets";
import type { SortState } from "@/components/data-table/types";

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
  /** Called when user presses h/ArrowLeft/Backspace to navigate up a directory */
  onNavigateUp?: () => void;
  /** Called when user presses Escape to clear file selection */
  onClearSelection?: () => void;
  isLoading?: boolean;
  /** Error from the file listing query — renders an error state inside the table shell */
  error?: Error | null;
  /** Called when user clicks retry on an error state */
  onRetry?: () => void;
  /** When true, column ResizeObserver changes are ignored (pass isDragging from gutter drag) */
  suspendResize?: boolean;
  /** Register a callback invoked when the layout stabilizes (e.g. after gutter drag ends) */
  registerLayoutStableCallback?: (callback: () => void) => () => void;
  /** When true, shows the Location column (relative path). Active during file filter search. */
  showLocation?: boolean;
}

// =============================================================================
// Type rank — folders and dataset-members always sort above files
// =============================================================================

function typeRank(type: DatasetFile["type"]): number {
  if (type === "dataset-member") return 0;
  if (type === "folder") return 1;
  return 2;
}

// =============================================================================
// File icon helper
// =============================================================================

function FileIcon({ name, type }: { name: string; type: DatasetFile["type"] }) {
  if (type === "dataset-member") {
    return (
      <Database
        className="size-4 shrink-0 text-emerald-500"
        aria-hidden="true"
      />
    );
  }
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
// Copy path button (inline in name cell, copies S3 URI)
// =============================================================================

function CopyPathButton({ storagePath }: { storagePath: string }) {
  const { copied, copy } = useCopy();

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void copy(storagePath);
    },
    [copy, storagePath],
  );

  return (
    <Tooltip open={copied || undefined}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          aria-label={`Copy S3 path: ${storagePath}`}
        >
          <Copy
            className="size-3.5"
            aria-hidden="true"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : "Copy path"}</TooltipContent>
    </Tooltip>
  );
}

// =============================================================================
// Column definitions
// =============================================================================

function createColumns(showLocation: boolean): ColumnDef<DatasetFile>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: "Name",
      enableSorting: true,
      size: 400,
      minSize: 160,
      cell: ({ row }) => {
        const { name, type, label, storagePath } = row.original;
        const displayName = label ?? name;
        return (
          <span className="flex w-full min-w-0 items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <FileIcon
                name={name}
                type={type}
              />
              {type === "file" ? (
                <MidTruncate
                  text={displayName}
                  className="text-sm text-zinc-900 dark:text-zinc-100"
                />
              ) : (
                <span className="truncate text-sm text-zinc-900 dark:text-zinc-100">{displayName}</span>
              )}
            </span>
            {type === "file" && storagePath && <CopyPathButton storagePath={storagePath} />}
          </span>
        );
      },
    },
    {
      id: "size",
      accessorKey: "size",
      header: "Size",
      enableSorting: true,
      size: 120,
      minSize: 90,
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
      enableSorting: false,
      size: 90,
      minSize: 70,
      cell: ({ row }) => {
        const { name, type } = row.original;
        if (type === "dataset-member") {
          return <span className="text-sm text-zinc-500 dark:text-zinc-400">Dataset</span>;
        }
        if (type === "folder") {
          return <span className="text-sm text-zinc-500 dark:text-zinc-400">Folder</span>;
        }
        const ext = name.split(".").pop()?.toUpperCase() ?? "—";
        return <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{ext}</span>;
      },
    },
    ...(showLocation
      ? [
          {
            id: "location",
            accessorKey: "relativePath",
            header: "Location",
            enableSorting: false,
            size: 280,
            minSize: 120,
            cell: ({ row }: { row: { original: DatasetFile } }) => {
              const { relativePath, type } = row.original;
              if (!relativePath || type !== "file") {
                return <span className="text-sm text-zinc-400 dark:text-zinc-600">—</span>;
              }
              return (
                <MidTruncate
                  text={relativePath}
                  className="font-mono text-xs text-zinc-500 dark:text-zinc-400"
                />
              );
            },
          } satisfies ColumnDef<DatasetFile>,
        ]
      : []),
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
  onNavigateUp,
  onClearSelection,
  isLoading = false,
  error,
  onRetry,
  suspendResize,
  registerLayoutStableCallback,
  showLocation = false,
}: FileBrowserTableProps) {
  const compactMode = useCompactMode();
  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

  // Sort state — default to name ascending
  const [sorting, setSorting] = useState<SortState<string>>({ column: "name", direction: "asc" });

  // Sort: dataset-members first, then folders, then files — user-controlled sort within each group
  const sortedFiles = useMemo(() => {
    const dir = sorting.direction === "asc" ? 1 : -1;
    return [...files].sort((a, b) => {
      // Type rank is always fixed: dataset-members → folders → files
      const rankDiff = typeRank(a.type) - typeRank(b.type);
      if (rankDiff !== 0) return rankDiff;

      // Within same type, apply sort column
      if (sorting.column === "size") {
        const aSize = a.size ?? -1;
        const bSize = b.size ?? -1;
        if (aSize !== bSize) return (aSize - bSize) * dir;
        // Tie-break by name
        return (a.label ?? a.name).localeCompare(b.label ?? b.name);
      }

      // Default: sort by display name
      return (a.label ?? a.name).localeCompare(b.label ?? b.name) * dir;
    });
  }, [files, sorting]);

  // Pre-compute index map for O(1) zebra stripe lookup
  const rowIndexMap = useMemo(() => {
    const map = new Map<DatasetFile, number>();
    sortedFiles.forEach((file, index) => map.set(file, index));
    return map;
  }, [sortedFiles]);

  // Zebra stripes: odd rows get a subtle background
  const rowClassName = useCallback(
    (item: DatasetFile) => {
      const idx = rowIndexMap.get(item) ?? 0;
      return idx % 2 === 1 ? "bg-zinc-50 dark:bg-zinc-900/50" : "";
    },
    [rowIndexMap],
  );

  // Row ID = full path so it matches selectedFile from URL state
  const getRowId = useCallback((file: DatasetFile) => (path ? `${path}/${file.name}` : file.name), [path]);

  // Single click: folders and dataset-members navigate, files select
  const handleRowClick = useCallback(
    (file: DatasetFile) => {
      if (file.type === "folder" || file.type === "dataset-member") {
        const newPath = path ? `${path}/${file.name}` : file.name;
        onNavigate(newPath);
      } else {
        const filePath = path ? `${path}/${file.name}` : file.name;
        onSelectFile(filePath);
      }
    },
    [path, onNavigate, onSelectFile],
  );

  const tableAreaRef = useRef<HTMLDivElement>(null);

  // Auto-focus first row when data first loads or when the directory changes,
  // but only if nothing else on the page currently has focus.
  useEffect(() => {
    if (sortedFiles.length === 0) return;

    const activeEl = document.activeElement;
    const isBodyFocused = !activeEl || activeEl === document.body;
    const isFocusInTable = tableAreaRef.current?.contains(activeEl) ?? false;
    if (!isBodyFocused && !isFocusInTable) return;

    const raf = requestAnimationFrame(() => {
      const firstRow = tableAreaRef.current?.querySelector<HTMLElement>('[aria-rowindex="2"]');
      firstRow?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [sortedFiles]);

  // Handle directory navigation and selection shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== "TR") return;

      switch (e.key) {
        case "h":
        case "ArrowLeft":
        case "Backspace":
          if (onNavigateUp) {
            e.preventDefault();
            onNavigateUp();
          }
          break;
        case "l":
        case "ArrowRight":
        case "Enter": {
          const rowIndex = parseInt(target.getAttribute("aria-rowindex") ?? "0", 10);
          const file = sortedFiles[rowIndex - 2]; // aria-rowindex starts at 2 (1 = header)
          if (file) {
            e.preventDefault();
            handleRowClick(file);
          }
          break;
        }
        case "Escape":
          if (onClearSelection) {
            e.preventDefault();
            onClearSelection();
          }
          break;
      }
    },
    [onNavigateUp, onClearSelection, sortedFiles, handleRowClick],
  );

  const columns = useMemo(() => createColumns(showLocation), [showLocation]);

  const emptyContent = useMemo(() => <TableEmptyState message="This directory is empty or does not exist" />, []);

  return (
    <div
      ref={tableAreaRef}
      className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      role="presentation"
      onKeyDown={handleKeyDown}
    >
      {error ? (
        <TableErrorState
          error={error}
          title="Unable to load files"
          onRetry={onRetry}
          headers={showLocation ? ["Name", "Size", "Type", "Location"] : ["Name", "Size", "Type"]}
        />
      ) : isLoading ? (
        <TableLoadingSkeleton
          rowHeight={rowHeight}
          columnCount={showLocation ? 4 : 3}
          headers={showLocation ? ["Name", "Size", "Type", "Location"] : ["Name", "Size", "Type"]}
        />
      ) : (
        <DataTable<DatasetFile>
          data={sortedFiles}
          columns={columns}
          getRowId={getRowId}
          onRowClick={handleRowClick}
          selectedRowId={selectedFile ?? undefined}
          rowHeight={rowHeight}
          compact={compactMode}
          emptyContent={emptyContent}
          headerClassName="px-4 py-3"
          theadClassName="file-browser-thead"
          className="text-sm"
          scrollClassName="flex-1 min-h-0"
          sorting={sorting}
          onSortingChange={setSorting}
          rowClassName={rowClassName}
          suspendResize={suspendResize}
          registerLayoutStableCallback={registerLayoutStableCallback}
        />
      )}
    </div>
  );
});
