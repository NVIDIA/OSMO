/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Share2, Check, Ban, ChevronDown, Search, ExternalLink, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { progressTrack, getProgressColor } from "@/lib/styles";
import type { Pool, PlatformConfig } from "@/lib/api/adapter";
import { getSharingInfo } from "@/lib/api/adapter/transforms";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { getChipLayoutSpacious } from "../../hooks/use-layout-dimensions";
import { useExpandableChips } from "@/lib/hooks";
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

export const PanelContent = memo(function PanelContent({
  pool,
  sharingGroups,
  onPoolSelect,
  selectedPlatform: selectedPlatformProp,
  onPlatformSelect,
}: PanelContentProps) {
  const sharedWith = useMemo(() => getSharingInfo(pool.name, sharingGroups), [pool.name, sharingGroups]);

  // Derive effective platform: use prop if valid for this pool, else fall back to default
  const defaultPlatform = pool.defaultPlatform ?? pool.platforms[0] ?? null;
  const effectivePlatform = useMemo(() => {
    // If prop is set and valid for this pool, use it
    if (selectedPlatformProp && pool.platforms.includes(selectedPlatformProp)) {
      return selectedPlatformProp;
    }
    // Otherwise use default
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
    [onPlatformSelect, defaultPlatform]
  );

  // Navigate to another pool when clicking a shared pool chip
  const handlePoolClick = useCallback(
    (poolName: string) => {
      onPoolSelect?.(poolName);
    },
    [onPoolSelect]
  );

  const quotaPercent = pool.quota.limit > 0 ? (pool.quota.used / pool.quota.limit) * 100 : 0;
  const capacityPercent = pool.quota.totalCapacity > 0 ? (pool.quota.totalUsage / pool.quota.totalCapacity) * 100 : 0;

  // Get selected platform config
  const platformConfig = effectivePlatform ? pool.platformConfigs[effectivePlatform] : null;

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            GPU Quota
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Used</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">
                {pool.quota.used} / {pool.quota.limit}
              </span>
            </div>
            <div className={cn(progressTrack, "pools-progress-track h-2")}>
              <div
                className={cn("h-full rounded-full transition-all", getProgressColor(quotaPercent))}
                style={{ width: `${Math.min(quotaPercent, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>{pool.quota.free} free</span>
              <span>{Math.round(quotaPercent)}% utilized</span>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
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
            <div className={cn(progressTrack, "pools-progress-track h-2")}>
              <div
                className={cn("h-full rounded-full transition-all", getProgressColor(capacityPercent))}
                style={{ width: `${Math.min(capacityPercent, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>{pool.quota.totalFree} idle</span>
              <span>{Math.round(capacityPercent)}% utilized</span>
            </div>
          </div>

          {sharedWith && sharedWith.length > 0 && (
            <div className="mt-3 rounded-lg bg-gradient-to-r from-violet-500/[0.08] to-fuchsia-500/[0.05] p-3 ring-1 ring-inset ring-violet-500/15 dark:ring-violet-400/20">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                <Share2 className="h-3.5 w-3.5" />
                Shares capacity with
              </div>
              <ExpandablePoolChips pools={sharedWith} onPoolClick={handlePoolClick} />
            </div>
          )}
        </section>

        {/* Platform Configuration */}
        {pool.platforms.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Platform Configuration
            </h3>

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

        {/* ============================================================
         * PLACEHOLDER: Cross-Reference Sections
         *
         * These sections will be implemented when workflow/resource pages
         * are complete and cross-referencing APIs are available.
         *
         * VISUALIZATION IDEAS:
         *
         * 1. ACTIVE RESOURCES / JOBS
         *    - Compact list with status dots (running/pending/completed)
         *    - Mini progress bars for long-running jobs
         *    - Click to navigate to resource details
         *    - Show: job name, owner, duration, GPU count
         *    - Group by workflow if multiple jobs from same workflow
         *
         * 2. RECENT WORKFLOWS
         *    - Timeline-style list (most recent at top)
         *    - Status badge (success/failed/running)
         *    - Workflow name as link → workflow detail page
         *    - Sparkline showing historical usage on this pool
         *    - "View all" link to filtered workflow list
         *
         * 3. POOL UTILIZATION OVER TIME
         *    - Small area chart showing GPU usage over 24h/7d
         *    - Hover to see point-in-time details
         *    - Compare quota vs actual usage
         *
         * 4. TOP USERS / TEAMS
         *    - Horizontal bar chart of GPU hours by user/team
         *    - Click user to filter workflows
         *    - Time period selector (today/week/month)
         *
         * 5. QUICK ACTIONS
         *    - "Submit job to this pool" button
         *    - "View all jobs" link
         *    - "Pool settings" (for admins)
         * ============================================================ */}

        {/* Active Resources Placeholder */}
        <section className="opacity-50">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Active Resources
          </h3>
          <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
            <p className="text-center text-sm text-zinc-400 dark:text-zinc-500">
              Jobs and resources running on this pool will appear here
            </p>
            <p className="mt-1 text-center text-xs text-zinc-400 dark:text-zinc-600">
              Coming soon: Cross-reference with Resources page
            </p>
          </div>
        </section>

        {/* Recent Workflows Placeholder */}
        <section className="opacity-50">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Recent Workflows
          </h3>
          <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
            <p className="text-center text-sm text-zinc-400 dark:text-zinc-500">
              Workflows that have used this pool will appear here
            </p>
            <p className="mt-1 text-center text-xs text-zinc-400 dark:text-zinc-600">
              Coming soon: Cross-reference with Workflows page
            </p>
          </div>
        </section>
      </div>
    </div>
  );
});

// =============================================================================
// Platform Selector Component
// Unified component that adapts to the number of platforms:
// - 1 platform: Static label
// - 2-5 platforms: Simple dropdown
// - 6+ platforms: Searchable combobox
// =============================================================================

/** Threshold for switching to searchable mode */
const SEARCH_THRESHOLD = 6;

interface PlatformSelectorProps {
  platforms: string[];
  defaultPlatform: string | null;
  selectedPlatform: string | null;
  onSelectPlatform: (platform: string) => void;
}

function PlatformSelector({ platforms, defaultPlatform, selectedPlatform, onSelectPlatform }: PlatformSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  const sortedPlatforms = useMemo(() => [...platforms].sort(), [platforms]);
  const isDefault = selectedPlatform === defaultPlatform;

  // Filter platforms by search query (only used for 6+ platforms)
  const filteredPlatforms = useMemo(() => {
    if (!searchQuery) return sortedPlatforms;
    const q = searchQuery.toLowerCase();
    return sortedPlatforms.filter((p) => p.toLowerCase().includes(q));
  }, [sortedPlatforms, searchQuery]);

  // Focus search input and scroll current item into view when dropdown opens
  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      setTimeout(() => {
        searchInputRef.current?.focus();
        const currentItem = listContainerRef.current?.querySelector('[data-current="true"]');
        if (currentItem) {
          currentItem.scrollIntoView({ block: "center", behavior: "instant" });
        }
      }, 0);
    } else {
      setSearchQuery("");
    }
  }, []);

  // Single platform: Static label
  if (platforms.length === 1) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {platforms[0]}
        </span>
        {defaultPlatform === platforms[0] && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
            default
          </span>
        )}
      </div>
    );
  }

  // 2-5 platforms: Simple dropdown
  if (platforms.length < SEARCH_THRESHOLD) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-md py-0.5 pr-1 text-zinc-900 transition-colors hover:bg-zinc-200/50 dark:text-zinc-100 dark:hover:bg-zinc-700/50"
            aria-label="Select platform"
          >
            <span className="text-sm font-medium">{selectedPlatform}</span>
            {isDefault && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                default
              </span>
            )}
            <ChevronDown className="size-3.5 text-zinc-500 dark:text-zinc-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {sortedPlatforms.map((platform) => {
            const isCurrent = platform === selectedPlatform;
            const isPlatformDefault = platform === defaultPlatform;
            return (
              <DropdownMenuItem
                key={platform}
                onSelect={() => {
                  onSelectPlatform(platform);
                }}
                className={cn(
                  "flex items-center gap-2",
                  isCurrent && "bg-zinc-100 dark:bg-zinc-800"
                )}
              >
                <span className={cn("flex-1 truncate", isCurrent && "font-medium")}>
                  {platform}
                </span>
                {isPlatformDefault && (
                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                    default
                  </span>
                )}
                {isCurrent && <Check className="size-4 shrink-0 text-emerald-500" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // 6+ platforms: Searchable dropdown
  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md py-0.5 pr-1 text-zinc-900 transition-colors hover:bg-zinc-200/50 dark:text-zinc-100 dark:hover:bg-zinc-700/50"
          aria-label="Select platform"
        >
          <span className="text-sm font-medium">{selectedPlatform}</span>
          {isDefault && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
              default
            </span>
          )}
          <ChevronDown className="size-3.5 text-zinc-500 dark:text-zinc-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-0">
        {/* Search input */}
        <div className="flex items-center border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <Search className="mr-2 size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search platforms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            onKeyDown={(e) => {
              // Stop propagation for navigation keys (let Escape bubble to close dropdown)
              if (e.key !== "Escape") {
                e.stopPropagation();
              }
            }}
          />
        </div>
        {/* Platform list */}
        <div ref={listContainerRef} className="max-h-60 overflow-y-auto py-1">
          {filteredPlatforms.length === 0 ? (
            <div className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-500">
              No platforms found
            </div>
          ) : (
            filteredPlatforms.map((platform) => {
              const isCurrent = platform === selectedPlatform;
              const isPlatformDefault = platform === defaultPlatform;
              return (
                <DropdownMenuItem
                  key={platform}
                  data-current={isCurrent ? "true" : undefined}
                  onSelect={() => {
                    onSelectPlatform(platform);
                    setSearchQuery("");
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-2",
                    isCurrent && "bg-zinc-100/50 dark:bg-zinc-800/50"
                  )}
                >
                  <span className={cn("flex-1 truncate text-sm", isCurrent && "font-medium")}>
                    {platform}
                  </span>
                  {isPlatformDefault && (
                    <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                      default
                    </span>
                  )}
                  {isCurrent && <Check className="size-4 shrink-0 text-emerald-500" />}
                </DropdownMenuItem>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// =============================================================================
// Platform Config Content Component
// =============================================================================

interface PlatformConfigContentProps {
  config: PlatformConfig;
}

function PlatformConfigContent({ config }: PlatformConfigContentProps) {
  return (
    <div className="space-y-3">
      {/* Description */}
      {config.description && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{config.description}</p>
      )}

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

// =============================================================================
// Expandable Pool Chips Component
// =============================================================================

interface ExpandablePoolChipsProps {
  pools: string[];
  onPoolClick?: (poolName: string) => void;
}

function ExpandablePoolChips({ pools, onPoolClick }: ExpandablePoolChipsProps) {
  const layout = useMemo(() => getChipLayoutSpacious(), []);

  const {
    containerRef,
    expanded,
    setExpanded,
    sortedItems,
    displayedItems,
    overflowCount,
    visibleCount,
  } = useExpandableChips({ items: pools, layout });

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex w-full items-center gap-1.5 -m-0.5 p-0.5",
        expanded ? "flex-wrap" : "flex-nowrap overflow-hidden"
      )}
    >
      {displayedItems.map((poolName) => (
        <button
          key={poolName}
          type="button"
          onClick={() => onPoolClick?.(poolName)}
          className={cn(
            "group inline-flex shrink-0 items-center gap-1 rounded-md bg-white/60 px-2 py-1 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 transition-colors hover:bg-violet-100 hover:text-violet-700 hover:ring-violet-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-violet-900/50 dark:hover:text-violet-300 dark:hover:ring-violet-600",
            expanded && "max-w-full"
          )}
          title={`View ${poolName}`}
        >
          <span className={expanded ? "truncate" : undefined}>{poolName}</span>
          <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ))}

      {/* Overflow indicator */}
      {!expanded && overflowCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex shrink-0 items-center rounded-md bg-violet-100 px-2 py-1 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200 transition-colors hover:bg-violet-200 dark:bg-violet-900/50 dark:text-violet-300 dark:ring-violet-700 dark:hover:bg-violet-800/50"
          title={`${overflowCount} more: ${sortedItems.slice(visibleCount).join(", ")}`}
        >
          +{overflowCount}
        </button>
      )}

      {/* Collapse button */}
      {expanded && sortedItems.length > 1 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-flex shrink-0 items-center rounded-md bg-violet-100 px-2 py-1 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200 transition-colors hover:bg-violet-200 dark:bg-violet-900/50 dark:text-violet-300 dark:ring-violet-700 dark:hover:bg-violet-800/50"
        >
          less
        </button>
      )}
    </div>
  );
}

// =============================================================================
// Boolean Indicator Component
// =============================================================================

function BooleanIndicator({ value }: { value: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm",
        value ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"
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
      <div className="mb-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        {title}
      </div>
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
      // Fallback for older browsers
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
