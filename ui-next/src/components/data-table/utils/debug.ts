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
 * Column Sizing Debug Utility
 *
 * Optimized for AI-in-the-loop iteration:
 * - Single batched log per event (no spam)
 * - Structured JSON for easy copy/paste to AI
 * - Captures all relevant state in one snapshot
 * - Toggle via localStorage: localStorage.setItem('DEBUG_COLUMN_SIZING', 'true')
 *
 * Usage:
 * 1. Enable: localStorage.setItem('DEBUG_COLUMN_SIZING', 'true')
 * 2. Reproduce issue
 * 3. Copy the logged object and paste to AI
 * 4. Disable: localStorage.removeItem('DEBUG_COLUMN_SIZING')
 */

// Check if debugging is enabled (SSR-safe)
function isDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("DEBUG_COLUMN_SIZING") === "true";
}

// Event types for structured debugging
// These match the state machine events in use-column-sizing.ts
export type DebugEventType =
  // State machine events
  | "INIT"
  | "CONTAINER_RESIZE"
  | "RESIZE_START"
  | "RESIZE_MOVE"
  | "RESIZE_END"
  | "AUTO_FIT"
  | "SET_SIZE"
  | "TANSTACK_SIZING_CHANGE"
  | "TANSTACK_INFO_CHANGE"
  // Internal/utility events
  | "CACHE_COMPUTE"
  | "ERROR";

export interface DebugSnapshot {
  event: DebugEventType;
  timestamp: string;
  duration?: number;
  columnIds: string[];
  containerWidth: number | null;
  columnSizing: Record<string, number>;
  preferences: Record<string, { mode: string; width: number }>;
  minSizes: Record<string, number>;
  preferredSizes: Record<string, number>;
  isResizing: boolean;
  isInitialized: boolean;
  // Event-specific data
  context?: Record<string, unknown>;
  // Error info if applicable
  error?: string;
}

// Singleton buffer for batching rapid events
let eventBuffer: DebugSnapshot[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
const FLUSH_DELAY_MS = 100; // Batch events within 100ms

/**
 * Log a debug snapshot.
 * Batches rapid events together for cleaner output.
 *
 * Accepts either a snapshot directly or a factory function to avoid
 * object allocation when debugging is disabled.
 */
export function logColumnSizingDebug(snapshotOrFactory: DebugSnapshot | (() => DebugSnapshot)): void {
  if (!isDebugEnabled()) return;

  const snapshot = typeof snapshotOrFactory === "function" ? snapshotOrFactory() : snapshotOrFactory;
  eventBuffer.push(snapshot);

  // Debounce flush to batch rapid events
  if (flushTimeout) clearTimeout(flushTimeout);
  flushTimeout = setTimeout(() => {
    flushDebugBuffer();
  }, FLUSH_DELAY_MS);
}

/**
 * Immediately flush all buffered events.
 * Call this at the end of a user action (e.g., resize end).
 */
export function flushDebugBuffer(): void {
  if (!isDebugEnabled() || eventBuffer.length === 0) return;

  const events = [...eventBuffer];
  eventBuffer = [];
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  // Format for AI consumption
  const output = {
    _instruction: "Copy this entire object and paste to AI for debugging",
    eventCount: events.length,
    timeRange:
      events.length > 1 ? `${events[0].timestamp} → ${events[events.length - 1].timestamp}` : events[0]?.timestamp,
    events: events.map((e) => ({
      event: e.event,
      time: e.timestamp.split("T")[1], // Just time portion
      ...(e.duration !== undefined && { durationMs: e.duration }),
      ...(e.context && { context: e.context }),
      ...(e.error && { error: e.error }),
    })),
    // Include full state snapshot from last event only (reduce noise)
    finalState: events.length > 0 ? formatState(events[events.length - 1]) : null,
  };

  console.log("%c[ColumnSizing Debug]", "color: #6366f1; font-weight: bold", "\n" + JSON.stringify(output, null, 2));
}

function formatState(snapshot: DebugSnapshot): Record<string, unknown> {
  return {
    containerWidth: snapshot.containerWidth,
    isResizing: snapshot.isResizing,
    isInitialized: snapshot.isInitialized,
    columns: snapshot.columnIds.map((id) => ({
      id,
      current: snapshot.columnSizing[id] ?? "undefined",
      min: snapshot.minSizes[id] ?? "undefined",
      preferred: snapshot.preferredSizes[id] ?? "undefined",
      preference: snapshot.preferences[id] ?? null,
    })),
  };
}

/**
 * Create a debug snapshot from hook state.
 * Helper to standardize snapshot creation.
 */
export function createDebugSnapshot(
  event: DebugEventType,
  state: {
    columnIds: string[];
    containerRef?: React.RefObject<HTMLElement | null>;
    columnSizing: Record<string, number>;
    preferences?: Record<string, { mode: string; width: number }>;
    minSizes: Record<string, number>;
    preferredSizes: Record<string, number>;
    isResizing: boolean;
    isInitialized: boolean;
  },
  context?: Record<string, unknown>,
  error?: string,
): DebugSnapshot {
  return {
    event,
    timestamp: new Date().toISOString(),
    columnIds: state.columnIds,
    containerWidth: state.containerRef?.current?.clientWidth ?? null,
    columnSizing: { ...state.columnSizing },
    preferences: state.preferences
      ? Object.fromEntries(Object.entries(state.preferences).map(([k, v]) => [k, { mode: v.mode, width: v.width }]))
      : {},
    minSizes: { ...state.minSizes },
    preferredSizes: { ...state.preferredSizes },
    isResizing: state.isResizing,
    isInitialized: state.isInitialized,
    ...(context && { context }),
    ...(error && { error }),
  };
}

/**
 * Measure execution time of a function.
 * Returns result and logs timing.
 */
export function measureTiming<T>(label: string, fn: () => T, state: Parameters<typeof createDebugSnapshot>[1]): T {
  if (!isDebugEnabled()) return fn();

  const start = performance.now();
  try {
    const result = fn();
    const duration = performance.now() - start;
    logColumnSizingDebug({
      ...createDebugSnapshot("CACHE_COMPUTE", state, { label }),
      duration,
    });
    return result;
  } catch (e) {
    logColumnSizingDebug(createDebugSnapshot("ERROR", state, { label }, e instanceof Error ? e.message : String(e)));
    throw e;
  }
}
