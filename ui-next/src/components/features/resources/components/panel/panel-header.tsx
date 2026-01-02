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
 * Row 2: Platform · Backend · Hostname
 */

"use client";

import React, { memo } from "react";
import { X, MoreVertical, PanelLeft, PanelLeftClose, Columns2, Server, Cpu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Resource } from "@/lib/api/adapter";
import { getResourceAllocationTypeDisplay } from "@/lib/constants/ui";
import { PANEL } from "../../lib";

const WIDTH_PRESET_ICONS: Record<number, React.FC<{ className?: string }>> = {
  33: PanelLeftClose,
  50: Columns2,
  75: PanelLeft,
};

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
          <h2 className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{resource.name}</h2>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              resourceTypeDisplay.className,
            )}
          >
            {resourceTypeDisplay.label}
          </span>
        </div>

        {/* Actions */}
        <div className="-mr-1.5 flex shrink-0 items-center gap-1">
          {/* View type badge */}
          <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-zinc-500 ring-1 ring-inset ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-600">
            Resource
          </span>

          {/* Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs text-zinc-500 dark:text-zinc-500">
                Snap to
              </DropdownMenuLabel>
              {PANEL.WIDTH_PRESETS.map((pct) => {
                const Icon = WIDTH_PRESET_ICONS[pct];
                return (
                  <DropdownMenuItem key={pct} onClick={() => onWidthPreset(pct)}>
                    <Icon className="mr-2 size-4" />
                    <span>{pct}%</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Close button */}
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Close panel"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Row 2: Platform, Backend, Hostname */}
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
        {resource.hostname && (
          <>
            <span className="text-zinc-400 dark:text-zinc-600">·</span>
            <span className="font-mono text-zinc-500 dark:text-zinc-400">{resource.hostname}</span>
          </>
        )}
        {resource.poolMemberships.length > 0 && (
          <>
            <span className="text-zinc-400 dark:text-zinc-600">·</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {resource.poolMemberships.length} pool{resource.poolMemberships.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>
    </header>
  );
});
