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
 * DatasetRightPanel — Right panel for the dataset detail page.
 *
 * Two content modes, animated with CSS translateX transitions:
 *
 * Details mode (showDetails=true):
 *   Header: optional back "<" button + dataset name + type badge + close X
 *   Body:   DatasetDetailsPanel (Overview + Versions/Members tabs)
 *
 * File preview mode (showDetails=false):
 *   Body:   FilePreviewPanel (has its own header with copy path + close X)
 *
 * Back button ("<") is shown only in "details-over-file" mode, allowing
 * the user to return to the file preview they were viewing before.
 */

"use client";

import { memo } from "react";
import { ChevronLeft, X } from "lucide-react";
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
  /** Whether the details layer is active (vs file preview layer) */
  showDetails: boolean;
  /** Whether to show the back "<" button in the details header (details-over-file mode) */
  showBack: boolean;
  /** The currently selected file (used in file preview mode) */
  selectedFile: DatasetFile | null;
  /** Current directory path (passed to FilePreviewPanel) */
  path: string;
  /** Called when the "<" back button is clicked — returns to file preview */
  onBack: () => void;
  /** Called when the X button is clicked — closes the panel */
  onClose: () => void;
}

export const DatasetRightPanel = memo(function DatasetRightPanel({
  bucket,
  name,
  datasetType,
  showDetails,
  showBack,
  selectedFile,
  path,
  onBack,
  onClose,
}: Props) {
  const badge = datasetType === DatasetType.COLLECTION ? "Collection" : "Dataset";

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white dark:bg-zinc-900">
      {/* Details layer */}
      <div
        className="absolute inset-0 flex flex-col transition-transform duration-200 ease-in-out"
        style={{ transform: showDetails ? "translateX(0)" : "translateX(-100%)" }}
        aria-hidden={!showDetails}
      >
        <PanelHeaderContainer>
          <div className="flex items-center gap-1.5">
            {/* Back button — only in details-over-file mode */}
            {showBack && (
              <button
                type="button"
                onClick={onBack}
                className="flex shrink-0 items-center justify-center rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                aria-label="Back to file preview"
              >
                <ChevronLeft
                  className="size-3 shrink-0"
                  aria-hidden="true"
                />
              </button>
            )}

            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <PanelTitle className="text-sm font-medium">{name}</PanelTitle>
            </div>

            <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tracking-wide text-zinc-500 uppercase ring-1 ring-zinc-300 ring-inset dark:text-zinc-400 dark:ring-zinc-600">
              {badge}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              aria-label="Close panel"
            >
              <X
                className="size-3 shrink-0"
                aria-hidden="true"
              />
            </button>
          </div>
        </PanelHeaderContainer>

        <div className="min-h-0 flex-1 overflow-hidden">
          <DatasetDetailsPanel
            bucket={bucket}
            name={name}
          />
        </div>
      </div>

      {/* File preview layer */}
      <div
        className="absolute inset-0 flex flex-col transition-transform duration-200 ease-in-out"
        style={{ transform: showDetails ? "translateX(100%)" : "translateX(0)" }}
        aria-hidden={showDetails}
      >
        {selectedFile && (
          <FilePreviewPanel
            file={selectedFile}
            path={path}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
});
