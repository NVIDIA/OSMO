"use client";

import { useMemo, useState } from "react";
import { Search, AlertCircle, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PoolRow, PoolRowSkeleton } from "./components/pool-row";
import { usePools } from "@/lib/api/adapter";
import { useAuth } from "@/lib/auth/auth-provider";

export default function PoolsPage() {
  const [search, setSearch] = useState("");
  const { isAuthenticated, login } = useAuth();
  const { pools, isLoading, error } = usePools();

  // Filter pools by search
  const filteredPools = useMemo(() => {
    if (!search.trim()) return pools;
    const query = search.toLowerCase();
    return pools.filter(
      (pool) =>
        pool.name.toLowerCase().includes(query) ||
        pool.description.toLowerCase().includes(query)
    );
  }, [pools, search]);

  // TODO: Get default pool from user profile
  const defaultPoolName = ""; // Will come from user context
  const defaultPool = pools.find((p) => p.name === defaultPoolName);
  const otherPools = filteredPools.filter((p) => p.name !== defaultPoolName);

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
            className="pl-9"
          />
        </div>
      </div>

      {/* Default pool (pinned) */}
      {defaultPool && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            ⭐ Your Default Pool
          </h2>
          <PoolRow pool={defaultPool} isDefault />
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

      {/* All pools */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {defaultPool ? "All Pools" : "Pools"} ({filteredPools.length})
          </h2>
        </div>
        
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          {isLoading ? (
            // Skeleton loader
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {[1, 2, 3, 4, 5].map((i) => (
                <PoolRowSkeleton key={i} />
              ))}
            </div>
          ) : otherPools.length === 0 && !error ? (
            <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {search ? "No pools match your search" : "No pools available"}
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-zinc-400 dark:text-zinc-600">
              —
            </div>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {otherPools.map((pool) => (
                <PoolRow key={pool.name} pool={pool} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
