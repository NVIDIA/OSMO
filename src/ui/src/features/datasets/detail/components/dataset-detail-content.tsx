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
 * Side-by-side layout: file browser (left, flex-1) + always-visible right panel.
 *
 * Right panel modes:
 * - Details mode (default): DatasetDetailsPanel with Overview + Versions/Members tabs
 * - File preview mode: FilePreviewPanel shown when a file is selected in the browser
 *
 * URL state: ?path= (current directory), ?version= (dataset version), ?file= (selected file)
 */

"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { usePage } from "@/components/chrome/page-context";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { Button } from "@/components/shadcn/button";
import { cn } from "@/lib/utils";
import { useResizeDrag } from "@/components/panel/hooks/use-resize-drag";
import { FileBrowserBreadcrumb } from "@/features/datasets/detail/components/file-browser-breadcrumb";
import { FileBrowserControls } from "@/features/datasets/detail/components/file-browser-controls";
import { FileBrowserTable } from "@/features/datasets/detail/components/file-browser-table";
import { DatasetRightPanel } from "@/features/datasets/detail/components/dataset-right-panel";
import { useDatasetDetail } from "@/features/datasets/detail/hooks/use-dataset-detail";
import { useFileBrowserState } from "@/features/datasets/detail/hooks/use-file-browser-state";
import { useDatasetFiles } from "@/lib/api/adapter/datasets-hooks";
import { buildDirectoryListing } from "@/lib/api/adapter/datasets";
import { DatasetType } from "@/lib/api/generated";
import type { SwitcherItem } from "@/features/datasets/detail/components/version-switcher";
import type { DatasetFile } from "@/lib/api/adapter/datasets";

interface Props {
  bucket: string;
  name: string;
}

export function DatasetDetailContent({ bucket, name }: Props) {
  // ==========================================================================
  // Dataset/collection metadata
  // ==========================================================================

  const { detail, error: datasetError, refetch: refetchDataset } = useDatasetDetail(bucket, name);

  // ==========================================================================
  // URL state: path, version (datasets only), selected file
  // ==========================================================================

  const { path, version, selectedFile, navigateTo, setVersion, selectFile, clearSelection } = useFileBrowserState();

  // ==========================================================================
  // Right panel mode — details (default) or file preview
  // No useEffect: transitions happen only in response to explicit user actions.
  // ==========================================================================

  const [showDetails, setShowDetails] = useState(true);

  const handleSelectFile = useCallback(
    (filePath: string) => {
      selectFile(filePath);
      setShowDetails(false);
    },
    [selectFile],
  );

  const handleShowDetails = useCallback(() => {
    setShowDetails(true);
  }, []);

  const handleClosePreview = useCallback(() => {
    clearSelection();
    setShowDetails(true);
  }, [clearSelection]);

  // ==========================================================================
  // Resolve location + files based on type
  // ==========================================================================

  const {
    switcherItems,
    location,
    files: virtualFiles,
    memberSubPath,
    segmentLabels,
  } = useMemo(() => {
    if (!detail) {
      return {
        switcherItems: [] as SwitcherItem[],
        location: null as string | null,
        files: null as DatasetFile[] | null,
        memberSubPath: "",
        segmentLabels: {} as Record<string, string>,
      };
    }

    if (detail.type === DatasetType.DATASET) {
      const sorted = [...detail.versions].sort((a, b) => parseInt(a.version, 10) - parseInt(b.version, 10));
      const latestVersion = sorted.at(-1) ?? null;
      const items: SwitcherItem[] = sorted.map((v) => ({
        id: v.version,
        label: `v${v.version}`,
        isLatest: v.version === latestVersion?.version,
      }));
      const currentVersionData = (version ? sorted.find((v) => v.version === version) : null) ?? latestVersion;
      return {
        switcherItems: items,
        location: currentVersionData?.location ?? null,
        files: null,
        memberSubPath: path,
        segmentLabels: {},
      };
    }

    // COLLECTION
    // Build segment label map: memberId → "name v{version}"
    const labels: Record<string, string> = {};
    for (const m of detail.members) {
      labels[m.id] = `${m.name} v${m.version}`;
    }

    if (!path) {
      // Collection root: show member datasets as virtual top-level entries
      const memberEntries: DatasetFile[] = detail.members.map((m) => ({
        name: m.id,
        type: "dataset-member" as const,
        label: `${m.name} v${m.version}`,
        size: m.size,
      }));
      return {
        switcherItems: [] as SwitcherItem[],
        location: null,
        files: memberEntries,
        memberSubPath: "",
        segmentLabels: labels,
      };
    }

    // Inside a collection member: first path segment = member ID
    const memberId = path.split("/")[0];
    const member = detail.members.find((m) => m.id === memberId) ?? null;
    const subPath = path.split("/").slice(1).join("/");
    return {
      switcherItems: [] as SwitcherItem[],
      location: member?.location ?? null,
      files: null,
      memberSubPath: subPath,
      segmentLabels: labels,
    };
  }, [detail, version, path]);

  // ==========================================================================
  // File listing — fetch manifest for selected version/member, filter client-side
  // ==========================================================================

  const {
    data: rawFiles,
    isLoading: isFilesLoading,
    error: filesError,
    refetch: refetchFiles,
  } = useDatasetFiles(location);

  // Build directory listing for the current path
  const files = useMemo(
    () => virtualFiles ?? buildDirectoryListing(rawFiles ?? [], memberSubPath),
    [virtualFiles, rawFiles, memberSubPath],
  );

  // ==========================================================================
  // Resolve selected file data for the right panel
  // ==========================================================================

  const selectedFileData = useMemo(() => {
    if (!selectedFile) return null;
    const fileName = selectedFile.split("/").pop() ?? "";
    return files.find((f) => f.name === fileName && f.type === "file") ?? null;
  }, [selectedFile, files]);

  // ==========================================================================
  // Resizable split between file browser and right panel
  // ==========================================================================

  const containerRef = useRef<HTMLDivElement>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(35);

  const { isDragging, bindResizeHandle, dragStyles } = useResizeDrag({
    width: rightPanelWidth,
    onWidthChange: setRightPanelWidth,
    minWidth: 20,
    maxWidth: 70,
    containerRef,
  });

  // ==========================================================================
  // Chrome: breadcrumbs + version switcher controls
  // ==========================================================================

  // For collections, don't pass rawFiles to breadcrumb (disables sibling popovers
  // which don't make sense for member-level segments)
  const breadcrumbRawFiles = detail?.type === DatasetType.COLLECTION ? undefined : (rawFiles ?? undefined);

  const breadcrumbTrail = useMemo(
    () => (
      <FileBrowserBreadcrumb
        datasetName={name}
        path={path}
        onNavigate={navigateTo}
        rawFiles={breadcrumbRawFiles}
        segmentLabels={Object.keys(segmentLabels).length > 0 ? segmentLabels : undefined}
      />
    ),
    [name, path, navigateTo, breadcrumbRawFiles, segmentLabels],
  );

  const headerControls = useMemo(
    () => (
      <FileBrowserControls
        items={switcherItems}
        selectedId={version}
        onSelectionChange={setVersion}
      />
    ),
    [switcherItems, version, setVersion],
  );

  usePage({
    title: "",
    breadcrumbs: [
      { label: "Datasets", href: "/datasets" },
      { label: bucket, href: `/datasets?f=bucket:${encodeURIComponent(bucket)}` },
    ],
    trailingBreadcrumbs: breadcrumbTrail,
    headerActions: headerControls,
  });

  // ==========================================================================
  // Error state — dataset/collection failed to load
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

  if (!detail) {
    return null; // Loading state handled by skeleton
  }

  // ==========================================================================
  // File listing content — handles query error inline
  // ==========================================================================

  const handleNavigateUp = () => {
    if (!path) return;
    navigateTo(path.split("/").slice(0, -1).join("/"));
  };

  const fileTableContent = filesError ? (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Failed to load files.</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void refetchFiles()}
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
      onSelectFile={handleSelectFile}
      onNavigateUp={handleNavigateUp}
      onClearSelection={handleClosePreview}
      previewOpen={!showDetails}
      isLoading={isFilesLoading && !virtualFiles}
    />
  );

  // ==========================================================================
  // Render — side-by-side: file browser + always-visible right panel
  // ==========================================================================

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <InlineErrorBoundary
        title="Unable to display file browser"
        resetKeys={[files.length]}
        onReset={() => void refetchFiles()}
      >
        <div
          ref={containerRef}
          className="flex min-h-0 flex-1 overflow-hidden"
        >
          {/* File browser — fills remaining width */}
          <div className="min-w-0 flex-1 overflow-hidden">{fileTableContent}</div>

          {/* Resize handle */}
          <div
            {...bindResizeHandle()}
            className={cn(
              "group relative h-full w-px shrink-0 cursor-ew-resize touch-none transition-colors",
              isDragging ? "bg-blue-500" : "bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600",
            )}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            aria-valuenow={rightPanelWidth}
          />

          {/* Always-visible right panel */}
          <aside
            className="flex shrink-0 flex-col overflow-hidden"
            style={{ width: `${rightPanelWidth}%`, ...dragStyles }}
            aria-label={
              showDetails ? `Dataset details: ${name}` : selectedFile ? `File preview: ${selectedFile}` : undefined
            }
          >
            <DatasetRightPanel
              bucket={bucket}
              name={name}
              datasetType={detail.type}
              showDetails={showDetails}
              selectedFile={selectedFileData}
              path={path}
              onShowDetails={handleShowDetails}
              onClosePreview={handleClosePreview}
            />
          </aside>
        </div>
      </InlineErrorBoundary>
    </div>
  );
}
