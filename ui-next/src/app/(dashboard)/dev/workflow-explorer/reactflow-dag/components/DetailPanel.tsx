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
 * - WCAG 2.1 AA accessibility
 */

"use client";

import { useEffect, useRef } from "react";
import { XCircle, FileText, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { GroupWithLayout, TaskQueryResponse } from "../../workflow-types";
import { calculateDuration, formatDuration } from "../../workflow-types";
import { getStatusIcon, getStatusCategory, getStatusStyle } from "../utils/status";

interface DetailPanelProps {
  group: GroupWithLayout;
  task: TaskQueryResponse;
  onClose: () => void;
}

export function DetailPanel({ group, task, onClose }: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const category = getStatusCategory(task.status);
  const style = getStatusStyle(task.status);

  // Focus management for accessibility
  useEffect(() => {
    // Focus the close button when panel opens
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
      className="w-1/3 min-w-[320px] max-w-[480px] border-l border-zinc-800 bg-zinc-900/95 backdrop-blur overflow-y-auto"
      role="complementary"
      aria-label="Task details"
    >
      {/* Header */}
      <div className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 p-4 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {getStatusIcon(task.status)}
            <h2
              className="font-semibold text-zinc-100 truncate"
              id="detail-panel-title"
            >
              {task.name}
            </h2>
          </div>
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={onClose}
            aria-label="Close details panel"
          >
            <XCircle
              className="h-4 w-4 text-zinc-400"
              aria-hidden="true"
            />
          </Button>
        </div>
        <div className={cn("text-xs mt-1", style.text)}>
          {task.status}
          {task.retry_id > 0 && ` • Retry #${task.retry_id}`}
        </div>
      </div>

      {/* Task details */}
      <div
        className="p-4 space-y-4"
        aria-labelledby="detail-panel-title"
      >
        <div>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Task Details</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-400">Group</dt>
              <dd
                className="text-zinc-200 font-mono text-xs truncate max-w-[150px]"
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
              <dd className="text-zinc-200 font-mono text-xs">{task.node_name || "-"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Pod</dt>
              <dd
                className="text-zinc-200 font-mono text-xs truncate max-w-[150px]"
                title={task.pod_name}
              >
                {task.pod_name || "-"}
              </dd>
            </div>
            {task.start_time && (
              <div className="flex justify-between">
                <dt className="text-zinc-400">Started</dt>
                <dd className="text-zinc-200 text-xs">{new Date(task.start_time).toLocaleString()}</dd>
              </div>
            )}
            {task.end_time && (
              <div className="flex justify-between">
                <dt className="text-zinc-400">Ended</dt>
                <dd className="text-zinc-200 text-xs">{new Date(task.end_time).toLocaleString()}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Actions */}
        <div
          className="flex gap-2"
          role="group"
          aria-label="Task actions"
        >
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs"
            asChild
          >
            <a
              href={task.logs}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View logs for ${task.name}`}
            >
              <FileText
                className="h-3 w-3 mr-1"
                aria-hidden="true"
              />
              Logs
            </a>
          </Button>
          {category === "running" && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs"
              aria-label={`Open shell for ${task.name}`}
            >
              <Terminal
                className="h-3 w-3 mr-1"
                aria-hidden="true"
              />
              Shell
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
