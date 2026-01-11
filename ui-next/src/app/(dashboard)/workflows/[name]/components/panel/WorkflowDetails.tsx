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
 * - Details (user, pool, backend, tags)
 * - External links (logs, dashboard, grafana, etc.)
 * - Actions (cancel workflow)
 */

"use client";

import { memo, useMemo, useState, useRef } from "react";
import { useInterval, useResizeObserver } from "usehooks-ts";
import { useDocumentVisibility } from "@react-hookz/web";
import { ExternalLink, FileText, BarChart3, Activity, ClipboardList, Package, XCircle, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/shadcn/card";
import type { WorkflowQueryResponse } from "@/lib/api/generated";
import { formatDuration } from "../../lib/workflow-types";
import { getStatusIcon } from "../../lib/status";
import { STATUS_STYLES, STATUS_CATEGORY_MAP } from "../../lib/status";
import { DetailsPanelHeader } from "./DetailsPanelHeader";

// =============================================================================
// Styling Constants (Single Source of Truth)
// =============================================================================

/** Minimum width per timeline phase (in pixels) for horizontal layout to be comfortable */
const MIN_WIDTH_PER_PHASE = 120;

/** Reusable style patterns for consistent styling across the component */
const STYLES = {
  /** Section header styling (matches pools panel) */
  sectionHeader: "text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase",
  /** Timeline vertical layout padding */
  timelineVertical: "px-2 pt-1",
  /** Sub-header styling (e.g., Tags label) */
  subHeader: "text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium",
  /** Small label text */
  smallLabel: "text-xs",
  /** Muted text colors */
  mutedText: "text-muted-foreground",
  /** Secondary/subtle text */
  subtleText: "text-xs text-muted-foreground/70",
  /** Inline separator dot */
  separator: "text-muted-foreground/50",
  /** Divider styling */
  divider: "border-border",
  /** Tag pill styling */
  tagPill: "rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground",
  /** Timeline pending border */
  timelinePending: "border-dashed border-border",
  /** External link styling */
  link: "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted",
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
  onClose: () => void;
  onCancel?: () => void;
  onPanelResize?: (pct: number) => void;
}

// =============================================================================
// Sub-components
// =============================================================================

/** Status and duration display */
const StatusDisplay = memo(function StatusDisplay({ workflow }: { workflow: WorkflowQueryResponse }) {
  // Fallback to "waiting" (a valid key in STATUS_STYLES) if status is unknown
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "waiting";
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

  // Only update when tab is visible (saves resources when user switches tabs)
  // useDocumentVisibility returns true when document is visible
  const isTabVisible = useDocumentVisibility();

  // useInterval handles the interval lifecycle - pass null to disable
  // Pause interval when tab is not visible
  useInterval(() => setLiveDuration((Date.now() - startTimeMs) / 1000), needsLiveUpdate && isTabVisible ? 1000 : null);

  const duration = needsLiveUpdate ? liveDuration : staticDuration;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={cn("flex items-center gap-1 font-medium", statusStyles.text)}>
        {getStatusIcon(workflow.status, "size-3.5")}
        {workflow.status}
      </span>
      <span className={STYLES.separator}>·</span>
      <span
        className={cn(
          "rounded px-1 py-0.5 text-xs font-medium",
          STYLES.priority[workflow.priority as keyof typeof STYLES.priority] ?? STYLES.priority.NORMAL,
        )}
      >
        {workflow.priority}
      </span>
      {duration !== null && (
        <>
          <span className={STYLES.separator}>·</span>
          <span className="text-muted-foreground font-mono">
            {formatDuration(duration)}
            {isRunning && "..."}
          </span>
        </>
      )}
    </div>
  );
});

/** Responsive timeline (horizontal when space allows, vertical otherwise) */
const Timeline = memo(function Timeline({ workflow }: { workflow: WorkflowQueryResponse }) {
  // Fallback to "waiting" (a valid key in STATUS_STYLES) if status is unknown
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "waiting";
  const isCompleted = statusCategory === "completed";
  const isFailed = statusCategory === "failed";
  const isRunning = statusCategory === "running";

  // Memoize time computations to prevent dependency changes on every render
  const submitTime = useMemo(
    () => (workflow.submit_time ? new Date(workflow.submit_time) : null),
    [workflow.submit_time],
  );
  const startTime = useMemo(() => (workflow.start_time ? new Date(workflow.start_time) : null), [workflow.start_time]);
  const endTime = useMemo(() => (workflow.end_time ? new Date(workflow.end_time) : null), [workflow.end_time]);

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
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  interface Phase {
    id: string;
    label: string;
    time: Date | null;
    annotation?: string;
    status: "completed" | "active" | "pending" | "failed";
    /** Duration of this phase in seconds (used for proportional width in horizontal layout) */
    duration: number | null;
  }

  const phases = useMemo<Phase[]>(() => {
    const result: Phase[] = [];

    if (submitTime) {
      // Submitted phase duration = time spent queued (until started)
      result.push({
        id: "submitted",
        label: "Submitted",
        time: submitTime,
        status: "completed",
        duration: queuedDuration ?? null,
      });
    }

    if (startTime) {
      result.push({
        id: "started",
        label: "Started",
        time: startTime,
        annotation: queuedDuration ? `queued ${formatDuration(queuedDuration)}` : undefined,
        status: "completed",
        // Started phase duration = time spent running (until completed/failed)
        duration: runningDuration ?? null,
      });
    } else if (submitTime) {
      result.push({
        id: "started",
        label: "Started",
        time: null,
        annotation: "waiting...",
        status: "pending",
        duration: null,
      });
    }

    if (isCompleted && endTime) {
      result.push({
        id: "completed",
        label: "Completed",
        time: endTime,
        annotation: runningDuration ? `ran ${formatDuration(runningDuration)}` : undefined,
        status: "completed",
        duration: null, // Terminal phase, no duration needed
      });
    } else if (isFailed && endTime) {
      result.push({
        id: "failed",
        label: "Failed",
        time: endTime,
        annotation: runningDuration ? `ran ${formatDuration(runningDuration)}` : undefined,
        status: "failed",
        duration: null, // Terminal phase, no duration needed
      });
    } else if (isRunning && startTime) {
      result.push({
        id: "running",
        label: "Running",
        time: null,
        annotation: runningDuration ? `${formatDuration(runningDuration)}...` : undefined,
        status: "active",
        duration: null, // Active/terminal phase, no duration needed
      });
    }

    return result;
  }, [submitTime, startTime, endTime, queuedDuration, runningDuration, isCompleted, isFailed, isRunning]);

  // Content-aware layout: measure container and switch layout based on phases
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate minimum width needed for horizontal layout based on number of phases
  const minWidthForHorizontal = phases.length * MIN_WIDTH_PER_PHASE;

  // Use useResizeObserver for efficient container dimension tracking
  const { width: containerWidth = 0 } = useResizeObserver({
    ref: containerRef as React.RefObject<HTMLElement>,
    box: "content-box",
  });

  const useHorizontal = containerWidth >= minWidthForHorizontal;

  if (phases.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="flex flex-col"
    >
      <h3 className={STYLES.sectionHeader}>Timeline</h3>

      {/* Vertical layout (for narrow containers or many phases) */}
      {!useHorizontal && (
        <div className={STYLES.timelineVertical}>
          {phases.map((phase, index) => {
            const isLast = index === phases.length - 1;
            return (
              <div
                key={phase.id}
                className="flex gap-3"
              >
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
                        "min-h-6 w-0.5 flex-1",
                        phase.status === "completed" && "timeline-segment-completed",
                        phase.status === "active" && "timeline-active-segment",
                        phase.status === "pending" && cn("border-l", STYLES.timelinePending),
                      )}
                    />
                  )}
                </div>
                <div className={cn("flex flex-col pb-4", isLast && "pb-0")}>
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
                  {phase.time && <span className={STYLES.subtleText}>{formatTime(phase.time)}</span>}
                  {phase.annotation && (
                    <span
                      className={cn(
                        STYLES.smallLabel,
                        phase.status === "active" ? "timeline-text-running" : STYLES.mutedText,
                      )}
                    >
                      {phase.annotation}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Horizontal layout (for wider containers with fewer phases) */}
      {/* Uses CSS Grid to keep timeline bar and labels aligned; flex-grow for proportional duration sizing */}
      {useHorizontal && (
        <div
          className="grid"
          style={{
            // Each phase gets a column; use duration for proportional sizing (fr units)
            // Fallback to 1fr for phases without duration (terminal/pending states)
            gridTemplateColumns: phases.map((p) => `minmax(max-content, ${p.duration ?? 1}fr)`).join(" "),
          }}
        >
          {/* Row 1: Timeline bar with markers and segments */}
          {phases.map((phase, index) => {
            const isLast = index === phases.length - 1;
            const prevPhase = index > 0 ? phases[index - 1] : null;
            return (
              <div
                key={phase.id}
                className="flex h-6 items-center"
              >
                {/* Connecting segment for last phase (uses previous phase's status for styling) */}
                {isLast && prevPhase && (
                  <div
                    className={cn(
                      "h-1 flex-1",
                      prevPhase.status === "completed" && "timeline-segment-completed",
                      prevPhase.status === "active" && "timeline-active-segment",
                      prevPhase.status === "pending" && cn("border-t", STYLES.timelinePending),
                    )}
                  />
                )}
                {/* Phase marker */}
                <div
                  className={cn(
                    "relative z-10 size-2.5 shrink-0 rounded-full border-2",
                    phase.status === "completed" && "timeline-marker-completed",
                    phase.status === "failed" && "timeline-marker-failed",
                    phase.status === "active" && "timeline-marker-running animate-pulse",
                    phase.status === "pending" && "timeline-marker-pending border-dashed",
                  )}
                />
                {/* Segment to next marker */}
                {!isLast && (
                  <div
                    className={cn(
                      "h-1 flex-1",
                      phase.status === "completed" && "timeline-segment-completed",
                      phase.status === "active" && "timeline-active-segment",
                      phase.status === "pending" && cn("border-t", STYLES.timelinePending),
                    )}
                  />
                )}
              </div>
            );
          })}

          {/* Row 2: Phase labels (same grid ensures alignment with markers) */}
          {phases.map((phase, index) => {
            const isLast = index === phases.length - 1;
            return (
              <div
                key={`${phase.id}-label`}
                className={cn(
                  "mt-1 flex flex-col whitespace-nowrap",
                  // Add padding between phases; last phase is right-aligned
                  isLast ? "items-end text-right" : "pr-4",
                )}
              >
                <span
                  className={cn(
                    STYLES.smallLabel,
                    "font-medium",
                    phase.status === "completed" && "timeline-text-completed",
                    phase.status === "failed" && "timeline-text-failed",
                    phase.status === "active" && "timeline-text-running",
                    phase.status === "pending" && "timeline-text-pending",
                  )}
                >
                  {phase.label}
                </span>
                {phase.time && <span className={STYLES.subtleText}>{formatTime(phase.time)}</span>}
                {phase.annotation && (
                  <span
                    className={cn(
                      STYLES.smallLabel,
                      phase.status === "active" ? "timeline-text-running" : STYLES.mutedText,
                    )}
                  >
                    {phase.annotation}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
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
              <span className="text-muted-foreground">User</span>
              <span>{workflow.submitted_by}</span>
              {workflow.pool && (
                <>
                  <span className="text-muted-foreground">Pool</span>
                  <span>{workflow.pool}</span>
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
      <h3 className={STYLES.sectionHeader}>Links</h3>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={STYLES.link}
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
  // Fallback to "waiting" (a valid key in STATUS_STYLES) if status is unknown
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "waiting";
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
          <hr className={STYLES.divider} />
          <Details workflow={workflow} />
          <hr className={STYLES.divider} />
          <Links workflow={workflow} />

          {/* Cancel action */}
          {canCancel && onCancel && (
            <>
              <hr className={STYLES.divider} />
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
