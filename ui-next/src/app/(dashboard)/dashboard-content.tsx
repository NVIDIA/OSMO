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

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePage } from "@/components/shell";
import { usePools, useVersion } from "@/lib/api/adapter";
import { useWorkflowsData } from "./workflows/hooks/use-workflows-data";
import { WorkflowStatus, PoolStatus } from "@/lib/api/generated";
import { cn } from "@/lib/utils";

// =============================================================================
// Dashboard Content
// =============================================================================

export function DashboardContent() {
  usePage({ title: "Dashboard" });

  // Data from hydrated cache
  const { pools, isLoading: poolsLoading } = usePools();
  const { workflows, isLoading: workflowsLoading } = useWorkflowsData({ searchChips: [] });
  const { version } = useVersion();

  // Compute stats from pools
  const poolStats = useMemo(() => {
    const online = pools.filter((p) => p.status === PoolStatus.ONLINE).length;
    const offline = pools.filter((p) => p.status === PoolStatus.OFFLINE).length;
    const maintenance = pools.filter((p) => p.status === PoolStatus.MAINTENANCE).length;
    return { online, offline, maintenance, total: pools.length };
  }, [pools]);

  // Capture mount time once for stable "last 24h" calculation
  // Using useState initializer ensures idempotent behavior during render
  const [mountTime] = useState(() => Date.now());

  // Compute stats from workflows (last 24h)
  const workflowStats = useMemo(() => {
    const oneDayAgo = mountTime - 24 * 60 * 60 * 1000;

    const running = workflows.filter((w) => w.status === WorkflowStatus.RUNNING).length;
    const completed = workflows.filter(
      (w) => w.status === WorkflowStatus.COMPLETED && w.submit_time && new Date(w.submit_time).getTime() > oneDayAgo,
    ).length;
    const failed = workflows.filter(
      (w) =>
        (w.status === WorkflowStatus.FAILED ||
          w.status === WorkflowStatus.FAILED_EXEC_TIMEOUT ||
          w.status === WorkflowStatus.FAILED_CANCELED) &&
        w.submit_time &&
        new Date(w.submit_time).getTime() > oneDayAgo,
    ).length;

    return { running, completed, failed };
  }, [workflows, mountTime]);

  const recentWorkflows = workflows.slice(0, 5);

  return (
    <div className="space-y-6 p-6">
      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Workflows"
          value={workflowsLoading ? undefined : workflowStats.running}
          href="/workflows?f=status:RUNNING"
          color="text-green-500"
        />
        <StatCard
          title="Completed (24h)"
          value={workflowsLoading ? undefined : workflowStats.completed}
          href="/workflows?f=status:COMPLETED"
          color="text-blue-500"
        />
        <StatCard
          title="Failed (24h)"
          value={workflowsLoading ? undefined : workflowStats.failed}
          href="/workflows?f=status:FAILED"
          color={workflowStats.failed > 0 ? "text-red-500" : "text-zinc-500"}
        />
        <StatCard
          title="Pools Online"
          value={poolsLoading ? undefined : `${poolStats.online}/${poolStats.total}`}
          href="/pools?f=status:ONLINE"
          color="text-nvidia"
        />
      </div>

      {/* Recent workflows */}
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
            <div className="text-sm text-zinc-500 dark:text-zinc-400">Loading...</div>
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

      {/* Version info */}
      {version && (
        <div className="text-center text-xs text-zinc-400 dark:text-zinc-600">
          OSMO v{version.major}.{version.minor}.{version.revision}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

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
  const statusConfig: Record<string, { label: string; className: string }> = {
    [WorkflowStatus.RUNNING]: {
      label: "Running",
      className: "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400",
    },
    [WorkflowStatus.PENDING]: {
      label: "Pending",
      className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
    },
    [WorkflowStatus.COMPLETED]: {
      label: "Completed",
      className: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
    },
    [WorkflowStatus.FAILED]: {
      label: "Failed",
      className: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    },
  };

  const config = statusConfig[status] ?? { label: status, className: "bg-zinc-100 text-zinc-700" };

  return <span className={cn("rounded-full px-2 py-1 text-xs font-medium", config.className)}>{config.label}</span>;
}
