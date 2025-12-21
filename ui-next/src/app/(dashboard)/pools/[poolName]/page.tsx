"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Server, Cpu, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResourceTable, ResourceCapacitySummary, QuotaBar } from "@/components/features/pools";
import { FilterBar } from "@/components/shared/filter-bar";
import { usePoolDetail } from "@/headless";
import { getPoolStatusDisplay } from "@/lib/constants/ui";
import { heading } from "@/lib/styles";

export default function PoolDetailPage() {
  const params = useParams();
  const poolName = params.poolName as string;

  const {
    pool,
    platforms,
    resourceTypes,
    platformConfigs,
    filteredResources,
    resourceCount,
    filteredResourceCount,
    search,
    setSearch,
    clearSearch,
    selectedPlatforms,
    togglePlatform,
    clearPlatformFilter,
    selectedResourceTypes,
    toggleResourceType,
    displayMode,
    setDisplayMode,
    activeFilters,
    removeFilter,
    clearAllFilters,
    isLoading,
  } = usePoolDetail({ poolName });

  const status = getPoolStatusDisplay(pool?.status);

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

      {/* Resources section with unified filter bar */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-zinc-400" />
          <h2 className={heading.section}>Resources</h2>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {filteredResourceCount !== resourceCount ? (
              <>({filteredResourceCount} of {resourceCount})</>
            ) : (
              <>({resourceCount})</>
            )}
          </span>
        </div>

        <FilterBar
          activeFilters={activeFilters}
          onRemoveFilter={removeFilter}
          onClearAll={clearAllFilters}
        >
          <FilterBar.Search
            value={search}
            onChange={setSearch}
            onClear={clearSearch}
            placeholder="Search resources..."
          />

          {platforms.length > 0 && (
            <FilterBar.MultiSelect
              icon={Cpu}
              label="Platform"
              options={platforms}
              selected={selectedPlatforms}
              onToggle={togglePlatform}
              onClear={clearPlatformFilter}
              searchable
              searchPlaceholder="Search platforms..."
            />
          )}

          {resourceTypes.length > 0 && (
            <FilterBar.SingleSelect
              icon={Box}
              label="Type"
              options={resourceTypes}
              value={[...selectedResourceTypes][0]}
              onChange={toggleResourceType}
            />
          )}

          <FilterBar.Actions>
            <FilterBar.Toggle
              label="View by"
              options={[
                { value: "free" as const, label: "Free" },
                { value: "used" as const, label: "Used" },
              ]}
              value={displayMode}
              onChange={setDisplayMode}
            />
          </FilterBar.Actions>
        </FilterBar>

        {/* Capacity summary boxes */}
        <ResourceCapacitySummary
          resources={filteredResources}
          displayMode={displayMode}
          isLoading={isLoading}
        />

        <ResourceTable
          resources={filteredResources}
          isLoading={isLoading}
          poolName={poolName}
          platformConfigs={platformConfigs}
          displayMode={displayMode}
        />
      </section>
    </div>
  );
}
