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
 * DatasetRightPanel — Always-visible right panel for the dataset detail page.
 *
 * Two content modes, animated with CSS translateX transitions:
 *
 * Details mode (default):
 *   Header: dataset name + type badge
 *   Body:   DatasetDetailsPanel (Overview + Versions/Members tabs)
 *
 * File preview mode (after clicking a file in the browser):
 *   Body:   FilePreviewPanel (has its own header with "← Dataset Details" + copy path + close)
 *
 * Transitions: both content areas are absolutely positioned. The active area
 * slides in from the right; the inactive area slides out to the left.
 */

"use client";

import { memo } from "react";
import { PanelHeaderContainer } from "@/components/panel/panel-header-controls";
import { PanelTitle } from "@/components/panel/panel-header";
import { DatasetDetailsPanel } from "@/features/datasets/detail/components/dataset-details-panel";
import { FilePreviewPanel } from "@/features/datasets/detail/components/file-preview-panel";
import { DatasetType } from "@/lib/api/generated";
import type { DatasetFile } from "@/lib/api/adapter/datasets";

interface Props {
  bucket: string;
  name: string;
  /** Type of the dataset (DATASET or COLLECTION), undefined while loading */
  datasetType: (typeof DatasetType)[keyof typeof DatasetType] | undefined;
  /** Whether the right panel is in Details mode (true) or File preview mode (false) */
  showDetails: boolean;
  /** The currently selected file (used in file preview mode) */
  selectedFile: DatasetFile | null;
  /** Current directory path (passed to FilePreviewPanel) */
  path: string;
  /** Called when the user clicks "← Dataset Details" in the file preview header */
  onShowDetails: () => void;
  /** Called when the user closes the file preview (× button or panel close) */
  onClosePreview: () => void;
}

export const DatasetRightPanel = memo(function DatasetRightPanel({
  bucket,
  name,
  datasetType,
  showDetails,
  selectedFile,
  path,
  onShowDetails,
  onClosePreview,
}: Props) {
  const badge = datasetType === DatasetType.COLLECTION ? "Collection" : "Dataset";

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Details mode: header lives here */}
      <div
        className="absolute inset-0 flex flex-col transition-transform duration-200 ease-in-out"
        style={{ transform: showDetails ? "translateX(0)" : "translateX(-100%)" }}
        aria-hidden={!showDetails}
      >
        <PanelHeaderContainer>
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <PanelTitle>{name}</PanelTitle>
            </div>
            <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tracking-wide text-zinc-500 uppercase ring-1 ring-zinc-300 ring-inset dark:text-zinc-400 dark:ring-zinc-600">
              {badge}
            </span>
          </div>
        </PanelHeaderContainer>

        <div className="min-h-0 flex-1 overflow-hidden">
          <DatasetDetailsPanel
            bucket={bucket}
            name={name}
          />
        </div>
      </div>

      {/* File preview mode: FilePreviewPanel owns its own header */}
      <div
        className="absolute inset-0 flex flex-col transition-transform duration-200 ease-in-out"
        style={{ transform: showDetails ? "translateX(100%)" : "translateX(0)" }}
        aria-hidden={showDetails}
      >
        {selectedFile && (
          <FilePreviewPanel
            file={selectedFile}
            path={path}
            onClose={onClosePreview}
            onShowDetails={onShowDetails}
          />
        )}
      </div>
    </div>
  );
});
