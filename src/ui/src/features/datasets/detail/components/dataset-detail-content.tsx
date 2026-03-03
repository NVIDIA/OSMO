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
 * Side-by-side layout: file browser (left, flex-1) + toggleable file preview panel (right).
 * Dataset details open in the layout-level overlay panel (DatasetsPanelLayout).
 *
 * File preview panel state:
 *   closed ──[click file]──► open (file preview)
 *   open ────[click file]──► open (update preview)
 *   open ────[X / Esc]─────► closed
 *
 * URL state: ?path= (current dir), ?version= (dataset version), ?file= (selected file)
 */

"use client";

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { usePrevious } from "@react-hookz/web";
import type { SearchChip } from "@/components/filter-bar/lib/types";
import { usePage } from "@/components/chrome/page-context";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { Button } from "@/components/shadcn/button";
import { GripVertical } from "lucide-react";
import { cn, naturalCompare } from "@/lib/utils";
import { useResizeDrag } from "@/components/panel/hooks/use-resize-drag";
import { usePanelAnimation } from "@/components/panel/hooks/use-panel-animation";
import { FileBrowserBreadcrumb } from "@/features/datasets/detail/components/file-browser-breadcrumb";
import { FileBrowserControlStrip } from "@/features/datasets/detail/components/file-browser-control-strip";
import { FileBrowserTable } from "@/features/datasets/detail/components/file-browser-table";
import { FilePreviewPanel } from "@/features/datasets/detail/components/file-preview-panel";
import { useDatasetsPanelContext } from "@/features/datasets/layout/datasets-panel-context";
import { useFileBrowserState } from "@/features/datasets/detail/hooks/use-file-browser-state";
import { useDataset, useDatasetFiles } from "@/lib/api/adapter/datasets-hooks";
import { buildDirectoryListing, binarySearchByPath } from "@/lib/api/adapter/datasets";
import { searchManifest, searchByExtension } from "@/lib/api/adapter/dataset-search";
import { DatasetType } from "@/lib/api/generated";
import type { DatasetFile } from "@/lib/api/adapter/datasets";
import "@/components/panel/resizable-panel.css";

interface Props {
  bucket: string;
  name: string;
}

export function DatasetDetailContent({ bucket, name }: Props) {
  // ==========================================================================
  // Dataset/collection metadata
  // ==========================================================================

  const { data: detail, error: datasetError, refetch: refetchDataset } = useDataset(bucket, name);

  // ==========================================================================
  // URL state: path, version (datasets only), selected file
  // ==========================================================================

  const { path, version, selectedFile, navigateTo, setVersion, selectFile, clearSelection } = useFileBrowserState();

  // ==========================================================================
  // File filter state — chip-based (no debounce needed; chips commit on Enter)
  // ==========================================================================

  const [filterChips, setFilterChips] = useState<SearchChip[]>([]);

  // Reset filter when the user navigates to a different directory or version.
  // Uses the same usePrevious pattern as previewPanelOpen sync above (derived-state
  // during render) to avoid calling setState inside a useEffect body.
  const prevFilterPath = usePrevious(path);
  const prevFilterVersion = usePrevious(version);
  if (prevFilterPath !== undefined && (prevFilterPath !== path || prevFilterVersion !== version)) {
    if (filterChips.length > 0) setFilterChips([]);
  }

  // ==========================================================================
  // File preview panel state
  // ==========================================================================

  // Lazy init: if the URL already has file= on mount (e.g. shared link), open immediately.
  const [previewPanelOpen, setPreviewPanelOpen] = useState(() => selectedFile !== null);

  // Derived-state sync: keep previewPanelOpen in sync when file= URL param changes externally
  // (browser back/forward, shared link, <Link> navigation).
  const prevSelectedFile = usePrevious(selectedFile);
  // file= cleared → close preview
  if (prevSelectedFile != null && selectedFile === null && previewPanelOpen) {
    setPreviewPanelOpen(false);
  }
  // file= added while preview closed → open
  if (prevSelectedFile === null && selectedFile !== null && !previewPanelOpen) {
    setPreviewPanelOpen(true);
  }

  // Click a file row → open file preview (or replace current preview)
  const handleSelectFile = useCallback(
    (filePath: string) => {
      selectFile(filePath);
      setPreviewPanelOpen(true);
    },
    [selectFile],
  );

  // Close preview panel (X button, Esc)
  // clearSelection() is deferred to the animation onClosed callback so the file
  // preview stays visible inside the panel while it slides out.
  const handleClosePanel = useCallback(() => {
    setPreviewPanelOpen(false);
  }, []);

  // ==========================================================================
  // Details overlay panel — controlled by the layout-level DatasetsPanelLayout
  // ==========================================================================

  const { isPanelOpen, openPanel, closePanel } = useDatasetsPanelContext();

  // Priority-ordered Esc: details panel closes first, file preview closes second.
  // Used by both the global keydown listener and FileBrowserTable's Esc shortcut.
  const handleEscapeKey = useCallback(() => {
    if (isPanelOpen) {
      closePanel();
    } else if (previewPanelOpen) {
      handleClosePanel();
    }
  }, [isPanelOpen, closePanel, previewPanelOpen, handleClosePanel]);

  // Global Esc — fires from any focus position
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (!isPanelOpen && !previewPanelOpen) return;
      handleEscapeKey();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isPanelOpen, previewPanelOpen, handleEscapeKey]);

  const handleDetailsToggle = useCallback(() => {
    if (isPanelOpen) {
      closePanel();
    } else {
      openPanel(bucket, name, version ?? null);
    }
  }, [isPanelOpen, openPanel, closePanel, bucket, name, version]);

  const handleViewAllVersions = useCallback(() => {
    // Defer to a microtask so the Popover-close render (setOpen(false)) commits first.
    // Without this, React batches both updates into one render; usePrevious(phase)
    // then returns "closing" instead of "closed", which bypasses ResizablePanel's
    // useLayoutEffect reflow trick and causes the panel to appear without its slide-in.
    queueMicrotask(() => openPanel(bucket, name, version ?? null));
  }, [openPanel, bucket, name, version]);

  const handleNavigateUp = useCallback(() => {
    if (!path) return;
    navigateTo(path.split("/").slice(0, -1).join("/"));
  }, [path, navigateTo]);

  // ==========================================================================
  // Resolve location + files based on type
  // ==========================================================================

  const {
    versions,
    location,
    files: virtualFiles,
    memberSubPath,
    segmentLabels,
  } = useMemo(() => {
    if (!detail) {
      return {
        versions: [],
        location: null as string | null,
        files: null as DatasetFile[] | null,
        memberSubPath: "",
        segmentLabels: {} as Record<string, string>,
      };
    }

    if (detail.type === DatasetType.DATASET) {
      const sorted = [...detail.versions].sort((a, b) => naturalCompare(a.version, b.version));
      const latestVersion = sorted.at(-1) ?? null;
      const currentVersionData = (version ? sorted.find((v) => v.version === version) : null) ?? latestVersion;
      return {
        versions: detail.versions,
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
        versions: [],
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
      versions: [],
      location: member?.location ?? null,
      files: null,
      memberSubPath: subPath,
      segmentLabels: labels,
    };
  }, [detail, version, path]);

  // ==========================================================================
  // File listing — fetch manifest for selected version/member
  // ==========================================================================

  const {
    data: manifest,
    isLoading: isFilesLoading,
    error: filesError,
    refetch: refetchFiles,
  } = useDatasetFiles(location);

  // Normal (unfiltered) directory listing — used for FilterBar suggestions and as base view
  const normalFiles = useMemo(
    () => virtualFiles ?? buildDirectoryListing(manifest?.byPath ?? [], memberSubPath),
    [virtualFiles, manifest, memberSubPath],
  );

  // Apply filter chips to produce the displayed file list.
  // "search:" chip → recursive prefix search; "type:" chip → recursive extension filter.
  // When both are present, apply extension filter as an AND on the prefix search results.
  const { filteredFiles } = useMemo(() => {
    const searchChip = filterChips.find((c) => c.field === "file");
    const typeChip = filterChips.find((c) => c.field === "type");

    if (!searchChip && !typeChip) return { filteredFiles: normalFiles, capped: false };
    if (!manifest) return { filteredFiles: [] as DatasetFile[], capped: false };

    if (searchChip && typeChip) {
      // AND: prefix-search first, then filter results by extension
      const { files, capped: searchCapped } = searchManifest(manifest, memberSubPath, searchChip.value);
      const suffix = `.${typeChip.value.toLowerCase()}`;
      return { filteredFiles: files.filter((f) => f.name.toLowerCase().endsWith(suffix)), capped: searchCapped };
    }
    if (searchChip) {
      const { files, capped: searchCapped } = searchManifest(manifest, memberSubPath, searchChip.value);
      return { filteredFiles: files, capped: searchCapped };
    }
    // typeChip only
    const { files, capped: extCapped } = searchByExtension(manifest, memberSubPath, typeChip!.value);
    return { filteredFiles: files, capped: extCapped };
  }, [filterChips, manifest, normalFiles, memberSubPath]);

  const handleRetryFiles = useCallback(() => void refetchFiles(), [refetchFiles]);

  // ==========================================================================
  // Resolve selected file data for the right panel
  //
  // First checks the current file list (fastest, has full metadata).
  // Falls back to a direct manifest lookup so the panel stays visible
  // when the user navigates to a different folder while a file is selected.
  // ==========================================================================

  const panelFileData = useMemo((): DatasetFile | null => {
    if (!selectedFile) return null;
    const fileName = selectedFile.split("/").pop() ?? "";

    // Prefer current file list entry (has all derived fields)
    const fromDir = filteredFiles.find((f) => f.name === fileName && f.type === "file");
    if (fromDir) return fromDir;

    // Fall back to full manifest so preview survives directory navigation (binary search, O(log n))
    const idx = manifest ? binarySearchByPath(manifest.byPath, selectedFile) : -1;
    const raw = manifest?.byPath[idx]?.relative_path === selectedFile ? manifest.byPath[idx] : undefined;
    if (!raw) return null;
    return {
      name: fileName,
      type: "file",
      size: raw.size,
      checksum: raw.etag,
      url: raw.url,
      relativePath: raw.relative_path,
      storagePath: raw.storage_path,
    };
  }, [selectedFile, filteredFiles, manifest]);

  // Derive the file's own directory from the URL param so the copy path
  // is always correct regardless of which directory is currently browsed.
  const fileDirPath = selectedFile ? selectedFile.split("/").slice(0, -1).join("/") : "";

  // ==========================================================================
  // Panel slide animation — drives mount lifecycle + translateX transitions.
  // clearSelection() is deferred to onClosed so the preview stays visible
  // inside the panel while it slides out.
  // ==========================================================================

  const panelRef = useRef<HTMLDivElement>(null);

  const {
    phase,
    shellMounted,
    panelSlideIn,
    contentMounted,
    contentState,
    contentRef,
    handleContentAnimationEnd,
    handlePanelTransitionEnd,
  } = usePanelAnimation(previewPanelOpen, clearSelection);

  const prevPhase = usePrevious(phase);

  // When the panel finishes opening or closing, fire layout-stable callbacks so
  // the table recalculates column widths for its new size.
  useEffect(() => {
    if ((phase === "open" && prevPhase === "opening") || (phase === "closed" && prevPhase === "closing")) {
      for (const cb of layoutStableCallbacksRef.current) cb();
    }
  }, [phase, prevPhase]);

  // Both open and close use the same reflow trick so the CSS transition always
  // starts from the correct position (before browser paint, unlike useEffect).
  //
  // Open:  panel is flex child (table shrinks), set 100% → reflow → 0
  // Close: panel is absolute (table expands), reset 100% → 0 → reflow → 100%
  useLayoutEffect(() => {
    if (!panelRef.current) return;
    const panel = panelRef.current;

    if (phase === "opening" && prevPhase === "closed") {
      panel.style.transform = "translateX(100%)";
      void panel.offsetHeight;
      panel.style.transform = "translateX(0)";
    }

    if (phase === "closing" && prevPhase === "open") {
      panel.style.transform = "translateX(0)";
      void panel.offsetHeight;
      panel.style.transform = "translateX(100%)";
    }
  }, [phase, prevPhase]);

  // ==========================================================================
  // Resizable split between file browser and right panel
  // ==========================================================================

  const containerRef = useRef<HTMLDivElement>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(35);

  // Callbacks registered by the file browser table's column sizer.
  // Called when gutter drag ends so the table recalculates column widths at final size.
  const layoutStableCallbacksRef = useRef<Set<() => void>>(new Set());

  const registerLayoutStableCallback = useCallback((callback: () => void) => {
    layoutStableCallbacksRef.current.add(callback);
    return () => layoutStableCallbacksRef.current.delete(callback);
  }, []);

  const { isDragging, bindResizeHandle } = useResizeDrag({
    width: rightPanelWidth,
    onWidthChange: setRightPanelWidth,
    minWidth: 20,
    maxWidth: 70,
    containerRef,
    onDragEnd: () => {
      for (const cb of layoutStableCallbacksRef.current) cb();
    },
  });

  // ==========================================================================
  // Chrome: static breadcrumbs (Datasets > bucket > name)
  // Path segments live in the control strip breadcrumb below.
  // ==========================================================================

  usePage({
    title: name,
    breadcrumbs: [
      { label: "Datasets", href: "/datasets" },
      { label: bucket, href: `/datasets?f=bucket:${encodeURIComponent(bucket)}` },
    ],
  });

  // For collections, don't pass rawFiles to breadcrumb (disables sibling popovers
  // which don't make sense for member-level segments).
  // Collections also pin the first path segment (member dataset name) so it stays
  // visible even when deeper folders collapse into the ellipsis.
  const isCollection = detail?.type === DatasetType.COLLECTION;
  const breadcrumbRawFiles = isCollection ? undefined : (manifest?.byPath ?? undefined);
  const breadcrumbPinnedPrefixCount = isCollection ? 1 : 0;

  const breadcrumbTrail = useMemo(
    () => (
      <FileBrowserBreadcrumb
        datasetName={name}
        path={path}
        onNavigate={navigateTo}
        rawFiles={breadcrumbRawFiles}
        segmentLabels={Object.keys(segmentLabels).length > 0 ? segmentLabels : undefined}
        pinnedPrefixCount={breadcrumbPinnedPrefixCount}
      />
    ),
    [name, path, navigateTo, breadcrumbRawFiles, segmentLabels, breadcrumbPinnedPrefixCount],
  );

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

  // Filter input is shown for datasets and for collections when browsing inside a member.
  // Hidden on the collection root view (which shows virtual dataset-member entries, not real files).
  const showFilter = !isCollection || path !== "";

  // Show result count in FilterBar when filter is active
  const filterResultsCount = filterChips.length > 0 ? { total: filteredFiles.length } : undefined;

  const fileTableContent = (
    <FileBrowserTable
      files={filteredFiles}
      showLocation={filterChips.length > 0}
      path={path}
      selectedFile={selectedFile}
      onNavigate={navigateTo}
      onSelectFile={handleSelectFile}
      onNavigateUp={handleNavigateUp}
      onClearSelection={handleEscapeKey}
      isLoading={isFilesLoading && !virtualFiles}
      error={filesError}
      onRetry={handleRetryFiles}
      suspendResize={isDragging}
      registerLayoutStableCallback={registerLayoutStableCallback}
    />
  );

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
      {/* Control strip */}
      <FileBrowserControlStrip
        versions={versions}
        selectedId={version}
        onSelectionChange={setVersion}
        breadcrumb={breadcrumbTrail}
        panelVisible={isPanelOpen}
        onTogglePanel={handleDetailsToggle}
        onViewAllVersions={handleViewAllVersions}
        filterChips={filterChips}
        onFilterChipsChange={setFilterChips}
        fileTypes={manifest?.fileTypes ?? []}
        showFilter={showFilter}
        filterResultsCount={filterResultsCount}
      />

      {/* File browser + optional file preview panel */}
      <InlineErrorBoundary
        title="Unable to display file browser"
        resetKeys={[filteredFiles.length]}
        onReset={handleRetryFiles}
      >
        <div
          ref={containerRef}
          className="relative flex min-h-0 flex-1 overflow-hidden"
        >
          {/* File browser — fills remaining width */}
          <div className="min-w-0 flex-1 overflow-hidden">{fileTableContent}</div>

          {shellMounted && (
            <>
              {/* Resize gutter — hidden instantly on close (frees flex space for the table) */}
              <div
                {...bindResizeHandle()}
                className="group flex w-2 shrink-0 cursor-ew-resize touch-none items-center justify-center"
                style={{ display: panelSlideIn ? undefined : "none" }}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panel"
                aria-valuenow={rightPanelWidth}
              >
                <GripVertical
                  className={cn(
                    "size-4 transition-colors",
                    isDragging
                      ? "text-zinc-500 dark:text-zinc-400"
                      : "text-zinc-300 group-hover:text-zinc-500 dark:text-zinc-700 dark:group-hover:text-zinc-400",
                  )}
                  aria-hidden="true"
                />
              </div>

              {/* File preview panel — slides in/out via translateX */}
              <aside
                ref={panelRef}
                className={cn(
                  "flex shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800",
                  isDragging
                    ? "transition-none"
                    : "transition-transform duration-200 ease-out motion-reduce:transition-none",
                )}
                style={{
                  width: `${rightPanelWidth}%`,
                  transform: panelSlideIn ? "translateX(0)" : "translateX(100%)",
                  // Apply will-change only during the active animation; absent otherwise
                  // so the browser never holds a permanent GPU layer for this element.
                  ...(phase === "opening" || phase === "closing" ? { willChange: "transform" } : {}),
                  // On close, switch to absolute so the aside leaves flex flow and
                  // the table expands immediately — same frame the slide starts.
                  ...(!panelSlideIn && { position: "absolute", right: 0, top: 0, bottom: 0 }),
                }}
                aria-label={selectedFile ? `File preview: ${selectedFile}` : undefined}
                onTransitionEnd={handlePanelTransitionEnd}
              >
                {contentMounted && (
                  <div
                    ref={contentRef}
                    className="resizable-panel-content flex h-full w-full flex-col overflow-hidden"
                    data-content-state={contentState}
                    onAnimationEnd={handleContentAnimationEnd}
                  >
                    {panelFileData && (
                      <FilePreviewPanel
                        file={panelFileData}
                        path={fileDirPath}
                        onClose={handleClosePanel}
                      />
                    )}
                  </div>
                )}
              </aside>
            </>
          )}
        </div>
      </InlineErrorBoundary>
    </div>
  );
}
