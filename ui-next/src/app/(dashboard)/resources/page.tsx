// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { Cpu, Box, Layers } from "lucide-react";
import { VirtualizedResourceTable } from "@/components/features/pools";
import { FilterBar, ApiError, AdaptiveSummary } from "@/components/shared";
import { useAllResources } from "@/headless";

export default function ResourcesPage() {
  const {
    pools,
    platforms,
    resourceTypes,
    filteredResources,
    resourceCount,
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
    filterCount,
    isLoading,
    error,
    refetch,
  } = useAllResources();

  return (
    <div className="flex h-full flex-col gap-6">
      {/* Page header */}
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Resources</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">View and filter resources across all pools</p>
      </div>

      {/* Resources section with integrated filter bar */}
      <section className="flex min-h-0 flex-1 flex-col gap-4">
        {/* API Error - shown outside table container */}
        {error && (
          <ApiError
            error={error}
            onRetry={refetch}
            title="Unable to load resources"
            authAware
            loginMessage="You need to log in to view resources."
          />
        )}

        {/* Virtualized table with integrated filters and summary */}
        {!error && (
          <div className="min-h-0 flex-1">
            <VirtualizedResourceTable
              resources={filteredResources}
              totalCount={resourceCount}
              isLoading={isLoading}
              showPoolsColumn
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
        )}
      </section>
    </div>
  );
}
