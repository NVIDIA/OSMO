"use client";

import { useGetVersionApiVersionGet } from "@/lib/api/generated";

// Version type - not in OpenAPI spec so we define it locally
interface Version {
  major: string;
  minor: string;
  revision: string;
  hash?: string;
}

export default function DashboardPage() {
  const { data } = useGetVersionApiVersionGet();
  const version = data as Version | undefined;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Overview of your workflows and resources
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Workflows"
          value="12"
          subtitle="3 running, 9 queued"
        />
        <StatCard
          title="Completed Today"
          value="47"
          subtitle="+12% from yesterday"
        />
        <StatCard
          title="Failed (24h)"
          value="2"
          subtitle="95.7% success rate"
        />
        <StatCard
          title="Pool Usage"
          value="68%"
          subtitle="research-gpu pool"
        />
      </div>

      {/* Recent workflows placeholder */}
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-lg font-semibold">Recent Workflows</h2>
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          Workflow list will go here...
        </div>
      </div>

      {/* Connection status */}
      {version && (
        <div className="text-xs text-zinc-400">
          Connected to OSMO {version.major}.{version.minor}.{version.revision}
          {version.hash && ` (${version.hash.slice(0, 7)})`}
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {title}
      </p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
    </div>
  );
}
