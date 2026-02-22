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
 * Dataset Detail Content (Client Component)
 *
 * Google Drive-style file browser for a dataset version.
 * URL state: ?path= (current directory), ?version= (version tag), ?file= (selected file)
 */

"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { usePage } from "@/components/chrome/page-context";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { Button } from "@/components/shadcn/button";
import { cn } from "@/lib/utils";
import { useResizeDrag } from "@/components/panel/hooks/use-resize-drag";
import { FileBrowserHeader } from "@/app/(dashboard)/datasets/[bucket]/[name]/components/FileBrowserHeader";
import { FileBrowserTable } from "@/app/(dashboard)/datasets/[bucket]/[name]/components/FileBrowserTable";
import { FilePreviewPanel } from "@/app/(dashboard)/datasets/[bucket]/[name]/components/FilePreviewPanel";
import { useDatasetDetail } from "@/app/(dashboard)/datasets/[bucket]/[name]/hooks/use-dataset-detail";
import { useFileBrowserState } from "@/app/(dashboard)/datasets/[bucket]/[name]/hooks/use-file-browser-state";
import { useDatasetFiles } from "@/lib/api/adapter/datasets-hooks";
import { buildDirectoryListing } from "@/lib/api/adapter/datasets";

interface Props {
  bucket: string;
  name: string;
}

export function DatasetDetailContent({ bucket, name }: Props) {
  // ==========================================================================
  // Dataset metadata + versions
  // ==========================================================================

  const { dataset, versions, error: datasetError, refetch: refetchDataset } = useDatasetDetail(bucket, name);

  // ==========================================================================
  // URL state: path, version, selected file
  // ==========================================================================

  const { path, version, selectedFile, navigateTo, setVersion, selectFile, clearSelection } = useFileBrowserState();

  // ==========================================================================
  // File listing — fetch full manifest for selected version, filter client-side
  // ==========================================================================

  // Determine which version to show files for
  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => parseInt(a.version, 10) - parseInt(b.version, 10)),
    [versions],
  );
  const latestVersion = sortedVersions.at(-1) ?? null;
  const currentVersionData = (version ? sortedVersions.find((v) => v.version === version) : null) ?? latestVersion;
  const location = currentVersionData?.location ?? null;

  const {
    data: rawFiles,
    isLoading: isFilesLoading,
    error: filesError,
    refetch: refetchFiles,
  } = useDatasetFiles(location);

  // Build directory listing for the current path from the flat file manifest
  const files = useMemo(() => buildDirectoryListing(rawFiles ?? [], path), [rawFiles, path]);

  // ==========================================================================
  // Panel state — side-by-side split with drag-to-resize
  // ==========================================================================

  const containerRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(35);
  const panelOpen = !!selectedFile;

  const { isDragging, bindResizeHandle, dragStyles } = useResizeDrag({
    width: panelWidth,
    onWidthChange: setPanelWidth,
    minWidth: 20,
    maxWidth: 70,
    containerRef,
  });

  // Resolve the DatasetFile object for the selected file path.
  // The selected file's name is the last path segment; it must exist in the
  // current files array (same directory) to render preview content.
  const selectedFileData = useMemo(() => {
    if (!selectedFile) return null;
    const fileName = selectedFile.split("/").pop() ?? "";
    return files.find((f) => f.name === fileName && f.type === "file") ?? null;
  }, [selectedFile, files]);

  // Stable callback wrappers to avoid stale closures in memo deps
  const handleRefetchFiles = useCallback(() => {
    void refetchFiles();
  }, [refetchFiles]);

  // ==========================================================================
  // Chrome: page title + breadcrumbs
  // ==========================================================================

  usePage({
    title: "Files",
    breadcrumbs: [
      { label: "Datasets", href: "/datasets" },
      { label: bucket, href: `/datasets?f=bucket:${encodeURIComponent(bucket)}` },
      { label: name, href: null },
    ],
  });

  // ==========================================================================
  // Error state — dataset failed to load
  // ==========================================================================

  if (datasetError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <h2 className="text-xl font-semibold text-red-600 dark:text-red-400">Error Loading Dataset</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{datasetError.message}</p>
          <Button
            onClick={() => void refetchDataset()}
            variant="outline"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!dataset) {
    return null; // Loading state handled by skeleton
  }

  // ==========================================================================
  // File listing content — handles query error inline
  // ==========================================================================

  const fileTableContent = filesError ? (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Failed to load files.</p>
      <Button
        variant="outline"
        size="sm"
        onClick={handleRefetchFiles}
      >
        Retry
      </Button>
    </div>
  ) : (
    <FileBrowserTable
      files={files}
      path={path}
      selectedFile={selectedFile}
      onNavigate={navigateTo}
      onSelectFile={selectFile}
      isLoading={isFilesLoading}
    />
  );

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky header: breadcrumb + version switcher */}
      <InlineErrorBoundary
        title="File browser header error"
        compact
      >
        <FileBrowserHeader
          datasetName={name}
          path={path}
          versions={versions}
          selectedVersion={version}
          onNavigate={navigateTo}
          onVersionChange={setVersion}
        />
      </InlineErrorBoundary>

      {/* File browser + preview panel side-by-side */}
      <InlineErrorBoundary
        title="Unable to display file browser"
        resetKeys={[files.length]}
        onReset={handleRefetchFiles}
      >
        <div
          ref={containerRef}
          className="flex min-h-0 flex-1 overflow-hidden"
        >
          {/* File browser — shrinks to give space to preview panel */}
          <div className="min-w-0 flex-1 overflow-hidden">{fileTableContent}</div>

          {/* Drag handle + preview panel — only mounted when a file is selected */}
          {panelOpen && (
            <>
              {/* Thin drag separator — 1px visual, full-height hit area */}
              <div
                {...bindResizeHandle()}
                className={cn(
                  "group relative h-full w-px shrink-0 cursor-ew-resize touch-none transition-colors",
                  isDragging ? "bg-blue-500" : "bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600",
                )}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panel"
                aria-valuenow={panelWidth}
              />
              <aside
                className="flex shrink-0 flex-col overflow-hidden"
                style={{ width: `${panelWidth}%`, ...dragStyles }}
                aria-label={selectedFile ? `File preview: ${selectedFile}` : undefined}
              >
                {selectedFileData && (
                  <FilePreviewPanel
                    file={selectedFileData}
                    path={path}
                    onClose={clearSelection}
                  />
                )}
              </aside>
            </>
          )}
        </div>
      </InlineErrorBoundary>
    </div>
  );
}
