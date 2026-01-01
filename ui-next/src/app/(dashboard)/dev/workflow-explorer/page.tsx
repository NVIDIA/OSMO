// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitBranch, BarChart3, Clock, Loader2, CheckCircle, XCircle, ArrowRight, Workflow } from "lucide-react";
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
      return <Loader2 className={cn(size, "text-emerald-400 animate-spin")} />;
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
  const category = getStatusCategory(workflow.status);

  return (
    <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-3 mb-3">
        {getStatusIcon(workflow.status, "h-5 w-5")}
        <div>
          <h3 className="font-mono text-sm font-medium text-zinc-100">{workflow.name}</h3>
          <p className="text-xs text-zinc-500">
            {workflow.pool} • {workflow.user}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-3">
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
      <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full flex">
          <div
            className="bg-emerald-500"
            style={{ width: `${(workflow.completedTasks / workflow.totalTasks) * 100}%` }}
          />
          <div
            className="bg-yellow-500 animate-pulse"
            style={{ width: `${(workflow.runningTasks / workflow.totalTasks) * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-2 text-xs text-zinc-500 text-center">Duration: {formatDuration(workflow.duration)}</div>
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
    <div className="max-w-6xl mx-auto py-8 px-4">
      {/* Description */}
      <p className="text-sm text-muted-foreground mb-8">
        Explore different approaches for visualizing workflow DAGs and timelines
      </p>

      {/* Workflow Pattern Selector */}
      <div className="mb-8 p-6 rounded-lg border border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center justify-between mb-4">
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
      <h2 className="text-lg font-semibold mb-4">Visualization Approaches</h2>
      <div className="grid gap-6 md:grid-cols-2">
        {visualizations.map((viz) => (
          <Link
            key={viz.id}
            href={viz.href}
            className="group p-6 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:border-cyan-500/50 hover:bg-zinc-900 transition-all"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-zinc-800 group-hover:bg-cyan-500/10 transition-colors">
                <viz.icon className="h-6 w-6 text-zinc-400 group-hover:text-cyan-400 transition-colors" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-zinc-100 group-hover:text-cyan-400 transition-colors">
                    {viz.title}
                  </h3>
                  <ArrowRight className="h-4 w-4 text-zinc-600 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
                </div>
                <p className="text-sm text-zinc-400 mt-1">{viz.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {viz.features.map((feature, i) => (
                    <span
                      key={i}
                      className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-500"
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
      <div className="mt-8 p-4 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/30">
        <h3 className="text-sm font-medium text-zinc-300 mb-2">📦 Libraries Used</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
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
