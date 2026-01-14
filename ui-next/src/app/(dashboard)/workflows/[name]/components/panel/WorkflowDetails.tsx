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

import { memo, useMemo, useState } from "react";
import { useInterval } from "usehooks-ts";
import { useDocumentVisibility } from "@react-hookz/web";
import { ExternalLink, FileText, BarChart3, Activity, ClipboardList, Package, XCircle, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/shadcn/card";
import type { WorkflowQueryResponse } from "@/lib/api/generated";
import { formatDuration } from "../../lib/workflow-types";
import { getStatusIcon } from "../../lib/status";
import { STATUS_STYLES, STATUS_CATEGORY_MAP } from "../../lib/status";
import { DetailsPanelHeader } from "./DetailsPanelHeader";
import { Timeline, type TimelinePhase } from "./Timeline";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse timestamp string to Date.
 * Timestamps are normalized in the adapter layer (useWorkflow hook),
 * so we can safely use new Date() directly.
 */
function parseTime(timeStr?: string | null): Date | null {
  if (!timeStr) return null;
  return new Date(timeStr);
}

// =============================================================================
// Styling Constants (Single Source of Truth)
// =============================================================================

/** Reusable style patterns for consistent styling across the component */
const STYLES = {
  /** Section header styling (matches pools panel) */
  sectionHeader: "text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase",
  /** Sub-header styling (e.g., Tags label) */
  subHeader: "text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium",
  /** Inline separator dot */
  separator: "text-muted-foreground/50",
  /** Divider styling */
  divider: "border-border",
  /** Tag pill styling */
  tagPill: "rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground",
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
  /** Whether the header details section is expanded (global for page) */
  isDetailsExpanded?: boolean;
  /** Toggle the details expansion state (global for page) */
  onToggleDetailsExpanded?: () => void;
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

  // Calculate static duration (timestamps normalized at API boundary)
  const staticDuration = useMemo(() => {
    if (workflow.duration) return workflow.duration;
    const start = parseTime(workflow.start_time);
    const end = parseTime(workflow.end_time);
    if (start && end) {
      return (end.getTime() - start.getTime()) / 1000;
    }
    return null;
  }, [workflow.duration, workflow.start_time, workflow.end_time]);

  // Live duration for running workflows
  const needsLiveUpdate = isRunning && workflow.start_time && !workflow.end_time;
  const startTimeMs = parseTime(workflow.start_time)?.getTime() ?? 0;
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
          <span className="text-muted-foreground font-mono">{formatDuration(duration)}</span>
        </>
      )}
    </div>
  );
});

/** Workflow timeline using the shared Timeline component */
const WorkflowTimeline = memo(function WorkflowTimeline({ workflow }: { workflow: WorkflowQueryResponse }) {
  // Fallback to "waiting" (a valid key in STATUS_STYLES) if status is unknown
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "waiting";
  const isCompleted = statusCategory === "completed";
  const isFailed = statusCategory === "failed";
  const isRunning = statusCategory === "running";

  // Memoize time computations to prevent dependency changes on every render
  // Timestamps are normalized in the adapter layer (useWorkflow hook)
  const submitTime = useMemo(() => parseTime(workflow.submit_time), [workflow.submit_time]);
  const startTime = useMemo(() => parseTime(workflow.start_time), [workflow.start_time]);
  const endTime = useMemo(() => parseTime(workflow.end_time), [workflow.end_time]);

  const queuedDuration = workflow.queued_time;
  const runningDuration = useMemo(() => {
    if (!startTime) return null;
    const end = endTime ?? new Date();
    return Math.floor((end.getTime() - startTime.getTime()) / 1000);
  }, [startTime, endTime]);

  // Build phases for the Timeline component
  const phases = useMemo<TimelinePhase[]>(() => {
    const result: TimelinePhase[] = [];

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
        status: "completed",
        // Only show duration if this is the last phase (completed/failed workflows)
        // For running workflows, the Running phase shows the duration instead
        duration: isRunning ? null : runningDuration ?? null,
      });
    } else if (submitTime) {
      result.push({
        id: "started",
        label: "Started",
        time: null,
        status: "pending",
        duration: null,
      });
    }

    if (isCompleted && endTime) {
      result.push({
        id: "completed",
        label: "Completed",
        time: endTime,
        status: "completed",
        duration: null, // Terminal milestone
      });
    } else if (isFailed && endTime) {
      result.push({
        id: "failed",
        label: "Failed",
        time: endTime,
        status: "failed",
        duration: null, // Terminal milestone
      });
    } else if (isRunning && startTime) {
      result.push({
        id: "running",
        label: "Running",
        time: null,
        status: "active",
        duration: runningDuration ?? null, // Shows the running duration
      });
    }

    return result;
  }, [submitTime, startTime, endTime, queuedDuration, runningDuration, isCompleted, isFailed, isRunning]);

  if (phases.length === 0) return null;

  return (
    <Timeline
      phases={phases}
      showHeader
      headerText="Timeline"
    />
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
  isDetailsExpanded,
  onToggleDetailsExpanded,
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
        isExpanded={isDetailsExpanded}
        onToggleExpand={onToggleDetailsExpanded}
      />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          <WorkflowTimeline workflow={workflow} />
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
