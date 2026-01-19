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

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/shadcn/select";
import { type LogScenarioName, getLogScenarioNames } from "@/mocks/generators";

/**
 * Re-export LogScenarioName as LogScenario for component API compatibility.
 */
export type LogScenario = LogScenarioName;

interface ScenarioConfig {
  label: string;
  description: string;
  volume: string;
}

const SCENARIO_CONFIGS: Record<LogScenario, ScenarioConfig> = {
  normal: {
    label: "Normal",
    description: "Typical training workflow",
    volume: "500-2k lines",
  },
  "error-heavy": {
    label: "Error Heavy",
    description: "30% errors, 20% warnings",
    volume: "500-1k lines",
  },
  "high-volume": {
    label: "High Volume",
    description: "Large workflow for perf testing",
    volume: "100k+ lines",
  },
  empty: {
    label: "Empty",
    description: "Zero logs",
    volume: "0 lines",
  },
  streaming: {
    label: "Streaming",
    description: "Trickle 1-5 lines/sec",
    volume: "Unbounded",
  },
  retries: {
    label: "Retries",
    description: "Tasks with retry-1, retry-2",
    volume: "1k lines",
  },
  multiline: {
    label: "Multiline",
    description: "Stack traces, JSON blobs",
    volume: "500 lines",
  },
  ansi: {
    label: "ANSI Codes",
    description: "ANSI escape codes",
    volume: "200 lines",
  },
  mixed: {
    label: "Mixed IOTypes",
    description: "All IOTypes interleaved",
    volume: "2k lines",
  },
};

// Use the canonical list of scenario names from the mock system
const SCENARIOS = getLogScenarioNames();

interface ScenarioSelectorProps {
  value: LogScenario;
  onChange: (scenario: LogScenario) => void;
}

/**
 * Dropdown selector for log scenarios.
 * Each scenario represents a different test case for the log viewer.
 */
export function ScenarioSelector({ value, onChange }: ScenarioSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-muted-foreground text-sm font-medium">Scenario:</label>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as LogScenario)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCENARIOS.map((scenario) => {
            const config = SCENARIO_CONFIGS[scenario];
            return (
              <SelectItem
                key={scenario}
                value={scenario}
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
