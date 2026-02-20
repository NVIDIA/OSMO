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
 * VersionSwitcher — Dropdown to switch between dataset versions.
 *
 * Shows version number + created_by + created_at per option.
 * Left/right chevron buttons to step one version at a time.
 * Calls setVersion() from useFileBrowserState on change (preserves ?path=).
 *
 * Uses SelectPrimitive.ItemText to scope only the version number to the
 * trigger display (via SelectValue), while the subtitle rows are rendered
 * outside ItemText so they appear only in the open dropdown.
 */

"use client";

import { memo, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, CheckIcon } from "lucide-react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/shadcn/select";
import { Button } from "@/components/shadcn/button";
import { formatDateTimeSuccinct } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import type { DatasetVersion } from "@/lib/api/adapter/datasets";

interface VersionSwitcherProps {
  versions: DatasetVersion[];
  /** Currently selected version string (e.g. "5"), null = latest */
  selectedVersion: string | null;
  /** Called with version string when user picks a different version */
  onVersionChange: (version: string) => void;
}

export const VersionSwitcher = memo(function VersionSwitcher({
  versions,
  selectedVersion,
  onVersionChange,
}: VersionSwitcherProps) {
  // Sorted ascending so index 0 = oldest, last = newest
  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => parseInt(a.version, 10) - parseInt(b.version, 10)),
    [versions],
  );

  const latestVersion = sortedVersions[sortedVersions.length - 1];
  const effectiveVersion = selectedVersion ?? latestVersion?.version ?? "";
  const currentIndex = sortedVersions.findIndex((v) => v.version === effectiveVersion);

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < sortedVersions.length - 1;

  const handlePrev = useCallback(() => {
    if (canGoPrev) onVersionChange(sortedVersions[currentIndex - 1].version);
  }, [canGoPrev, currentIndex, onVersionChange, sortedVersions]);

  const handleGoNext = useCallback(() => {
    if (canGoNext) onVersionChange(sortedVersions[currentIndex + 1].version);
  }, [canGoNext, currentIndex, onVersionChange, sortedVersions]);

  if (versions.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={handlePrev}
        disabled={!canGoPrev}
        aria-label="Previous version"
      >
        <ChevronLeft
          className="size-3.5"
          aria-hidden="true"
        />
      </Button>

      <Select
        value={effectiveVersion}
        onValueChange={onVersionChange}
      >
        {/* SelectValue is required by Radix for trigger to open the popover.
            It reflects the content of the selected item's SelectPrimitive.ItemText,
            which we scope to just the version number (below). */}
        <SelectTrigger
          className="h-7 w-auto gap-1.5 border-zinc-200 bg-white px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          aria-label="Select dataset version"
        >
          <span className="text-zinc-500 dark:text-zinc-400">v</span>
          <SelectValue />
        </SelectTrigger>

        <SelectContent
          position="popper"
          align="end"
          sideOffset={4}
        >
          {[...sortedVersions].reverse().map((v) => {
            const isLatest = v.version === latestVersion.version;
            return (
              // Use Radix primitive directly so we can put only the version number
              // inside ItemText. The subtitle spans are siblings of ItemText and
              // therefore do NOT appear in the SelectValue trigger display.
              <SelectPrimitive.Item
                key={v.version}
                value={v.version}
                className={cn(
                  "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default flex-col gap-0.5 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                )}
              >
                <span className="absolute top-2 right-2 flex size-3.5 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <CheckIcon className="size-3.5" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <span className="flex items-center gap-1 text-xs font-medium">
                  <span className="text-zinc-500 dark:text-zinc-400">v</span>
                  {/* Only the version number is scoped to ItemText —
                      this is the only part that appears in SelectValue */}
                  <SelectPrimitive.ItemText>{v.version}</SelectPrimitive.ItemText>
                  {isLatest && <span className="font-normal text-zinc-400 dark:text-zinc-500">(latest)</span>}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {v.created_by} · {formatDateTimeSuccinct(v.created_date)}
                </span>
              </SelectPrimitive.Item>
            );
          })}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={handleGoNext}
        disabled={!canGoNext}
        aria-label="Next version"
      >
        <ChevronRight
          className="size-3.5"
          aria-hidden="true"
        />
      </Button>
    </div>
  );
});
