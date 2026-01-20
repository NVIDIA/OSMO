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
import { useQueryState, parseAsStringLiteral } from "nuqs";
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
 * Valid scenario values for URL parsing.
 */
const SCENARIO_VALUES = ["normal", "error-heavy", "high-volume", "empty", "streaming"] as const;

/**
 * Log Viewer Playground
 *
 * Main client component for the experimental log viewer page.
 * Provides a full-page log viewer with scenario selection in the header.
 * Scenario is synced to URL via nuqs for easy sharing and debugging.
 */
export function LogViewerPlayground() {
  // URL-synced scenario state using nuqs
  // URL: /experimental/log-viewer?scenario=streaming
  const [scenario, setScenario] = useQueryState(
    "scenario",
    parseAsStringLiteral(SCENARIO_VALUES).withDefault("normal").withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // Memoize header actions to prevent infinite re-render loop
  // The usePage hook uses headerActions as a useMemo dependency, so passing
  // a new JSX element on every render causes infinite updates.
  const headerActions = useMemo(
    () => (
      <ScenarioSelector
        value={scenario}
        onChange={setScenario}
      />
    ),
    [scenario, setScenario],
  );

  // Register page with scenario selector in the header
  usePage({
    title: "Log Viewer",
    breadcrumbs: [{ label: "Experimental", href: "/experimental" }],
    headerActions,
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
      <LogViewerContainerInner scenario={scenario} />
    </LogAdapterProvider>
  );
}

/**
 * Inner container that uses the log adapter hooks.
 * Separated to ensure hooks are called within the provider context.
 *
 * Note: The key={scenario} on LogAdapterProvider ensures this component
 * fully remounts when scenario changes, resetting all state including
 * React Query's useQuery hooks.
 */
function LogViewerContainerInner({ scenario }: { scenario: LogScenario }) {
  // Filter chips state (for URL sync demonstration)
  const [filterChips, setFilterChips] = useState<SearchChip[]>([]);

  // Get tailing state from store
  const isTailing = useLogViewerStore((s) => s.isTailing);

  // Fetch initial log data using the adapter hooks
  // Include scenario in workflowId to ensure different scenarios get different React Query cache entries
  const workflowIdWithScenario = `${MOCK_WORKFLOW_ID}__${scenario}`;

  const {
    entries: queryEntries,
    isLoading,
    error,
    refetch,
  } = useLogQuery({
    workflowId: workflowIdWithScenario,
    enabled: true,
  });

  // Live tailing hook - appends new entries as they stream in
  // Always use streaming scenario for tailing in the mock playground
  // (In production, the backend handles streaming natively)
  const tailDevParams = useMemo(() => ({ log_scenario: "streaming" }), []);
  const { entries: tailEntries } = useLogTail({
    workflowId: MOCK_WORKFLOW_ID,
    enabled: isTailing,
    devParams: tailDevParams,
  });

  // Cache the latest timestamp from query entries (computed once per query change)
  // This avoids O(n) recomputation on every tail update
  const queryLatestTime = useMemo(() => {
    if (queryEntries.length === 0) return 0;
    let maxTime = 0;
    for (const e of queryEntries) {
      const t = e.timestamp.getTime();
      if (t > maxTime) maxTime = t;
    }
    return maxTime;
  }, [queryEntries]);

  // Combine query entries with tail entries
  // Query entries are the initial load, tail entries are live updates
  const combinedEntries = useMemo(() => {
    if (tailEntries.length === 0) return queryEntries;

    // Filter tail entries to only include new ones (after query entries)
    // Use the cached queryLatestTime to avoid O(n) recomputation
    const newTailEntries: LogEntry[] = [];
    for (const entry of tailEntries) {
      if (entry.timestamp.getTime() > queryLatestTime) {
        newTailEntries.push(entry);
      }
    }

    if (newTailEntries.length === 0) return queryEntries;

    // Combine arrays
    const combined: LogEntry[] = [];
    for (const e of queryEntries) combined.push(e);
    for (const e of newTailEntries) combined.push(e);

    return combined;
  }, [queryEntries, tailEntries, queryLatestTime]);

  // Get histogram data from the adapter
  const { buckets: histogramBuckets, intervalMs: histogramIntervalMs } = useLogHistogram({
    workflowId: workflowIdWithScenario,
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
  const facetFields = useMemo(() => ["level", "source", "task"], []);
  const { facets } = useLogFacets({
    workflowId: workflowIdWithScenario,
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
