// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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
 * Derived from the keys of LOG_SCENARIOS for type safety.
 */
export type LogScenarioName =
  | "normal"
  | "error-heavy"
  | "high-volume"
  | "empty"
  | "streaming"
  | "retries"
  | "multiline"
  | "ansi"
  | "mixed";

/**
 * 9 pre-defined log scenarios for comprehensive testing.
 */
export const LOG_SCENARIOS: Record<LogScenarioName, LogScenarioConfig> = {
  /**
   * Normal scenario - typical training workflow logs.
   * 500-2k lines, mostly INFO with occasional warnings/errors.
   */
  normal: {
    name: "normal",
    description: "Typical training workflow with mixed log levels",
    volume: { min: 500, max: 2000 },
    levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
    ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
    features: DEFAULT_FEATURES,
  },

  /**
   * Error-heavy scenario - high error rate for UI testing.
   * 500-1k lines, 28% errors, 20% warnings.
   */
  "error-heavy": {
    name: "error-heavy",
    description: "High error rate for testing error display and filtering",
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
    features: { ...DEFAULT_FEATURES, taskCount: 4 },
  },

  /**
   * High-volume scenario - performance testing with 100k+ lines.
   */
  "high-volume": {
    name: "high-volume",
    description: "Large workflow for virtualization and memory testing",
    volume: { min: 100000, max: 150000 },
    levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
    ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
    features: { ...DEFAULT_FEATURES, taskCount: 10 },
  },

  /**
   * Empty scenario - no logs (empty state testing).
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
   * Generates logs over time with configurable delay.
   */
  streaming: {
    name: "streaming",
    description: "Live tailing simulation with slow log generation",
    volume: { min: 10000, max: 50000 },
    levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
    ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
    features: {
      ...DEFAULT_FEATURES,
      streaming: true,
      streamDelayMs: 200,
      taskCount: 2,
    },
  },

  /**
   * Retries scenario - logs with retry attempts.
   * Useful for testing retry filtering in the log viewer.
   */
  retries: {
    name: "retries",
    description: "Tasks with multiple retry attempts for retry filtering",
    volume: { min: 800, max: 1200 },
    levelDistribution: {
      debug: 0.01,
      info: 0.7,
      warn: 0.15,
      error: 0.12,
      fatal: 0.02,
    },
    ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
    features: {
      ...DEFAULT_FEATURES,
      retries: true,
      maxRetryAttempt: 3,
      taskCount: 4,
    },
  },

  /**
   * Multiline scenario - stack traces and JSON blobs.
   * Tests multi-line log entry expansion.
   */
  multiline: {
    name: "multiline",
    description: "Stack traces and JSON blobs for multi-line expansion",
    volume: { min: 400, max: 600 },
    levelDistribution: {
      debug: 0.1,
      info: 0.5,
      warn: 0.15,
      error: 0.2,
      fatal: 0.05,
    },
    ioTypeDistribution: {
      stdout: 0.48,
      osmo_ctrl: 0.18,
      stderr: 0.25,
      download: 0.025,
      upload: 0.025,
      dump: 0.04,
    },
    features: { ...DEFAULT_FEATURES, multiLine: true },
  },

  /**
   * ANSI scenario - logs with ANSI escape codes.
   * Tests ANSI stripping functionality.
   */
  ansi: {
    name: "ansi",
    description: "Logs with ANSI escape codes for strip testing",
    volume: { min: 150, max: 250 },
    levelDistribution: {
      debug: 0.05,
      info: 0.7,
      warn: 0.15,
      error: 0.08,
      fatal: 0.02,
    },
    ioTypeDistribution: DEFAULT_IO_DISTRIBUTION,
    features: { ...DEFAULT_FEATURES, ansiCodes: true },
  },

  /**
   * Mixed scenario - all IO types interleaved.
   * Tests IO type filtering and display.
   */
  mixed: {
    name: "mixed",
    description: "All IO types interleaved for filter testing",
    volume: { min: 1500, max: 2500 },
    levelDistribution: DEFAULT_LEVEL_DISTRIBUTION,
    ioTypeDistribution: {
      stdout: 0.3,
      osmo_ctrl: 0.2,
      stderr: 0.15,
      download: 0.12,
      upload: 0.12,
      dump: 0.11, // Higher dump rate to test filtering
    },
    features: { ...DEFAULT_FEATURES, taskCount: 5 },
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
