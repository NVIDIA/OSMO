/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * ResourcePanelHeader Component
 *
 * Two-row header layout:
 * Row 1: Title + Resource type badge                    [Menu] [Close]
 * Row 2: Platform · Backend · Pool count
 */

"use client";

import { memo } from "react";
import { Server, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Resource } from "@/lib/api/adapter";
import { getResourceAllocationTypeDisplay } from "../../lib/constants";
import { PanelHeaderActions } from "@/components/panel";

export interface ResourcePanelHeaderProps {
  resource: Resource;
  onClose: () => void;
  onWidthPreset: (pct: number) => void;
}

export const ResourcePanelHeader = memo(function ResourcePanelHeader({
  resource,
  onClose,
  onWidthPreset,
}: ResourcePanelHeaderProps) {
  const resourceTypeDisplay = getResourceAllocationTypeDisplay(resource.resourceType);

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      {/* Row 1: Title row */}
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
            {resource.name}
          </h2>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              resourceTypeDisplay.className,
            )}
          >
            {resourceTypeDisplay.label}
          </span>
        </div>
        <PanelHeaderActions badge="Resource" onWidthPreset={onWidthPreset} onClose={onClose} />
      </div>

      {/* Row 2: Platform, Backend, Pool count */}
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
          <Cpu className="size-3" />
          {resource.platform}
        </span>
        <span className="text-zinc-400 dark:text-zinc-600">·</span>
        <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
          <Server className="size-3" />
          {resource.backend}
        </span>
        {resource.poolMemberships.length > 0 && (
          <>
            <span className="text-zinc-400 dark:text-zinc-600">·</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {resource.poolMemberships.length} pool
              {resource.poolMemberships.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>
    </header>
  );
});
