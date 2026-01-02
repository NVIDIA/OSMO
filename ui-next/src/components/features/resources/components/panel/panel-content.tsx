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
import { Check, Ban, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { CapacityBar } from "@/components/shared/capacity-bar";
import { ApiError, type ApiErrorProps } from "@/components/shared";
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
        {/* Resource Capacity */}
        <section>
          <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Capacity</h3>
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
            <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Conditions</h3>
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
          <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Pool Configuration</h3>

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
            <p className="text-sm text-zinc-500 dark:text-zinc-400">This resource is not a member of any pool.</p>
          ) : pools.length === 1 ? (
            // Single pool - flat styling
            <div>
              <div className="mb-4 border-b border-zinc-200 pb-2 dark:border-zinc-700">
                <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{pools[0]}</span>
              </div>
              {taskConfig ? (
                <TaskConfigContent config={taskConfig} />
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  No configuration available for this platform.
                </p>
              )}
            </div>
          ) : (
            // Multiple pools - tabs with flat content
            <div>
              <PoolTabs
                pools={pools}
                selectedPool={selectedPool}
                onSelectPool={handlePoolSelect}
              />
              <div className="pt-4">
                {taskConfig ? (
                  <TaskConfigContent config={taskConfig} />
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    No configuration available for this platform in {selectedPool}.
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
// Pool Tabs Component
// =============================================================================

interface PoolTabsProps {
  pools: string[];
  selectedPool: string | null;
  onSelectPool: (pool: string) => void;
}

function PoolTabs({ pools, selectedPool, onSelectPool }: PoolTabsProps) {
  return (
    <div className="relative border-b border-zinc-200 dark:border-zinc-700">
      <div className="flex">
        {pools.map((pool) => {
          const isActive = pool === selectedPool;
          return (
            <button
              key={pool}
              onClick={() => onSelectPool(pool)}
              className={cn(
                "relative px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300",
                "after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-emerald-500",
                "after:origin-center after:transition-transform after:duration-200 after:ease-out",
                isActive ? "after:scale-x-100" : "after:scale-x-0",
              )}
            >
              {pool}
            </button>
          );
        })}
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
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Host Network Allowed</span>
          <BooleanIndicator value={config.hostNetworkAllowed} />
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Privileged Mode Allowed</span>
          <BooleanIndicator value={config.privilegedAllowed} />
        </div>
      </div>

      {/* Default Mounts */}
      {config.defaultMounts.length > 0 && (
        <MountsList
          title="Default Mounts"
          mounts={config.defaultMounts}
        />
      )}

      {/* Allowed Mounts */}
      {config.allowedMounts.length > 0 && (
        <MountsList
          title="Allowed Mounts"
          mounts={config.allowedMounts}
        />
      )}
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

function BooleanIndicator({ value }: { value: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm",
        value ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500",
      )}
    >
      {value ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
      {value ? "Yes" : "No"}
    </span>
  );
}

function MountsList({ title, mounts }: { title: string; mounts: string[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-400">
        <FolderOpen className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {mounts.map((mount, idx) => (
          <span
            key={idx}
            className="inline-flex rounded-full bg-zinc-100 px-2.5 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          >
            {mount}
          </span>
        ))}
      </div>
    </div>
  );
}
