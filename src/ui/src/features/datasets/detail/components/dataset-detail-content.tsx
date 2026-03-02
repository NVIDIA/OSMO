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
 * Side-by-side layout: file browser (left, flex-1) + toggleable right panel.
 *
 * Panel state machine (no useEffect — transitions only from explicit user actions):
 *
 *   closed ──[click file]──────────────► file
 *   closed ──[click Details]───────────► details
 *   file ────[click file]──────────────► file (update preview)
 *   file ────[click Details]───────────► details-over-file (back button available)
 *   file ────[X / Esc]─────────────────► closed
 *   details ─[click file]──────────────► file
 *   details ─[click Details / X / Esc]─► closed
 *   details-over-file ─[click file]────► file
 *   details-over-file ─[back "<"]──────► file (same file as before)
 *   details-over-file ─[Details/X/Esc]─► closed
 *
 * URL state: ?path= (current dir), ?version= (dataset version), ?file= (selected file)
 */

"use client";

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { usePrevious } from "@react-hookz/web";
import { usePage } from "@/components/chrome/page-context";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { Button } from "@/components/shadcn/button";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useResizeDrag } from "@/components/panel/hooks/use-resize-drag";
import { usePanelAnimation } from "@/components/panel/hooks/use-panel-animation";
import { FileBrowserBreadcrumb } from "@/features/datasets/detail/components/file-browser-breadcrumb";
import { FileBrowserControlStrip } from "@/features/datasets/detail/components/file-browser-control-strip";
import { FileBrowserTable } from "@/features/datasets/detail/components/file-browser-table";
import { DatasetRightPanel } from "@/features/datasets/detail/components/dataset-right-panel";
import { useDatasetDetail } from "@/features/datasets/detail/hooks/use-dataset-detail";
import { useFileBrowserState } from "@/features/datasets/detail/hooks/use-file-browser-state";
import { useDatasetFiles } from "@/lib/api/adapter/datasets-hooks";
import { buildDirectoryListing } from "@/lib/api/adapter/datasets";
import { DatasetType } from "@/lib/api/generated";
import type { SwitcherItem } from "@/features/datasets/detail/components/version-switcher";
import type { DatasetFile } from "@/lib/api/adapter/datasets";
import "@/components/panel/resizable-panel.css";

// =============================================================================
// Panel mode — single source of truth for right panel state
// =============================================================================

type PanelMode =
  | "closed" // panel hidden
  | "file" // file preview visible
  | "details" // dataset details visible (no file context)
  | "details-over-file"; // details visible, back button returns to file preview

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
  // Panel mode — all transitions happen in explicit user-action handlers.
  // ==========================================================================

  const [panelMode, setPanelMode] = useState<PanelMode>("closed");

  // Click a file row → open file preview (or replace current preview)
  const handleSelectFile = useCallback(
    (filePath: string) => {
      selectFile(filePath);
      setPanelMode("file");
    },
    [selectFile],
  );

  // Details button in control strip — toggles details layer
  const handleDetailsToggle = useCallback(() => {
    if (panelMode === "closed") {
      setPanelMode("details");
    } else if (panelMode === "file") {
      setPanelMode("details-over-file");
    } else if (panelMode === "details-over-file") {
      // Can go back to file preview — do that instead of closing
      setPanelMode("file");
    } else {
      // "details" with no file underneath → close (clearSelection deferred via animation onClosed)
      setPanelMode("closed");
    }
  }, [panelMode]);

  // Back button ("<") in the details header — returns to the file that was open
  const handleBack = useCallback(() => {
    setPanelMode("file");
  }, []);

  // Close panel (X button, Esc, or table Esc on row)
  // clearSelection() is deferred to the animation onClosed callback so the file
  // preview stays visible inside the panel while it slides out.
  const handleClosePanel = useCallback(() => {
    setPanelMode("closed");
  }, []);

  // Global Esc — closes panel from any focus position
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || panelMode === "closed") return;
      handleClosePanel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelMode, handleClosePanel]);

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
  // File listing — fetch manifest for selected version/member
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
  //
  // First checks the current directory listing (fastest, has full metadata).
  // Falls back to a direct rawFiles manifest lookup so the panel stays visible
  // when the user navigates to a different folder while a file is selected.
  // ==========================================================================

  const panelFileData = useMemo((): DatasetFile | null => {
    if (!selectedFile) return null;
    const fileName = selectedFile.split("/").pop() ?? "";

    // Prefer current directory entry (has all derived fields)
    const fromDir = files.find((f) => f.name === fileName && f.type === "file");
    if (fromDir) return fromDir;

    // Fall back to full manifest so preview survives directory navigation
    const raw = rawFiles?.find((f) => f.relative_path === selectedFile);
    if (!raw) return null;
    return { name: fileName, type: "file", size: raw.size, checksum: raw.etag, url: raw.url, s3Path: raw.storage_path };
  }, [selectedFile, files, rawFiles]);

  // Derive the file's own directory from the URL param so the copy path
  // is always correct regardless of which directory is currently browsed.
  const fileDirPath = selectedFile ? selectedFile.split("/").slice(0, -1).join("/") : "";

  // ==========================================================================
  // Panel slide animation — drives mount lifecycle + translateX transitions.
  // clearSelection() is deferred to onClosed so the preview stays visible
  // inside the panel while it slides out.
  // ==========================================================================

  const panelOpen = panelMode !== "closed";
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
  } = usePanelAnimation(panelOpen, clearSelection);

  const prevPhase = usePrevious(phase);

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
      // Aside is already position:absolute in this render (frees flex space so the
      // table has already expanded). Now wire up the CSS transition: reset React's
      // translateX(100%) back to 0, force a reflow to register that as the start
      // position, then set 100% so the CSS transition fires 0 → 100%.
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

  const { isDragging, bindResizeHandle } = useResizeDrag({
    width: rightPanelWidth,
    onWidthChange: setRightPanelWidth,
    minWidth: 20,
    maxWidth: 70,
    containerRef,
  });

  // ==========================================================================
  // Chrome: static breadcrumbs (Datasets > bucket > name)
  // Path segments live in the control strip breadcrumb below.
  // ==========================================================================

  usePage({
    title: "",
    breadcrumbs: [
      { label: "Datasets", href: "/datasets" },
      { label: bucket, href: `/datasets?f=bucket:${encodeURIComponent(bucket)}` },
      { label: name, href: null },
    ],
  });

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
      onClearSelection={handleClosePanel}
      previewOpen={panelMode === "file"}
      isLoading={isFilesLoading && !virtualFiles}
    />
  );

  const showDetails = panelMode === "details" || panelMode === "details-over-file";

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
      {/* Control strip */}
      <FileBrowserControlStrip
        items={switcherItems}
        selectedId={version}
        onSelectionChange={setVersion}
        breadcrumb={breadcrumbTrail}
        panelVisible={showDetails}
        onTogglePanel={handleDetailsToggle}
      />

      {/* File browser + optional right panel */}
      <InlineErrorBoundary
        title="Unable to display file browser"
        resetKeys={[files.length]}
        onReset={() => void refetchFiles()}
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

              {/* Right panel — slides in/out via translateX */}
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
                  willChange: shellMounted ? "transform" : "auto",
                  // On close, switch to absolute so the aside leaves flex flow and
                  // the table expands immediately — same frame the slide starts.
                  // The outer container has position:relative as the anchor.
                  ...(!panelSlideIn && { position: "absolute", right: 0, top: 0, bottom: 0 }),
                }}
                aria-label={
                  showDetails ? `Dataset details: ${name}` : selectedFile ? `File preview: ${selectedFile}` : undefined
                }
                onTransitionEnd={handlePanelTransitionEnd}
              >
                {contentMounted && (
                  <div
                    ref={contentRef}
                    className="resizable-panel-content flex h-full w-full flex-col overflow-hidden"
                    data-content-state={contentState}
                    onAnimationEnd={handleContentAnimationEnd}
                  >
                    <DatasetRightPanel
                      bucket={bucket}
                      name={name}
                      datasetType={detail.type}
                      showDetails={showDetails}
                      showBack={panelMode === "details-over-file"}
                      selectedFile={panelFileData}
                      path={fileDirPath}
                      onBack={handleBack}
                      onClose={handleClosePanel}
                    />
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
