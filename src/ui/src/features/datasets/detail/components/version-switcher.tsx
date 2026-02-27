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
 * VersionSwitcher — Compact prev/next navigation for the file browser header.
 *
 * Shows: [<] {label} [>]
 * Works for both dataset versions and collection members.
 */

"use client";

import { memo, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/shadcn/button";

export interface SwitcherItem {
  /** Unique ID used as the URL param value */
  id: string;
  /** Display label */
  label: string;
  /** If true, shows "(latest)" suffix */
  isLatest?: boolean;
}

interface VersionSwitcherProps {
  items: SwitcherItem[];
  /** Currently selected item ID, null = use last item */
  selectedId: string | null;
  /** Called with item ID when user picks a different item */
  onSelectionChange: (id: string) => void;
}

export const VersionSwitcher = memo(function VersionSwitcher({
  items,
  selectedId,
  onSelectionChange,
}: VersionSwitcherProps) {
  const lastItem = items[items.length - 1];
  const effectiveId = selectedId ?? lastItem?.id ?? "";
  const currentIndex = useMemo(() => items.findIndex((item) => item.id === effectiveId), [items, effectiveId]);
  const currentItem = items[currentIndex] ?? null;

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < items.length - 1;

  const handlePrev = useCallback(() => {
    if (canGoPrev) onSelectionChange(items[currentIndex - 1].id);
  }, [canGoPrev, currentIndex, onSelectionChange, items]);

  const handleGoNext = useCallback(() => {
    if (canGoNext) onSelectionChange(items[currentIndex + 1].id);
  }, [canGoNext, currentIndex, onSelectionChange, items]);

  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={handlePrev}
        disabled={!canGoPrev}
        aria-label="Previous"
      >
        <ChevronLeft
          className="size-3.5"
          aria-hidden="true"
        />
      </Button>

      <span className="px-1.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">
        {currentItem?.label ?? ""}
        {currentItem?.isLatest && <span className="ml-1 text-zinc-400 dark:text-zinc-500">(latest)</span>}
      </span>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={handleGoNext}
        disabled={!canGoNext}
        aria-label="Next"
      >
        <ChevronRight
          className="size-3.5"
          aria-hidden="true"
        />
      </Button>
    </div>
  );
});
