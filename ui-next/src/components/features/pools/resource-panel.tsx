"use client";

// Copyright (c) 2024-2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { X, Check, Ban, FolderOpen } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CapacityBar } from "@/components/shared/capacity-bar";
import { useResourceDetail, type Resource, type PlatformConfig } from "@/lib/api/adapter";

interface ResourcePanelProps {
  /** Resource to display, or null to hide panel */
  resource: Resource | null;
  /**
   * Pool context for displaying pool-specific information.
   * If omitted, panel shows resource in "fleet" context.
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
 * 1. Pool context: Shows pool-specific task configurations
 * 2. Fleet context: Shows resource across all pools (omit poolName)
 *
 * Reusable for both pool detail page and future resources fleet page.
 */
export function ResourcePanel({
  resource,
  poolName,
  platformConfigs = {},
  onClose,
}: ResourcePanelProps) {
  // All business logic is encapsulated in the adapter hook
  const { pools, showPoolMembership, taskConfig, isLoadingMemberships } = useResourceDetail(resource, platformConfigs);

  if (!resource) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 min-h-screen bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed bottom-0 right-0 top-0 z-50 w-full max-w-md overflow-y-auto border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{resource.name}</h2>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  resource.resourceType === "RESERVED"
                    ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                    : resource.resourceType === "SHARED"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                )}
              >
                {resource.resourceType}
              </span>
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {resource.platform}
              {poolName && <> · {poolName}</>}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="space-y-6 p-6">
          {/* Pool Membership - only shown for SHARED resources */}
          {showPoolMembership && (
            <section>
              <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Pool Membership
              </h3>
              {isLoadingMemberships ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                  Loading...
                </div>
              ) : pools.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {pools.map((pool) => (
                    <Link
                      key={pool}
                      href={`/pools/${pool}`}
                      className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-700"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {pool}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">No pools found</p>
              )}
            </section>
          )}

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
      </div>
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
// across pool detail, resource detail, and fleet views.
