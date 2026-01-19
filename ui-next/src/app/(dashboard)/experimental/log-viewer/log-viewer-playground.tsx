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

import { useState, useCallback, useMemo } from "react";
import { usePage } from "@/components/chrome";
import { LogViewer, useLogViewerStore } from "@/components/log-viewer";
import {
  useLogQuery,
  useLogHistogram,
  useLogFacets,
  useLogTail,
  LogAdapterProvider,
  type LogEntry,
} from "@/lib/api/log-adapter";
import type { SearchChip } from "@/components/filter-bar";
import { ScenarioSelector, type LogScenario } from "./components/scenario-selector";

/**
 * Log Viewer Playground
 *
 * Main client component for the experimental log viewer page.
 * Provides a full-page log viewer with scenario selection in the header.
 */
export function LogViewerPlayground() {
  // Playground state
  const [scenario, setScenario] = useState<LogScenario>("normal");

  // Register page with scenario selector in the header
  usePage({
    title: "Log Viewer",
    breadcrumbs: [{ label: "Experimental", href: "/experimental" }],
    headerActions: (
      <ScenarioSelector
        value={scenario}
        onChange={setScenario}
      />
    ),
  });

  return (
    <div className="flex h-full flex-col p-4">
      {/* Full height log viewer */}
      <div className="relative flex-1">
        <LogViewerContainer scenario={scenario} />
      </div>
    </div>
  );
}

// Mock workflow ID for the playground
const MOCK_WORKFLOW_ID = "log-viewer-playground";

/**
 * Container for the LogViewer component.
 * Uses LogAdapterProvider to pass the scenario to the mock handler.
 */
function LogViewerContainer({ scenario }: { scenario: LogScenario }) {
  // Create adapter config with scenario as a dev param
  const adapterConfig = useMemo(
    () => ({
      devParams: { log_scenario: scenario },
    }),
    [scenario],
  );

  return (
    <LogAdapterProvider
      config={adapterConfig}
      key={scenario}
    >
      <LogViewerContainerInner />
    </LogAdapterProvider>
  );
}

/**
 * Inner container that uses the log adapter hooks.
 * Separated to ensure hooks are called within the provider context.
 */
function LogViewerContainerInner() {
  // Filter chips state (for URL sync demonstration)
  const [filterChips, setFilterChips] = useState<SearchChip[]>([]);

  // Get tailing state from store
  const isTailing = useLogViewerStore((s) => s.isTailing);

  // Fetch initial log data using the adapter hooks
  const {
    entries: queryEntries,
    isLoading,
    error,
    refetch,
  } = useLogQuery({
    workflowId: MOCK_WORKFLOW_ID,
    enabled: true,
  });

  // Live tailing hook - appends new entries as they stream in
  const { entries: tailEntries } = useLogTail({
    workflowId: MOCK_WORKFLOW_ID,
    enabled: isTailing, // Only tail when tailing is enabled in the store
  });

  // Combine query entries with tail entries
  // Query entries are the initial load, tail entries are live updates
  const combinedEntries = useMemo(() => {
    if (tailEntries.length === 0) return queryEntries;

    // Get the latest timestamp from query entries to avoid duplicates
    const queryLatestTime = queryEntries.length > 0 ? Math.max(...queryEntries.map((e) => e.timestamp.getTime())) : 0;

    // Filter tail entries to only include new ones
    const newTailEntries: LogEntry[] = [];
    for (const entry of tailEntries) {
      if (entry.timestamp.getTime() > queryLatestTime) {
        newTailEntries.push(entry);
      }
    }

    return [...queryEntries, ...newTailEntries];
  }, [queryEntries, tailEntries]);

  // Get histogram data from the adapter
  const { buckets: histogramBuckets, intervalMs: histogramIntervalMs } = useLogHistogram({
    workflowId: MOCK_WORKFLOW_ID,
    enabled: !isLoading,
  });

  // Build histogram object for LogViewer
  const histogram = useMemo(
    () => ({
      buckets: histogramBuckets,
      intervalMs: histogramIntervalMs,
    }),
    [histogramBuckets, histogramIntervalMs],
  );

  // Get facet data - use stable array reference to avoid re-renders
  const facetFields = useMemo(() => ["level", "task", "io_type"], []);
  const { facets } = useLogFacets({
    workflowId: MOCK_WORKFLOW_ID,
    fields: facetFields,
    enabled: !isLoading,
  });

  // Handle filter changes (for URL sync demonstration)
  const handleFiltersChange = useCallback((chips: SearchChip[]) => {
    setFilterChips(chips);
  }, []);

  return (
    <div className="border-border bg-card h-full overflow-hidden rounded-lg border">
      <LogViewer
        entries={combinedEntries}
        isLoading={isLoading}
        error={error}
        histogram={histogram}
        facets={facets}
        onRefetch={refetch}
        onFiltersChange={handleFiltersChange}
        initialChips={filterChips}
        scope="workflow"
        className="h-full"
      />
    </div>
  );
}
