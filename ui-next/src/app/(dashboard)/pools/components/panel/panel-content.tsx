/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

"use client";

import React, { memo, useMemo, useCallback } from "react";
import { Share2, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { heading } from "@/lib/styles";
import { CapacityBar } from "@/components/capacity-bar";
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

  // Get selected platform config
  const platformConfig = effectivePlatform ? pool.platformConfigs[effectivePlatform] : null;

  // Check if we have pool details content
  const hasTimeouts =
    pool.timeouts.defaultExec !== null ||
    pool.timeouts.maxExec !== null ||
    pool.timeouts.defaultQueue !== null ||
    pool.timeouts.maxQueue !== null;

  const hasExitActions = Object.keys(pool.defaultExitActions).length > 0;
  const hasPoolDetails = pool.description || hasTimeouts || hasExitActions;

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-6">
        {/* GPU Quota */}
        <CapacityBar
          label="GPU Quota"
          used={pool.quota.used}
          total={pool.quota.limit}
        />

        {/* GPU Capacity */}
        <CapacityBar
          label={
            <span className="flex items-center gap-2">
              GPU Capacity
              {sharedWith && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 px-2 py-0.5 text-[0.625rem] font-medium text-violet-700 ring-1 ring-violet-500/20 ring-inset dark:text-violet-300 dark:ring-violet-400/30">
                  <Share2 className="h-3 w-3" />
                  Shared
                </span>
              )}
            </span>
          }
          used={pool.quota.totalUsage}
          total={pool.quota.totalCapacity}
        >
          {/* Shared pools info - colocated with capacity bar */}
          {sharedWith && sharedWith.length > 0 && (
            <div className="rounded-lg bg-gradient-to-r from-violet-500/[0.08] to-fuchsia-500/[0.05] p-3 ring-1 ring-violet-500/15 ring-inset dark:ring-violet-400/20">
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
        </CapacityBar>

        {/* Pool Details */}
        {hasPoolDetails && (
          <section>
            <h3 className={cn(heading.section, "mb-2")}>Pool Details</h3>

            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {/* Description */}
                {pool.description && (
                  <div className="p-3">
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{pool.description}</p>
                  </div>
                )}

                {/* Timeouts */}
                {hasTimeouts && (
                  <div className="p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      <Clock className="size-3" />
                      Timeouts
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      {pool.timeouts.defaultExec && (
                        <>
                          <span className="text-zinc-500 dark:text-zinc-500">Default Execution</span>
                          <span className="font-mono text-zinc-700 dark:text-zinc-300">
                            {pool.timeouts.defaultExec}
                          </span>
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
                          <span className="font-mono text-zinc-700 dark:text-zinc-300">
                            {pool.timeouts.defaultQueue}
                          </span>
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

                {/* Exit Actions */}
                {hasExitActions && (
                  <div className="p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      <AlertCircle className="size-3" />
                      Default Exit Actions
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
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
            </div>
          </section>
        )}

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
