/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortButtonProps } from "./types";

/**
 * Sort button for table column headers.
 *
 * Shows sort indicator (asc/desc/inactive) and handles click to toggle sort.
 * Can be used in both mandatory (static) and optional (draggable) columns.
 */
export const SortButton = memo(function SortButton({
  label,
  align = "left",
  sortable = true,
  isActive,
  direction,
  onSort,
}: SortButtonProps) {
  const ariaSort = isActive
    ? direction === "asc"
      ? "ascending"
      : "descending"
    : undefined;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (sortable) onSort();
      }}
      disabled={!sortable}
      aria-sort={ariaSort}
      className={cn(
        "flex items-center gap-1 whitespace-nowrap transition-colors",
        sortable && "hover:text-zinc-900 dark:hover:text-zinc-100",
        align === "right" && "ml-auto",
      )}
    >
      <span className="truncate">{label}</span>
      {sortable &&
        (isActive ? (
          direction === "asc" ? (
            <ChevronUp className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
          )
        ) : (
          <ChevronsUpDown className="size-3 shrink-0 opacity-30" aria-hidden="true" />
        ))}
    </button>
  );
});
