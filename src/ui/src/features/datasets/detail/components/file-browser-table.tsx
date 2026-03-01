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
 * A leading fixed copy-path button is shown for each file row (always visible).
 */

"use client";

import { useMemo, useCallback, memo, useRef, useEffect } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Folder, File, FileText, FileImage, FileVideo, Copy, Database } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { TableEmptyState } from "@/components/data-table/table-empty-state";
import { TableLoadingSkeleton } from "@/components/data-table/table-states";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatBytes } from "@/lib/utils";
import { useCopy } from "@/hooks/use-copy";
import { useCompactMode } from "@/hooks/shared-preferences-hooks";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import { MidTruncate } from "@/components/mid-truncate";
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
  /** Called when user presses h/ArrowLeft/Backspace to navigate up a directory */
  onNavigateUp?: () => void;
  /** Called when user presses Escape to clear file selection */
  onClearSelection?: () => void;
  /** Whether the file preview panel is currently visible (controls j/k live-update) */
  previewOpen?: boolean;
  isLoading?: boolean;
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

function CopyPathButton({ s3Path }: { s3Path: string }) {
  const { copied, copy } = useCopy();

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void copy(s3Path);
    },
    [copy, s3Path],
  );

  return (
    <Tooltip open={copied || undefined}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          aria-label={`Copy S3 path: ${s3Path}`}
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

function createColumns(): ColumnDef<DatasetFile>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const { name, type, label, s3Path } = row.original;
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
            {type === "file" && s3Path && <CopyPathButton s3Path={s3Path} />}
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
        if (type === "folder" || (type !== "dataset-member" && size === undefined)) {
          return <span className="text-sm text-zinc-400 dark:text-zinc-600">—</span>;
        }
        if (size === undefined) return <span className="text-sm text-zinc-400 dark:text-zinc-600">—</span>;
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
  previewOpen = false,
  isLoading = false,
}: FileBrowserTableProps) {
  const compactMode = useCompactMode();
  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

  // Sort: dataset-members first, then folders, then files — each group alphabetically
  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) => {
        const rank = (t: DatasetFile["type"]) => (t === "dataset-member" ? 0 : t === "folder" ? 1 : 2);
        const diff = rank(a.type) - rank(b.type);
        if (diff !== 0) return diff;
        return (a.label ?? a.name).localeCompare(b.label ?? b.name);
      }),
    [files],
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
      // aria-rowindex is 1-based: header=1, first data row=2.
      // Select by aria-rowindex rather than tabindex="0" so that stale focusedRowIndex
      // state from the previous directory doesn't cause a non-first row to be focused.
      const firstRow = tableAreaRef.current?.querySelector<HTMLElement>('[aria-rowindex="2"]');
      firstRow?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [sortedFiles]); // Re-runs when directory changes or data loads

  // Live preview on keyboard focus: update preview when it's already open, no-op for folders
  // or when preview is closed (avoids opening it unexpectedly during j/k navigation)
  const handleFocusedRowChange = useCallback(
    (file: DatasetFile | null) => {
      if (!file || file.type !== "file") return; // folders and dataset-members are not previewable
      if (!previewOpen) return;
      const filePath = path ? `${path}/${file.name}` : file.name;
      onSelectFile(filePath);
    },
    [path, onSelectFile, previewOpen],
  );

  // Handle directory navigation and selection shortcuts at the table wrapper level
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
        case "Escape":
          if (onClearSelection) {
            e.preventDefault();
            onClearSelection();
          }
          break;
      }
    },
    [onNavigateUp, onClearSelection],
  );

  const columns = useMemo(() => createColumns(), []);

  const emptyContent = useMemo(() => <TableEmptyState message="This directory is empty or does not exist" />, []);

  if (isLoading) {
    return <TableLoadingSkeleton rowHeight={rowHeight} />;
  }

  return (
    <div
      ref={tableAreaRef}
      className="contents"
      role="presentation"
      onKeyDown={handleKeyDown}
    >
      <DataTable<DatasetFile>
        data={sortedFiles}
        columns={columns}
        getRowId={getRowId}
        onRowClick={handleRowClick}
        onFocusedRowChange={handleFocusedRowChange}
        selectedRowId={selectedFile ?? undefined}
        rowHeight={rowHeight}
        compact={compactMode}
        emptyContent={emptyContent}
        headerClassName="px-4 py-[18.5px]"
        theadClassName="file-browser-thead"
        className="text-sm"
        scrollClassName="flex-1"
      />
    </div>
  );
});
