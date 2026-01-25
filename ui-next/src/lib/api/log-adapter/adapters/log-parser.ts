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

import type { LogEntry, LogLevel, LogIOType, LogSourceType } from "../types";

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
 * Capture group 1 is the full prefix to strip (including separator).
 */
const LEVEL_PATTERNS: ReadonlyArray<readonly [RegExp, LogLevel]> = [
  [/^(INFO[:\s])/i, "info"],
  [/^(ERROR[:\s])/i, "error"],
  [/^(WARN(?:ING)?[:\s])/i, "warn"],
  [/^(DEBUG[:\s])/i, "debug"],
  [/^(FATAL[:\s])/i, "fatal"],
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
 * Result of level detection: the detected level, stripped message, and original prefix.
 */
interface LevelDetectResult {
  level: LogLevel;
  strippedMessage: string;
  /** The original prefix that was stripped (e.g., "INFO: "), or undefined if none */
  prefix?: string;
}

/**
 * Detects log level from message content and strips the level prefix.
 * Uses first-char check for early exit optimization.
 *
 * @param msg - The message portion of the log line
 * @returns Object with detected level, message with level prefix stripped, and original prefix
 */
function detectAndStripLevel(msg: string): LevelDetectResult {
  if (!msg) return { level: "info", strippedMessage: msg };

  // Fast path: check first character (lowercase via OR 32)
  // Only check patterns if first char could match a level prefix
  const first = msg.charCodeAt(0) | 32; // lowercase

  // i=105, e=101, w=119, d=100, f=102
  if (first !== 105 && first !== 101 && first !== 119 && first !== 100 && first !== 102) {
    return { level: "info", strippedMessage: msg };
  }

  for (const [re, lvl] of LEVEL_PATTERNS) {
    const match = re.exec(msg);
    if (match) {
      // Strip the matched prefix (capture group 1), preserve original prefix for reconstruction
      return { level: lvl, strippedMessage: msg.slice(match[1].length), prefix: match[1] };
    }
  }

  return { level: "info", strippedMessage: msg };
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
  const rawMessage = line.replace(ANSI_RE, "");
  const { level, strippedMessage, prefix } = detectAndStripLevel(rawMessage);
  return {
    id: `dump-${timestamp.getTime()}-${++idCounter}`,
    timestamp,
    message: strippedMessage,
    labels: {
      workflow: workflowId,
      level,
      io_type: "stdout" as LogIOType,
      source: "user" as LogSourceType,
      ...(prefix && { level_prefix: prefix }),
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

  // Extract message, strip ANSI codes, and detect/strip level prefix
  const rawMessage = line.slice(pos).replace(ANSI_RE, "");
  const { level, strippedMessage, prefix } = detectAndStripLevel(rawMessage);

  // Determine IO type and source based on osmo flag
  const ioType: LogIOType = isOsmo ? "osmo_ctrl" : "stdout";
  const source: LogSourceType = isOsmo ? "osmo" : "user";

  return {
    id: generateId(timestamp),
    timestamp,
    message: strippedMessage,
    labels: {
      workflow: workflowId,
      task,
      retry,
      level,
      io_type: ioType,
      source,
      ...(prefix && { level_prefix: prefix }),
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
 * IMPORTANT: Does NOT sort entries - trusts backend to return chronological data.
 * Backend is the source of truth for ordering.
 *
 * @param text - Multi-line log text (newline separated)
 * @param workflowId - Workflow ID for labeling
 * @returns Array of parsed LogEntry objects in backend-provided order
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

  // DEBUG: Check if backend returned sorted logs
  if (process.env.NODE_ENV === "development" && entries.length > 1) {
    let outOfOrder = 0;
    for (let i = 1; i < Math.min(entries.length, 10); i++) {
      if (entries[i].timestamp < entries[i - 1].timestamp) {
        outOfOrder++;
      }
    }
    if (outOfOrder > 0) {
      console.warn(
        `[parseLogBatch] Backend returned ${outOfOrder} out-of-order entries in first 10. ` +
          `First 3 dates: ${entries
            .slice(0, 3)
            .map((e) => e.timestamp.toISOString().split("T")[0])
            .join(", ")}`,
      );
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

// =============================================================================
// Line Formatting (reverse of parsing)
// =============================================================================

/**
 * Formats a timestamp to OSMO log format: YYYY/MM/DD HH:MM:SS
 *
 * @param date - Date to format
 * @returns Formatted timestamp string
 */
function formatTimestamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}/${m}/${d} ${h}:${min}:${s}`;
}

/**
 * Reconstructs a full log line from a parsed LogEntry.
 * Reverse of parseLogLine - used for copy-to-clipboard and download.
 *
 * Format patterns:
 * - `{date} [{task}][osmo] {level_prefix}{message}` for osmo_ctrl, download, upload (retry=0)
 * - `{date} [{task} retry-{N}][osmo] {level_prefix}{message}` for osmo_ctrl, download, upload (retry>0)
 * - `{date} [{task}] {level_prefix}{message}` for stdout, stderr (retry=0)
 * - `{date} [{task} retry-{N}] {level_prefix}{message}` for stdout, stderr (retry>0)
 * - `{level_prefix}{message}` for DUMP type (no task label)
 *
 * @param entry - Parsed log entry
 * @returns Reconstructed full log line
 */
export function formatLogLine(entry: LogEntry): string {
  const { timestamp, message, labels } = entry;

  // Restore the level prefix if one was stripped during parsing
  const levelPrefix = labels.level_prefix ?? "";
  const fullMessage = `${levelPrefix}${message}`;

  // DUMP lines have no prefix (no task label)
  if (!labels.task) {
    return fullMessage;
  }

  // Format timestamp: YYYY/MM/DD HH:MM:SS
  const date = formatTimestamp(timestamp);

  // Format task: [task] or [task retry-N]
  const retry = labels.retry && labels.retry !== "0" ? ` retry-${labels.retry}` : "";
  const task = `[${labels.task}${retry}]`;

  // OSMO suffix for control messages
  const isOsmo = labels.io_type === "osmo_ctrl" || labels.io_type === "download" || labels.io_type === "upload";
  const osmoSuffix = isOsmo ? "[osmo]" : "";

  return `${date} ${task}${osmoSuffix} ${fullMessage}`;
}
