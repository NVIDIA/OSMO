// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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
import { FileText, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { calculateDuration, formatDuration } from "../../../workflow-types";
import { getStatusIcon, getStatusCategory, getStatusStyle, getStatusLabel } from "../../utils/status";
import { DetailsPanelHeader } from "./DetailsPanelHeader";
import type { TaskDetailsProps, SiblingTask } from "../../types/panel";

// ============================================================================
// Component
// ============================================================================

interface TaskDetailsInternalProps extends TaskDetailsProps {
  onClose: () => void;
  onPanelResize: (pct: number) => void;
}

export const TaskDetails = memo(function TaskDetails({
  group,
  task,
  onBackToGroup,
  onSelectTask,
  onClose,
  onPanelResize,
}: TaskDetailsInternalProps) {
  const category = getStatusCategory(task.status);
  const style = getStatusStyle(task.status);
  const tasks = group.tasks || [];
  const isFromGroup = tasks.length > 1;

  // Build sibling tasks for inline switcher
  const siblingTasks: SiblingTask[] = useMemo(() => {
    return tasks.map((t) => ({
      name: t.name,
      retryId: t.retry_id,
      status: t.status,
      isCurrent: t.name === task.name && t.retry_id === task.retry_id,
    }));
  }, [tasks, task.name, task.retry_id]);

  // Handle sibling selection from dropdown
  const handleSelectSibling = useCallback((name: string, retryId: number) => {
    const selectedTask = tasks.find((t) => t.name === name && t.retry_id === retryId);
    if (selectedTask) {
      onSelectTask(selectedTask, group);
    }
  }, [tasks, group, onSelectTask]);

  // Status content for header (Row 2 - matches GroupDetails layout)
  const statusContent = (
    <div className={cn("flex items-center gap-1.5 text-xs", style.text)}>
      {getStatusIcon(task.status, "size-3")}
      <span className="font-medium">{getStatusLabel(task.status)}</span>
      {task.retry_id > 0 && (
        <>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-400">Retry #{task.retry_id}</span>
        </>
      )}
    </div>
  );

  return (
    <>
      {/* Header - aligned with GroupDetails layout */}
      <DetailsPanelHeader
        viewType="task"
        breadcrumb={isFromGroup ? group.name : undefined}
        title={task.name}
        statusContent={statusContent}
        onBack={isFromGroup ? onBackToGroup : undefined}
        onClose={onClose}
        onPanelResize={onPanelResize}
        siblingTasks={isFromGroup ? siblingTasks : undefined}
        onSelectSibling={isFromGroup ? handleSelectSibling : undefined}
      />

      {/* Content */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">

        {/* Task details */}
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400">Task Details</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-400">Group</dt>
              <dd
                className="max-w-40 truncate font-mono text-xs text-zinc-200"
                title={group.name}
              >
                {group.name}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Duration</dt>
              <dd className="text-zinc-200">{formatDuration(calculateDuration(task.start_time, task.end_time))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Node</dt>
              <dd className="font-mono text-xs text-zinc-200">{task.node_name || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Pod</dt>
              <dd
                className="max-w-40 truncate font-mono text-xs text-zinc-200"
                title={task.pod_name}
              >
                {task.pod_name || "—"}
              </dd>
            </div>
            {task.pod_ip && (
              <div className="flex justify-between">
                <dt className="text-zinc-400">Pod IP</dt>
                <dd className="font-mono text-xs text-zinc-200">{task.pod_ip}</dd>
              </div>
            )}
            {task.start_time && (
              <div className="flex justify-between">
                <dt className="text-zinc-400">Started</dt>
                <dd className="text-xs text-zinc-200">{new Date(task.start_time).toLocaleString()}</dd>
              </div>
            )}
            {task.end_time && (
              <div className="flex justify-between">
                <dt className="text-zinc-400">Ended</dt>
                <dd className="text-xs text-zinc-200">{new Date(task.end_time).toLocaleString()}</dd>
              </div>
            )}
            {task.exit_code !== undefined && task.exit_code !== null && (
              <div className="flex justify-between">
                <dt className="text-zinc-400">Exit Code</dt>
                <dd className={cn("font-mono text-xs", task.exit_code === 0 ? "text-zinc-200" : "text-red-400")}>
                  {task.exit_code}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Failure message */}
        {task.failure_message && (
          <div className="rounded-md bg-red-950/50 p-3">
            <h3 className="mb-1 text-xs font-medium text-red-400">Failure Message</h3>
            <p className="text-sm text-red-200">{task.failure_message}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2" role="group" aria-label="Task actions">
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-1 border-zinc-700 bg-zinc-800/50 text-xs text-zinc-200 hover:bg-zinc-700 hover:text-white"
            asChild
          >
            <a
              href={task.logs}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View logs for ${task.name}`}
            >
              <FileText className="mr-1.5 size-3.5" aria-hidden="true" />
              View Logs
            </a>
          </Button>
          {category === "running" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 flex-1 border-zinc-700 bg-zinc-800/50 text-xs text-zinc-200 hover:bg-zinc-700 hover:text-white"
              aria-label={`Open shell for ${task.name}`}
            >
              <Terminal className="mr-1.5 size-3.5" aria-hidden="true" />
              Shell
            </Button>
          )}
        </div>
      </div>
    </>
  );
});
