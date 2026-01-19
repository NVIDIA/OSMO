//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Log Parser for OSMO Log Format
 *
 * Performance-critical code that runs on every log line during streaming.
 * Optimized for the known OSMO log format using position-based parsing
 * and pre-compiled regexes.
 *
 * OSMO Log Format:
 * - Standard: `{YYYY/MM/DD HH:mm:ss} [{task_name}] {message}`
 * - With retry: `{YYYY/MM/DD HH:mm:ss} [{task_name} retry-N] {message}`
 * - OSMO ctrl: `{YYYY/MM/DD HH:mm:ss} [{task_name}][osmo] {message}`
 */

import type { LogEntry, LogLevel, LogIOType } from "../types";

// =============================================================================
// Pre-compiled Regexes (compiled once at module load)
// =============================================================================

/** Matches OSMO timestamp format: YYYY/MM/DD HH:MM:SS */
const TIMESTAMP_RE = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/;

/** Matches task name with optional retry: [task_name] or [task_name retry-N] */
const TASK_RE = /^\[([^\]\s]+)(?:\s+retry-(\d+))?\]/;

/** Matches OSMO control prefix */
const OSMO_RE = /^\[osmo\]/;

/** Strips ANSI escape codes from log messages */
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * Level detection patterns ordered by frequency in typical logs.
 * Each pattern matches level prefix at start of message.
 */
const LEVEL_PATTERNS: ReadonlyArray<readonly [RegExp, LogLevel]> = [
  [/^INFO[:\s]/i, "info"],
  [/^ERROR[:\s]/i, "error"],
  [/^WARN(?:ING)?[:\s]/i, "warn"],
  [/^DEBUG[:\s]/i, "debug"],
  [/^FATAL[:\s]/i, "fatal"],
] as const;

// =============================================================================
// ID Generation
// =============================================================================

let idCounter = 0;

/**
 * Generates a unique ID for a log entry.
 * Uses timestamp + counter for uniqueness and sortability.
 */
function generateId(timestamp: Date): string {
  return `${timestamp.getTime()}-${++idCounter}`;
}

/**
 * Resets the ID counter. Useful for testing.
 */
export function resetIdCounter(): void {
  idCounter = 0;
}

// =============================================================================
// Level Detection
// =============================================================================

/**
 * Detects log level from message content.
 * Uses first-char check for early exit optimization.
 *
 * @param msg - The message portion of the log line
 * @returns Detected log level, defaults to 'info'
 */
function detectLevel(msg: string): LogLevel {
  if (!msg) return "info";

  // Fast path: check first character (lowercase via OR 32)
  // Only check patterns if first char could match a level prefix
  const first = msg.charCodeAt(0) | 32; // lowercase

  // i=105, e=101, w=119, d=100, f=102
  if (first !== 105 && first !== 101 && first !== 119 && first !== 100 && first !== 102) {
    return "info";
  }

  for (const [re, lvl] of LEVEL_PATTERNS) {
    if (re.test(msg)) return lvl;
  }

  return "info";
}

// =============================================================================
// Line Parsing
// =============================================================================

/**
 * Parses a non-timestamped log line (dump line).
 * Used for lines that don't match the standard OSMO format.
 *
 * @param line - Raw log line
 * @param workflowId - Workflow ID for labeling
 * @returns LogEntry with minimal labels
 */
function parseDumpLine(line: string, workflowId: string): LogEntry {
  const timestamp = new Date();
  return {
    id: `dump-${timestamp.getTime()}-${++idCounter}`,
    timestamp,
    line: line.replace(ANSI_RE, ""),
    labels: {
      workflow: workflowId,
      level: detectLevel(line),
      io_type: "stdout" as LogIOType,
    },
  };
}

/**
 * Parses a single OSMO log line into a structured LogEntry.
 *
 * Performance optimizations:
 * 1. Early exit if line doesn't start with digit (timestamp indicator)
 * 2. Position-based parsing for known format structure
 * 3. Pre-compiled regexes reused across calls
 *
 * @param line - Raw log line from backend
 * @param workflowId - Workflow ID for labeling
 * @returns Parsed LogEntry or null for empty lines
 */
export function parseLogLine(line: string, workflowId: string): LogEntry | null {
  // Skip empty lines
  if (!line || line.trim().length === 0) return null;

  // Fast path: timestamp lines start with digit (0-9 = charCode 48-57)
  const firstChar = line.charCodeAt(0);
  if (firstChar < 48 || firstChar > 57) {
    return parseDumpLine(line, workflowId);
  }

  // Parse timestamp: YYYY/MM/DD HH:MM:SS
  const tsMatch = TIMESTAMP_RE.exec(line);
  if (!tsMatch) {
    return parseDumpLine(line, workflowId);
  }

  // Construct Date from regex groups (faster than Date.parse)
  const timestamp = new Date(
    Date.UTC(
      +tsMatch[1], // year
      +tsMatch[2] - 1, // month (0-indexed)
      +tsMatch[3], // day
      +tsMatch[4], // hour
      +tsMatch[5], // minute
      +tsMatch[6], // second
    ),
  );

  // After timestamp: "YYYY/MM/DD HH:MM:SS " = 20 characters
  let pos = 20;

  // Parse task name: [task_name] or [task_name retry-N]
  const afterTimestamp = line.slice(pos);
  const taskMatch = TASK_RE.exec(afterTimestamp);
  if (!taskMatch) {
    return parseDumpLine(line, workflowId);
  }

  const task = taskMatch[1];
  const retry = taskMatch[2] ?? "0";
  pos += taskMatch[0].length;

  // Check for [osmo] suffix indicating control message
  const afterTask = line.slice(pos);
  const isOsmo = OSMO_RE.test(afterTask);
  if (isOsmo) {
    pos += 6; // Skip "[osmo]"
  }

  // Skip leading space before message
  if (line.charCodeAt(pos) === 32) {
    pos++;
  }

  // Extract message and strip ANSI escape codes
  const message = line.slice(pos).replace(ANSI_RE, "");
  const level = detectLevel(message);

  // Determine IO type based on osmo flag
  const ioType: LogIOType = isOsmo ? "osmo_ctrl" : "stdout";

  return {
    id: generateId(timestamp),
    timestamp,
    line,
    labels: {
      workflow: workflowId,
      task,
      retry,
      level,
      io_type: ioType,
    },
  };
}

// =============================================================================
// Batch Processing
// =============================================================================

/**
 * Parses a batch of log lines efficiently.
 * Uses for...of loop with push for optimal performance.
 *
 * @param text - Multi-line log text (newline separated)
 * @param workflowId - Workflow ID for labeling
 * @returns Array of parsed LogEntry objects
 */
export function parseLogBatch(text: string, workflowId: string): LogEntry[] {
  if (!text) return [];

  const lines = text.split("\n");
  const entries: LogEntry[] = [];

  for (const line of lines) {
    const entry = parseLogLine(line, workflowId);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Strips ANSI escape codes from text.
 * Exported for use by other modules that need clean text.
 *
 * @param text - Text potentially containing ANSI codes
 * @returns Clean text without ANSI codes
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}
