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

import { useMemo, useCallback, memo, useEffect, useRef } from "react";
import {
  FileText,
  Terminal,
  AlertCircle,
  XCircle,
  History,
  Info,
  BarChart3,
  Activity,
  Clock,
  Loader2,
  CheckCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/shadcn/card";
import {
  PanelTabs,
  DetailsSection,
  LinksSection,
  EmptyTabPrompt,
  TabPanel,
  SeparatedParts,
  type PanelTab,
} from "@/components/panel";
import { useTick } from "@/hooks";
import { ShellConnectPrompt } from "./TaskShell";
import { calculateDuration, formatDuration } from "../../../lib/workflow-types";
import type { GroupWithLayout } from "../../../lib/workflow-types";
import type { TaskTab } from "../../../hooks/use-navigation-state";
import { getStatusIcon, getStatusCategory, getStatusStyle, getStatusLabel } from "../../../lib/status";
import { DetailsPanelHeader } from "../shared/DetailsPanelHeader";
import { TaskTimeline } from "./TaskTimeline";
import { DependencyPills } from "../shared/DependencyPills";
import { useShellPortal, useShellContext } from "../../shell";
import { useShellSession, StatusDot } from "@/components/shell";
import type { TaskDetailsProps, SiblingTask, BreadcrumbSegment } from "../../../lib/panel-types";
import { TaskGroupStatus } from "@/lib/api/generated";

interface OverviewTabProps {
  task: TaskDetailsProps["task"];
}

/** Section header styling */
const SECTION_HEADER = "text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase";

/** Build links configuration for task */
const getTaskLinks = (task: TaskDetailsProps["task"]) => {
  const taskWithLinks = task as typeof task & { grafana_url?: string };
  return [
    {
      id: "dashboard",
      label: "Dashboard",
      description: "Kubernetes pod details",
      url: task.dashboard_url,
      icon: BarChart3,
    },
    {
      id: "grafana",
      label: "Grafana",
      description: "Metrics & monitoring",
      url: taskWithLinks.grafana_url,
      icon: Activity,
    },
  ];
};

interface ShellStatusPromptProps {
  status: string;
  category: "waiting" | "pending" | "running" | "completed" | "failed";
}

const ShellStatusPrompt = memo(function ShellStatusPrompt({ status, category }: ShellStatusPromptProps) {
  // Determine message based on status category and specific status
  const isInitializing = status === TaskGroupStatus.INITIALIZING;

  if (category === "waiting") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800">
          <Clock className="size-6 text-gray-400 dark:text-zinc-500" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">Waiting to Start</h3>
          <p className="mt-1 max-w-xs text-xs text-gray-500 dark:text-zinc-400">
            Shell will be available once the container is running
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-500">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-gray-400 dark:bg-zinc-500" />
          <span>{getStatusLabel(status)}</span>
        </div>
      </div>
    );
  }

  // Pending category: PROCESSING, SCHEDULING, INITIALIZING (pre-running states)
  if (category === "pending") {
    // Special case for INITIALIZING - container is starting up
    if (isInitializing) {
      return (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/50">
            <Loader2 className="size-6 animate-spin text-amber-500 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">Container Initializing</h3>
            <p className="mt-1 max-w-xs text-xs text-gray-500 dark:text-zinc-400">
              Shell will be available shortly once initialization completes
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-amber-500 dark:text-amber-400">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-amber-500" />
            <span>Initializing...</span>
          </div>
        </div>
      );
    }

    // PROCESSING or SCHEDULING - not yet on a node
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/50">
          <Loader2 className="size-6 animate-spin text-amber-500 dark:text-amber-400" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">Starting Up</h3>
          <p className="mt-1 max-w-xs text-xs text-gray-500 dark:text-zinc-400">
            Shell will be available once the container is running
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-amber-500 dark:text-amber-400">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-amber-500" />
          <span>{getStatusLabel(status)}</span>
        </div>
      </div>
    );
  }

  if (category === "completed") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/50">
          <CheckCircle className="size-6 text-emerald-500 dark:text-emerald-400" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">Task Completed</h3>
          <p className="mt-1 max-w-xs text-xs text-gray-500 dark:text-zinc-400">
            Shell is no longer available after task completion
          </p>
        </div>
      </div>
    );
  }

  if (category === "failed") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/50">
          <XCircle className="size-6 text-red-500 dark:text-red-400" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">Task Failed</h3>
          <p className="mt-1 max-w-xs text-xs text-gray-500 dark:text-zinc-400">
            Shell is no longer available after task failure
          </p>
        </div>
        <p className="text-xs text-gray-400 dark:text-zinc-500">Check logs for error details</p>
      </div>
    );
  }

  // Fallback (shouldn't happen)
  return null;
});

const OverviewTab = memo(function OverviewTab({ task }: OverviewTabProps) {
  const hasError = task.exit_code !== undefined && task.exit_code !== null && task.exit_code !== 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Timeline section */}
      <section>
        <h3 className={SECTION_HEADER}>Timeline</h3>
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="min-w-0 overflow-hidden p-3">
            <TaskTimeline task={task} />

            {/* Exit status - shown after timeline when non-zero */}
            {hasError && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/30">
                <div className="flex items-start gap-2">
                  <XCircle className="mt-0.5 size-4 shrink-0 text-red-500 dark:text-red-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-red-800 dark:text-red-300">
                      Exit Code: {task.exit_code}
                    </div>
                    {task.failure_message && (
                      <p className="mt-1 text-xs break-words text-red-700 dark:text-red-400">{task.failure_message}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Details section - using DetailsSection component */}
      <DetailsSection
        title="Details"
        items={[
          { label: "UUID", value: task.task_uuid, copyable: true, mono: true, truncate: true, show: !!task.task_uuid },
          { label: "Node", value: task.node_name, copyable: true, mono: true, truncate: true, show: !!task.node_name },
          { label: "Pod", value: task.pod_name, copyable: true, mono: true, truncate: true, show: !!task.pod_name },
          { label: "Pod IP", value: task.pod_ip, copyable: true, mono: true, truncate: true, show: !!task.pod_ip },
        ]}
      />

      {/* Links section - using LinksSection component */}
      <LinksSection
        title="Links"
        links={getTaskLinks(task)}
      />
    </div>
  );
});

interface TaskDetailsInternalProps extends TaskDetailsProps {
  allGroups: GroupWithLayout[];
  /** Navigate back to workflow view */
  onBackToWorkflow?: () => void;
  onPanelResize: (pct: number) => void;
  onSelectGroup?: (group: GroupWithLayout) => void;
  isDetailsExpanded: boolean;
  onToggleDetailsExpanded: () => void;
  /** Called when shell tab becomes active/inactive. Passes taskName when active, null when inactive. */
  onShellTabChange?: (taskName: string | null) => void;
  /** Currently selected tab (URL-synced) */
  selectedTab?: TaskTab;
  /** Callback to change the selected tab */
  setSelectedTab?: (tab: TaskTab) => void;
}

export const TaskDetails = memo(function TaskDetails({
  group,
  allGroups,
  task,
  workflowName,
  onBackToGroup,
  onBackToWorkflow,
  onSelectTask,
  onSelectGroup,
  onPanelResize,
  isDetailsExpanded,
  onToggleDetailsExpanded,
  onShellTabChange,
  selectedTab: selectedTabProp,
  setSelectedTab: setSelectedTabProp,
}: TaskDetailsInternalProps) {
  const category = getStatusCategory(task.status);
  const style = getStatusStyle(task.status);

  // Shell connection is only allowed for tasks in exact RUNNING status (not INITIALIZING)
  const canConnectShell = task.status === TaskGroupStatus.RUNNING && !!workflowName;

  // Shell tab is always shown (with contextual messages for non-running states)
  const activeTab = selectedTabProp ?? "overview";

  // Notify parent when shell tab becomes active/inactive (only when connectable)
  useEffect(() => {
    if (activeTab === "shell" && canConnectShell) {
      onShellTabChange?.(task.name);
    } else {
      onShellTabChange?.(null);
    }
  }, [activeTab, canConnectShell, task.name, onShellTabChange]);

  // Clean up when component unmounts (navigating away)
  useEffect(() => {
    return () => {
      onShellTabChange?.(null);
    };
  }, [onShellTabChange]);

  // Shell context for connecting shells
  const { connectShell, hasActiveShell } = useShellContext();
  const hasShellSession = hasActiveShell(task.task_uuid);

  // Get actual session status from cache (for accurate status indicator)
  const shellSession = useShellSession(task.task_uuid);

  // Shell portal for rendering shell in correct position
  const { setPortalTarget } = useShellPortal();
  const shellTabRef = useRef<HTMLDivElement>(null);

  // Handle clicking Connect in the shell tab (with shell selection)
  const handleConnectShell = useCallback(
    (shell: string) => {
      if (workflowName && task.task_uuid && canConnectShell) {
        connectShell(task.task_uuid, task.name, workflowName, shell);
      }
    },
    [workflowName, task.task_uuid, task.name, connectShell, canConnectShell],
  );

  // Register/unregister portal target when shell tab is active and we have a session
  useEffect(() => {
    if (activeTab === "shell" && hasShellSession && canConnectShell && shellTabRef.current) {
      setPortalTarget(shellTabRef.current);
    } else {
      setPortalTarget(null);
    }

    return () => {
      setPortalTarget(null);
    };
  }, [activeTab, hasShellSession, canConnectShell, setPortalTarget]);

  // Wrap in useMemo to avoid unstable reference when group.tasks is falsy
  const tasks = useMemo(() => group.tasks || [], [group.tasks]);
  const isStandaloneTask = tasks.length <= 1; // Single-task group
  const isFromGroup = tasks.length > 1;

  // Synchronized tick for live duration (for running tasks)
  const now = useTick();
  const duration = calculateDuration(task.start_time, task.end_time, now);

  // Build sibling tasks for inline switcher
  const siblingTasks: SiblingTask[] = useMemo(() => {
    return tasks.map((t) => ({
      name: t.name,
      retryId: t.retry_id,
      status: t.status,
      isCurrent: t.name === task.name && t.retry_id === task.retry_id,
      isLead: t.lead,
    }));
  }, [tasks, task.name, task.retry_id]);

  // Handle sibling selection from dropdown
  const handleSelectSibling = useCallback(
    (name: string, retryId: number) => {
      const selectedTask = tasks.find((t) => t.name === name && t.retry_id === retryId);
      if (selectedTask) {
        onSelectTask(selectedTask, group);
      }
    },
    [tasks, group, onSelectTask],
  );

  // Handle dependency pill click (for standalone tasks)
  const handleSelectGroupByName = useCallback(
    (groupName: string) => {
      if (onSelectGroup) {
        const targetGroup = allGroups.find((g) => g.name === groupName);
        if (targetGroup) {
          onSelectGroup(targetGroup);
        }
      }
    },
    [allGroups, onSelectGroup],
  );

  // Compute upstream/downstream groups (only for standalone tasks)
  const upstreamGroups = useMemo(() => {
    if (!isStandaloneTask) return [];
    return allGroups.filter((g) => g.downstream_groups?.includes(group.name));
  }, [allGroups, group.name, isStandaloneTask]);

  const downstreamGroups = useMemo(() => {
    if (!isStandaloneTask) return [];
    return allGroups.filter((g) => group.downstream_groups?.includes(g.name));
  }, [allGroups, group.downstream_groups, isStandaloneTask]);

  // Status content for header (Row 2 - clean, consistent with GroupDetails)
  const statusContent = (
    <SeparatedParts className={cn("text-xs", style.text)}>
      <span className="flex items-center gap-1.5">
        {getStatusIcon(task.status, "size-3")}
        <span className="font-medium">{getStatusLabel(task.status)}</span>
      </span>
      {duration !== null && <span className="text-gray-500 dark:text-zinc-400">{formatDuration(duration)}</span>}
      {task.retry_id > 0 && <span className="text-gray-500 dark:text-zinc-400">Retry #{task.retry_id}</span>}
    </SeparatedParts>
  );

  // Check if we have any expandable content
  const hasFailureMessage = !!task.failure_message;
  const hasDependencies = isStandaloneTask && (upstreamGroups.length > 0 || downstreamGroups.length > 0);
  const hasExpandableContent = hasFailureMessage || hasDependencies;

  // Expandable content for header
  const expandableContent = hasExpandableContent ? (
    <div className="space-y-3">
      {/* Failure message - first item when present */}
      {hasFailureMessage && (
        <div className="flex items-start gap-1.5 text-xs text-red-400">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          <span>{task.failure_message}</span>
        </div>
      )}
      {hasDependencies && (
        <DependencyPills
          upstreamGroups={upstreamGroups}
          downstreamGroups={downstreamGroups}
          onSelectGroup={handleSelectGroupByName}
        />
      )}
    </div>
  ) : undefined;

  // Build breadcrumbs for hierarchical navigation
  // For tasks within a group: Workflow / Group > Task
  // For standalone tasks: Workflow > Task
  const breadcrumbs = useMemo((): BreadcrumbSegment[] => {
    const segments: BreadcrumbSegment[] = [];

    // Always add "Workflow" as the first segment if we can navigate back
    if (onBackToWorkflow) {
      segments.push({ label: "Workflow", onClick: onBackToWorkflow });
    }

    // Add group segment for multi-task groups
    if (isFromGroup && onBackToGroup) {
      segments.push({ label: group.name, onClick: onBackToGroup });
    }

    return segments;
  }, [onBackToWorkflow, onBackToGroup, isFromGroup, group.name]);

  // Handle tab change - update URL state
  const handleTabChange = useCallback(
    (value: string) => {
      setSelectedTabProp?.(value as TaskTab);
    },
    [setSelectedTabProp],
  );

  // Build tabs array - shell tab is always shown with contextual content
  const availableTabs: PanelTab[] = useMemo(() => {
    // Shell status indicator: show StatusDot when connected, nothing otherwise
    const shellStatusContent =
      shellSession && shellSession.status !== "idle" ? <StatusDot status={shellSession.status} /> : undefined;

    return [
      { id: "overview", label: "Overview", icon: Info },
      { id: "shell", label: "Shell", icon: Terminal, statusContent: shellStatusContent },
      { id: "logs", label: "Logs", icon: FileText },
      { id: "events", label: "Events", icon: History },
    ];
  }, [shellSession]);

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden">
      {/* Header - aligned with GroupDetails layout */}
      <DetailsPanelHeader
        viewType="task"
        isLead={task.lead}
        breadcrumbs={breadcrumbs.length > 0 ? breadcrumbs : undefined}
        title={task.name}
        statusContent={statusContent}
        onPanelResize={onPanelResize}
        siblingTasks={isFromGroup ? siblingTasks : undefined}
        onSelectSibling={isFromGroup ? handleSelectSibling : undefined}
        expandableContent={expandableContent}
        isExpanded={isDetailsExpanded}
        onToggleExpand={onToggleDetailsExpanded}
      />

      {/* Tab Navigation - Chrome-style tabs with curved connectors */}
      <PanelTabs
        tabs={availableTabs}
        value={activeTab}
        onValueChange={handleTabChange}
        compactBreakpoint={280}
      />

      {/* Tab Content */}
      <div className="relative flex-1 overflow-hidden bg-white dark:bg-zinc-900">
        <TabPanel
          tab="overview"
          activeTab={activeTab}
          padding="with-bottom"
        >
          <OverviewTab task={task} />
        </TabPanel>

        {/* Shell tab - always shown with contextual content based on task status */}
        <div
          ref={shellTabRef}
          className={cn("absolute inset-0", activeTab !== "shell" && "invisible")}
          aria-label={`Shell for ${task.name}`}
        >
          {/* When task is RUNNING and no session exists, show connect prompt */}
          {canConnectShell && !hasShellSession && (
            <div className="flex h-full items-center justify-center p-4">
              <ShellConnectPrompt onConnect={handleConnectShell} />
            </div>
          )}
          {/* When task is not RUNNING (or not connectable), show status message */}
          {!canConnectShell && (
            <div className="flex h-full items-center justify-center p-4">
              <ShellStatusPrompt
                status={task.status}
                category={category}
              />
            </div>
          )}
          {/* When session exists and task is running, ShellContainer portals into this container */}
        </div>

        <TabPanel
          tab="logs"
          activeTab={activeTab}
          centered
          className="p-4"
        >
          <EmptyTabPrompt
            icon={FileText}
            title="Task Logs"
            description="View stdout/stderr output from the task execution"
            url={task.logs}
            secondaryAction={
              task.error_logs ? { url: task.error_logs, label: "View Error Logs", icon: AlertCircle } : undefined
            }
          />
        </TabPanel>

        <TabPanel
          tab="events"
          activeTab={activeTab}
          centered
          className="p-4"
        >
          <EmptyTabPrompt
            icon={History}
            title="Kubernetes Events"
            description="Pod scheduling, container lifecycle, and resource events"
            url={task.events}
            buttonLabel="View Events"
            emptyText="No events available"
          />
        </TabPanel>
      </div>
    </div>
  );
});
