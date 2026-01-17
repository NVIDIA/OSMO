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
 * TaskDetails Component
 *
 * Content component for displaying task details within DetailsPanel.
 * Features:
 * - Tabbed interface: Overview, Shell (for running tasks), Logs, Events
 * - Task information display
 * - Sibling task navigation within the same group
 * - Visual hierarchy matching GroupDetails
 */

"use client";

import { useMemo, useCallback, memo, useState, useEffect } from "react";
import {
  FileText,
  Terminal,
  AlertCircle,
  Copy,
  Check,
  XCircle,
  Calendar,
  Info,
  ExternalLink,
  BarChart3,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import { Card, CardContent } from "@/components/shadcn/card";
import { PanelTabs, type PanelTab } from "@/components/panel-tabs";
import { useCopy, useTick } from "@/hooks";
import { ShellConnectPrompt } from "./TaskShell";
import { calculateDuration, formatDuration } from "../../../lib/workflow-types";
import type { GroupWithLayout } from "../../../lib/workflow-types";
import { getStatusIcon, getStatusCategory, getStatusStyle, getStatusLabel } from "../../../lib/status";
import { DetailsPanelHeader } from "../shared/DetailsPanelHeader";
import { TaskTimeline } from "./TaskTimeline";
import { DependencyPills } from "../shared/DependencyPills";
import type { TaskDetailsProps, SiblingTask, BreadcrumbSegment } from "../../../lib/panel-types";
import { useShellStore } from "../../../stores";

// ============================================================================
// Types
// ============================================================================

type TaskTab = "overview" | "shell" | "logs" | "events";

// ============================================================================
// Copy Button Component
// ============================================================================

function CopyButton({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy();

  return (
    <button
      onClick={() => copy(value)}
      className="text-muted-foreground hover:bg-accent hover:text-foreground ml-1.5 shrink-0 rounded p-0.5 transition-colors"
      aria-label={`Copy ${label}`}
      title={copied ? "Copied!" : `Copy ${label}`}
    >
      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
    </button>
  );
}

// ============================================================================
// Overview Tab Content
// ============================================================================

interface OverviewTabProps {
  task: TaskDetailsProps["task"];
}

// ============================================================================
// Logs Tab Content (Placeholder)
// ============================================================================

interface LogsTabProps {
  task: TaskDetailsProps["task"];
}

const LogsTab = memo(function LogsTab({ task }: LogsTabProps) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800">
        <FileText className="size-6 text-gray-400 dark:text-zinc-500" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">Task Logs</h3>
        <p className="mt-1 max-w-xs text-xs text-gray-500 dark:text-zinc-400">
          View stdout/stderr output from the task execution
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        asChild
      >
        <a
          href={task.logs}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FileText className="mr-1.5 size-3.5" />
          Open in New Tab
        </a>
      </Button>
      {task.error_logs && (
        <Button
          variant="outline"
          size="sm"
          className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
          asChild
        >
          <a
            href={task.error_logs}
            target="_blank"
            rel="noopener noreferrer"
          >
            <AlertCircle className="mr-1.5 size-3.5" />
            View Error Logs
          </a>
        </Button>
      )}
    </div>
  );
});

// ============================================================================
// Events Tab Content (Placeholder)
// ============================================================================

interface EventsTabProps {
  task: TaskDetailsProps["task"];
}

const EventsTab = memo(function EventsTab({ task }: EventsTabProps) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800">
        <Calendar className="size-6 text-gray-400 dark:text-zinc-500" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">Kubernetes Events</h3>
        <p className="mt-1 max-w-xs text-xs text-gray-500 dark:text-zinc-400">
          Pod scheduling, container lifecycle, and resource events
        </p>
      </div>
      {task.events ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          asChild
        >
          <a
            href={task.events}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Calendar className="mr-1.5 size-3.5" />
            View Events
          </a>
        </Button>
      ) : (
        <p className="text-xs text-gray-400 dark:text-zinc-500">No events available</p>
      )}
    </div>
  );
});

// ============================================================================
// Overview Tab Content
// ============================================================================

/** Reusable style patterns (matches WorkflowDetails) */
const STYLES = {
  /** Section header styling */
  sectionHeader: "text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase",
  /** External link styling */
  link: "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted",
} as const;

/** Detail row component for consistent styling (matches WorkflowDetails) */
const DetailRow = memo(function DetailRow({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <>
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      <span className="flex min-w-0 items-center">
        <span
          className="min-w-0 truncate font-mono text-xs"
          title={value}
        >
          {value}
        </span>
        {copyable && (
          <CopyButton
            value={value}
            label={label}
          />
        )}
      </span>
    </>
  );
});

const OverviewTab = memo(function OverviewTab({ task }: OverviewTabProps) {
  const hasError = task.exit_code !== undefined && task.exit_code !== null && task.exit_code !== 0;
  const hasDetails = task.task_uuid || task.node_name || task.pod_name || task.pod_ip;

  // Build links array - cast to access grafana_url which may not be in generated types yet
  const taskWithLinks = task as typeof task & { grafana_url?: string };
  const links = [
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
  ].filter((link) => link.url);

  const hasLinks = links.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Timeline section */}
      <section>
        <h3 className={STYLES.sectionHeader}>Timeline</h3>
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

      {/* Details section - using Card like WorkflowDetails */}
      {hasDetails && (
        <section>
          <h3 className={STYLES.sectionHeader}>Details</h3>
          <Card className="gap-0 overflow-hidden py-0">
            <CardContent className="min-w-0 p-3">
              {/* auto column for labels (shrinks to fit), 1fr for values (uses remaining space) */}
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-2 text-sm">
                {task.task_uuid && (
                  <DetailRow
                    label="UUID"
                    value={task.task_uuid}
                    copyable
                  />
                )}
                {task.node_name && (
                  <DetailRow
                    label="Node"
                    value={task.node_name}
                    copyable
                  />
                )}
                {task.pod_name && (
                  <DetailRow
                    label="Pod"
                    value={task.pod_name}
                    copyable
                  />
                )}
                {task.pod_ip && (
                  <DetailRow
                    label="Pod IP"
                    value={task.pod_ip}
                    copyable
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Links section */}
      {hasLinks && (
        <section>
          <h3 className={STYLES.sectionHeader}>Links</h3>
          <Card className="gap-0 overflow-hidden py-0">
            <CardContent className="divide-border divide-y p-0">
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:bg-muted/50 flex items-center gap-3 p-3 transition-colors"
                  >
                    <Icon className="text-muted-foreground size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{link.label}</div>
                      <div className="text-muted-foreground text-xs">{link.description}</div>
                    </div>
                    <ExternalLink className="text-muted-foreground/50 size-3.5 shrink-0" />
                  </a>
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

interface TaskDetailsInternalProps extends TaskDetailsProps {
  allGroups: GroupWithLayout[];
  onClose: () => void;
  /** Navigate back to workflow view */
  onBackToWorkflow?: () => void;
  onPanelResize: (pct: number) => void;
  onSelectGroup?: (group: GroupWithLayout) => void;
  isDetailsExpanded: boolean;
  onToggleDetailsExpanded: () => void;
  /** Called when shell tab becomes active/inactive. Passes taskName when active, null when inactive. */
  onShellTabChange?: (taskName: string | null) => void;
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
  onClose,
  onPanelResize,
  isDetailsExpanded,
  onToggleDetailsExpanded,
  onShellTabChange,
}: TaskDetailsInternalProps) {
  const category = getStatusCategory(task.status);
  const style = getStatusStyle(task.status);
  const isRunning = category === "running";

  // Tab state
  const [activeTab, setActiveTab] = useState<TaskTab>("overview");

  // Notify parent when shell tab becomes active/inactive
  useEffect(() => {
    if (activeTab === "shell" && isRunning && workflowName) {
      onShellTabChange?.(task.name);
    } else {
      onShellTabChange?.(null);
    }
  }, [activeTab, isRunning, workflowName, task.name, onShellTabChange]);

  // Clean up when component unmounts (navigating away)
  useEffect(() => {
    return () => {
      onShellTabChange?.(null);
    };
  }, [onShellTabChange]);

  // Get shell session and openSession action from store
  const shellSession = useShellStore((s) => s.getSession(task.name));
  const openSession = useShellStore((s) => s.openSession);

  // Handle clicking Connect in the shell tab (with shell selection)
  const handleConnectShell = useCallback(
    (shell: string) => {
      if (workflowName) {
        openSession(workflowName, task.name, shell);
      }
    },
    [workflowName, task.name, openSession],
  );

  // Check if we should show the connect overlay vs the actual shell
  const hasShellSession = !!shellSession;

  // Compute shell status indicator for tab based on store state
  const shellStatusIndicator = useMemo((): "green" | "red" | undefined => {
    if (!shellSession) {
      return undefined;
    }
    const { status } = shellSession;
    // Connected - green
    if (status === "connected" || status === "connecting") {
      return "green";
    }
    // Disconnected or error - red
    if (status === "disconnected" || status === "error") {
      return "red";
    }
    // Idle - no indicator
    return undefined;
  }, [shellSession]);

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
    <div className={cn("flex items-center gap-1.5 text-xs", style.text)}>
      {getStatusIcon(task.status, "size-3")}
      <span className="font-medium">{getStatusLabel(task.status)}</span>
      {duration !== null && (
        <>
          <span className="text-gray-400 dark:text-zinc-600">·</span>
          <span className="text-gray-500 dark:text-zinc-400">{formatDuration(duration)}</span>
        </>
      )}
      {task.retry_id > 0 && (
        <>
          <span className="text-gray-400 dark:text-zinc-600">·</span>
          <span className="text-gray-500 dark:text-zinc-400">Retry #{task.retry_id}</span>
        </>
      )}
    </div>
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

  // Handle tab change
  const handleTabChange = useCallback(
    (value: string) => {
      setActiveTab(value as TaskTab);
    },
    [setActiveTab],
  );

  // Build tabs array dynamically based on whether shell is available
  const availableTabs: PanelTab[] = useMemo(() => {
    const tabs: PanelTab[] = [{ id: "overview", label: "Overview", icon: Info }];

    if (isRunning && workflowName) {
      tabs.push({ id: "shell", label: "Shell", icon: Terminal, statusIndicator: shellStatusIndicator });
    }

    tabs.push({ id: "logs", label: "Logs", icon: FileText }, { id: "events", label: "Events", icon: Calendar });

    return tabs;
  }, [isRunning, workflowName, shellStatusIndicator]);

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden">
      {/* Header - aligned with GroupDetails layout */}
      <DetailsPanelHeader
        viewType="task"
        isLead={task.lead}
        breadcrumbs={breadcrumbs.length > 0 ? breadcrumbs : undefined}
        title={task.name}
        statusContent={statusContent}
        onClose={onClose}
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
        {/* Overview tab */}
        <div className={cn("absolute inset-0 overflow-y-auto", activeTab !== "overview" && "invisible")}>
          <div className="p-4 pb-16">
            <OverviewTab task={task} />
          </div>
        </div>

        {/* Shell tab - shows connect prompt OR ShellContainer renders the active shell */}
        {isRunning && workflowName && (
          <div
            className={cn("absolute inset-0 overflow-y-auto", activeTab !== "shell" && "invisible")}
            aria-label={`Shell for ${task.name}`}
          >
            {/* Show connect prompt when no session exists */}
            {!hasShellSession && (
              <div className="flex h-full items-center justify-center p-4">
                <ShellConnectPrompt onConnect={handleConnectShell} />
              </div>
            )}
            {/* When session exists, ShellContainer (rendered at DetailsPanel level) overlays this area */}
          </div>
        )}

        {/* Logs tab */}
        <div className={cn("absolute inset-0 overflow-y-auto", activeTab !== "logs" && "invisible")}>
          <div className="flex h-full items-center justify-center p-4">
            <LogsTab task={task} />
          </div>
        </div>

        {/* Events tab */}
        <div className={cn("absolute inset-0 overflow-y-auto", activeTab !== "events" && "invisible")}>
          <div className="flex h-full items-center justify-center p-4">
            <EventsTab task={task} />
          </div>
        </div>
      </div>
    </div>
  );
});
