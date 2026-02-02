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

import { Suspense } from "react";
import { LogViewerSkeleton } from "@/components/log-viewer";
import { LogViewerWithData } from "./components/log-viewer-with-data";
import { WorkflowSelector } from "./components/workflow-selector";

/**
 * Log Viewer Page (Server Component)
 *
 * A standalone log viewer for viewing workflow, task group, and task logs.
 * Uses the reusable LogViewerContainer with server-side data prefetching.
 *
 * PARTIAL PRERENDER (PPR) ARCHITECTURE:
 * 1. Server immediately sends Chrome shell + LogViewerSkeleton (static shell)
 * 2. LogViewerWithData suspends while prefetching log data on server
 * 3. When data is ready, React streams the content to replace skeleton
 * 4. Client hydrates with data already in React Query cache (no client fetch!)
 *
 * Production usage:
 * - Task logs, Group logs, Workflow logs pages
 * - Static logs (completed workflows) - biggest PPR benefit
 * - Streaming logs (running workflows) - prefetch initial batch
 * - Permalinked logs - server knows exactly what to fetch
 */

interface PageProps {
  searchParams: Promise<{ workflow?: string; scenario?: string }>;
}

export default async function LogViewerPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const workflowId = params.workflow;

  // No workflow selected - show selector
  if (!workflowId) {
    return <WorkflowSelector />;
  }

  // Workflow selected - show log viewer with data
  return (
    <Suspense
      fallback={
        <div className="flex h-full flex-col p-4">
          <div className="border-border bg-card relative flex-1 overflow-hidden rounded-lg border">
            <LogViewerSkeleton className="h-full" />
          </div>
        </div>
      }
    >
      <LogViewerWithData searchParams={searchParams} />
    </Suspense>
  );
}
