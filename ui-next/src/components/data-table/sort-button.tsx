/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

"use client";

import { memo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortButtonProps } from "@/components/data-table/types";
import { SortDirections, TextAlignments } from "@/components/data-table/constants";

/**
 * Sort button for table column headers.
 *
 * Shows sort indicator (asc/desc/inactive) and handles click to toggle sort.
 * Can be used in both mandatory (static) and optional (draggable) columns.
 */
export const SortButton = memo(function SortButton({
  label,
  align = TextAlignments.LEFT,
  sortable = true,
  isActive,
  direction,
  onSort,
}: SortButtonProps) {
  // Note: aria-sort belongs on the parent <th> element, not on the button.
  // The parent SortableCell or DataTable header cell should handle this.
  const ariaLabel = isActive
    ? `Sort by ${label}, currently ${direction === SortDirections.ASC ? "ascending" : "descending"}`
    : `Sort by ${label}`;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (sortable) onSort();
      }}
      disabled={!sortable}
      aria-label={sortable ? ariaLabel : undefined}
      className={cn(
        "flex items-center gap-1 whitespace-nowrap transition-colors",
        sortable && "hover:text-zinc-900 dark:hover:text-zinc-100",
        align === TextAlignments.RIGHT && "ml-auto",
      )}
    >
      <span className="truncate">{label}</span>
      {sortable &&
        (isActive ? (
          direction === SortDirections.ASC ? (
            <ChevronUp
              className="size-3 shrink-0"
              aria-hidden="true"
            />
          ) : (
            <ChevronDown
              className="size-3 shrink-0"
              aria-hidden="true"
            />
          )
        ) : (
          <ChevronsUpDown
            className="size-3 shrink-0 opacity-30"
            aria-hidden="true"
          />
        ))}
    </button>
  );
});
