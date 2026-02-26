// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState, useCallback, useMemo } from "react";
import { useNavigationRouter } from "@/hooks/use-navigation-router";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/shadcn/card";
import { Badge } from "@/components/shadcn/badge";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Button } from "@/components/shadcn/button";
import { CapacityBar } from "@/components/capacity-bar";
import { ApiError } from "@/components/error/api-error";
import { CopyableValue, CopyableBlock } from "@/components/copyable-value";
import { ItemSelector } from "@/components/item-selector";
import { BooleanIndicator } from "@/components/boolean-indicator";
import { naturalCompare } from "@/lib/utils";
import { useResourceDetail } from "@/lib/api/adapter/hooks";
import type { Resource, TaskConfig } from "@/lib/api/adapter/types";
import { useViewTransition } from "@/hooks/use-view-transition";

interface ResourcePanelContentProps {
  resource: Resource;
  /** Initial pool to select in tabs (from URL config) */
  selectedPool?: string | null;
  /** Callback when pool tab changes */
  onPoolSelect?: (pool: string | null) => void;
}

export function ResourcePanelContent({
  resource,
  selectedPool: initialSelectedPool,
  onPoolSelect,
}: ResourcePanelContentProps) {
  const router = useNavigationRouter();
  const { startTransition } = useViewTransition();

  const { pools, initialPool, taskConfigByPool, isLoadingPools, error, refetch } = useResourceDetail(
    resource,
    initialSelectedPool ?? undefined,
  );

  // Track selected pool tab - initialized from URL or first pool
  const [selectedPool, setSelectedPool] = useState<string | null>(initialSelectedPool ?? initialPool);

  // Handle pool tab selection
  const handlePoolSelect = (pool: string) => {
    setSelectedPool(pool);
    onPoolSelect?.(pool);
  };

  // Navigate to pool details page with selected pool pre-opened
  const handleViewPoolDetails = useCallback(() => {
    if (!selectedPool) return;
    startTransition(() => {
      router.push(`/pools?view=${encodeURIComponent(selectedPool)}`);
    });
  }, [selectedPool, router, startTransition]);

  // Get platform configs for selected pool
  const platformConfigs = selectedPool ? (taskConfigByPool[selectedPool] ?? null) : null;
  const platformNames = useMemo(
    () => (platformConfigs ? Object.keys(platformConfigs).sort(naturalCompare) : []),
    [platformConfigs],
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Pool-Agnostic Section */}
      <div className="border-border space-y-6 border-b p-6">
        {/* Hostname */}
        <section>
          <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">Hostname</h3>
          <CopyableValue value={resource.hostname} />
        </section>

        {/* Resource Capacity */}
        <section>
          <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">Capacity</h3>
          <div className="space-y-4">
            <CapacityBar
              label="GPU"
              used={resource.gpu.used}
              total={resource.gpu.total}
              free={resource.gpu.free}
            />
            <CapacityBar
              label="CPU"
              used={resource.cpu.used}
              total={resource.cpu.total}
              free={resource.cpu.free}
            />
            <CapacityBar
              label="Memory"
              used={resource.memory.used}
              total={resource.memory.total}
              free={resource.memory.free}
              isBytes
            />
            <CapacityBar
              label="Storage"
              used={resource.storage.used}
              total={resource.storage.total}
              free={resource.storage.free}
              isBytes
            />
          </div>
        </section>

        {/* Conditions if any */}
        {resource.conditions.length > 0 && (
          <section>
            <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">Conditions</h3>
            <div className="flex flex-wrap gap-2">
              {resource.conditions.map((condition) => (
                <Badge
                  key={condition}
                  variant="secondary"
                >
                  {condition}
                </Badge>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Pool-Specific Section */}
      <div className="p-6">
        <section>
          <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
            Platform Configuration
          </h3>

          {error ? (
            <ApiError
              error={error}
              onRetry={refetch}
              title="Failed to load pool details"
            />
          ) : isLoadingPools ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : pools.length === 0 ? (
            <p className="text-muted-foreground text-sm">This resource is not a member of any pool.</p>
          ) : (
            <Card className="gap-0 py-0">
              {/* Pool Selector Header */}
              <div className="border-border bg-muted/30 flex items-center justify-between border-b px-4 py-2.5">
                <ItemSelector
                  items={pools}
                  selectedItem={selectedPool}
                  onSelect={handlePoolSelect}
                  label="Pool"
                  aria-label="Select pool"
                />
                {selectedPool && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleViewPoolDetails}
                    className="text-muted-foreground hover:text-foreground -mr-2 gap-1 text-xs"
                  >
                    View Pool Details
                    <ArrowUpRight className="size-3" />
                  </Button>
                )}
              </div>

              {/* Platform Config Content */}
              <CardContent className="p-3">
                {platformConfigs && platformNames.length > 0 ? (
                  platformNames.length === 1 ? (
                    <TaskConfigContent config={platformConfigs[platformNames[0]]} />
                  ) : (
                    <div className="space-y-4">
                      {platformNames.map((platformName, index) => (
                        <div key={platformName}>
                          {index > 0 && <div className="border-border -mx-3 mb-4 border-t" />}
                          <h4 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                            {platformName}
                          </h4>
                          <TaskConfigContent config={platformConfigs[platformName]} />
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <p className="text-muted-foreground text-sm">No configuration available for this resource.</p>
                )}
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

// =============================================================================
// Task Config Content Component
// =============================================================================

interface TaskConfigContentProps {
  config: TaskConfig;
}

function TaskConfigContent({ config }: TaskConfigContentProps) {
  return (
    <div className="space-y-3">
      {/* Boolean flags */}
      <div className="space-y-1">
        <div className="flex items-center justify-between py-1">
          <span className="text-muted-foreground text-sm">Host Network</span>
          <BooleanIndicator value={config.hostNetworkAllowed} />
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-muted-foreground text-sm">Privileged Mode</span>
          <BooleanIndicator value={config.privilegedAllowed} />
        </div>
      </div>

      {/* Default Mounts */}
      {config.defaultMounts.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1.5 text-sm">Default Mounts</div>
          <div className="flex flex-col gap-1">
            {config.defaultMounts.map((mount) => (
              <CopyableBlock
                key={mount}
                value={mount}
              />
            ))}
          </div>
        </div>
      )}

      {/* Allowed Mounts */}
      {config.allowedMounts.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1.5 text-sm">Allowed Mounts</div>
          <div className="flex flex-col gap-1">
            {config.allowedMounts.map((mount) => (
              <CopyableBlock
                key={mount}
                value={mount}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
