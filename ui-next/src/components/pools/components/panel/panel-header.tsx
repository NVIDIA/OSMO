/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * PanelHeader Component
 *
 * Two-row header layout inspired by workflow-explorer DetailsPanel:
 * Row 1: Title + View badge                              [Menu] [Close]
 * Row 2: Status indicator · Backend info · [show more]
 * 
 * Expandable section contains: Description, GPU Resources, Timeouts
 */

"use client";

import React, { memo } from "react";
import { X, MoreVertical, PanelLeft, PanelLeftClose, Columns2, Server, Clock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Pool } from "@/lib/api/adapter";
import { getStatusDisplay, getStatusStyles, PANEL } from "../../lib";
import { usePoolsExtendedStore } from "../../stores/pools-table-store";

const WIDTH_PRESET_ICONS: Record<number, React.FC<{ className?: string }>> = {
  33: PanelLeftClose,
  50: Columns2,
  75: PanelLeft,
};

export interface PanelHeaderProps {
  pool: Pool;
  onClose: () => void;
  onWidthPreset: (pct: number) => void;
}

export const PanelHeader = memo(function PanelHeader({ pool, onClose, onWidthPreset }: PanelHeaderProps) {
  const isExpanded = usePoolsExtendedStore((s) => s.headerExpanded);
  const toggleHeaderExpanded = usePoolsExtendedStore((s) => s.toggleHeaderExpanded);
  const statusDisplay = getStatusDisplay(pool.status);
  const statusStyles = getStatusStyles(pool.status);

  // Check if we have any expandable content
  const hasTimeouts =
    pool.timeouts.defaultExec !== null ||
    pool.timeouts.maxExec !== null ||
    pool.timeouts.defaultQueue !== null ||
    pool.timeouts.maxQueue !== null;

  const hasExitActions = Object.keys(pool.defaultExitActions).length > 0;

  const hasExpandableContent = pool.description || hasTimeouts || hasExitActions;

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      {/* Row 1: Title row */}
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{pool.name}</h2>
        </div>

        {/* Actions */}
        <div className="-mr-1.5 flex shrink-0 items-center gap-1">
          {/* View type badge */}
          <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-zinc-500 ring-1 ring-inset ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-600">
            Pool
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

      {/* Row 2: Status + Backend info + expand toggle */}
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", statusStyles.dot)} />
          <span className="font-medium text-zinc-600 dark:text-zinc-300">{statusDisplay.label}</span>
        </span>
        <span className="text-zinc-400 dark:text-zinc-600">·</span>
        <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
          <Server className="size-3" />
          {pool.backend}
        </span>
        {pool.platforms.length > 0 && (
          <>
            <span className="text-zinc-400 dark:text-zinc-600">·</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {pool.platforms.length} platform{pool.platforms.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
        {hasExpandableContent && (
          <>
            <span className="text-zinc-400 dark:text-zinc-600">·</span>
            <button
              onClick={toggleHeaderExpanded}
              className="text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
              aria-expanded={isExpanded}
            >
              {isExpanded ? "less" : "more"}
            </button>
          </>
        )}
      </div>

      {/* Expandable section: Description, Timeouts, Exit Actions */}
      {hasExpandableContent && isExpanded && (
        <div className="mt-3 space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
          {/* Description */}
          {pool.description && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{pool.description}</p>
          )}

          {/* Timeouts */}
          {hasTimeouts && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <Clock className="size-3" />
                Timeouts
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-4 text-sm">
                {pool.timeouts.defaultExec && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-500">Default Execution</span>
                    <span className="font-mono text-zinc-700 dark:text-zinc-300">{pool.timeouts.defaultExec}</span>
                  </>
                )}
                {pool.timeouts.maxExec && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-500">Max Execution</span>
                    <span className="font-mono text-zinc-700 dark:text-zinc-300">{pool.timeouts.maxExec}</span>
                  </>
                )}
                {pool.timeouts.defaultQueue && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-500">Default Queue</span>
                    <span className="font-mono text-zinc-700 dark:text-zinc-300">{pool.timeouts.defaultQueue}</span>
                  </>
                )}
                {pool.timeouts.maxQueue && (
                  <>
                    <span className="text-zinc-500 dark:text-zinc-500">Max Queue</span>
                    <span className="font-mono text-zinc-700 dark:text-zinc-300">{pool.timeouts.maxQueue}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Default Exit Actions */}
          {hasExitActions && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Default Exit Actions
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-4 text-sm">
                {Object.entries(pool.defaultExitActions).map(([exitCode, action]) => (
                  <React.Fragment key={exitCode}>
                    <span className="font-mono text-zinc-500 dark:text-zinc-500">{exitCode}</span>
                    <span className="text-zinc-700 dark:text-zinc-300">{action}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </header>
  );
});
