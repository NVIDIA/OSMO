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
  const { data, isLoading: versionLoading } = useGetVersionApiVersionGet();
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

      {/* Stats cards - TODO: Wire to real API endpoints */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Workflows" />
        <StatCard title="Completed Today" />
        <StatCard title="Failed (24h)" />
        <StatCard title="Pool Usage" />
      </div>

      {/* Recent workflows - TODO: Wire to real API endpoint */}
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-lg font-semibold">Recent Workflows</h2>
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          No workflows to display
        </div>
      </div>

      {/* Connection status */}
      <div className="text-xs text-zinc-400">
        {versionLoading ? (
          "Connecting to OSMO..."
        ) : version ? (
          <>
            Connected to OSMO {version.major}.{version.minor}.{version.revision}
            {version.hash && ` (${version.hash.slice(0, 7)})`}
          </>
        ) : (
          "Not connected"
        )}
      </div>
    </div>
  );
}

function StatCard({ title }: { title: string }) {
  // TODO: Accept data from props when wired to real API
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {title}
      </p>
      <p className="mt-1 text-2xl font-bold text-zinc-300 dark:text-zinc-700">
        —
      </p>
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
        No data
      </p>
    </div>
  );
}
