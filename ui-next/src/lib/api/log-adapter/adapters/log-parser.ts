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

import type { LogEntry, LogIOType, LogSourceType } from "@/lib/api/log-adapter/types";

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
// Line Parsing
// =============================================================================

/**
 * Parses a non-timestamped log line (dump line).
 * Used for lines that don't match the standard OSMO format.
 *
 * @param line - Raw log line
 * @returns LogEntry with minimal labels
 */
function parseDumpLine(line: string): LogEntry {
  const timestamp = new Date();
  const message = line.replace(ANSI_RE, "");
  return {
    id: `dump-${timestamp.getTime()}-${++idCounter}`,
    timestamp,
    message,
    labels: {
      io_type: "stdout" as LogIOType,
      source: "user" as LogSourceType,
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
 * @returns Parsed LogEntry or null for empty lines
 */
export function parseLogLine(line: string): LogEntry | null {
  // Skip empty lines
  if (!line || line.trim().length === 0) return null;

  // Fast path: timestamp lines start with digit (0-9 = charCode 48-57)
  const firstChar = line.charCodeAt(0);
  if (firstChar < 48 || firstChar > 57) {
    return parseDumpLine(line);
  }

  // Parse timestamp: YYYY/MM/DD HH:MM:SS
  const tsMatch = TIMESTAMP_RE.exec(line);
  if (!tsMatch) {
    return parseDumpLine(line);
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
    return parseDumpLine(line);
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

  // Extract message, strip ANSI codes only - preserve leading space and all content as-is
  const message = line.slice(pos).replace(ANSI_RE, "");

  // Determine IO type and source based on osmo flag
  const ioType: LogIOType = isOsmo ? "osmo_ctrl" : "stdout";
  const source: LogSourceType = isOsmo ? "osmo" : "user";

  return {
    id: generateId(timestamp),
    timestamp,
    message,
    labels: {
      task,
      retry,
      io_type: ioType,
      source,
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
 * @returns Array of parsed LogEntry objects in backend-provided order
 */
export function parseLogBatch(text: string): LogEntry[] {
  if (!text) return [];

  const lines = text.split("\n");
  const entries: LogEntry[] = [];

  for (const line of lines) {
    const entry = parseLogLine(line);
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
 * - `{date} [{task}][osmo]{message}` for osmo_ctrl, download, upload (retry=0)
 * - `{date} [{task} retry-{N}][osmo]{message}` for osmo_ctrl, download, upload (retry>0)
 * - `{date} [{task}]{message}` for stdout, stderr (retry=0)
 * - `{date} [{task} retry-{N}]{message}` for stdout, stderr (retry>0)
 * - `{message}` for DUMP type (no task label)
 *
 * @param entry - Parsed log entry
 * @returns Reconstructed full log line in standardized format
 */
export function formatLogLine(entry: LogEntry): string {
  const { timestamp, message, labels } = entry;

  // DUMP lines have no prefix (no task label)
  if (!labels.task) {
    return message;
  }

  // Format timestamp: YYYY/MM/DD HH:MM:SS
  const date = formatTimestamp(timestamp);

  // Format task: [task] or [task retry-N]
  const retry = labels.retry && labels.retry !== "0" ? ` retry-${labels.retry}` : "";
  const task = `[${labels.task}${retry}]`;

  // OSMO suffix for control messages
  const isOsmo = labels.io_type === "osmo_ctrl" || labels.io_type === "download" || labels.io_type === "upload";
  const osmoSuffix = isOsmo ? "[osmo]" : "";

  return `${date} ${task}${osmoSuffix}${message}`;
}
