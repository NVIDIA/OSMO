// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * DetailPanel Component
 *
 * Side panel showing task details when a task is selected.
 * Features:
 * - Task information display
 * - Action buttons (logs, shell)
 * - Back navigation to GroupPanel (for multi-task groups)
 * - WCAG 2.1 AA accessibility
 */

"use client";

import { useEffect, useRef } from "react";
import { XCircle, FileText, Terminal, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { GroupWithLayout, TaskQueryResponse } from "../../workflow-types";
import { calculateDuration, formatDuration } from "../../workflow-types";
import { getStatusIcon, getStatusCategory, getStatusStyle } from "../utils/status";
import { GPU_STYLES } from "../constants";

interface DetailPanelProps {
  group: GroupWithLayout;
  task: TaskQueryResponse;
  onClose: () => void;
  /** Optional: go back to GroupPanel (only shown for multi-task groups) */
  onBack?: () => void;
}

export function DetailPanel({ group, task, onClose, onBack }: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const category = getStatusCategory(task.status);
  const style = getStatusStyle(task.status);

  // Check if this is from a multi-task group (show back button)
  const isFromGroup = (group.tasks?.length ?? 0) > 1;

  // Focus management for accessibility
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [task]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <aside
      ref={panelRef}
      className="w-1/3 min-w-80 max-w-[30rem] overflow-y-auto border-l border-zinc-800 bg-zinc-900/95 backdrop-blur"
      style={GPU_STYLES.contained}
      role="complementary"
      aria-label="Task details"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/95 p-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* Back button for multi-task groups */}
            {isFromGroup && onBack && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={onBack}
                aria-label="Back to group"
              >
                <ChevronLeft className="size-4 text-zinc-400" aria-hidden="true" />
              </Button>
            )}
            {getStatusIcon(task.status)}
            <h2
              className="truncate font-semibold text-zinc-100"
              id="detail-panel-title"
            >
              {task.name}
            </h2>
          </div>
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={onClose}
            aria-label="Close details panel"
          >
            <XCircle className="size-4 text-zinc-400" aria-hidden="true" />
          </Button>
        </div>
        <div className={cn("mt-1 text-xs", style.text)}>
          {task.status}
          {task.retry_id > 0 && ` • Retry #${task.retry_id}`}
        </div>
      </div>

      {/* Task details */}
      <div className="space-y-4 p-4" aria-labelledby="detail-panel-title">
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400">Task Details</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-400">Group</dt>
              <dd
                className="max-w-[9.375rem] truncate font-mono text-xs text-zinc-200"
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
              <dd className="font-mono text-xs text-zinc-200">{task.node_name || "-"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Pod</dt>
              <dd
                className="max-w-[9.375rem] truncate font-mono text-xs text-zinc-200"
                title={task.pod_name}
              >
                {task.pod_name || "-"}
              </dd>
            </div>
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
            className="h-7 flex-1 text-xs"
            asChild
          >
            <a
              href={task.logs}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View logs for ${task.name}`}
            >
              <FileText className="mr-1 size-3" aria-hidden="true" />
              Logs
            </a>
          </Button>
          {category === "running" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 flex-1 text-xs"
              aria-label={`Open shell for ${task.name}`}
            >
              <Terminal className="mr-1 size-3" aria-hidden="true" />
              Shell
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
