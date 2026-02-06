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

import { useEffect } from "react";
import { usePage } from "@/components/chrome/page-context";
import { LogViewerContainer } from "@/components/log-viewer/components/LogViewerContainer";
import { addRecentWorkflow } from "../lib/recent-workflows";
import { WorkflowStatus } from "@/lib/api/generated";

/**
 * Workflow metadata for timeline bounds
 */
interface WorkflowMetadata {
  name: string;
  status: WorkflowStatus;
  submitTime?: Date;
  startTime?: Date;
  endTime?: Date;
}

interface LogViewerPageContentProps {
  workflowId: string;
  workflowMetadata: WorkflowMetadata | null;
}

/**
 * Log Viewer Page Content (Client Component)
 *
 * Contains all the client-side logic for the log viewer experimental page.
 * Wrapped in Suspense by the parent Server Component page.
 */
export function LogViewerPageContent({ workflowId, workflowMetadata }: LogViewerPageContentProps) {
  // Save workflow to recent workflows on mount
  useEffect(() => {
    addRecentWorkflow(workflowId);
  }, [workflowId]);

  // Register page with workflow name in breadcrumbs
  usePage({
    title: workflowMetadata?.name ?? workflowId,
    breadcrumbs: [{ label: "Log Viewer", href: "/log-viewer" }],
  });

  return (
    <div className="flex h-full flex-col p-4">
      <div className="relative flex-1">
        <LogViewerContainer
          workflowId={workflowId}
          workflowMetadata={workflowMetadata}
          scope="workflow"
          className="h-full"
          viewerClassName="h-full"
        />
      </div>
    </div>
  );
}
