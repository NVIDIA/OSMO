//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { getApiHostname } from "@/lib/config";
import { computeHistogram, filterEntries } from "@/lib/api/log-adapter/adapters/compute";
import { useLogStream } from "@/lib/api/log-adapter/hooks/use-log-stream";
import { useGetWorkflowApiWorkflowNameGet, type WorkflowQueryResponse } from "@/lib/api/generated";
import { LogViewer } from "@/components/log-viewer/components/LogViewer";
import type {
  LogViewerDataProps,
  LogViewerFilterProps,
  LogViewerTimelineProps,
} from "@/components/log-viewer/components/LogViewer";
import { LogViewerSkeleton } from "@/components/log-viewer/components/LogViewerSkeleton";
import { chipsToLogQuery } from "@/components/log-viewer/lib/chips-to-log-query";
import { useLogViewerUrlState } from "@/components/log-viewer/lib/use-log-viewer-url-state";
import { useTick, useTickController } from "@/hooks/use-tick";
import {
  DISPLAY_PADDING_RATIO,
  MIN_PADDING_MS,
} from "@/components/log-viewer/components/timeline/lib/timeline-constants";

interface PendingDisplayRange {
  start: Date;
  end: Date;
}

export interface WorkflowMetadata {
  name: string;
  status: string;
  submitTime?: Date;
  startTime?: Date;
  endTime?: Date;
}

export interface LogViewerContainerProps {
  workflowId: string;
  workflowMetadata?: WorkflowMetadata | null;
  scope?: "workflow" | "group" | "task";
  /** Group ID (required when scope is "group" or "task") */
  groupId?: string;
  /** Task ID (required when scope is "task") */
  taskId?: string;
  className?: string;
  viewerClassName?: string;
  showBorder?: boolean;
  /** Whether to show the timeline histogram and time range controls (default: true) */
  showTimeline?: boolean;
}

/**
 * Log viewer container that handles data fetching, live streaming, and URL state.
 * Uses key-based remounting to reset state when workflowId changes.
 */
export function LogViewerContainer(props: LogViewerContainerProps) {
  return (
    <LogViewerContainerImpl
      key={props.workflowId}
      {...props}
    />
  );
}

function LogViewerContainerImpl({
  workflowId,
  workflowMetadata: workflowMetadataFromSSR,
  scope = "workflow",
  groupId,
  taskId,
  className,
  viewerClassName,
  showBorder = true,
  showTimeline = true,
}: LogViewerContainerProps) {
  // Fetch workflow metadata on client if not provided via SSR
  const selectWorkflow = useCallback((rawData: unknown) => {
    if (!rawData) return null;
    try {
      const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
      return parsed as WorkflowQueryResponse;
    } catch {
      return null;
    }
  }, []);

  const { data: workflowFromClient, isLoading: isLoadingWorkflow } = useGetWorkflowApiWorkflowNameGet(
    workflowId,
    { verbose: false },
    {
      query: {
        enabled: !workflowMetadataFromSSR,
        select: selectWorkflow,
      },
    },
  );

  const workflowMetadata = useMemo(() => {
    if (workflowMetadataFromSSR) return workflowMetadataFromSSR;
    if (!workflowFromClient) return null;
    return {
      name: workflowFromClient.name,
      status: workflowFromClient.status,
      submitTime: workflowFromClient.submit_time ? new Date(workflowFromClient.submit_time) : undefined,
      startTime: workflowFromClient.start_time ? new Date(workflowFromClient.start_time) : undefined,
      endTime: workflowFromClient.end_time ? new Date(workflowFromClient.end_time) : undefined,
    };
  }, [workflowMetadataFromSSR, workflowFromClient]);

  // Synchronized time for running workflows
  useTickController(workflowMetadata?.endTime === undefined);
  const now = useTick();

  // URL-synced state
  const { filterChips, setFilterChips, startTime, endTime, activePreset, setStartTime, setEndTime, setPreset } =
    useLogViewerUrlState({
      entityStartTime: workflowMetadata?.startTime,
      entityEndTime: workflowMetadata?.endTime,
      now,
    });

  // Pending display range for pan/zoom preview
  const [pendingDisplay, setPendingDisplay] = useState<PendingDisplayRange | null>(null);

  // Convert chips to query filters for client-side filtering
  const queryFilters = useMemo(() => chipsToLogQuery(filterChips), [filterChips]);

  const filterParams = useMemo(
    () => ({
      levels: queryFilters.levels,
      tasks: queryFilters.tasks,
      retries: queryFilters.retries,
      sources: queryFilters.sources,
      search: queryFilters.search,
      start: startTime,
      end: endTime,
    }),
    [queryFilters, startTime, endTime],
  );

  // Unified streaming: fetch all logs progressively
  const {
    entries: rawEntries,
    phase,
    error,
    isStreaming,
    restart,
  } = useLogStream({
    workflowId,
    groupId,
    taskId,
    enabled: true, // Always enabled - stream completes for finished workflows
  });

  // Client-side filtering (pure derivation)
  const filteredEntries = useMemo(() => filterEntries(rawEntries, filterParams), [rawEntries, filterParams]);

  // Entity time boundaries
  const entityStartTimeMs = workflowMetadata?.startTime?.getTime();
  const entityEndTimeMs = workflowMetadata?.endTime?.getTime();

  // Compute display range with padding - anchored to entity boundaries for stability
  const { displayStart, displayEnd } = useMemo(() => {
    // Use entity times as the anchors for full timeline
    const dataStart = entityStartTimeMs ? new Date(entityStartTimeMs) : new Date(now - 60 * 60 * 1000);
    const dataEnd = entityEndTimeMs ? new Date(entityEndTimeMs) : new Date(now);

    const rangeMs = dataEnd.getTime() - dataStart.getTime();
    const paddingMs = Math.max(rangeMs * DISPLAY_PADDING_RATIO, MIN_PADDING_MS);

    return {
      displayStart: new Date(dataStart.getTime() - paddingMs),
      displayEnd: new Date(dataEnd.getTime() + paddingMs),
    };
  }, [entityStartTimeMs, entityEndTimeMs, now]);

  // Histogram computation - uses filtered entries (respects all filters)
  // Display range shows full entity timeline, effective range highlights user's time filter
  const histogram = useMemo(
    () =>
      computeHistogram(filteredEntries, {
        numBuckets: 50,
        displayStart,
        displayEnd,
        effectiveStart: startTime,
        effectiveEnd: endTime,
      }),
    [filteredEntries, displayStart, displayEnd, startTime, endTime],
  );

  const pendingHistogram = useMemo(() => {
    if (!pendingDisplay) return undefined;
    return computeHistogram(filteredEntries, {
      numBuckets: 50,
      displayStart: pendingDisplay.start,
      displayEnd: pendingDisplay.end,
      effectiveStart: startTime,
      effectiveEnd: endTime,
    });
  }, [filteredEntries, pendingDisplay, startTime, endTime]);

  const handleDisplayRangeChange = useCallback((newStart: Date, newEnd: Date) => {
    setPendingDisplay({ start: newStart, end: newEnd });
  }, []);

  const handleClearPendingDisplay = useCallback(() => {
    setPendingDisplay(null);
  }, []);

  // Construct external log URL (direct to backend, bypassing UI proxy)
  const externalLogUrl = useMemo(() => {
    const hostname = getApiHostname();
    // Ensure protocol is included (assume https if no protocol specified)
    const baseUrl = hostname.startsWith("http") ? hostname : `https://${hostname}`;
    const basePath = `${baseUrl}/api/workflow/${encodeURIComponent(workflowId)}/logs`;

    // Add query parameters for group/task scope
    const params = new URLSearchParams();
    if (groupId) params.set("group_id", groupId);
    if (taskId) params.set("task_id", taskId);

    const queryString = params.toString();
    return queryString ? `${basePath}?${queryString}` : basePath;
  }, [workflowId, groupId, taskId]);

  // Grouped props for LogViewer (memoized to prevent re-renders)
  const dataProps = useMemo<LogViewerDataProps>(
    () => ({
      rawEntries,
      filteredEntries,
      isLoading: phase === "connecting",
      isFetching: phase === "streaming",
      error,
      histogram,
      pendingHistogram,
      isStreaming,
      externalLogUrl,
      onRefetch: restart,
    }),
    [rawEntries, filteredEntries, phase, error, histogram, pendingHistogram, isStreaming, externalLogUrl, restart],
  );

  const filterProps = useMemo<LogViewerFilterProps>(
    () => ({
      filterChips,
      onFilterChipsChange: setFilterChips,
      scope,
    }),
    [filterChips, setFilterChips, scope],
  );

  const entityStartTime = workflowMetadata?.startTime;
  const entityEndTime = workflowMetadata?.endTime;

  const timelineProps = useMemo<LogViewerTimelineProps | null>(() => {
    if (!entityStartTime) return null;
    return {
      filterStartTime: startTime,
      filterEndTime: endTime,
      displayStart,
      displayEnd,
      activePreset,
      onFilterStartTimeChange: setStartTime,
      onFilterEndTimeChange: setEndTime,
      onPresetSelect: setPreset,
      onDisplayRangeChange: handleDisplayRangeChange,
      onClearPendingDisplay: handleClearPendingDisplay,
      entityStartTime,
      entityEndTime,
      now,
    };
  }, [
    startTime,
    endTime,
    displayStart,
    displayEnd,
    activePreset,
    setStartTime,
    setEndTime,
    setPreset,
    handleDisplayRangeChange,
    handleClearPendingDisplay,
    entityStartTime,
    entityEndTime,
    now,
  ]);

  // Render states
  const containerClasses = cn(showBorder && "border-border bg-card overflow-hidden rounded-lg border", className);

  if (workflowMetadata && !workflowMetadata.startTime) {
    return (
      <div className={containerClasses}>
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="bg-muted text-muted-foreground rounded-full p-4">
            <svg
              className="size-8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
              />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="space-y-1">
            <p className="text-foreground text-sm font-medium">Workflow Not Started</p>
            <p className="text-muted-foreground text-xs">
              {workflowMetadata.submitTime
                ? `Submitted ${workflowMetadata.submitTime.toLocaleString()}, waiting to start`
                : "Workflow has been submitted but hasn't started yet"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (((phase === "connecting" || phase === "idle") && filteredEntries.length === 0) || isLoadingWorkflow) {
    return (
      <div className={containerClasses}>
        <LogViewerSkeleton className={viewerClassName} />
      </div>
    );
  }

  if (!workflowMetadata?.startTime || !timelineProps) {
    return (
      <div className={containerClasses}>
        <div className="text-muted-foreground p-4 text-center text-sm">Workflow has not started yet</div>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      <LogViewer
        data={dataProps}
        filter={filterProps}
        timeline={timelineProps}
        className={viewerClassName}
        showTimeline={showTimeline}
      />
    </div>
  );
}
