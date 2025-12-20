"use client";

/* eslint-disable react-hooks/preserve-manual-memoization */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { NodeTable } from "./components/node-table";
import { QuotaBar } from "./components/quota-bar";
import { PlatformChips } from "./components/platform-chips";
import {
  useGetPoolQuotasApiPoolQuotaGet,
  useGetResourcesApiResourcesGet,
  type PoolResponse,
  type ResourcesResponse,
  type ResourcesEntry,
} from "@/lib/api/generated";

const statusConfig: Record<string, { icon: string; label: string; className: string }> = {
  online: { icon: "🟢", label: "ONLINE", className: "text-emerald-600" },
  active: { icon: "🟢", label: "ACTIVE", className: "text-emerald-600" },
  offline: { icon: "🔴", label: "OFFLINE", className: "text-red-600" },
  maintenance: { icon: "🟡", label: "MAINTENANCE", className: "text-amber-600" },
  unknown: { icon: "⚪", label: "UNKNOWN", className: "text-zinc-500" },
};

const defaultStatus = statusConfig.unknown;

interface NodeData {
  name: string;
  platform: string;
  resourceType: string;
  gpu: { used: number; total: number };
  cpu: { used: number; total: number };
  memory: { used: number; total: number };
  storage: { used: number; total: number };
}

export default function PoolDetailPage() {
  const params = useParams();
  const poolName = params.poolName as string;
  const [search, setSearch] = useState("");

  // Fetch pool quota data
  // Note: API returns PoolResponse but OpenAPI spec incorrectly types it as string
  const { data: rawPoolData, isLoading: poolLoading } = useGetPoolQuotasApiPoolQuotaGet({
    pools: [poolName],
    all_pools: false,
  });
  const poolData = rawPoolData as unknown as PoolResponse | undefined;

  // Fetch resources for this pool
  // Note: API returns ResourcesResponse but OpenAPI spec incorrectly types it as string
  const { data: rawResourceData, isLoading: resourcesLoading } = useGetResourcesApiResourcesGet({
    pools: [poolName],
    all_pools: false,
  });
  const resourceData = rawResourceData as unknown as ResourcesResponse | undefined;

  // Extract pool info
  const pool = useMemo(() => {
    if (!poolData?.node_sets) return null;
    for (const nodeSet of poolData.node_sets) {
      const found = nodeSet.pools?.find((p) => p.name === poolName);
      if (found) {
        const usage = found.resource_usage;
        return {
          name: found.name ?? "",
          description: found.description ?? "",
          status: String(found.status ?? "unknown").toLowerCase(),
          quotaUsed: parseFloat(usage?.quota_used ?? "0") || 0,
          quotaLimit: parseFloat(usage?.quota_limit ?? "0") || 0,
          quotaFree: parseFloat(usage?.quota_free ?? "0") || 0,
          totalCapacity: parseFloat(usage?.total_capacity ?? "0") || 0,
          totalUsage: parseFloat(usage?.total_usage ?? "0") || 0,
          totalFree: parseFloat(usage?.total_free ?? "0") || 0,
        };
      }
    }
    return null;
  }, [poolData, poolName]);

  // Process nodes from resources
  const { nodes, platforms } = useMemo((): { nodes: NodeData[]; platforms: string[] } => {
    if (!resourceData?.resources) return { nodes: [], platforms: [] };

    const platformSet = new Set<string>();
    const nodeList: NodeData[] = resourceData.resources.flatMap((resource) => {
      const exposedFields = resource.exposed_fields ?? {};
      const nodeName = String(exposedFields.node ?? "");
      const poolPlatforms = (exposedFields["pool/platform"] ?? []) as string[];

      // Filter to only this pool's platforms
      const relevantPlatforms = poolPlatforms
        .filter((pp) => pp.startsWith(`${poolName}/`))
        .map((pp) => pp.split("/")[1] ?? "");

      relevantPlatforms.forEach((p) => platformSet.add(p));

      if (relevantPlatforms.length === 0) return [];

      return relevantPlatforms.map((platform) => ({
        name: nodeName,
        platform,
        resourceType: resource.resource_type ?? "SHARED",
        gpu: extractResource(resource, poolName, platform, "gpu"),
        cpu: extractResource(resource, poolName, platform, "cpu"),
        memory: extractResource(resource, poolName, platform, "memory"),
        storage: extractResource(resource, poolName, platform, "storage"),
      }));
    });

    return {
      nodes: nodeList,
      platforms: Array.from(platformSet).sort(),
    };
  }, [resourceData, poolName]);

  // Filter nodes by search
  const filteredNodes = useMemo(() => {
    if (!search.trim()) return nodes;
    const query = search.toLowerCase();
    return nodes.filter(
      (node) =>
        node.name.toLowerCase().includes(query) ||
        node.platform.toLowerCase().includes(query)
    );
  }, [nodes, search]);

  const status = statusConfig[pool?.status ?? "unknown"] ?? defaultStatus;
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
          used={pool.quotaUsed}
          limit={pool.quotaLimit}
          free={pool.quotaFree}
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

// Helper to extract resource usage from the API response
function extractResource(
  resource: ResourcesEntry,
  _pool: string,
  _platform: string,
  key: string
): { used: number; total: number } {
  // Get allocatable from allocatable_fields
  const allocatable = (resource.allocatable_fields as Record<string, number>)?.[key] ?? 0;
  // Get used from usage_fields
  const used = (resource.usage_fields as Record<string, number>)?.[key] ?? 0;
  return { used: Math.floor(used), total: Math.floor(allocatable) };
}
