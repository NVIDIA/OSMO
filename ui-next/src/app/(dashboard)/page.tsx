// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { usePage } from "@/components/shell";

export default function DashboardPage() {
  usePage({ title: "Dashboard" });

  return (
    <div className="space-y-6">
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
        <div className="text-sm text-zinc-500 dark:text-zinc-400">No workflows to display</div>
      </div>
    </div>
  );
}

function StatCard({ title }: { title: string }) {
  // TODO: Accept data from props when wired to real API
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-300 dark:text-zinc-700">—</p>
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">No data</p>
    </div>
  );
}
