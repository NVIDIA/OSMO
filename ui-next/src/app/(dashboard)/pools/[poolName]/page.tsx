"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { NodeTable, QuotaBar, FilterBar } from "@/components/features/pools";
import { usePoolDetail } from "@/headless";
import { PoolStatusDisplay, DefaultPoolStatusDisplay } from "@/lib/constants/ui";
import { heading } from "@/lib/styles";

export default function PoolDetailPage() {
  const params = useParams();
  const poolName = params.poolName as string;

  const {
    pool,
    platforms,
    resourceTypes,
    platformConfigs,
    filteredNodes,
    nodeCount,
    filteredNodeCount,
    search,
    setSearch,
    clearSearch,
    selectedPlatforms,
    togglePlatform,
    clearPlatformFilter,
    selectedResourceTypes,
    toggleResourceType,
    clearResourceTypeFilter,
    resourceDisplayMode,
    setResourceDisplayMode,
    activeFilters,
    removeFilter,
    clearAllFilters,
    isLoading,
  } = usePoolDetail({ poolName });

  const status = pool?.status
    ? (PoolStatusDisplay[pool.status] ?? DefaultPoolStatusDisplay)
    : DefaultPoolStatusDisplay;

  return (
    <div className="space-y-6">
      {/* Header with breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/pools"
            className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Pools
          </Link>
          <span className="text-zinc-300 dark:text-zinc-700">/</span>
          <h1 className="text-2xl font-bold tracking-tight">{poolName}</h1>
        </div>

        {pool && (
          <div
            className={cn(
              "flex items-center gap-2 text-sm font-medium",
              status.className
            )}
          >
            <span>{status.icon}</span>
            <span>{status.label}</span>
          </div>
        )}
      </div>

      {/* Description */}
      {pool?.description && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {pool.description}
        </p>
      )}

      {/* Quota bar */}
      {pool && (
        <QuotaBar
          used={pool.quota.used}
          limit={pool.quota.limit}
          free={pool.quota.free}
          isLoading={isLoading}
        />
      )}

      {/* Nodes section with unified filter bar */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-zinc-400" />
          <h2 className={heading.section}>Nodes</h2>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {filteredNodeCount !== nodeCount ? (
              <>({filteredNodeCount} of {nodeCount})</>
            ) : (
              <>({nodeCount})</>
            )}
          </span>
        </div>

        <FilterBar
          search={search}
          onSearchChange={setSearch}
          onClearSearch={clearSearch}
          platforms={platforms}
          selectedPlatforms={selectedPlatforms}
          onTogglePlatform={togglePlatform}
          onClearPlatformFilter={clearPlatformFilter}
          resourceTypes={resourceTypes}
          selectedResourceTypes={selectedResourceTypes}
          onToggleResourceType={toggleResourceType}
          onClearResourceTypeFilter={clearResourceTypeFilter}
          resourceDisplayMode={resourceDisplayMode}
          onResourceDisplayModeChange={setResourceDisplayMode}
          activeFilters={activeFilters}
          onRemoveFilter={removeFilter}
          onClearAllFilters={clearAllFilters}
        />

        <NodeTable
          nodes={filteredNodes}
          isLoading={isLoading}
          poolName={poolName}
          platformConfigs={platformConfigs}
          displayMode={resourceDisplayMode}
        />
      </section>
    </div>
  );
}
