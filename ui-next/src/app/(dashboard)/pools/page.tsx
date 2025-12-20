"use client";

import { Search, AlertCircle, LogIn, ChevronDown, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PoolRow, PoolRowSkeleton } from "@/components/features/pools";
import { usePoolsList } from "@/headless";
import { useAuth } from "@/lib/auth/auth-provider";

export default function PoolsPage() {
  const { isAuthenticated, login } = useAuth();
  
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
  } = usePoolsList();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pools</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Compute pools and GPU quota allocation
          </p>
        </div>
        
        {/* Search */}
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
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
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
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            ⭐ Your Default Pool
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <PoolRow pool={defaultPool} isDefault />
          </div>
        </section>
      )}

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <p className="font-medium text-amber-800 dark:text-amber-200">
              Unable to fetch pools
            </p>
            {!isAuthenticated ? (
              <div className="mt-2 flex items-center gap-3">
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  You need to log in to view pools.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={login}
                  className="gap-1.5 border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-900/50 dark:text-amber-200 dark:hover:bg-amber-900"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Log in
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                There was an error fetching pool data. Please try refreshing the page.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
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
                    className={cn(
                      "h-4 w-4 text-zinc-400 transition-transform",
                      isCollapsed && "-rotate-90"
                    )}
                  />
                  <span className="text-sm">{group.icon}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {group.label}
                  </span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    ({group.pools.length})
                  </span>
                </button>

                {/* Collapsible content */}
                {!isCollapsed && (
                  <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                    {hasResults ? (
                      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {group.pools.map((pool) => (
                          <PoolRow key={pool.name} pool={pool} />
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                        {hasSearch ? "No matches" : "No pools"}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}

          {/* No results at all */}
          {filteredCount === 0 && hasSearch && (
            <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No pools match &ldquo;{search}&rdquo;
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
