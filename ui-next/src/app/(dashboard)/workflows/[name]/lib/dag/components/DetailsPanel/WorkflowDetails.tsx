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
 * WorkflowDetails Component
 *
 * Displays workflow-level details in the unified inspector panel.
 * This is the "base layer" shown when no group/task is selected.
 *
 * Includes:
 * - Status, priority, and duration
 * - Vertical timeline (submitted → started → running/completed)
 * - Metadata (user, pool, tags)
 * - External links (logs, dashboard, grafana, etc.)
 * - Actions (cancel workflow)
 */

"use client";

import { memo, useMemo, useState, useEffect } from "react";
import { ExternalLink, FileText, BarChart3, Activity, ClipboardList, Package, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowQueryResponse } from "@/lib/api/generated";
import { formatDuration } from "../../workflow-types";
import { getStatusIcon } from "../../utils/status";
import { STATUS_STYLES, STATUS_CATEGORY_MAP } from "../../constants";
import { DetailsPanelHeader } from "./DetailsPanelHeader";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowDetailsProps {
  workflow: WorkflowQueryResponse;
  onClose: () => void;
  onCancel?: () => void;
  onPanelResize?: (pct: number) => void;
}

// =============================================================================
// Sub-components
// =============================================================================

/** Status and duration display */
const StatusDisplay = memo(function StatusDisplay({ workflow }: { workflow: WorkflowQueryResponse }) {
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "unknown";
  const statusStyles = STATUS_STYLES[statusCategory];
  const isRunning = statusCategory === "running";

  // Calculate static duration
  const staticDuration = useMemo(() => {
    if (workflow.duration) return workflow.duration;
    if (workflow.start_time && workflow.end_time) {
      const start = new Date(workflow.start_time).getTime();
      const end = new Date(workflow.end_time).getTime();
      return (end - start) / 1000;
    }
    return null;
  }, [workflow.duration, workflow.start_time, workflow.end_time]);

  // Live duration for running workflows
  const needsLiveUpdate = isRunning && workflow.start_time && !workflow.end_time;
  const startTimeMs = workflow.start_time ? new Date(workflow.start_time).getTime() : 0;
  const [liveDuration, setLiveDuration] = useState<number>(() =>
    needsLiveUpdate ? (Date.now() - startTimeMs) / 1000 : 0,
  );

  useEffect(() => {
    if (!needsLiveUpdate) return;
    const interval = setInterval(() => {
      setLiveDuration((Date.now() - startTimeMs) / 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, [needsLiveUpdate, startTimeMs]);

  const duration = needsLiveUpdate ? liveDuration : staticDuration;

  // Priority badge styling
  const priorityStyles = {
    HIGH: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    NORMAL: "bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400",
    LOW: "bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-500",
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={cn("flex items-center gap-1 font-medium", statusStyles.text)}>
        {getStatusIcon(workflow.status, "size-3.5")}
        {workflow.status}
      </span>
      <span className="text-gray-400 dark:text-zinc-600">·</span>
      <span
        className={cn(
          "rounded px-1 py-0.5 text-[10px] font-medium",
          priorityStyles[workflow.priority as keyof typeof priorityStyles] ?? priorityStyles.NORMAL,
        )}
      >
        {workflow.priority}
      </span>
      {duration !== null && (
        <>
          <span className="text-gray-400 dark:text-zinc-600">·</span>
          <span className="font-mono text-gray-600 dark:text-zinc-400">
            {formatDuration(duration)}
            {isRunning && "..."}
          </span>
        </>
      )}
    </div>
  );
});

/** Vertical timeline */
const Timeline = memo(function Timeline({ workflow }: { workflow: WorkflowQueryResponse }) {
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "unknown";
  const isCompleted = statusCategory === "completed";
  const isFailed = statusCategory === "failed";
  const isRunning = statusCategory === "running";

  const submitTime = workflow.submit_time ? new Date(workflow.submit_time) : null;
  const startTime = workflow.start_time ? new Date(workflow.start_time) : null;
  const endTime = workflow.end_time ? new Date(workflow.end_time) : null;

  const queuedDuration = workflow.queued_time;
  const runningDuration = useMemo(() => {
    if (!startTime) return null;
    const end = endTime ?? new Date();
    return Math.floor((end.getTime() - startTime.getTime()) / 1000);
  }, [startTime, endTime]);

  const formatTime = (date: Date | null) => {
    if (!date) return "";
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    }
    return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  };

  interface Phase {
    id: string;
    label: string;
    time: Date | null;
    annotation?: string;
    status: "completed" | "active" | "pending" | "failed";
  }

  const phases = useMemo<Phase[]>(() => {
    const result: Phase[] = [];

    if (submitTime) {
      result.push({ id: "submitted", label: "Submitted", time: submitTime, status: "completed" });
    }

    if (startTime) {
      result.push({
        id: "started",
        label: "Started",
        time: startTime,
        annotation: queuedDuration ? `queued ${formatDuration(queuedDuration)}` : undefined,
        status: "completed",
      });
    } else if (submitTime) {
      result.push({ id: "started", label: "Started", time: null, annotation: "waiting...", status: "pending" });
    }

    if (isCompleted && endTime) {
      result.push({
        id: "completed",
        label: "Completed",
        time: endTime,
        annotation: runningDuration ? `ran ${formatDuration(runningDuration)}` : undefined,
        status: "completed",
      });
    } else if (isFailed && endTime) {
      result.push({
        id: "failed",
        label: "Failed",
        time: endTime,
        annotation: runningDuration ? `ran ${formatDuration(runningDuration)}` : undefined,
        status: "failed",
      });
    } else if (isRunning && startTime) {
      result.push({
        id: "running",
        label: "Running",
        time: null,
        annotation: runningDuration ? `${formatDuration(runningDuration)}...` : undefined,
        status: "active",
      });
    }

    return result;
  }, [submitTime, startTime, endTime, queuedDuration, runningDuration, isCompleted, isFailed, isRunning]);

  if (phases.length === 0) return null;

  return (
    <div className="flex flex-col">
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-zinc-600">
        Timeline
      </h3>
      {phases.map((phase, index) => {
        const isLast = index === phases.length - 1;
        return (
          <div key={phase.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "size-2 shrink-0 rounded-full border-2",
                  phase.status === "completed" && "timeline-marker-completed",
                  phase.status === "failed" && "timeline-marker-failed",
                  phase.status === "active" && "timeline-marker-running animate-pulse",
                  phase.status === "pending" && "timeline-marker-pending border-dashed",
                )}
              />
              {!isLast && (
                <div
                  className={cn(
                    "w-0.5 flex-1 min-h-[16px]",
                    phase.status === "completed" && "timeline-segment-completed",
                    phase.status === "active" && "timeline-active-segment",
                    phase.status === "pending" && "border-l border-dashed border-gray-300 dark:border-zinc-700",
                  )}
                />
              )}
            </div>
            <div className={cn("flex flex-col pb-2", isLast && "pb-0")}>
              <span
                className={cn(
                  "text-xs font-medium",
                  phase.status === "completed" && "timeline-text-completed",
                  phase.status === "failed" && "timeline-text-failed",
                  phase.status === "active" && "timeline-text-running",
                  phase.status === "pending" && "timeline-text-pending",
                )}
              >
                {phase.label}
              </span>
              {phase.time && <span className="text-[11px] text-gray-500 dark:text-zinc-500">{formatTime(phase.time)}</span>}
              {phase.annotation && (
                <span className={cn("text-[11px]", phase.status === "active" ? "timeline-text-running" : "text-gray-400 dark:text-zinc-600")}>
                  {phase.annotation}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});

/** Metadata section */
const Metadata = memo(function Metadata({ workflow }: { workflow: WorkflowQueryResponse }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-zinc-600">
        Metadata
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <div className="text-[10px] text-gray-400 dark:text-zinc-600">User</div>
          <div className="text-gray-900 dark:text-zinc-100">{workflow.submitted_by}</div>
        </div>
        {workflow.pool && (
          <div>
            <div className="text-[10px] text-gray-400 dark:text-zinc-600">Pool</div>
            <div className="text-gray-900 dark:text-zinc-100">{workflow.pool}</div>
          </div>
        )}
        {workflow.backend && (
          <div>
            <div className="text-[10px] text-gray-400 dark:text-zinc-600">Backend</div>
            <div className="text-gray-900 dark:text-zinc-100">{workflow.backend}</div>
          </div>
        )}
      </div>
      {workflow.tags && workflow.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {workflow.tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-zinc-800 dark:text-zinc-400"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

/** External links */
const Links = memo(function Links({ workflow }: { workflow: WorkflowQueryResponse }) {
  const links = [
    { id: "logs", label: "Logs", url: workflow.logs, icon: FileText },
    { id: "dashboard", label: "Dashboard", url: workflow.dashboard_url, icon: BarChart3 },
    { id: "grafana", label: "Grafana", url: workflow.grafana_url, icon: Activity },
    { id: "events", label: "Events", url: workflow.events, icon: ClipboardList },
    { id: "outputs", label: "Outputs", url: workflow.outputs, icon: Package },
  ].filter((link) => link.url);

  if (links.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-zinc-600">
        Links
      </h3>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <Icon className="size-3.5" />
              {link.label}
              <ExternalLink className="size-2.5 opacity-50" />
            </a>
          );
        })}
      </div>
    </div>
  );
});

// =============================================================================
// Main Component
// =============================================================================

export const WorkflowDetails = memo(function WorkflowDetails({
  workflow,
  onClose,
  onCancel,
  onPanelResize,
}: WorkflowDetailsProps) {
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "unknown";
  const canCancel = statusCategory === "running" || statusCategory === "waiting";

  // Status content for header Row 2
  const statusContent = <StatusDisplay workflow={workflow} />;

  return (
    <>
      {/* Shared Header (consistent with Group/Task views) */}
      <DetailsPanelHeader
        viewType="workflow"
        title={workflow.name}
        statusContent={statusContent}
        onClose={onClose}
        onPanelResize={onPanelResize}
      />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          <Timeline workflow={workflow} />
          <hr className="border-gray-200 dark:border-zinc-800" />
          <Metadata workflow={workflow} />
          <hr className="border-gray-200 dark:border-zinc-800" />
          <Links workflow={workflow} />
          
          {/* Cancel action */}
          {canCancel && onCancel && (
            <>
              <hr className="border-gray-200 dark:border-zinc-800" />
              <button
                type="button"
                onClick={onCancel}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                  "text-red-600 ring-1 ring-red-200 ring-inset",
                  "hover:bg-red-50 hover:text-red-700",
                  "dark:text-red-400 dark:ring-red-800",
                  "dark:hover:bg-red-950/50 dark:hover:text-red-300",
                )}
              >
                <XCircle className="size-4" />
                Cancel Workflow
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
});
