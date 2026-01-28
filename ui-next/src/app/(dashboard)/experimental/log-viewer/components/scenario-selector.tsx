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

import { useMemo, useId } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { useMounted } from "@/hooks";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/shadcn/select";
import { type LogScenarioName, getLogScenarioNames } from "@/mocks/generators";

// =============================================================================
// Types
// =============================================================================

/**
 * Re-export LogScenarioName as LogScenario for component API compatibility.
 */
export type LogScenario = LogScenarioName;

/**
 * Valid scenario values for URL parsing.
 */
const SCENARIO_VALUES = ["normal", "error-heavy", "high-volume", "empty", "streaming"] as const;

// =============================================================================
// Hook: useScenario
// =============================================================================

/**
 * Hook to read the current scenario from URL.
 *
 * This is a read-only hook for components that need to react to scenario changes.
 * Use ScenarioSelector component for the UI that allows changing scenarios.
 *
 * @returns Current scenario and dev params ready for LogViewerContainer
 *
 * @example
 * ```tsx
 * const { scenario, devParams, liveDevParams } = useScenario();
 *
 * return (
 *   <LogViewerContainer
 *     workflowId="my-workflow"
 *     devParams={devParams}
 *     liveDevParams={liveDevParams}
 *   />
 * );
 * ```
 */
export function useScenario() {
  const [scenario] = useQueryState(
    "scenario",
    parseAsStringLiteral(SCENARIO_VALUES).withDefault("normal").withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // Memoize devParams to prevent unnecessary re-renders and request cancellations
  // Without this, new objects are created every render, triggering cascading updates
  const devParams = useMemo(() => ({ log_scenario: scenario }), [scenario]);

  // Memoize liveDevParams (constant value, only needs to be created once)
  const liveDevParams = useMemo(() => ({ log_scenario: "streaming" as const }), []);

  return {
    /** Current scenario name */
    scenario: scenario as LogScenario,
    /** Dev params for LogViewerContainer */
    devParams,
    /** Live mode dev params (always streaming for mock) */
    liveDevParams,
  };
}

// =============================================================================
// UI Configuration
// =============================================================================

interface ScenarioConfig {
  label: string;
  description: string;
  volume: string;
}

/**
 * UI configuration for each log scenario.
 */
const SCENARIO_CONFIGS: Record<LogScenario, ScenarioConfig> = {
  normal: {
    label: "Normal",
    description: "Typical training workflow",
    volume: "500-2k lines",
  },
  "error-heavy": {
    label: "Error Heavy",
    description: "~30% errors, ~20% warnings",
    volume: "500-1k lines",
  },
  "high-volume": {
    label: "High Volume",
    description: "Performance testing",
    volume: "50k+ lines",
  },
  empty: {
    label: "Empty",
    description: "Zero logs (empty state)",
    volume: "0 lines",
  },
  streaming: {
    label: "Streaming",
    description: "Live tailing simulation",
    volume: "~10 lines/sec",
  },
};

// Use the canonical list of scenario names from the mock system
const SCENARIOS = getLogScenarioNames();

// =============================================================================
// Component: ScenarioSelector
// =============================================================================

/**
 * Self-contained dropdown selector for log scenarios.
 *
 * Manages its own URL state via nuqs and handles hydration safety.
 * Use useScenario() hook to read the current value elsewhere.
 *
 * @example
 * ```tsx
 * // In page header
 * usePage({
 *   title: "Log Viewer",
 *   headerActions: <ScenarioSelector />,
 * });
 * ```
 */
export function ScenarioSelector() {
  const [scenario, setScenario] = useQueryState(
    "scenario",
    parseAsStringLiteral(SCENARIO_VALUES).withDefault("normal").withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // Hydration-safe rendering for Radix Select
  const mounted = useMounted();

  // Generate unique ID for label-select association
  const selectId = useId();

  if (!mounted) {
    return <Skeleton className="h-9 w-[220px]" />;
  }

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={selectId}
        className="text-muted-foreground text-sm font-medium"
      >
        Scenario:
      </label>
      <Select
        value={scenario}
        onValueChange={(v) => setScenario(v as LogScenario)}
      >
        <SelectTrigger
          id={selectId}
          className="w-[180px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCENARIOS.map((s) => {
            const config = SCENARIO_CONFIGS[s];
            return (
              <SelectItem
                key={s}
                value={s}
              >
                <div className="flex flex-col">
                  <span>{config.label}</span>
                  <span className="text-muted-foreground text-xs">{config.description}</span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
