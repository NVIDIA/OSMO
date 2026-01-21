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
 * Log Viewer With Data (Async Server Component)
 *
 * This component suspends while prefetching log data on the server.
 * When wrapped in Suspense, it enables streaming (Partial Prerender):
 * 1. Parent renders skeleton immediately
 * 2. This component awaits data fetch
 * 3. When ready, React streams the content to replace skeleton
 *
 * Benefits:
 * - Fast TTFB (skeleton streams immediately)
 * - No client-side fetch for initial data (data in hydrated cache)
 * - Seamless content swap (React handles it)
 *
 * This pattern mirrors production usage where log-viewer will be used on:
 * - Task logs, Group logs, Workflow logs pages
 * - Static logs (completed workflows)
 * - Streaming logs (running workflows)
 * - Permalinked logs
 */

import { dehydrate, QueryClient, HydrationBoundary } from "@tanstack/react-query";
import { prefetchLogData } from "@/lib/api/server";
import { LogViewerPageContent } from "./log-viewer-page-content";

/**
 * Mock workflow ID for the playground.
 */
const MOCK_WORKFLOW_ID = "log-viewer-playground";

/**
 * Valid scenario values matching the client-side parser.
 */
type LogScenario = "normal" | "error-heavy" | "high-volume" | "empty" | "streaming";

const VALID_SCENARIOS: readonly LogScenario[] = ["normal", "error-heavy", "high-volume", "empty", "streaming"];

function isValidScenario(value: unknown): value is LogScenario {
  return typeof value === "string" && VALID_SCENARIOS.includes(value as LogScenario);
}

interface LogViewerWithDataProps {
  /** URL search params passed from page */
  searchParams: Promise<{ scenario?: string }>;
}

export async function LogViewerWithData({ searchParams }: LogViewerWithDataProps) {
  // Parse scenario from URL (default to "normal")
  const params = await searchParams;
  const scenario: LogScenario = isValidScenario(params.scenario) ? params.scenario : "normal";

  // Create QueryClient for this request
  const queryClient = new QueryClient();

  // Build dev params matching what the client uses
  const devParams = { log_scenario: scenario };

  // Prefetch log data - this await causes the component to suspend
  // React streams the Suspense fallback, then streams this when ready
  await prefetchLogData(queryClient, {
    workflowId: MOCK_WORKFLOW_ID,
    devParams,
  });

  // Wrap in HydrationBoundary so client gets the cached data
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LogViewerPageContent />
    </HydrationBoundary>
  );
}
