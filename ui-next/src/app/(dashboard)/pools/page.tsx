// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { Search, ChevronDown, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { card, section, heading, clearButton } from "@/lib/styles";
import { PoolRow, PoolRowSkeleton } from "@/components/features/pools";
import { ApiError } from "@/components/shared";
import { usePoolsList } from "@/headless";
import { usePage } from "@/components/shell";

export default function PoolsPage() {
  usePage({ title: "Pools" });

  const {
    groupedPools,
    defaultPool,
    search,
    setSearch,
    clearSearch,
    hasSearch,
    toggleSection,
    isSectionCollapsed,
    filteredCount,
    isLoading,
    error,
    refetch,
  } = usePoolsList();

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="flex justify-end">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            placeholder="Search pools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8"
          />
          {hasSearch && (
            <button
              onClick={clearSearch}
              className={`absolute right-2 top-1/2 -translate-y-1/2 ${clearButton}`}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>


      {/* Default pool (pinned) */}
      {defaultPool && (
        <section>
          <h2 className={cn(heading.section, "mb-2")}>⭐ Your Default Pool</h2>
          <div className={card.base}>
            <PoolRow
              pool={defaultPool}
              isDefault
            />
          </div>
        </section>
      )}

      {/* Error message */}
      <ApiError
        error={error}
        onRetry={refetch}
        title="Unable to load pools"
        authAware
        loginMessage="You need to log in to view pools."
      />

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={card.base}
            >
              <div className={section.list}>
                <PoolRowSkeleton />
                <PoolRowSkeleton />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pools grouped by status */}
      {!isLoading && !error && (
        <div className="space-y-4">
          {groupedPools.map((group) => {
            const isCollapsed = isSectionCollapsed(group.status, group.pools.length);
            const hasResults = group.pools.length > 0;

            return (
              <section key={group.status}>
                {/* Collapsible header */}
                <button
                  onClick={() => toggleSection(group.status)}
                  className="mb-2 flex w-full items-center gap-2 text-left"
                >
                  <ChevronDown
                    className={cn("h-4 w-4 text-zinc-400 transition-transform", isCollapsed && "-rotate-90")}
                  />
                  <span className="text-sm">{group.icon}</span>
                  <span className={heading.section}>{group.label}</span>
                  <span className={heading.meta}>({group.pools.length})</span>
                </button>

                {/* Collapsible content - uses content-visibility for lazy rendering */}
                <div
                  className={cn(card.base, isCollapsed && "hidden")}
                  style={{
                    // content-visibility: auto enables lazy rendering of off-screen content
                    contentVisibility: "auto",
                    containIntrinsicSize: "auto 200px",
                  }}
                >
                  {hasResults ? (
                    <div className={section.list}>
                      {group.pools.map((pool) => (
                        <PoolRow
                          key={pool.name}
                          pool={pool}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                      {hasSearch ? "No matches" : "No pools"}
                    </div>
                  )}
                </div>
              </section>
            );
          })}

          {/* No results at all */}
          {filteredCount === 0 && hasSearch && (
            <div className={cn(card.base, "p-8 text-center")}>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No pools match &ldquo;{search}&rdquo;</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
