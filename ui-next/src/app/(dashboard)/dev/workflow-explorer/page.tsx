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

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";
import { GitBranch, BarChart3, Clock, Loader2, CheckCircle, XCircle, ArrowRight } from "lucide-react";
import { usePage } from "@/components/shell";

import {
  EXAMPLE_WORKFLOWS,
  getStatusCategory,
  type MockComplexWorkflow,
  type WorkflowPattern,
  TaskGroupStatus,
} from "./mock-workflow";

// ============================================================================
// Utility Functions
// ============================================================================

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function getStatusIcon(status: TaskGroupStatus, size = "h-4 w-4") {
  const category = getStatusCategory(status);
  switch (category) {
    case "waiting":
      return <Clock className={cn(size, "text-zinc-400")} />;
    case "running":
      return <Loader2 className={cn(size, "animate-spin text-emerald-400")} />;
    case "completed":
      return <CheckCircle className={cn(size, "text-zinc-500")} />;
    case "failed":
      return <XCircle className={cn(size, "text-red-400")} />;
  }
}

// ============================================================================
// Workflow Preview Card
// ============================================================================

function WorkflowPreview({ workflow }: { workflow: MockComplexWorkflow }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="mb-3 flex items-center gap-3">
        {getStatusIcon(workflow.status, "h-5 w-5")}
        <div>
          <h3 className="font-mono text-sm font-medium text-zinc-100">{workflow.name}</h3>
          <p className="text-xs text-zinc-500">
            {workflow.pool} • {workflow.user}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-3 grid grid-cols-4 gap-2">
        <div className="text-center">
          <div className="text-lg font-bold text-zinc-100">{workflow.totalTasks}</div>
          <div className="text-xs text-zinc-500">Tasks</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-emerald-400">{workflow.completedTasks}</div>
          <div className="text-xs text-zinc-500">Complete</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-yellow-400">{workflow.runningTasks}</div>
          <div className="text-xs text-zinc-500">Running</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-zinc-400">{workflow.waitingTasks}</div>
          <div className="text-xs text-zinc-500">Waiting</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className="flex h-full">
          <div
            className="bg-emerald-500"
            style={{ width: `${(workflow.completedTasks / workflow.totalTasks) * 100}%` }}
          />
          <div
            className="animate-pulse bg-yellow-500"
            style={{ width: `${(workflow.runningTasks / workflow.totalTasks) * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-2 text-center text-xs text-zinc-500">Duration: {formatDuration(workflow.duration)}</div>
    </div>
  );
}

// ============================================================================
// Visualization Options
// ============================================================================

const visualizations = [
  {
    id: "reactflow-dag",
    title: "React Flow + Dagre",
    description: "Interactive DAG with automatic hierarchical layout. Pan, zoom, and click nodes.",
    icon: GitBranch,
    href: "/dev/workflow-explorer/reactflow-dag",
    features: [
      "@xyflow/react for canvas",
      "@dagrejs/dagre for layout",
      "Collapsible group nodes",
      "Animated running edges",
      "Expand/collapse all",
    ],
  },
  {
    id: "vis-timeline",
    title: "vis-timeline Gantt",
    description: "Timeline/Gantt view showing task execution over time. Great for duration analysis.",
    icon: BarChart3,
    href: "/dev/workflow-explorer/vis-timeline",
    features: [
      "vis-timeline library",
      "Nested task groups",
      "Flat/nested toggle",
      "Current time marker",
      "Zoom and pan",
    ],
  },
];

// ============================================================================
// Main Page
// ============================================================================

export default function WorkflowExplorerPage() {
  usePage({
    title: "Workflow Explorer",
    breadcrumbs: [{ label: "Dev", href: "/dev" }],
  });

  const [workflowPattern, setWorkflowPattern] = useState<WorkflowPattern>("complex");

  const workflow = useMemo(() => EXAMPLE_WORKFLOWS[workflowPattern](), [workflowPattern]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Description */}
      <p className="text-muted-foreground mb-8 text-sm">
        Explore different approaches for visualizing workflow DAGs and timelines
      </p>

      {/* Workflow Pattern Selector */}
      <div className="mb-8 rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sample Workflow</h2>
          <Tabs
            value={workflowPattern}
            onValueChange={(v) => setWorkflowPattern(v as WorkflowPattern)}
          >
            <TabsList className="bg-zinc-800/50">
              <TabsTrigger
                value="linear"
                className="data-[state=active]:bg-zinc-700"
              >
                Linear
              </TabsTrigger>
              <TabsTrigger
                value="diamond"
                className="data-[state=active]:bg-zinc-700"
              >
                Diamond
              </TabsTrigger>
              <TabsTrigger
                value="parallel"
                className="data-[state=active]:bg-zinc-700"
              >
                Parallel
              </TabsTrigger>
              <TabsTrigger
                value="complex"
                className="data-[state=active]:bg-zinc-700"
              >
                Complex
              </TabsTrigger>
              <TabsTrigger
                value="massiveParallel"
                className="data-[state=active]:bg-zinc-700"
              >
                200 Tasks
              </TabsTrigger>
              <TabsTrigger
                value="manyGroups"
                className="data-[state=active]:bg-zinc-700"
              >
                100 Groups
              </TabsTrigger>
              <TabsTrigger
                value="multiRoot"
                className="data-[state=active]:bg-zinc-700"
              >
                Multi-Root
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <WorkflowPreview workflow={workflow} />

        <div className="mt-4 text-sm text-zinc-500">
          <strong>Pattern: {workflowPattern}</strong>
          <span className="mx-2">•</span>
          {workflow.groups.length} groups
          <span className="mx-2">•</span>
          {workflow.totalTasks} total tasks
        </div>
      </div>

      {/* Visualization Options */}
      <h2 className="mb-4 text-lg font-semibold">Visualization Approaches</h2>
      <div className="grid gap-6 md:grid-cols-2">
        {visualizations.map((viz) => (
          <Link
            key={viz.id}
            href={viz.href}
            className="group rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 transition-all hover:border-cyan-500/50 hover:bg-zinc-900"
          >
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-zinc-800 p-3 transition-colors group-hover:bg-cyan-500/10">
                <viz.icon className="h-6 w-6 text-zinc-400 transition-colors group-hover:text-cyan-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-zinc-100 transition-colors group-hover:text-cyan-400">
                    {viz.title}
                  </h3>
                  <ArrowRight className="h-4 w-4 text-zinc-600 transition-all group-hover:translate-x-1 group-hover:text-cyan-400" />
                </div>
                <p className="mt-1 text-sm text-zinc-400">{viz.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {viz.features.map((feature, i) => (
                    <span
                      key={i}
                      className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-500"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Info Box */}
      <div className="mt-8 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/30 p-4">
        <h3 className="mb-2 text-sm font-medium text-zinc-300">📦 Libraries Used</h3>
        <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
          <div>
            <div className="font-medium text-zinc-400">@xyflow/react</div>
            <div className="text-zinc-500">React Flow canvas</div>
          </div>
          <div>
            <div className="font-medium text-zinc-400">@dagrejs/dagre</div>
            <div className="text-zinc-500">Graph layout</div>
          </div>
          <div>
            <div className="font-medium text-zinc-400">vis-timeline</div>
            <div className="text-zinc-500">Gantt charts</div>
          </div>
          <div>
            <div className="font-medium text-zinc-400">@faker-js/faker</div>
            <div className="text-zinc-500">Mock data</div>
          </div>
        </div>
      </div>
    </div>
  );
}
