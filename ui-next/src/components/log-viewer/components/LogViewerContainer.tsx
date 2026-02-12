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

import { cn } from "@/lib/utils";
import { useLogStream } from "@/lib/api/log-adapter/hooks/use-log-stream";
import { LogViewer } from "@/components/log-viewer/components/LogViewer";
import { LogViewerSkeleton } from "@/components/log-viewer/components/LogViewerSkeleton";
import { useLogPresentation } from "@/components/log-viewer/hooks/useLogPresentation";
import { useLogViewerUrlState } from "@/components/log-viewer/lib/use-log-viewer-url-state";
import { useLogViewerLocalState } from "@/components/log-viewer/lib/use-log-viewer-local-state";
import { useTick, useTickController } from "@/hooks/use-tick";

export interface WorkflowMetadata {
  name: string;
  status: string;
  submitTime?: Date;
  startTime?: Date;
  endTime?: Date;
}

export interface LogViewerContainerProps {
  /** Backend-provided log URL (e.g., task.logs, workflow.logs) */
  logUrl: string;
  /** Workflow/task metadata for timeline and status display */
  workflowMetadata?: WorkflowMetadata | null;
  /** Scope for filter field visibility (default: "workflow") */
  scope?: "workflow" | "group" | "task";
  className?: string;
  viewerClassName?: string;
  showBorder?: boolean;
  /** Whether to show the timeline histogram and time range controls (default: true) */
  showTimeline?: boolean;
  /**
   * Whether to sync filter/time-range state with URL query parameters.
   *
   * - `true`: State is stored in URL params (?f=level:error&start=...).
   *   Use for the standalone log viewer page where shareable URLs are desired.
   * - `false` (default): State is local to this component instance.
   *   Use for embedded log viewers (panel tabs) to ensure full isolation.
   */
  urlSync?: boolean;
}

/**
 * Log viewer container - thin orchestrator that wires the data layer
 * (useLogStream) to the presentation layer (useLogPresentation) to
 * the component layer (LogViewer).
 *
 * Callers provide the log URL directly (from task.logs, workflow.logs, etc.)
 * instead of passing IDs for internal re-fetching.
 *
 * Uses key-based remounting to reset state when logUrl changes.
 */
export function LogViewerContainer(props: LogViewerContainerProps) {
  return (
    <LogViewerContainerImpl
      key={props.logUrl}
      {...props}
    />
  );
}

function LogViewerContainerImpl({
  logUrl,
  workflowMetadata = null,
  scope = "workflow",
  className,
  viewerClassName,
  showBorder = true,
  showTimeline = true,
  urlSync = false,
}: LogViewerContainerProps) {
  // Synchronized time for running workflows
  useTickController(workflowMetadata?.endTime === undefined);
  const now = useTick();

  // State layer: choose URL-synced or instance-isolated state
  // Both hooks are always called (React hooks rules), but only the active one
  // is wired to the presentation layer. The inactive one is a no-op cost.
  const stateOptions = {
    entityStartTime: workflowMetadata?.startTime,
    entityEndTime: workflowMetadata?.endTime,
    now,
  };
  const urlState = useLogViewerUrlState(stateOptions);
  const localState = useLogViewerLocalState(stateOptions);
  const stateApi = urlSync ? urlState : localState;

  // Data layer: stream ALL logs from the provided URL
  const {
    entries: rawEntries,
    phase,
    error,
    isStreaming,
    restart,
  } = useLogStream({
    logUrl,
    enabled: !!logUrl,
  });

  // Presentation layer: filtering, histogram, display range
  const { dataProps, filterProps, timelineProps } = useLogPresentation({
    rawEntries,
    phase,
    error,
    isStreaming,
    restart,
    workflowMetadata,
    now,
    scope,
    logUrl,
    stateApi,
  });

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

  if ((phase === "connecting" || phase === "idle") && rawEntries.length === 0) {
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
