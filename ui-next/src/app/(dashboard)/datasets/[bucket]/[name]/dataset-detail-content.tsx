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

import { useState, useMemo, useCallback } from "react";
import { usePage } from "@/components/chrome/page-context";
import { Button } from "@/components/shadcn/button";
import { ResizablePanel } from "@/components/panel/resizable-panel";
import { PANEL } from "@/components/panel/panel-header-controls";
import { usePanelLifecycle } from "@/hooks/use-panel-lifecycle";
import { FileBrowserHeader } from "@/app/(dashboard)/datasets/[bucket]/[name]/components/FileBrowserHeader";
import { FileBrowserTable } from "@/app/(dashboard)/datasets/[bucket]/[name]/components/FileBrowserTable";
import { FilePreviewPanel } from "@/app/(dashboard)/datasets/[bucket]/[name]/components/FilePreviewPanel";
import { useDatasetDetail } from "@/app/(dashboard)/datasets/[bucket]/[name]/hooks/use-dataset-detail";
import { useFileBrowserState } from "@/app/(dashboard)/datasets/[bucket]/[name]/hooks/use-file-browser-state";
import { useDatasetFiles } from "@/lib/api/adapter/datasets-hooks";

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
  // File listing — updates when path or version changes
  // ==========================================================================

  const {
    data: filesData,
    isLoading: isFilesLoading,
    error: filesError,
    refetch: refetchFiles,
  } = useDatasetFiles(bucket, name, path, version ?? undefined);

  const files = useMemo(() => filesData?.files ?? [], [filesData]);

  // ==========================================================================
  // Panel state — ResizablePanel lifecycle + width
  // ==========================================================================

  const [panelWidth, setPanelWidth] = useState(35);

  const {
    isPanelOpen,
    handleClose: handleClosePanel,
    handleClosed: handlePanelClosed,
  } = usePanelLifecycle({
    hasSelection: !!selectedFile,
    onClosed: clearSelection,
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
      <FileBrowserHeader
        datasetName={name}
        path={path}
        versions={versions}
        selectedVersion={version}
        onNavigate={navigateTo}
        onVersionChange={setVersion}
      />

      {/* File browser + file preview panel */}
      <div className="min-h-0 flex-1">
        <ResizablePanel
          open={isPanelOpen}
          onClose={handleClosePanel}
          onClosed={handlePanelClosed}
          width={panelWidth}
          onWidthChange={setPanelWidth}
          minWidth={PANEL.MIN_WIDTH_PCT}
          maxWidth={PANEL.OVERLAY_MAX_WIDTH_PCT}
          mainContent={fileTableContent}
          aria-label={selectedFile ? `File preview: ${selectedFile}` : undefined}
        >
          {selectedFileData && (
            <FilePreviewPanel
              file={selectedFileData}
              path={path}
              onClose={handleClosePanel}
            />
          )}
        </ResizablePanel>
      </div>
    </div>
  );
}
