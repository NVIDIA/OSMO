"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { NodeTable, QuotaBar, PlatformChips } from "@/components/features/pools";
import { usePool, usePoolResources, type PoolStatus } from "@/lib/api/adapter";
import { PoolStatusDisplay, DefaultPoolStatusDisplay } from "@/lib/constants/ui";

export default function PoolDetailPage() {
  const params = useParams();
  const poolName = params.poolName as string;
  const [search, setSearch] = useState("");

  const { pool, isLoading: poolLoading } = usePool(poolName);
  const { nodes, platforms, isLoading: resourcesLoading } = usePoolResources(poolName);

  // Filter nodes by search
  const filteredNodes = useMemo(() => {
    if (!search.trim()) return nodes;
    const query = search.toLowerCase();
    return nodes.filter(
      (node) =>
        node.nodeName.toLowerCase().includes(query) ||
        node.platform.toLowerCase().includes(query)
    );
  }, [nodes, search]);

  const status = pool?.status ? (PoolStatusDisplay[pool.status] ?? DefaultPoolStatusDisplay) : DefaultPoolStatusDisplay;
  const isLoading = poolLoading || resourcesLoading;

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
          <div className={cn("flex items-center gap-2 text-sm font-medium", status.className)}>
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

      {/* Platform chips */}
      {platforms.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Platforms
          </h2>
          <PlatformChips platforms={platforms} />
        </div>
      )}

      {/* Nodes section */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Nodes ({filteredNodes.length})
          </h2>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              placeholder="Search nodes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-9 text-sm"
            />
          </div>
        </div>

        <NodeTable
          nodes={filteredNodes}
          isLoading={isLoading}
          poolName={poolName}
        />
      </div>
    </div>
  );
}
