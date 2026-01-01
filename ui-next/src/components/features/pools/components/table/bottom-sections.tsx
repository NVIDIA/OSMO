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
import type { StatusSection } from "../../hooks";

export interface BottomSectionStackProps {
  sections: StatusSection[];
  hiddenSectionIndices: number[];
  onJumpTo: (index: number) => void;
}

export const BottomSectionStack = memo(function BottomSectionStack({
  sections,
  hiddenSectionIndices,
  onJumpTo,
}: BottomSectionStackProps) {
  if (hiddenSectionIndices.length === 0) return null;

  const reversedIndices = [...hiddenSectionIndices].reverse();

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 pointer-events-none">
      {reversedIndices.map((sectionIndex, stackIndex) => {
        const section = sections[sectionIndex];

        return (
          <button
            key={section.status}
            type="button"
            onClick={() => onJumpTo(sectionIndex)}
            data-stack-index={stackIndex}
            className={cn(
              "pools-bottom-section absolute inset-x-0 pointer-events-auto",
              "flex w-full items-center gap-2 px-3",
              "border-t border-zinc-200 dark:border-zinc-700",
              "text-left text-sm font-medium",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset",
            )}
            style={{ height: "var(--pools-section-height)" }}
            aria-label={`Jump to ${section.label} section`}
          >
            <span>{section.icon}</span>
            <span className="text-zinc-900 dark:text-zinc-100">{section.label}</span>
            <span className="text-zinc-500 dark:text-zinc-400">({section.pools.length})</span>
          </button>
        );
      })}
    </div>
  );
});
