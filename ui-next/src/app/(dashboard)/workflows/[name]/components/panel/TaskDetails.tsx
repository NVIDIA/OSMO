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
 * - Task information display
 * - Action buttons (logs, shell)
 * - Sibling task navigation within the same group
 * - Visual hierarchy matching GroupDetails
 */

"use client";

import { useMemo, useCallback, memo } from "react";
import { FileText, Terminal, AlertCircle, Copy, Check, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import { useCopy } from "@/hooks";
import { calculateDuration, formatDuration } from "../../lib/workflow-types";
import type { GroupWithLayout } from "../../lib/workflow-types";
import { getStatusIcon, getStatusCategory, getStatusStyle, getStatusLabel } from "../../lib/status";
import { DetailsPanelHeader } from "./DetailsPanelHeader";
import { TaskTimeline } from "./TaskTimeline";
import { DependencyPills } from "./DependencyPills";
import type { TaskDetailsProps, SiblingTask, BreadcrumbSegment } from "../../lib/panel-types";

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
// Component
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
}

export const TaskDetails = memo(function TaskDetails({
  group,
  allGroups,
  task,
  onBackToGroup,
  onBackToWorkflow,
  onSelectTask,
  onSelectGroup,
  onClose,
  onPanelResize,
  isDetailsExpanded,
  onToggleDetailsExpanded,
}: TaskDetailsInternalProps) {
  const category = getStatusCategory(task.status);
  const style = getStatusStyle(task.status);
  // Wrap in useMemo to avoid unstable reference when group.tasks is falsy
  const tasks = useMemo(() => group.tasks || [], [group.tasks]);
  const isStandaloneTask = tasks.length <= 1; // Single-task group
  const isFromGroup = tasks.length > 1;
  const duration = calculateDuration(task.start_time, task.end_time);

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
  const hasTimeline = task.scheduling_start_time || task.start_time;
  const hasDependencies = isStandaloneTask && (upstreamGroups.length > 0 || downstreamGroups.length > 0);
  const hasExpandableContent = hasFailureMessage || hasTimeline || hasDependencies;

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
      {hasTimeline && <TaskTimeline task={task} />}
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

  return (
    <div className="relative flex h-full flex-col">
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

      {/* Content */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-16">
        {/* Exit status - special treatment at top when non-zero */}
        {task.exit_code !== undefined && task.exit_code !== null && task.exit_code !== 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/30">
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

        {/* Task details - Option D layout */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
          {/* Task UUID - first */}
          <dt className="text-gray-500 dark:text-zinc-400">UUID</dt>
          <dd className="flex min-w-0 items-center">
            <span
              className="truncate font-mono text-xs text-gray-700 dark:text-zinc-200"
              title={task.task_uuid}
            >
              {task.task_uuid}
            </span>
            <CopyButton
              value={task.task_uuid}
              label="Task UUID"
            />
          </dd>

          {/* Node */}
          {task.node_name && (
            <>
              <dt className="text-gray-500 dark:text-zinc-400">Node</dt>
              <dd className="flex min-w-0 items-center">
                <span className="truncate font-mono text-xs text-gray-700 dark:text-zinc-200">{task.node_name}</span>
                <CopyButton
                  value={task.node_name}
                  label="Node"
                />
              </dd>
            </>
          )}

          {/* Pod */}
          {task.pod_name && (
            <>
              <dt className="text-gray-500 dark:text-zinc-400">Pod</dt>
              <dd className="flex min-w-0 items-center">
                <span
                  className="truncate font-mono text-xs text-gray-700 dark:text-zinc-200"
                  title={task.pod_name}
                >
                  {task.pod_name}
                </span>
                <CopyButton
                  value={task.pod_name}
                  label="Pod"
                />
              </dd>
            </>
          )}

          {/* Pod IP */}
          {task.pod_ip && (
            <>
              <dt className="text-gray-500 dark:text-zinc-400">Pod IP</dt>
              <dd className="flex min-w-0 items-center">
                <span className="font-mono text-xs text-gray-700 dark:text-zinc-200">{task.pod_ip}</span>
                <CopyButton
                  value={task.pod_ip}
                  label="Pod IP"
                />
              </dd>
            </>
          )}

          {/* Exit code - only show if success (0), failures shown above */}
          {task.exit_code === 0 && (
            <>
              <dt className="text-gray-500 dark:text-zinc-400">Exit Code</dt>
              <dd className="font-mono text-xs text-gray-700 dark:text-zinc-200">0</dd>
            </>
          )}
        </dl>

        {/* Actions */}
        <div
          className="flex gap-2"
          role="group"
          aria-label="Task actions"
        >
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-1 border-gray-300 bg-gray-100/50 text-xs text-gray-700 hover:bg-gray-200 hover:text-gray-900 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:hover:text-white"
            asChild
          >
            <a
              href={task.logs}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View logs for ${task.name}`}
            >
              <FileText
                className="mr-1.5 size-3.5"
                aria-hidden="true"
              />
              View Logs
            </a>
          </Button>
          {category === "running" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 flex-1 border-gray-300 bg-gray-100/50 text-xs text-gray-700 hover:bg-gray-200 hover:text-gray-900 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:hover:text-white"
              aria-label={`Open shell for ${task.name}`}
            >
              <Terminal
                className="mr-1.5 size-3.5"
                aria-hidden="true"
              />
              Shell
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});
