"use client";

// Copyright (c) 2024-2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { X, Check, Ban, FolderOpen, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CapacityBar } from "@/components/shared/capacity-bar";
import { ResponsivePoolChips } from "@/components/shared/responsive-pool-chips";
import { useResourceDetail, type Resource, type PlatformConfig } from "@/lib/api/adapter";
import { getResourceAllocationTypeDisplay } from "@/lib/constants/ui";

interface ResourcePanelProps {
  /** Resource to display, or null to hide panel */
  resource: Resource | null;
  /**
   * Pool context for displaying pool-specific information.
   * If omitted, panel shows resource across all pools.
   */
  poolName?: string;
  /**
   * Platform configurations for task config display.
   * Only used when poolName is provided.
   */
  platformConfigs?: Record<string, PlatformConfig>;
  /** Callback when panel is closed */
  onClose: () => void;
}

/**
 * Slide-in panel showing detailed resource information.
 *
 * Can be used in two contexts:
 * 1. Pool context: Shows pool-specific task configurations (provide poolName)
 * 2. Cross-pool context: Shows resource across all pools (omit poolName)
 */
export function ResourcePanel({
  resource,
  poolName,
  platformConfigs = {},
  onClose,
}: ResourcePanelProps) {
  // All business logic is encapsulated in the adapter hook
  const { pools, primaryPool, taskConfig, isLoadingPools } = useResourceDetail(
    resource,
    platformConfigs,
    poolName // Pass context pool to determine primary
  );

  if (!resource) return null;

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
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
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

          {/* Task Configurations */}
          {taskConfig && (
            <section>
              <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Task Configurations
              </h3>
              <div className="space-y-3">
                {/* Boolean flags */}
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      Host Network Allowed
                    </span>
                    <BooleanIndicator value={taskConfig.hostNetworkAllowed} />
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      Privileged Mode Allowed
                    </span>
                    <BooleanIndicator value={taskConfig.privilegedAllowed} />
                  </div>
                </div>

                {/* Default Mounts */}
                {taskConfig.defaultMounts.length > 0 && (
                  <MountsList title="Default Mounts" mounts={taskConfig.defaultMounts} />
                )}

                {/* Allowed Mounts */}
                {taskConfig.allowedMounts.length > 0 && (
                  <MountsList title="Allowed Mounts" mounts={taskConfig.allowedMounts} />
                )}
              </div>
            </section>
          )}

          {/* Configuration */}
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

        {/* Pool Membership Footer */}
        {(pools.length > 0 || isLoadingPools) && (
          <div className="shrink-0 border-t border-zinc-200 bg-zinc-50 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start gap-2">
              <Layers className="mt-1 h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              <ResponsivePoolChips
                pools={pools}
                primaryPool={primaryPool}
                isLoading={isLoadingPools}
                className="flex-1"
              />
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function BooleanIndicator({ value }: { value: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex w-14 items-center justify-end gap-1.5 text-sm font-medium",
        value
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-zinc-400"
      )}
    >
      {value ? <Check className="h-4 w-4 shrink-0" /> : <Ban className="h-4 w-4 shrink-0" />}
      <span className="w-6">{value ? "Yes" : "No"}</span>
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
      <div className="space-y-1">
        {mounts.map((mount, idx) => (
          <div
            key={idx}
            className="rounded bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {mount}
          </div>
        ))}
      </div>
    </div>
  );
}

// NOTE: CapacityBar has been moved to @/components/shared/capacity-bar for reuse
// across pool detail and resource detail views.
