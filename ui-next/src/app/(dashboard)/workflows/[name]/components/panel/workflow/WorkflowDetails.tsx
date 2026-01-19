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
 * Features:
 * - Tabbed interface: Overview, Logs, Events
 * - Status, priority, and duration
 * - Vertical timeline (submitted → started → running/completed)
 * - Details (user, pool, backend, tags)
 * - External links (logs, dashboard, grafana, etc.)
 * - Actions (cancel workflow)
 */

"use client";

import { memo, useMemo, useCallback } from "react";
import { FileText, BarChart3, Activity, Package, XCircle, Tag, Info, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/shadcn/card";
import { PanelTabs, LinksSection, EmptyTabPrompt, TabPanel, SeparatedParts, type PanelTab } from "@/components/panel";
import type { WorkflowQueryResponse } from "@/lib/api/adapter";
import { formatDuration } from "../../../lib/workflow-types";
import { getStatusIcon } from "../../../lib/status";
import { STATUS_STYLES, STATUS_CATEGORY_MAP } from "../../../lib/status";
import { DetailsPanelHeader } from "../shared/DetailsPanelHeader";
import { WorkflowTimeline } from "./WorkflowTimeline";
import { parseTime } from "../shared/Timeline";
import { useTick } from "@/hooks";
import type { WorkflowTab } from "../../../hooks/use-navigation-state";

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
  onPanelResize?: (pct: number) => void;
  /** Whether the header details section is expanded (global for page) */
  isDetailsExpanded?: boolean;
  /** Toggle the details expansion state (global for page) */
  onToggleDetailsExpanded?: () => void;
  /** Currently selected tab (URL-synced) */
  selectedTab?: WorkflowTab;
  /** Callback to change the selected tab */
  setSelectedTab?: (tab: WorkflowTab) => void;
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
        {workflow.status}
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
}

const OverviewTab = memo(function OverviewTab({ workflow, canCancel, onCancel }: OverviewTabProps) {
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
      {canCancel && onCancel && (
        <section>
          <h3 className={STYLES.sectionHeader}>Actions</h3>
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
        </section>
      )}
    </div>
  );
});

// =============================================================================
// Tab Configuration
// =============================================================================

const WORKFLOW_TABS: PanelTab[] = [
  { id: "overview", label: "Overview", icon: Info },
  { id: "logs", label: "Logs", icon: FileText },
  { id: "events", label: "Events", icon: History },
];

// =============================================================================
// Main Component
// =============================================================================

export const WorkflowDetails = memo(function WorkflowDetails({
  workflow,
  onCancel,
  onPanelResize,
  isDetailsExpanded,
  onToggleDetailsExpanded,
  selectedTab: selectedTabProp,
  setSelectedTab: setSelectedTabProp,
}: WorkflowDetailsProps) {
  // Fallback to "waiting" (a valid key in STATUS_STYLES) if status is unknown
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "waiting";
  const canCancel = statusCategory === "running" || statusCategory === "waiting";

  // Tab state - use URL-synced state if provided, otherwise default to "overview"
  const activeTab = selectedTabProp ?? "overview";

  // Handle tab change - update URL state
  const handleTabChange = useCallback(
    (value: string) => {
      setSelectedTabProp?.(value as WorkflowTab);
    },
    [setSelectedTabProp],
  );

  // Status content for header Row 2
  const statusContent = <StatusDisplay workflow={workflow} />;

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden">
      {/* Shared Header (consistent with Group/Task views) */}
      <DetailsPanelHeader
        viewType="workflow"
        title={workflow.name}
        statusContent={statusContent}
        onPanelResize={onPanelResize}
        isExpanded={isDetailsExpanded}
        onToggleExpand={onToggleDetailsExpanded}
      />

      {/* Tab Navigation - Chrome-style tabs with curved connectors */}
      <PanelTabs
        tabs={WORKFLOW_TABS}
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
          <OverviewTab
            workflow={workflow}
            canCancel={canCancel}
            onCancel={onCancel}
          />
        </TabPanel>

        <TabPanel
          tab="logs"
          activeTab={activeTab}
          centered
          className="p-4"
        >
          <EmptyTabPrompt
            icon={FileText}
            title="Workflow Logs"
            description="View stdout/stderr output from the workflow execution"
            url={workflow.logs}
            emptyText="No logs available"
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
            url={workflow.events}
            buttonLabel="View Events"
            emptyText="No events available"
          />
        </TabPanel>
      </div>
    </div>
  );
});
