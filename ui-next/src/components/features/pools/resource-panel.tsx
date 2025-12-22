"use client";

// Copyright (c) 2024-2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { useState, useRef, useEffect } from "react";
import { X, Check, Ban, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CapacityBar } from "@/components/shared/capacity-bar";
import { useResourceDetail, type Resource, type TaskConfig } from "@/lib/api/adapter";
import { getResourceAllocationTypeDisplay } from "@/lib/constants/ui";

interface ResourcePanelProps {
  /** Resource to display, or null to hide panel */
  resource: Resource | null;
  /**
   * Pool context for displaying pool-specific information.
   * If omitted, panel shows resource across all pools.
   */
  poolName?: string;
  /** Callback when panel is closed */
  onClose: () => void;
}

/**
 * Slide-in panel showing detailed resource information.
 *
 * Shows pool-agnostic info (capacity, resource info, conditions) at the top,
 * and pool-specific task configurations in a tabbed interface below.
 */
export function ResourcePanel({
  resource,
  poolName,
  onClose,
}: ResourcePanelProps) {
  // All business logic is encapsulated in the adapter hook
  const { pools, initialPool, taskConfigByPool, isLoadingPools } = useResourceDetail(
    resource,
    poolName // Pass context pool to determine initial selection
  );

  if (!resource) return null;

  return (
    <ResourcePanelContent
      key={resource.name} // Reset state when resource changes
      resource={resource}
      pools={pools}
      initialPool={initialPool}
      taskConfigByPool={taskConfigByPool}
      isLoadingPools={isLoadingPools}
      onClose={onClose}
    />
  );
}

// =============================================================================
// Panel Content - separated to enable key-based state reset
// =============================================================================

interface ResourcePanelContentProps {
  resource: Resource;
  pools: string[];
  initialPool: string | null;
  taskConfigByPool: Record<string, TaskConfig | null>;
  isLoadingPools: boolean;
  onClose: () => void;
}

function ResourcePanelContent({
  resource,
  pools,
  initialPool,
  taskConfigByPool,
  isLoadingPools,
  onClose,
}: ResourcePanelContentProps) {
  // Track selected pool tab - initialized from initialPool
  const [selectedPool, setSelectedPool] = useState<string | null>(initialPool);

  // Get task config for selected pool
  const taskConfig = selectedPool ? taskConfigByPool[selectedPool] ?? null : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 min-h-screen bg-black/20 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel - WCAG 2.1 compliant slide-out */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-panel-title"
        className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="resource-panel-title" className="text-lg font-semibold">{resource.name}</h2>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  getResourceAllocationTypeDisplay(resource.resourceType).className
                )}
              >
                {getResourceAllocationTypeDisplay(resource.resourceType).label}
              </span>
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {resource.platform}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close resource panel">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Pool-Agnostic Section */}
          <div className="space-y-6 border-b border-zinc-200 p-6 dark:border-zinc-800">
            {/* Resource Capacity */}
            <section>
              <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Capacity
              </h3>
              <div className="space-y-4">
                <CapacityBar label="GPU" used={resource.gpu.used} total={resource.gpu.total} />
                <CapacityBar label="CPU" used={resource.cpu.used} total={resource.cpu.total} />
                <CapacityBar label="Memory" used={resource.memory.used} total={resource.memory.total} unit="Gi" />
                <CapacityBar label="Storage" used={resource.storage.used} total={resource.storage.total} unit="Gi" />
              </div>
            </section>

            {/* Resource Info */}
            <section>
              <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Resource Info
              </h3>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    Backend
                  </span>
                  <span className="text-sm font-medium">{resource.backend}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    Hostname
                  </span>
                  <span className="text-sm font-medium">{resource.hostname}</span>
                </div>
              </div>
            </section>

            {/* Conditions if any */}
            {resource.conditions.length > 0 && (
              <section>
                <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
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
              <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Pool Configuration
              </h3>

              {isLoadingPools ? (
                <div className="animate-pulse space-y-3">
                  <div className="h-8 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
                  <div className="h-16 rounded bg-zinc-200 dark:bg-zinc-800" />
                </div>
              ) : pools.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  This resource is not a member of any pool.
                </p>
              ) : pools.length === 1 ? (
                // Single pool - flat styling
                <div>
                  <div className="mb-4 border-b border-zinc-200 pb-2 dark:border-zinc-700">
                    <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      {pools[0]}
                    </span>
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
                    onSelectPool={setSelectedPool}
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
      </aside>
    </>
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
  const tabsRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // Update indicator position when selected pool changes
  // Using a ref to avoid re-attaching resize listener on every selectedPool change
  const updateIndicator = () => {
    if (!tabsRef.current || !selectedPool) return;

    const container = tabsRef.current;
    const activeTab = container.querySelector(`[data-pool="${selectedPool}"]`) as HTMLButtonElement;

    if (activeTab) {
      setIndicatorStyle({
        left: activeTab.offsetLeft,
        width: activeTab.offsetWidth,
      });
    }
  };

  // Store the update function in a ref so resize handler always has latest version
  const updateIndicatorRef = useRef(updateIndicator);
  updateIndicatorRef.current = updateIndicator;

  // Update indicator when selectedPool changes
  useEffect(() => {
    updateIndicator();
  }, [selectedPool]);

  // Attach resize listener once - uses ref to avoid re-attaching on state changes
  useEffect(() => {
    const handleResize = () => updateIndicatorRef.current();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="relative border-b border-zinc-200 dark:border-zinc-700" ref={tabsRef}>
      <div className="flex">
        {pools.map((pool) => (
          <button
            key={pool}
            data-pool={pool}
            onClick={() => onSelectPool(pool)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              pool === selectedPool
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
            )}
          >
            {pool}
          </button>
        ))}
      </div>
      {/* Sliding indicator */}
      <div
        className="absolute bottom-0 h-0.5 bg-emerald-500 transition-all duration-200 ease-out"
        style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
      />
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
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Host Network Allowed
          </span>
          <BooleanIndicator value={config.hostNetworkAllowed} />
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Privileged Mode Allowed
          </span>
          <BooleanIndicator value={config.privilegedAllowed} />
        </div>
      </div>

      {/* Default Mounts */}
      {config.defaultMounts.length > 0 && (
        <MountsList title="Default Mounts" mounts={config.defaultMounts} />
      )}

      {/* Allowed Mounts */}
      {config.allowedMounts.length > 0 && (
        <MountsList title="Allowed Mounts" mounts={config.allowedMounts} />
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
        value
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-zinc-400 dark:text-zinc-500"
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
