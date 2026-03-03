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
 * FileBrowserControlStrip — Top control bar for the dataset detail page.
 *
 * Layout: [VersionPicker | separator | breadcrumb] · spacer · [FilterBar] [Details toggle]
 *
 * - VersionPicker + separator only rendered for datasets (versions.length > 0)
 * - FilterBar hidden when showFilter=false (collection root view)
 * - FilterBar offers free-text "file:" prefix search and "type:" extension filter
 * - Details button toggles the right panel visibility
 */

"use client";

import { memo, useMemo } from "react";
import { Info, ChevronRight } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { FilterBar } from "@/components/filter-bar/filter-bar";
import type { SearchChip, SearchField } from "@/components/filter-bar/lib/types";
import { VersionPicker } from "@/features/datasets/detail/components/version-picker";
import type { DatasetFile, DatasetVersion } from "@/lib/api/adapter/datasets";

// =============================================================================
// Props
// =============================================================================

interface FileBrowserControlStripProps {
  /** Dataset versions (empty for collections) */
  versions: DatasetVersion[];
  /** Currently selected version ID or tag name (null = latest) */
  selectedId: string | null;
  /** Called when version/tag selection changes (null = latest) */
  onSelectionChange: (id: string | null) => void;
  /** Breadcrumb trail rendered inline (FileBrowserBreadcrumb node) */
  breadcrumb: React.ReactNode;
  /** Whether the right panel is currently visible */
  panelVisible: boolean;
  /** Called to toggle the right panel */
  onTogglePanel: () => void;
  /** Called when "View all versions" is clicked in the version picker */
  onViewAllVersions?: () => void;
  /** Active filter chips */
  filterChips: SearchChip[];
  /** Called when filter chips change */
  onFilterChipsChange: (chips: SearchChip[]) => void;
  /**
   * File extensions available in this dataset (for "type:" suggestions).
   * From ProcessedManifest.fileTypes — lowercase, sorted, no dot prefix.
   */
  fileTypes: readonly string[];
  /** Whether to show the filter input (hidden on collection root view) */
  showFilter: boolean;
}

// Stable empty data array — FilterBar data prop is only used by sync field getValues,
// which we don't use here (type: field closes over fileTypes directly).
const EMPTY_DATA: DatasetFile[] = [];

// =============================================================================
// Component
// =============================================================================

export const FileBrowserControlStrip = memo(function FileBrowserControlStrip({
  versions,
  selectedId,
  onSelectionChange,
  breadcrumb,
  panelVisible,
  onTogglePanel,
  onViewAllVersions,
  filterChips,
  onFilterChipsChange,
  fileTypes,
  showFilter,
}: FileBrowserControlStripProps) {
  // Field definitions — type: field's getValues closes over fileTypes
  const fields = useMemo(
    (): readonly SearchField<DatasetFile>[] => [
      {
        id: "file",
        label: "File",
        prefix: "file:",
        singular: true,
        exhaustive: false,
        freeFormHint: "filename or path/with/slashes",
        getValues: () => [],
      },
      {
        id: "type",
        label: "Type",
        prefix: "type:",
        singular: true,
        exhaustive: true,
        getValues: () => [...fileTypes],
      },
    ],
    [fileTypes],
  );

  return (
    <div className="flex shrink-0 items-center gap-3">
      {/* Left group: optional version picker + separator + breadcrumb */}
      {versions.length > 0 && (
        <>
          <VersionPicker
            versions={versions}
            selectedId={selectedId}
            onSelectionChange={onSelectionChange}
            onViewAllVersions={onViewAllVersions}
          />
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600"
            aria-hidden="true"
          />
        </>
      )}

      {breadcrumb}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Filter bar — direct flex child so w-1/3 is relative to the strip width */}
      {showFilter && (
        <FilterBar
          data={EMPTY_DATA}
          fields={fields}
          chips={filterChips}
          onChipsChange={onFilterChipsChange}
          placeholder="Filter in current directory..."
          defaultField="file"
          className="w-[30%]"
        />
      )}

      {/* Details toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={panelVisible ? "secondary" : "ghost"}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onTogglePanel}
            aria-label={panelVisible ? "Hide details panel" : "Show details panel"}
            aria-pressed={panelVisible}
          >
            <Info
              className="size-3.5"
              aria-hidden="true"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Show details</TooltipContent>
      </Tooltip>
    </div>
  );
});
