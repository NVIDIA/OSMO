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

/** Workflow-level details panel (base layer when no group/task is selected). */

"use client";

import { memo, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  TextSearch,
  BarChart3,
  Activity,
  Package,
  XCircle,
  Tag,
  Info,
  History,
  List,
  Loader2,
  RotateCw,
  FileCode,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/shadcn/card";
import { Skeleton } from "@/components/shadcn/skeleton";
import { CopyButton } from "@/components/copyable-value";
import { ActionsSection, type ActionItem } from "@/components/panel/actions-section";
import { LinksSection } from "@/components/panel/links-section";
import { PanelTabs, type PanelTab } from "@/components/panel/panel-tabs";
import { SeparatedParts } from "@/components/panel/separated-parts";
import { TabPanel } from "@/components/panel/tab-panel";
import type { WorkflowQueryResponse } from "@/lib/api/adapter/types";
import { formatDuration } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";
import { getStatusIcon } from "@/app/(dashboard)/workflows/[name]/lib/status";
import { EventViewerContainer, type TaskTiming } from "@/components/event-viewer/EventViewerContainer";
import { isWorkflowTerminal } from "@/lib/api/status-metadata.generated";
import { TaskGroupStatus } from "@/lib/api/generated";
import { STATUS_STYLES, STATUS_CATEGORY_MAP } from "@/app/(dashboard)/workflows/[name]/lib/status";
import { DetailsPanelHeader } from "@/app/(dashboard)/workflows/[name]/components/panel/views/details-panel-header";
import { StatusHoverCard } from "@/app/(dashboard)/workflows/[name]/components/panel/views/StatusHoverCard";
import { WorkflowTimeline } from "@/app/(dashboard)/workflows/[name]/components/panel/workflow/workflow-timeline";
import { parseTime } from "@/app/(dashboard)/workflows/[name]/components/panel/views/Timeline";
import { useTick } from "@/hooks/use-tick";
import type { WorkflowTab } from "@/app/(dashboard)/workflows/[name]/hooks/use-navigation-state";
import { WorkflowTasksTab } from "@/app/(dashboard)/workflows/[name]/components/panel/workflow/workflow-tasks-tab";
import { LogViewerContainer } from "@/components/log-viewer/components/LogViewerContainer";

// Lazy-load CodeMirror-based spec viewer (only loads when "Spec" tab is clicked)
// Saves ~92 KB from initial bundle (CodeMirror + YAML parser + Lezer)
const WorkflowSpecViewer = dynamic(
  () => import("./spec/WorkflowSpecViewer").then((m) => ({ default: m.WorkflowSpecViewer })),
  {
    loading: () => (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-64 w-full" />
      </div>
    ),
    ssr: false,
  },
);

// =============================================================================
// Styling Constants (Single Source of Truth)
// =============================================================================

/** Reusable style patterns for consistent styling across the component */
const STYLES = {
  /** Section header styling (matches pools panel) */
  sectionHeader: "text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase",
  /** Sub-header styling (e.g., Tags label) */
  subHeader: "text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium",
  /** Tag pill styling */
  tagPill: "rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground",
  /** Priority badge variants */
  priority: {
    HIGH: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    NORMAL: "bg-muted text-muted-foreground",
    LOW: "bg-muted text-muted-foreground/70",
  },
} as const;

// =============================================================================
// Types
// =============================================================================

export interface WorkflowDetailsProps {
  workflow: WorkflowQueryResponse;
  onCancel?: () => void;
  onResubmit?: () => void;
  /** Whether the header details section is expanded (global for page) */
  isDetailsExpanded?: boolean;
  /** Toggle the details expansion state (global for page) */
  onToggleDetailsExpanded?: () => void;
  /** Currently selected tab (URL-synced) */
  selectedTab?: WorkflowTab;
  /** Callback to change the selected tab */
  setSelectedTab?: (tab: WorkflowTab) => void;
  /** All groups in the workflow (for Tasks tab) */
  allGroups?: import("../../../lib/workflow-types").GroupWithLayout[];
  /** Currently selected group name (for Tasks tab) */
  selectedGroupName?: string | null;
  /** Currently selected task name (for Tasks tab) */
  selectedTaskName?: string | null;
  /** Callback when a group is selected (for Tasks tab) */
  onSelectGroup?: (group: import("../../../lib/workflow-types").GroupWithLayout) => void;
  /** Callback when a task is selected (for Tasks tab) */
  onSelectTask?: (
    task: import("../../../lib/workflow-types").TaskQueryResponse,
    group: import("../../../lib/workflow-types").GroupWithLayout,
  ) => void;
}

// =============================================================================
// Sub-components
// =============================================================================

/** Status and duration display */
const StatusDisplay = memo(function StatusDisplay({
  workflow,
  onNavigateToEvents,
}: {
  workflow: WorkflowQueryResponse;
  onNavigateToEvents?: () => void;
}) {
  // Fallback to "waiting" (a valid key in STATUS_STYLES) if status is unknown
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "waiting";
  const statusStyles = STATUS_STYLES[statusCategory];
  const isRunning = statusCategory === "running";

  // Synchronized tick for live durations (all components update together)
  const now = useTick();

  // Calculate duration - live for running workflows, static otherwise
  const duration = useMemo(() => {
    // Static duration from workflow data
    if (workflow.duration) return workflow.duration;

    const start = parseTime(workflow.start_time);
    const end = parseTime(workflow.end_time);

    if (start) {
      // Use synchronized tick for running workflows, end_time otherwise
      const endMs = isRunning && !end ? now : end?.getTime();
      if (endMs) {
        return Math.max(0, Math.floor((endMs - start.getTime()) / 1000));
      }
    }
    return null;
  }, [workflow.duration, workflow.start_time, workflow.end_time, isRunning, now]);

  return (
    <SeparatedParts className="gap-2 text-xs">
      <span className={cn("flex items-center gap-1 font-medium", statusStyles.text)}>
        {getStatusIcon(workflow.status, "size-3.5")}
        <StatusHoverCard
          status={workflow.status}
          label={workflow.status}
          onNavigateToEvents={onNavigateToEvents}
        />
      </span>
      <span
        className={cn(
          "rounded px-1 py-0.5 text-xs font-medium",
          STYLES.priority[workflow.priority as keyof typeof STYLES.priority] ?? STYLES.priority.NORMAL,
        )}
      >
        {workflow.priority}
      </span>
      {duration !== null && <span className="text-muted-foreground font-mono">{formatDuration(duration)}</span>}
    </SeparatedParts>
  );
});

/** Details section */
const Details = memo(function Details({ workflow }: { workflow: WorkflowQueryResponse }) {
  return (
    <section>
      <h3 className={STYLES.sectionHeader}>Details</h3>
      <Card className="gap-0 py-0">
        <CardContent className="divide-border divide-y p-0">
          <div className="p-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">UUID</span>
              <div className="flex items-center gap-1">
                <span className="font-mono text-xs">{workflow.uuid}</span>
                <CopyButton
                  value={workflow.uuid}
                  label="UUID"
                />
              </div>
              <span className="text-muted-foreground">User</span>
              <Link
                href={`/workflows?f=user:${encodeURIComponent(workflow.submitted_by)}`}
                className="text-foreground focus-visible:ring-ring rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {workflow.submitted_by}
              </Link>
              {workflow.pool && (
                <>
                  <span className="text-muted-foreground">Pool</span>
                  <Link
                    href={`/workflows?f=pool:${encodeURIComponent(workflow.pool)}&all=true`}
                    className="text-foreground focus-visible:ring-ring rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    {workflow.pool}
                  </Link>
                </>
              )}
              {workflow.backend && (
                <>
                  <span className="text-muted-foreground">Backend</span>
                  <span>{workflow.backend}</span>
                </>
              )}
            </div>
          </div>
          {workflow.tags && workflow.tags.length > 0 && (
            <div className="p-3">
              <div className={STYLES.subHeader}>
                <Tag className="size-3" />
                Tags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {workflow.tags.map((tag) => (
                  <span
                    key={tag}
                    className={STYLES.tagPill}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
});

/** Links configuration for workflow */
const WORKFLOW_LINKS = (workflow: WorkflowQueryResponse) => [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Kubernetes details",
    url: workflow.dashboard_url,
    icon: BarChart3,
  },
  { id: "grafana", label: "Grafana", description: "Metrics & monitoring", url: workflow.grafana_url, icon: Activity },
  { id: "outputs", label: "Outputs", description: "Artifacts & results", url: workflow.outputs, icon: Package },
];

/** Overview tab content */
interface OverviewTabProps {
  workflow: WorkflowQueryResponse;
  canCancel: boolean;
  onCancel?: () => void;
  onResubmit?: () => void;
}

const OverviewTab = memo(function OverviewTab({ workflow, canCancel, onCancel, onResubmit }: OverviewTabProps) {
  // Build actions array
  const actions: ActionItem[] = [];

  // Cancel button - always present but conditionally enabled
  if (onCancel) {
    actions.push({
      id: "cancel",
      label: "Cancel Workflow",
      description: canCancel ? "Stop the workflow execution" : "Workflow has already terminated",
      onClick: onCancel,
      icon: XCircle,
      variant: "destructive",
      disabled: !canCancel,
    });
  }

  // Resubmit button - always enabled
  if (onResubmit) {
    actions.push({
      id: "resubmit",
      label: "Resubmit Workflow",
      description: "Create a new workflow with the same configuration",
      onClick: onResubmit,
      icon: RotateCw,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Timeline section */}
      <section>
        <h3 className={STYLES.sectionHeader}>Timeline</h3>
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="min-w-0 overflow-hidden p-3">
            <WorkflowTimeline workflow={workflow} />
          </CardContent>
        </Card>
      </section>

      <Details workflow={workflow} />
      <LinksSection
        title="Links"
        links={WORKFLOW_LINKS(workflow)}
      />

      {/* Actions section */}
      {actions.length > 0 && (
        <ActionsSection
          title="Actions"
          actions={actions}
        />
      )}
    </div>
  );
});

export const WorkflowDetails = memo(function WorkflowDetails({
  workflow,
  onCancel,
  onResubmit,
  isDetailsExpanded,
  onToggleDetailsExpanded,
  selectedTab: selectedTabProp,
  setSelectedTab: setSelectedTabProp,
  allGroups,
  selectedGroupName,
  selectedTaskName,
  onSelectGroup,
  onSelectTask,
}: WorkflowDetailsProps) {
  // Tab configuration
  const tabs = useMemo<PanelTab[]>(
    () => [
      { id: "overview", label: "Overview", icon: Info },
      { id: "tasks", label: "Tasks", icon: List },
      { id: "logs", label: "Logs", icon: TextSearch },
      { id: "events", label: "Events", icon: History },
      { id: "spec", label: "Spec", icon: FileCode },
    ],
    [],
  );

  // Fallback to "waiting" (a valid key in STATUS_STYLES) if status is unknown
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "waiting";
  const canCancel = statusCategory === "running" || statusCategory === "waiting";

  // Build per-task status and timing lookups for the event viewer. Key: `${taskName}:${retryId}`.
  // taskStatuses: corrects the "Running" label when K8s events race ahead of Postgres.
  // taskTimings: replaces event-based duration with processing_start_time → end_time (or NOW).
  const { taskStatuses, taskTimings } = useMemo(() => {
    const statuses = new Map<string, TaskGroupStatus>();
    const timings = new Map<string, TaskTiming>();
    for (const group of workflow.groups) {
      for (const task of group.tasks ?? []) {
        const key = `${task.name}:${task.retry_id}`;
        statuses.set(key, task.status);
        timings.set(key, { processingStartTime: task.processing_start_time, endTime: task.end_time });
      }
    }
    return { taskStatuses: statuses, taskTimings: timings };
  }, [workflow.groups]);

  // Tab state - use URL-synced state if provided, otherwise default to "overview"
  const activeTab = selectedTabProp ?? "overview";

  // Handle tab change - update URL state
  const handleTabChange = useCallback(
    (value: string) => {
      setSelectedTabProp?.(value as WorkflowTab);
    },
    [setSelectedTabProp],
  );

  const handleNavigateToEvents = useCallback(() => {
    setSelectedTabProp?.("events");
  }, [setSelectedTabProp]);

  // Status content for header Row 2
  const statusContent = (
    <StatusDisplay
      workflow={workflow}
      onNavigateToEvents={handleNavigateToEvents}
    />
  );

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden">
      {/* Shared Header (consistent with Group/Task views) */}
      <DetailsPanelHeader
        viewType="workflow"
        title={workflow.name}
        statusContent={statusContent}
        isExpanded={isDetailsExpanded}
        onToggleExpand={onToggleDetailsExpanded}
      />

      {/* Tab Navigation - Chrome-style tabs with curved connectors */}
      <PanelTabs
        tabs={tabs}
        value={activeTab}
        onValueChange={handleTabChange}
      />

      {/* Tab Content */}
      <div className="relative flex-1 overflow-hidden bg-white dark:bg-zinc-900">
        <TabPanel
          tab="overview"
          activeTab={activeTab}
          padding="with-bottom"
        >
          <OverviewTab
            workflow={workflow}
            canCancel={canCancel}
            onCancel={onCancel}
            onResubmit={onResubmit}
          />
        </TabPanel>

        <TabPanel
          tab="tasks"
          activeTab={activeTab}
          scrollable={false}
        >
          {!allGroups ? (
            <div className="flex h-full items-center justify-center p-4">
              <Loader2 className="text-muted-foreground size-6 animate-spin" />
            </div>
          ) : allGroups.length === 0 ? (
            <div className="flex h-full items-center justify-center p-4">
              <p className="text-muted-foreground text-sm">No task groups in this workflow</p>
            </div>
          ) : !onSelectGroup || !onSelectTask ? (
            <div className="flex h-full items-center justify-center p-4">
              <p className="text-muted-foreground text-sm">Task selection not available</p>
            </div>
          ) : (
            <WorkflowTasksTab
              workflow={workflow}
              groups={allGroups}
              selectedGroupName={selectedGroupName ?? null}
              selectedTaskName={selectedTaskName ?? null}
              onSelectGroup={onSelectGroup}
              onSelectTask={onSelectTask}
            />
          )}
        </TabPanel>

        <TabPanel
          tab="logs"
          activeTab={activeTab}
          scrollable={false}
          className="p-0"
        >
          {activeTab === "logs" && (
            <div className="absolute inset-0">
              <LogViewerContainer
                logUrl={workflow.logs}
                workflowMetadata={{
                  name: workflow.name,
                  status: workflow.status,
                  submitTime: workflow.submit_time ? new Date(workflow.submit_time) : undefined,
                  startTime: workflow.start_time ? new Date(workflow.start_time) : undefined,
                  endTime: workflow.end_time ? new Date(workflow.end_time) : undefined,
                }}
                scope="workflow"
                showBorder={false}
                showTimeline={false}
                className="h-full"
              />
            </div>
          )}
        </TabPanel>

        <TabPanel
          tab="events"
          activeTab={activeTab}
          scrollable={false}
          className="p-0"
        >
          {activeTab === "events" && (
            <div className="absolute inset-0">
              <EventViewerContainer
                url={workflow.events}
                isTerminal={isWorkflowTerminal(workflow.status)}
                taskStatuses={taskStatuses}
                taskTimings={taskTimings}
                className="h-full"
              />
            </div>
          )}
        </TabPanel>

        <TabPanel
          tab="spec"
          activeTab={activeTab}
          scrollable={false}
        >
          {activeTab === "spec" && <WorkflowSpecViewer workflow={workflow} />}
        </TabPanel>
      </div>
    </div>
  );
});
