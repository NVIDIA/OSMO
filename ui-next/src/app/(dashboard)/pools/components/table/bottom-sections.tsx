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
import type { StatusSection } from "../../hooks/use-pool-sections";

export interface BottomSectionStackProps {
  sections: StatusSection[];
  hiddenSectionIndices: number[];
  columnCount: number;
  onJumpTo: (index: number) => void;
}

export const BottomSectionStack = memo(function BottomSectionStack({
  sections,
  hiddenSectionIndices,
  columnCount,
  onJumpTo,
}: BottomSectionStackProps) {
  if (hiddenSectionIndices.length === 0) return null;

  return (
    <tfoot className="pools-tfoot sticky bottom-0 z-20">
      {hiddenSectionIndices.map((sectionIndex) => {
        const section = sections[sectionIndex];

        return (
          <tr
            key={section.status}
            data-status={section.status}
            className="pools-bottom-section-row"
          >
            <td colSpan={columnCount} className="p-0">
              <button
                type="button"
                onClick={() => onJumpTo(sectionIndex)}
                className={cn(
                  "pools-bottom-section-item",
                  "flex w-full items-center gap-2 px-3",
                  "text-left text-xs font-semibold uppercase tracking-wider",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset",
                )}
                style={{ height: "var(--pools-section-height)" }}
                aria-label={`Jump to ${section.label} section`}
              >
                <span className="pools-section-label">{section.label}</span>
                <span className="pools-section-count">{section.pools.length}</span>
              </button>
            </td>
          </tr>
        );
      })}
    </tfoot>
  );
});
