/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { heading, text } from "@/lib/styles";
import { CapacityBar } from "@/components/capacity-bar";
import { ApiError } from "@/components/error";
import { CopyableValue, CopyableBlock } from "@/components/copyable-value";
import { ItemSelector } from "@/components/item-selector";
import { BooleanIndicator } from "@/components/boolean-indicator";
import { useResourceDetail, type Resource, type TaskConfig } from "@/lib/api/adapter";

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

  // Get task config for selected pool
  const taskConfig = selectedPool ? (taskConfigByPool[selectedPool] ?? null) : null;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Pool-Agnostic Section */}
      <div className="space-y-6 border-b border-zinc-200 p-6 dark:border-zinc-800">
        {/* Hostname */}
        <section>
          <h3 className={cn("mb-2", heading.section)}>
            Hostname
          </h3>
          <CopyableValue value={resource.hostname} />
        </section>

        {/* Resource Capacity */}
        <section>
          <h3 className={cn("mb-2", heading.section)}>
            Capacity
          </h3>
          <div className="space-y-4">
            <CapacityBar
              label="GPU"
              used={resource.gpu.used}
              total={resource.gpu.total}
            />
            <CapacityBar
              label="CPU"
              used={resource.cpu.used}
              total={resource.cpu.total}
            />
            <CapacityBar
              label="Memory"
              used={resource.memory.used}
              total={resource.memory.total}
              isBytes
            />
            <CapacityBar
              label="Storage"
              used={resource.storage.used}
              total={resource.storage.total}
              isBytes
            />
          </div>
        </section>

        {/* Conditions if any */}
        {resource.conditions.length > 0 && (
          <section>
            <h3 className={cn("mb-2", heading.section)}>
              Conditions
            </h3>
            <div className="flex flex-wrap gap-2">
              {resource.conditions.map((condition, idx) => (
                <span
                  key={idx}
                  className="inline-flex rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                >
                  {condition}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Pool-Specific Section */}
      <div className="p-6">
        <section>
          <h3 className={cn("mb-2", heading.section)}>
            Pool Configuration
          </h3>

          {error ? (
            <ApiError
              error={error}
              onRetry={refetch}
              title="Failed to load pool details"
              authAware
              loginMessage="You need to log in to view resource details."
            />
          ) : isLoadingPools ? (
            <div className="animate-pulse space-y-3">
              <div className="h-8 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-16 rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ) : pools.length === 0 ? (
            <p className={text.muted}>This resource is not a member of any pool.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              {/* Pool Selector Header */}
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100/50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/30">
                <ItemSelector
                  items={pools}
                  selectedItem={selectedPool}
                  onSelect={handlePoolSelect}
                  aria-label="Select pool"
                />
              </div>

              {/* Task Config Content */}
              <div className="p-3">
                {taskConfig ? (
                  <TaskConfigContent config={taskConfig} />
                ) : (
                  <p className={text.muted}>
                    No configuration available for this platform.
                  </p>
                )}
              </div>
            </div>
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
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Host Network</span>
          <BooleanIndicator value={config.hostNetworkAllowed} />
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Privileged Mode</span>
          <BooleanIndicator value={config.privilegedAllowed} />
        </div>
      </div>

      {/* Default Mounts */}
      {config.defaultMounts.length > 0 && (
        <div>
          <div className="mb-1.5 text-sm text-zinc-600 dark:text-zinc-400">Default Mounts</div>
          <div className="flex flex-col gap-1">
            {config.defaultMounts.map((mount, idx) => (
              <CopyableBlock key={idx} value={mount} />
            ))}
          </div>
        </div>
      )}

      {/* Allowed Mounts */}
      {config.allowedMounts.length > 0 && (
        <div>
          <div className="mb-1.5 text-sm text-zinc-600 dark:text-zinc-400">Allowed Mounts</div>
          <div className="flex flex-col gap-1">
            {config.allowedMounts.map((mount, idx) => (
              <CopyableBlock key={idx} value={mount} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
