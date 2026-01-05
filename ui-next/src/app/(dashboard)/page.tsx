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
