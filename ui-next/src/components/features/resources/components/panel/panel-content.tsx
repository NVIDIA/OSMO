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

import { useState, useCallback } from "react";
import { Check, Ban, ChevronDown, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { CapacityBar } from "@/components/shared/capacity-bar";
import { ApiError } from "@/components/shared";
import { useResourceDetail, type Resource, type TaskConfig } from "@/lib/api/adapter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
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
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
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
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
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
            <p className="text-sm text-zinc-500 dark:text-zinc-400">This resource is not a member of any pool.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              {/* Pool Selector Header */}
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100/50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/30">
                <PoolSelector
                  pools={pools}
                  selectedPool={selectedPool}
                  onSelectPool={handlePoolSelect}
                />
              </div>

              {/* Task Config Content */}
              <div className="p-3">
                {taskConfig ? (
                  <TaskConfigContent config={taskConfig} />
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
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
// Pool Selector Component
// =============================================================================

interface PoolSelectorProps {
  pools: string[];
  selectedPool: string | null;
  onSelectPool: (pool: string) => void;
}

function PoolSelector({ pools, selectedPool, onSelectPool }: PoolSelectorProps) {
  // Single pool: Static label
  if (pools.length === 1) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {pools[0]}
        </span>
      </div>
    );
  }

  // Multiple pools: Dropdown
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md py-0.5 pr-1 text-zinc-900 transition-colors hover:bg-zinc-200/50 dark:text-zinc-100 dark:hover:bg-zinc-700/50"
          aria-label="Select pool"
        >
          <span className="text-sm font-medium">{selectedPool}</span>
          <ChevronDown className="size-3.5 text-zinc-500 dark:text-zinc-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {pools.map((pool) => {
          const isCurrent = pool === selectedPool;
          return (
            <DropdownMenuItem
              key={pool}
              onSelect={() => onSelectPool(pool)}
              className={cn(
                "flex items-center gap-2",
                isCurrent && "bg-zinc-100 dark:bg-zinc-800"
              )}
            >
              <span className={cn("flex-1 truncate", isCurrent && "font-medium")}>
                {pool}
              </span>
              {isCurrent && <Check className="size-4 shrink-0 text-emerald-500" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
        value ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500",
      )}
    >
      {value ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
      {value ? "Allowed" : "Not allowed"}
    </span>
  );
}

function MountsList({ title, mounts }: { title: string; mounts: string[] }) {
  return (
    <div>
      <div className="mb-1.5 text-sm text-zinc-600 dark:text-zinc-400">{title}</div>
      <div className="flex flex-col gap-1">
        {mounts.map((mount, idx) => (
          <CopyableMount key={idx} value={mount} />
        ))}
      </div>
    </div>
  );
}

function CopyableMount({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      console.warn("Clipboard API not available");
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "group flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition-colors",
        copied
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
      )}
      title={copied ? "Copied!" : `Copy ${value}`}
    >
      <span className="break-all">{value}</span>
      {copied ? (
        <Check className="mt-0.5 size-3 shrink-0" />
      ) : (
        <Copy className="mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}
