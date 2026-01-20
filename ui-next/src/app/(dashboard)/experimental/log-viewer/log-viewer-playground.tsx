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

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { usePage } from "@/components/chrome";
import { LogViewer, useLogViewerStore, chipsToLogQuery } from "@/components/log-viewer";
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

  // Convert filter chips to query params for O(1) adapter-level filtering
  // This leverages LogIndex inverted indexes instead of O(n) client-side filtering
  const queryFilters = useMemo(() => chipsToLogQuery(filterChips), [filterChips]);

  const {
    entries: queryEntries,
    isLoading,
    error,
    refetch,
  } = useLogQuery({
    workflowId: workflowIdWithScenario,
    enabled: true,
    // Pass filter params for O(1) filtering via LogIndex
    ...queryFilters,
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

  // ==========================================================================
  // Ref-based streaming buffer for stable array identity
  // Avoids creating new arrays on every tail update for better performance
  // ==========================================================================

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

  // Ref-based buffer maintains stable array identity during streaming
  // This prevents unnecessary re-renders when only appending entries
  const combinedEntriesRef = useRef<LogEntry[]>([]);
  const lastQueryEntriesRef = useRef<LogEntry[]>([]);
  const processedTailCountRef = useRef(0);

  // Version counter to trigger re-renders when buffer changes
  const [bufferVersion, setBufferVersion] = useState(0);

  // Update combined entries buffer when query or tail entries change
  useEffect(() => {
    // If query entries changed (different reference = new data load), reset buffer
    if (queryEntries !== lastQueryEntriesRef.current) {
      // Copy query entries to buffer (new array on query change is expected)
      const newBuffer: LogEntry[] = [];
      for (const e of queryEntries) newBuffer.push(e);
      combinedEntriesRef.current = newBuffer;
      lastQueryEntriesRef.current = queryEntries;
      processedTailCountRef.current = 0;
      setBufferVersion((v) => v + 1);
      return;
    }

    // Append only new tail entries (incremental update)
    const newTailCount = tailEntries.length - processedTailCountRef.current;
    if (newTailCount > 0) {
      let appended = false;
      for (let i = processedTailCountRef.current; i < tailEntries.length; i++) {
        const entry = tailEntries[i];
        if (entry.timestamp.getTime() > queryLatestTime) {
          // Mutate in place for O(1) append
          combinedEntriesRef.current.push(entry);
          appended = true;
        }
      }
      processedTailCountRef.current = tailEntries.length;

      // Only trigger re-render if we actually appended entries
      if (appended) {
        setBufferVersion((v) => v + 1);
      }
    }
  }, [queryEntries, tailEntries, queryLatestTime]);

  // Use buffer version in dependency to ensure consumers re-render
  // The actual array reference is stable between appends
  const combinedEntries = useMemo(
    () => combinedEntriesRef.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bufferVersion triggers update
    [bufferVersion],
  );

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

  // Check if any filters are active for preFiltered mode
  const hasFilters = filterChips.length > 0;

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
        // Entries are pre-filtered at adapter level via chipsToLogQuery
        // This skips O(n) client-side filtering for O(1) performance
        preFiltered={hasFilters}
      />
    </div>
  );
}
