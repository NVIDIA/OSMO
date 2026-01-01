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
  icon: string;
  count: number;
  sectionIndex: number;
  onJumpTo: () => void;
}

export const SectionRow = memo(function SectionRow({
  label,
  icon,
  count,
  sectionIndex,
  onJumpTo,
}: SectionRowProps) {
  return (
    <button
      type="button"
      onClick={onJumpTo}
      data-section-index={sectionIndex}
      className={cn(
        "pools-section-row",
        "flex w-full items-center gap-2 px-3",
        "border-b border-zinc-200 dark:border-zinc-700",
        "text-left text-sm font-medium",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset",
        "transition-shadow duration-150",
      )}
      aria-label={`Jump to ${label} section`}
    >
      <span>{icon}</span>
      <span className="text-zinc-900 dark:text-zinc-100">{label}</span>
      <span className="text-zinc-500 dark:text-zinc-400">({count})</span>
    </button>
  );
});
