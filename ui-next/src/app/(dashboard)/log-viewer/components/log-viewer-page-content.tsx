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

"use client";

import { useEffect, useMemo } from "react";
import { usePage } from "@/components/chrome/page-context";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { LogViewerContainer } from "@/components/log-viewer/components/log-viewer-container";
import type { WorkflowMetadata } from "@/components/log-viewer/components/log-viewer-container";
import { LogViewerSkeleton } from "@/components/log-viewer/components/log-viewer-skeleton";
import { addRecentWorkflow } from "@/app/(dashboard)/log-viewer/lib/recent-workflows";
import { useWorkflow } from "@/lib/api/adapter/hooks";

interface LogViewerPageContentProps {
  workflowId: string;
}

/**
 * Log Viewer Page Content (Client Component)
 *
 * This is the one call site that only has a workflowId (from URL params).
 * It fetches the workflow to resolve the log URL and metadata, then passes
 * them directly to LogViewerContainer.
 */
export function LogViewerPageContent({ workflowId }: LogViewerPageContentProps) {
  // Save workflow to recent workflows on mount
  useEffect(() => {
    addRecentWorkflow(workflowId);
  }, [workflowId]);

  // Register page (workflow name will be set by LogViewerContainer after metadata loads)
  usePage({
    title: workflowId,
    breadcrumbs: [{ label: "Log Viewer", href: "/log-viewer" }],
  });

  // Fetch workflow to get log URL and metadata (via adapter for parsing + timestamp normalization)
  const { workflow, isLoading } = useWorkflow({ name: workflowId, verbose: false });

  const logUrl = workflow?.logs ?? "";

  const workflowMetadata = useMemo<WorkflowMetadata | null>(() => {
    if (!workflow) return null;
    return {
      name: workflow.name,
      status: workflow.status,
      submitTime: workflow.submit_time ? new Date(workflow.submit_time) : undefined,
      startTime: workflow.start_time ? new Date(workflow.start_time) : undefined,
      endTime: workflow.end_time ? new Date(workflow.end_time) : undefined,
    };
  }, [workflow]);

  if (isLoading || !workflow) {
    return (
      <div className="flex h-full flex-col p-4">
        <div className="relative flex-1">
          <LogViewerSkeleton className="h-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="relative flex-1">
        <InlineErrorBoundary
          title="Unable to display log viewer"
          resetKeys={[logUrl]}
        >
          <LogViewerContainer
            logUrl={logUrl}
            workflowMetadata={workflowMetadata}
            scope="workflow"
            urlSync
            className="h-full"
            viewerClassName="h-full"
          />
        </InlineErrorBoundary>
      </div>
    </div>
  );
}
