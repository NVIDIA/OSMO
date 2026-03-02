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
 * Layout: [VersionSwitcher | breadcrumb] · spacer · [search] [Details toggle]
 *
 * - VersionSwitcher + separator only rendered when items.length > 0
 * - Search input is placeholder-only (disabled) — filter logic wired up later
 * - Details button toggles the right panel visibility
 */

"use client";

import { memo } from "react";
import { Info, Search } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { VersionSwitcher } from "@/features/datasets/detail/components/version-switcher";
import type { SwitcherItem } from "@/features/datasets/detail/components/version-switcher";

interface FileBrowserControlStripProps {
  /** Switcher items (versions for datasets, empty for collections) */
  items: SwitcherItem[];
  /** Currently selected item ID (null = latest) */
  selectedId: string | null;
  /** Called when version selection changes */
  onSelectionChange: (id: string) => void;
  /** Breadcrumb trail rendered inline (FileBrowserBreadcrumb node) */
  breadcrumb: React.ReactNode;
  /** Whether the right panel is currently visible */
  panelVisible: boolean;
  /** Called to toggle the right panel */
  onTogglePanel: () => void;
}

export const FileBrowserControlStrip = memo(function FileBrowserControlStrip({
  items,
  selectedId,
  onSelectionChange,
  breadcrumb,
  panelVisible,
  onTogglePanel,
}: FileBrowserControlStripProps) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {/* Left group: optional version switcher + separator + breadcrumb */}
      {items.length > 0 && (
        <>
          <VersionSwitcher
            items={items}
            selectedId={selectedId}
            onSelectionChange={onSelectionChange}
          />
          <span
            className="h-4 w-px shrink-0 bg-zinc-300 dark:bg-zinc-600"
            aria-hidden="true"
          />
        </>
      )}

      {breadcrumb}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right group: search + Details toggle */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search
            className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <Input
            disabled
            placeholder="Filter files..."
            className="h-7 w-48 pl-7 text-xs"
            aria-label="Filter files (coming soon)"
          />
        </div>

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
    </div>
  );
});
