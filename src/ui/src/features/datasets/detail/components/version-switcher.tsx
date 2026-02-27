// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * VersionNav — Compact prev/next version navigation for the file browser header.
 *
 * Shows: [<] v{current} [>]
 * Use the Details panel (DatasetPanel) to browse and select specific versions.
 */

"use client";

import { memo, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/shadcn/button";
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

      <span className="px-1.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">
        v{effectiveVersion}
        {effectiveVersion === latestVersion?.version && (
          <span className="ml-1 text-zinc-400 dark:text-zinc-500">(latest)</span>
        )}
      </span>

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
