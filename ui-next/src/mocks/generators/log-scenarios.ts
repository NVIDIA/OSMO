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
 * Log Scenarios for Mock System
 *
 * Pre-defined scenarios for testing the log viewer with different
 * log volumes, distributions, and features.
 *
 * Usage: Add `?log_scenario=error-heavy` to URL to select a scenario.
 */

import type { LogLevel, LogIOType } from "@/lib/api/log-adapter/types";

// =============================================================================
// Types
// =============================================================================

/**
 * Volume configuration for log generation.
 */
export interface LogVolumeConfig {
  /** Minimum number of log lines */
  min: number;
  /** Maximum number of log lines */
  max: number;
}

/**
 * Feature flags for scenario-specific log generation.
 */
export interface LogFeatureConfig {
  /** Include retry attempts in task names */
  retries: boolean;
  /** Generate multi-line log entries (stack traces, JSON) */
  multiLine: boolean;
  /** Include ANSI escape codes in log output */
  ansiCodes: boolean;
  /** Enable streaming mode (for tailing simulation) */
  streaming: boolean;
  /** Delay between chunks in streaming mode (ms) */
  streamDelayMs?: number;
  /** Number of tasks to generate logs for */
  taskCount?: number;
  /** Max retry attempt number (only if retries: true) */
  maxRetryAttempt?: number;
}

/**
 * Complete scenario configuration for log generation.
 */
export interface LogScenarioConfig {
  /** Unique scenario identifier */
  name: string;
  /** Human-readable description for UI */
  description: string;
  /** Log volume range */
  volume: LogVolumeConfig;
  /** Distribution of log levels (must sum to 1.0) */
  levelDistribution: Record<LogLevel, number>;
  /** Distribution of IO types (must sum to 1.0) */
  ioTypeDistribution: Record<LogIOType, number>;
  /** Feature flags */
  features: LogFeatureConfig;
}

// =============================================================================
// Scenario Definitions
// =============================================================================

/**
 * Default level distribution - typical training workflow.
 */
const DEFAULT_LEVEL_DISTRIBUTION: Record<LogLevel, number> = {
  debug: 0.01,
  info: 0.85,
  warn: 0.1,
  error: 0.035,
  fatal: 0.005,
};

/**
 * Default IO type distribution.
 * Matches backend IOType usage patterns.
 */
const DEFAULT_IO_DISTRIBUTION: Record<LogIOType, number> = {
  stdout: 0.58,
  osmo_ctrl: 0.28,
  stderr: 0.05,
  download: 0.025,
  upload: 0.025,
  dump: 0.04, // Progress bars, tqdm output (no timestamp/prefix)
};

/**
 * Default feature flags.
 */
const DEFAULT_FEATURES: LogFeatureConfig = {
  retries: false,
  multiLine: false,
  ansiCodes: false,
  streaming: false,
  taskCount: 3,
};

/**
 * Valid scenario name type.
 */
export type LogScenarioName = "normal" | "error-heavy" | "high-volume" | "empty" | "streaming";

/**
 * 5 core log scenarios for testing the log viewer.
 */
export const LOG_SCENARIOS: Record<LogScenarioName, LogScenarioConfig> = {
  /**
   * Normal scenario - typical training workflow logs.
   * 500-2k lines, mostly INFO with occasional warnings/errors.
   * Good for general UI testing and development.
   */
  normal: {
    name: "normal",
    description: "Typical training workflow with mixed log levels",
    volume: { min: 500, max: 2000 },
    levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
    ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
    features: { ...DEFAULT_FEATURES, multiLine: true, taskCount: 4 },
  },

  /**
   * Error-heavy scenario - high error rate for UI testing.
   * 500-1k lines, ~30% errors, ~20% warnings.
   * Tests error highlighting, filtering, and display.
   */
  "error-heavy": {
    name: "error-heavy",
    description: "High error rate (~30%) for testing error display",
    volume: { min: 500, max: 1000 },
    levelDistribution: {
      debug: 0.02,
      info: 0.45,
      warn: 0.2,
      error: 0.28,
      fatal: 0.05,
    },
    ioTypeDistribution: {
      stdout: 0.28,
      osmo_ctrl: 0.14,
      stderr: 0.5,
      download: 0.025,
      upload: 0.025,
      dump: 0.03,
    },
    features: { ...DEFAULT_FEATURES, multiLine: true, taskCount: 4 },
  },

  /**
   * High-volume scenario - performance testing with 50k+ lines.
   * Tests virtualization, memory usage, and scroll performance.
   */
  "high-volume": {
    name: "high-volume",
    description: "50k+ lines for virtualization and performance testing",
    volume: { min: 50000, max: 75000 },
    levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
    ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
    features: { ...DEFAULT_FEATURES, taskCount: 8 },
  },

  /**
   * Empty scenario - no logs (empty state testing).
   * Tests empty state UI, loading states, and error handling.
   */
  empty: {
    name: "empty",
    description: "Zero logs for empty state UI testing",
    volume: { min: 0, max: 0 },
    levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
    ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
    features: DEFAULT_FEATURES,
  },

  /**
   * Streaming scenario - simulates live log tailing.
   * Returns logs via HTTP streaming with delays between chunks.
   * Tests real-time log viewing, auto-scroll, and tailing UI.
   */
  streaming: {
    name: "streaming",
    description: "Live tailing with ~5 lines/second",
    volume: { min: 500, max: 1000 },
    levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
    ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
    features: {
      ...DEFAULT_FEATURES,
      streaming: true,
      streamDelayMs: 100, // ~10 lines/second (faster for testing)
      taskCount: 2,
    },
  },
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get a scenario configuration by name.
 * Falls back to 'normal' if scenario not found.
 */
export function getLogScenario(name: string): LogScenarioConfig {
  if (isValidScenario(name)) {
    return LOG_SCENARIOS[name];
  }
  return LOG_SCENARIOS.normal;
}

/**
 * Get all available scenario names.
 */
export function getLogScenarioNames(): LogScenarioName[] {
  return Object.keys(LOG_SCENARIOS) as LogScenarioName[];
}

/**
 * Validate that a scenario name exists.
 */
export function isValidScenario(name: string): name is LogScenarioName {
  return name in LOG_SCENARIOS;
}

// =============================================================================
// Scenario State Management (for testing)
// =============================================================================

/**
 * Current active scenario (can be overridden for testing).
 */
let currentScenario: LogScenarioName = "normal";

/**
 * Set the active log scenario.
 * Useful for testing different scenarios programmatically.
 */
export function setLogScenario(scenario: string): void {
  if (isValidScenario(scenario)) {
    currentScenario = scenario;
  } else {
    console.warn(`[LogScenario] Unknown scenario "${scenario}", using "normal"`);
    currentScenario = "normal";
  }
}

/**
 * Get the current active scenario name.
 */
export function getActiveScenario(): LogScenarioName {
  return currentScenario;
}

/**
 * Reset to the default scenario.
 */
export function resetLogScenario(): void {
  currentScenario = "normal";
}

/**
 * Get the current scenario configuration.
 */
export function getActiveScenarioConfig(): LogScenarioConfig {
  return getLogScenario(currentScenario);
}
