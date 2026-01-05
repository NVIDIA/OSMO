/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useMemo, useCallback } from "react";
import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { heading, text } from "@/lib/styles";
import { ProgressBar } from "@/components/progress-bar";
import { PlaceholderSection } from "@/components/placeholder-section";
import type { Pool } from "@/lib/api/adapter";
import { getSharingInfo } from "@/lib/api/adapter/transforms";
import { PlatformSelector } from "./platform-selector";
import { PlatformConfigContent } from "./platform-config";
import { SharedPoolsChips } from "./shared-pools-chips";

// =============================================================================
// Types
// =============================================================================

export interface PanelContentProps {
  pool: Pool;
  sharingGroups: string[][];
  /** Callback when a pool is selected (for navigating to shared pools) */
  onPoolSelect?: (poolName: string) => void;
  /** Currently selected platform (URL-synced) */
  selectedPlatform?: string | null;
  /** Callback when platform is selected */
  onPlatformSelect?: (platform: string | null) => void;
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Panel Content - Main content area for pool details panel.
 *
 * Displays:
 * - GPU Quota (used/limit bar)
 * - GPU Capacity (usage/total bar, shared capacity info)
 * - Platform Configuration (platform selector + config details)
 * - Placeholder sections for future cross-reference features
 */
export const PanelContent = memo(function PanelContent({
  pool,
  sharingGroups,
  onPoolSelect,
  selectedPlatform: selectedPlatformProp,
  onPlatformSelect,
}: PanelContentProps) {
  // Derive shared pools
  const sharedWith = useMemo(() => getSharingInfo(pool.name, sharingGroups), [pool.name, sharingGroups]);

  // Derive effective platform: use prop if valid for this pool, else fall back to default
  const defaultPlatform = pool.defaultPlatform ?? pool.platforms[0] ?? null;
  const effectivePlatform = useMemo(() => {
    if (selectedPlatformProp && pool.platforms.includes(selectedPlatformProp)) {
      return selectedPlatformProp;
    }
    return defaultPlatform;
  }, [selectedPlatformProp, pool.platforms, defaultPlatform]);

  // Handler to update platform selection
  const handlePlatformSelect = useCallback(
    (platform: string | null) => {
      // Only sync to URL if it's different from default
      if (platform === defaultPlatform) {
        onPlatformSelect?.(null); // Clear from URL
      } else {
        onPlatformSelect?.(platform);
      }
    },
    [onPlatformSelect, defaultPlatform],
  );

  // Navigate to another pool when clicking a shared pool chip
  const handlePoolClick = useCallback(
    (poolName: string) => {
      onPoolSelect?.(poolName);
    },
    [onPoolSelect],
  );

  // Calculate progress percentages
  const quotaPercent = pool.quota.limit > 0 ? (pool.quota.used / pool.quota.limit) * 100 : 0;
  const capacityPercent = pool.quota.totalCapacity > 0 ? (pool.quota.totalUsage / pool.quota.totalCapacity) * 100 : 0;

  // Get selected platform config
  const platformConfig = effectivePlatform ? pool.platformConfigs[effectivePlatform] : null;

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-6">
        {/* GPU Quota Section */}
        <QuotaSection
          title="GPU Quota"
          used={pool.quota.used}
          total={pool.quota.limit}
          free={pool.quota.free}
          percent={quotaPercent}
          freeLabel="free"
        />

        {/* GPU Capacity Section */}
        <section>
          <h3 className={cn(heading.section, "mb-2 flex items-center gap-2")}>
            GPU Capacity
            {sharedWith && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 px-2 py-0.5 text-[0.625rem] font-medium text-violet-700 ring-1 ring-inset ring-violet-500/20 dark:text-violet-300 dark:ring-violet-400/30">
                <Share2 className="h-3 w-3" />
                Shared
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
            <ProgressBar
              value={pool.quota.totalUsage}
              max={pool.quota.totalCapacity}
              size="md"
              trackClassName="pools-progress-track"
              aria-label={`GPU Capacity: ${pool.quota.totalUsage} of ${pool.quota.totalCapacity} used`}
            />
            <div className={cn(text.mutedSmall, "flex items-center justify-between")}>
              <span>{pool.quota.totalFree} idle</span>
              <span>{Math.round(capacityPercent)}% utilized</span>
            </div>
          </div>

          {/* Shared pools info */}
          {sharedWith && sharedWith.length > 0 && (
            <div className="mt-3 rounded-lg bg-gradient-to-r from-violet-500/[0.08] to-fuchsia-500/[0.05] p-3 ring-1 ring-inset ring-violet-500/15 dark:ring-violet-400/20">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                <Share2 className="h-3.5 w-3.5" />
                Shares capacity with
              </div>
              <SharedPoolsChips
                pools={sharedWith}
                onPoolClick={handlePoolClick}
              />
            </div>
          )}
        </section>

        {/* Platform Configuration */}
        {pool.platforms.length > 0 && (
          <section>
            <h3 className={cn(heading.section, "mb-2")}>Platform Configuration</h3>

            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              {/* Platform Selector Header */}
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100/50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/30">
                <PlatformSelector
                  platforms={pool.platforms}
                  defaultPlatform={pool.defaultPlatform}
                  selectedPlatform={effectivePlatform}
                  onSelectPlatform={handlePlatformSelect}
                />
              </div>

              {/* Platform Config Content */}
              <div className="p-3">
                {platformConfig ? (
                  <PlatformConfigContent config={platformConfig} />
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    No configuration available for this platform.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Placeholder: Active Resources */}
        <PlaceholderSection
          title="Active Resources"
          description="Jobs and resources running on this pool will appear here"
          note="Coming soon: Cross-reference with Resources page"
        />

        {/* Placeholder: Recent Workflows */}
        <PlaceholderSection
          title="Recent Workflows"
          description="Workflows that have used this pool will appear here"
          note="Coming soon: Cross-reference with Workflows page"
        />
      </div>
    </div>
  );
});

// =============================================================================
// Helper Components
// =============================================================================

interface QuotaSectionProps {
  title: string;
  used: number;
  total: number;
  free: number;
  percent: number;
  freeLabel: string;
}

function QuotaSection({ title, used, total, free, percent, freeLabel }: QuotaSectionProps) {
  return (
    <section>
      <h3 className={cn(heading.section, "mb-2")}>{title}</h3>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Used</span>
          <span className="font-mono text-zinc-900 dark:text-zinc-100">
            {used} / {total}
          </span>
        </div>
        <ProgressBar
          value={used}
          max={total}
          size="md"
          trackClassName="pools-progress-track"
          aria-label={`${title}: ${used} of ${total} used`}
        />
        <div className={cn(text.mutedSmall, "flex items-center justify-between")}>
          <span>
            {free} {freeLabel}
          </span>
          <span>{Math.round(percent)}% utilized</span>
        </div>
      </div>
    </section>
  );
}
