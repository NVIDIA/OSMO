// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Dashboard Content (Client Component)
 *
 * Interactive dashboard content with hydrated data.
 */

"use client";

import { useMemo, useEffect } from "react";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Link } from "@/components/link";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { usePage } from "@/components/chrome/page-context";
import { useWorkflowsData } from "@/lib/workflows/hooks/use-workflows-data";
import { usePools, useVersion, useProfile } from "@/lib/api/adapter/hooks";
import { WorkflowStatus, PoolStatus } from "@/lib/api/generated";
import { cn } from "@/lib/utils";
import { getStatusDisplay, STATUS_STYLES } from "@/lib/workflows/workflow-constants";
import { WORKFLOW_STATUS_ICONS } from "@/lib/workflows/workflow-status-icons";
import { STATUS_PRESETS } from "@/lib/workflows/workflow-status-presets";

// =============================================================================
// Dashboard Content
// =============================================================================

interface DashboardContentProps {
  /** Server-computed 24h cutoff (ISO string) — ensures query key matches between SSR and client */
  submittedAfter: string;
}

export function DashboardContent({ submittedAfter }: DashboardContentProps) {
  usePage({ title: "Dashboard" });

  // Data from hydrated cache
  const { pools, isLoading: poolsLoading } = usePools();
  const { profile, isLoading: profileLoading } = useProfile();
  const {
    workflows,
    isLoading: workflowsLoading,
    hasMore,
    fetchNextPage,
    isFetchingNextPage,
  } = useWorkflowsData({ searchChips: [], submittedAfter });

  // Auto-fetch all pages so dashboard stats cover the full 24h window
  useEffect(() => {
    if (hasMore && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasMore, isFetchingNextPage, fetchNextPage]);

  // Filter pools to only those accessible to the user.
  // Return [] while profile is loading to prevent flashing all pools before scoping.
  // Empty accessible list means "no restrictions" (admin), so show all pools.
  const accessiblePools = useMemo(() => {
    if (profileLoading || !profile) return [];
    if (!profile.pool.accessible || profile.pool.accessible.length === 0) return pools;
    const accessibleSet = new Set(profile.pool.accessible);
    return pools.filter((p) => accessibleSet.has(p.name));
  }, [pools, profile, profileLoading]);

  // Compute stats from accessible pools only
  const poolStats = useMemo(() => {
    const online = accessiblePools.filter((p) => p.status === PoolStatus.ONLINE).length;
    const offline = accessiblePools.filter((p) => p.status === PoolStatus.OFFLINE).length;
    const maintenance = accessiblePools.filter((p) => p.status === PoolStatus.MAINTENANCE).length;
    return { online, offline, maintenance, total: accessiblePools.length };
  }, [accessiblePools]);

  // All workflows are already server-filtered to the last 24h via submittedAfter,
  // so stats are simple counts by status — no client-side time filtering needed.
  const workflowStats = useMemo(() => {
    const running = workflows.filter((w) => w.status === WorkflowStatus.RUNNING).length;
    const completed = workflows.filter((w) => w.status === WorkflowStatus.COMPLETED).length;
    const failed = workflows.filter((w) => STATUS_PRESETS.failed.includes(w.status)).length;
    return { running, completed, failed };
  }, [workflows]);

  const allPagesLoaded = !hasMore && !isFetchingNextPage;
  const recentWorkflows = workflows.slice(0, 5);

  return (
    <div className="contain-layout-style space-y-6 p-6">
      {/* Stats cards */}
      <InlineErrorBoundary
        title="Unable to load dashboard stats"
        compact
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Active Workflows"
            value={workflowsLoading || !allPagesLoaded ? undefined : workflowStats.running}
            href="/workflows?f=status:RUNNING"
            color="text-blue-500"
          />
          <StatCard
            title="Completed (24h)"
            value={workflowsLoading || !allPagesLoaded ? undefined : workflowStats.completed}
            href="/workflows?f=status:COMPLETED"
            color="text-green-500"
          />
          <StatCard
            title="Failed (24h)"
            value={workflowsLoading || !allPagesLoaded ? undefined : workflowStats.failed}
            href={`/workflows?f=${STATUS_PRESETS.failed.map((s) => `status:${s}`).join(",")}`}
            color={workflowStats.failed > 0 ? "text-red-500" : "text-zinc-500"}
          />
          <StatCard
            title="Pools Online"
            value={poolsLoading || profileLoading ? undefined : `${poolStats.online}/${poolStats.total}`}
            href="/pools?f=status:ONLINE"
            color="text-nvidia"
          />
        </div>
      </InlineErrorBoundary>

      {/* Recent workflows */}
      <InlineErrorBoundary
        title="Unable to load recent workflows"
        resetKeys={[workflows.length]}
      >
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-lg font-semibold">Recent Workflows</h2>
            <Link
              href="/workflows"
              className="text-nvidia text-sm hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="p-4">
            {workflowsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2"
                  >
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                ))}
              </div>
            ) : recentWorkflows.length === 0 ? (
              <div className="text-sm text-zinc-500 dark:text-zinc-400">No workflows to display</div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {recentWorkflows.map((workflow) => (
                  <Link
                    key={workflow.name}
                    href={`/workflows/${encodeURIComponent(workflow.name)}`}
                    className="flex items-center justify-between py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <div>
                      <div className="font-medium">{workflow.name}</div>
                      <div className="text-sm text-zinc-500">{workflow.user ?? "Unknown user"}</div>
                    </div>
                    <StatusBadge status={workflow.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </InlineErrorBoundary>

      {/* Version info — lazy: only fetches when this component renders */}
      <InlineErrorBoundary
        title="Version info error"
        compact
      >
        <VersionFooter />
      </InlineErrorBoundary>
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

/**
 * Lazy version footer — only triggers the /api/version fetch when rendered.
 * If the user already opened the profile dropdown, the data is cached (Infinity staleTime)
 * and this renders instantly with no additional API call.
 */
function VersionFooter() {
  const { version } = useVersion();
  if (!version) return null;
  return (
    <div className="text-center text-xs text-zinc-400 dark:text-zinc-600">
      OSMO v{version.major}.{version.minor}.{version.revision}
    </div>
  );
}

interface StatCardProps {
  title: string;
  value?: string | number;
  href: string;
  color?: string;
}

function StatCard({ title, value, href, color = "text-zinc-900 dark:text-zinc-100" }: StatCardProps) {
  return (
    <Link
      href={href}
      className="group hover:border-nvidia rounded-lg border border-zinc-200 bg-white p-4 transition-all hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
      <p className={cn("mt-1 text-2xl font-bold", color)}>{value ?? "—"}</p>
      <p className="group-hover:text-nvidia mt-1 text-xs text-zinc-400 dark:text-zinc-500">Click to view →</p>
    </Link>
  );
}

function StatusBadge({ status }: { status: WorkflowStatus }) {
  const { category, label } = getStatusDisplay(status);
  const styles = STATUS_STYLES[category];
  const Icon = WORKFLOW_STATUS_ICONS[category];

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5", styles.bg)}>
      <Icon className={cn("size-3.5", styles.icon, category === "running" && "animate-spin")} />
      <span className={cn("text-xs font-semibold", styles.text)}>{label}</span>
    </span>
  );
}
