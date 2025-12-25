"use client";

// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Server, Cpu, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import { VirtualizedResourceTable, QuotaBar } from "@/components/features/pools";
import { FilterBar, ApiError, AdaptiveSummary } from "@/components/shared";
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
    filteredResources,
    resourceCount,
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
    filterCount,
    isLoading,
    poolError,
    resourcesError,
    refetch,
  } = usePoolDetail({ poolName });

  // Combine errors - show pool error first, then resources error
  const error = poolError || resourcesError;

  const status = getPoolStatusDisplay(pool?.status);

  return (
    <div className="flex h-full flex-col gap-6">
      {/* Header with breadcrumb */}
      <div className="shrink-0 flex items-center justify-between">
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
          <div className={cn("flex items-center gap-2 text-sm font-medium", status.className)}>
            <span>{status.icon}</span>
            <span>{status.label}</span>
          </div>
        )}
      </div>

      {/* Description */}
      {pool?.description && <p className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">{pool.description}</p>}

      {/* API Error */}
      {error && (
        <ApiError
          error={error}
          onRetry={refetch}
          title="Unable to load pool data"
          authAware
          loginMessage="You need to log in to view pool details."
        />
      )}

      {/* Quota bar */}
      {!error && pool && (
        <div className="shrink-0">
          <QuotaBar
            used={pool.quota.used}
            limit={pool.quota.limit}
            free={pool.quota.free}
            isLoading={isLoading}
          />
        </div>
      )}

      {/* Resources section with virtualized table */}
      {!error && (
        <section className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="shrink-0 flex items-center gap-2">
            <Server className="h-4 w-4 text-zinc-400" />
            <h2 className={heading.section}>Resources</h2>
          </div>

          <div className="min-h-0 flex-1">
            <VirtualizedResourceTable
              resources={filteredResources}
              totalCount={resourceCount}
              isLoading={isLoading}
              poolName={poolName}
              displayMode={displayMode}
              filterCount={filterCount}
              filterContent={
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
              }
              summaryContent={
                <AdaptiveSummary
                  resources={filteredResources}
                  displayMode={displayMode}
                  isLoading={isLoading}
                />
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}
