/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

export interface SectionRowProps {
  label: string;
  status: string;
  count: number;
  sectionIndex: number;
  columnCount: number;
  onJumpTo: () => void;
}

export const SectionRow = memo(function SectionRow({
  label,
  status,
  count,
  sectionIndex,
  columnCount,
  onJumpTo,
}: SectionRowProps) {
  return (
    <tr
      data-section-index={sectionIndex}
      data-status={status}
      className="pools-section-row"
    >
      <td colSpan={columnCount} className="p-0">
        <button
          type="button"
          onClick={onJumpTo}
          className={cn(
            "flex w-full items-center gap-2 px-3",
            "text-left text-xs font-semibold uppercase tracking-wider",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset",
          )}
          style={{ height: "var(--pools-section-height)" }}
          aria-label={`Jump to ${label} section`}
        >
          <span className="pools-section-label">{label}</span>
          <span className="pools-section-count">{count}</span>
        </button>
      </td>
    </tr>
  );
});
