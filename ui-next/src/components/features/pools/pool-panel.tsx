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
 * Pool Panel Component
 *
 * Resizable slide-in panel for pool details.
 * Uses react-resizable-panels v4.x (Group, Panel, Separator).
 */

"use client";

import { memo, useMemo, useCallback } from "react";
import { X, MoreVertical, PanelLeft, PanelLeftClose, Columns2 } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { clearButton, progressTrack, getProgressColor, badge as badgeStyles } from "@/lib/styles";
import type { Pool } from "@/lib/api/adapter";
import { getSharingInfo } from "@/lib/api/adapter/transforms";
import { getStatusDisplay, getStatusStyles, PANEL } from "./constants";
import { usePoolsExtendedStore, usePoolsTableStore } from "./stores/pools-table-store";

// =============================================================================
// Panel Width Icons
// =============================================================================

const WIDTH_PRESET_ICONS: Record<number, React.FC<{ className?: string }>> = {
  33: PanelLeftClose,
  50: Columns2,
  75: PanelLeft,
};

// =============================================================================
// Types
// =============================================================================

export interface PoolPanelProps {
  /** Pool to display */
  pool: Pool | null;
  /** Sharing groups for context */
  sharingGroups: string[][];
  /** Close handler */
  onClose: () => void;
  /** Children (main content area) */
  children: React.ReactNode;
}

// =============================================================================
// Panel Header
// =============================================================================

interface PanelHeaderProps {
  pool: Pool;
  onClose: () => void;
  onWidthPreset: (pct: number) => void;
}

const PanelHeader = memo(function PanelHeader({ pool, onClose, onWidthPreset }: PanelHeaderProps) {
  const statusDisplay = getStatusDisplay(pool.status);
  const statusStyles = getStatusStyles(pool.status);

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
      <div className="flex items-center gap-3">
        {/* Status badge */}
        <span className={cn("size-2 rounded-full", statusStyles.dot)} />
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{pool.name}</h2>
        <Badge variant="outline" className="text-xs">
          {statusDisplay.label}
        </Badge>
      </div>

      <div className="flex items-center gap-1">
        {/* Kebab menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="size-8 p-0">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs text-zinc-500">Snap to</DropdownMenuLabel>
            {PANEL.WIDTH_PRESETS.map((pct) => {
              const Icon = WIDTH_PRESET_ICONS[pct];
              return (
                <DropdownMenuItem key={pct} onClick={() => onWidthPreset(pct)}>
                  <Icon className="mr-2 size-4" />
                  <span>{pct}%</span>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClose}>
              <X className="mr-2 size-4" />
              Close panel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Close button */}
        <button onClick={onClose} className={clearButton}>
          <X className="size-4" />
        </button>
      </div>
    </header>
  );
});

// =============================================================================
// Panel Content
// =============================================================================

interface PanelContentProps {
  pool: Pool;
  sharingGroups: string[][];
}

const PanelContent = memo(function PanelContent({ pool, sharingGroups }: PanelContentProps) {
  const sharedWith = useMemo(() => getSharingInfo(pool.name, sharingGroups), [pool.name, sharingGroups]);

  const quotaPercent = pool.quota.limit > 0 ? (pool.quota.used / pool.quota.limit) * 100 : 0;
  const capacityPercent = pool.quota.totalCapacity > 0 ? (pool.quota.totalUsage / pool.quota.totalCapacity) * 100 : 0;

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-6">
        {/* Description */}
        {pool.description && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Description
            </h3>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{pool.description}</p>
          </section>
        )}

        {/* GPU Quota */}
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            GPU Quota
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Used</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">
                {pool.quota.used} / {pool.quota.limit}
              </span>
            </div>
            <div className={cn(progressTrack, "h-2")}>
              <div
                className={cn("h-full rounded-full transition-all", getProgressColor(quotaPercent))}
                style={{ width: `${Math.min(quotaPercent, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>{pool.quota.free} free</span>
              <span>{Math.round(quotaPercent)}% utilized</span>
            </div>
          </div>
        </section>

        {/* GPU Capacity */}
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            GPU Capacity
            {sharedWith && (
              <span className={badgeStyles.info} title={`Shared with: ${sharedWith.join(", ")}`}>
                🔗 Shared
              </span>
            )}
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Usage</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">
                {pool.quota.totalUsage} / {pool.quota.totalCapacity}
              </span>
            </div>
            <div className={cn(progressTrack, "h-2")}>
              <div
                className={cn("h-full rounded-full transition-all", getProgressColor(capacityPercent))}
                style={{ width: `${Math.min(capacityPercent, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>{pool.quota.totalFree} idle</span>
              <span>{Math.round(capacityPercent)}% utilized</span>
            </div>
          </div>

          {/* Shared pools info */}
          {sharedWith && sharedWith.length > 0 && (
            <div className="mt-3 rounded-md bg-blue-50 p-3 dark:bg-blue-950/30">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                <strong>Shares capacity with:</strong> {sharedWith.join(", ")}
              </p>
            </div>
          )}
        </section>

        {/* Platforms */}
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Platforms ({pool.platforms.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {pool.platforms.sort().map((platform) => (
              <Badge key={platform} variant="secondary">
                {platform}
              </Badge>
            ))}
          </div>
        </section>

        {/* Backend */}
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Backend
          </h3>
          <p className="font-mono text-sm text-zinc-700 dark:text-zinc-300">{pool.backend}</p>
        </section>
      </div>
    </div>
  );
});

// =============================================================================
// Main Component
// =============================================================================

export function PoolPanelLayout({ pool, sharingGroups, onClose, children }: PoolPanelProps) {
  // Store state - use individual selectors for stable hook ordering
  const panelWidth = usePoolsTableStore((s) => s.panelWidth);
  const setPanelWidth = usePoolsTableStore((s) => s.setPanelWidth);

  // Handle layout changes from react-resizable-panels
  const handleLayoutChange = useCallback(
    (layout: Record<string, number>) => {
      const detailsSize = layout["details"];
      if (detailsSize !== undefined && detailsSize !== panelWidth) {
        setPanelWidth(detailsSize);
      }
    },
    [panelWidth, setPanelWidth],
  );

  const handleWidthPreset = useCallback(
    (pct: number) => {
      setPanelWidth(pct);
    },
    [setPanelWidth],
  );

  if (!pool) {
    return <div className="h-full w-full">{children}</div>;
  }

  return (
    <Group
      orientation="horizontal"
      id="pools-panel-layout"
      onLayoutChange={handleLayoutChange}
      defaultLayout={{ main: 100 - panelWidth, details: panelWidth }}
      className="h-full w-full"
    >
      {/* Main content */}
      <Panel id="main" minSize="30%">
        {children}
      </Panel>

      {/* Resize separator */}
      <Separator className="w-1 bg-zinc-200 transition-colors hover:bg-blue-500 data-[active]:bg-blue-500 dark:bg-zinc-700 dark:hover:bg-blue-500" />

      {/* Details panel */}
      <Panel id="details" minSize="20%" maxSize="80%" defaultSize={`${panelWidth}%`}>
        <aside className="pools-panel flex h-full flex-col border-l border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          <PanelHeader pool={pool} onClose={onClose} onWidthPreset={handleWidthPreset} />
          <PanelContent pool={pool} sharingGroups={sharingGroups} />
        </aside>
      </Panel>
    </Group>
  );
}
