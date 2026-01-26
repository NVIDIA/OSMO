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
import { CirclePile, Clock, AlertCircle, Server, Workflow, ArrowRight } from "lucide-react";
import { Badge } from "@/components/shadcn/badge";
import { Card, CardContent } from "@/components/shadcn/card";
import { Link } from "@/components/link";
import { CapacityBar } from "@/components/capacity-bar";
import type { Pool } from "@/lib/api/adapter";
import { getSharingInfo } from "@/lib/api/adapter";
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
                <Badge
                  variant="outline"
                  className="gap-1 border-violet-500/20 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 text-[0.625rem] text-violet-700 dark:text-violet-300"
                >
                  <CirclePile className="h-3 w-3" />
                  Shared
                </Badge>
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
                <CirclePile className="h-3.5 w-3.5" />
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
            <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">Pool Details</h3>

            <Card className="gap-0 py-0">
              <CardContent className="divide-border divide-y p-0">
                {/* Description */}
                {pool.description && (
                  <div className="p-3">
                    <p className="text-muted-foreground text-sm">{pool.description}</p>
                  </div>
                )}

                {/* Timeouts */}
                {hasTimeouts && (
                  <div className="p-3">
                    <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
                      <Clock className="size-3" />
                      Timeouts
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      {pool.timeouts.defaultExec && (
                        <>
                          <span className="text-muted-foreground">Default Execution</span>
                          <span className="font-mono">{pool.timeouts.defaultExec}</span>
                        </>
                      )}
                      {pool.timeouts.maxExec && (
                        <>
                          <span className="text-muted-foreground">Max Execution</span>
                          <span className="font-mono">{pool.timeouts.maxExec}</span>
                        </>
                      )}
                      {pool.timeouts.defaultQueue && (
                        <>
                          <span className="text-muted-foreground">Default Queue</span>
                          <span className="font-mono">{pool.timeouts.defaultQueue}</span>
                        </>
                      )}
                      {pool.timeouts.maxQueue && (
                        <>
                          <span className="text-muted-foreground">Max Queue</span>
                          <span className="font-mono">{pool.timeouts.maxQueue}</span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Exit Actions */}
                {hasExitActions && (
                  <div className="p-3">
                    <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
                      <AlertCircle className="size-3" />
                      Default Exit Actions
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      {Object.entries(pool.defaultExitActions).map(([exitCode, action]) => (
                        <React.Fragment key={exitCode}>
                          <span className="text-muted-foreground font-mono">{exitCode}</span>
                          <span>{action}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {/* Platform Configuration */}
        {pool.platforms.length > 0 && (
          <section>
            <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
              Platform Configuration
            </h3>

            <Card className="gap-0 py-0">
              {/* Platform Selector Header */}
              <div className="border-border bg-muted/30 border-b px-4 py-2.5">
                <PlatformSelector
                  platforms={pool.platforms}
                  defaultPlatform={pool.defaultPlatform}
                  selectedPlatform={effectivePlatform}
                  onSelectPlatform={handlePlatformSelect}
                />
              </div>

              {/* Platform Config Content */}
              <CardContent className="p-3">
                {platformConfig ? (
                  <PlatformConfigContent config={platformConfig} />
                ) : (
                  <p className="text-muted-foreground text-sm">No configuration available for this platform.</p>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {/* Related */}
        <section>
          <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">Related</h3>

          <Card className="gap-0 py-0">
            <CardContent className="divide-border divide-y p-0">
              {/* Resources Link */}
              <Link
                href={`/resources?f=pool:${encodeURIComponent(pool.name)}`}
                className="hover:bg-accent flex items-center gap-3 p-3 transition-colors"
              >
                <Server className="text-muted-foreground size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Resources</div>
                  <div className="text-muted-foreground text-xs">View compute resources in this pool</div>
                </div>
                <ArrowRight className="text-muted-foreground size-4 shrink-0" />
              </Link>

              {/* Workflows Link */}
              <Link
                href={`/workflows?f=pool:${encodeURIComponent(pool.name)}&all=true`}
                className="hover:bg-accent flex items-center gap-3 p-3 transition-colors"
              >
                <Workflow className="text-muted-foreground size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Workflows</div>
                  <div className="text-muted-foreground text-xs">View workflows that ran on this pool</div>
                </div>
                <ArrowRight className="text-muted-foreground size-4 shrink-0" />
              </Link>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
});
