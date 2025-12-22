// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { Server, Cpu, Box, Layers } from "lucide-react";
import { ResourceTable, ResourceCapacitySummary } from "@/components/features/pools";
import { FilterBar, ApiError } from "@/components/shared";
import { useAllResources } from "@/headless";
import { heading } from "@/lib/styles";

export default function ResourcesPage() {
  const {
    pools,
    platforms,
    resourceTypes,
    filteredResources,
    resourceCount,
    filteredResourceCount,
    search,
    setSearch,
    clearSearch,
    selectedPools,
    togglePool,
    clearPoolFilter,
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
    error,
    refetch,
  } = useAllResources();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Resources</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          View and filter resources across all pools
        </p>
      </div>

      {/* Resources section with unified filter bar */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-zinc-400" />
          <h2 className={heading.section}>All Resources</h2>
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

          {pools.length > 0 && (
            <FilterBar.MultiSelect
              icon={Layers}
              label="Pool"
              options={pools}
              selected={selectedPools}
              onToggle={togglePool}
              onClear={clearPoolFilter}
              searchable
              searchPlaceholder="Search pools..."
            />
          )}

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

        {/* API Error */}
        {error && (
          <ApiError
            error={error}
            onRetry={refetch}
            title="Unable to load resources"
          />
        )}

        {/* Capacity summary boxes */}
        {!error && (
          <ResourceCapacitySummary
            resources={filteredResources}
            displayMode={displayMode}
            isLoading={isLoading}
          />
        )}

        {!error && (
          <ResourceTable
            resources={filteredResources}
            isLoading={isLoading}
            showPoolsColumn
            displayMode={displayMode}
          />
        )}
      </section>
    </div>
  );
}
