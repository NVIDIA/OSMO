/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Synchronized Tick Hook
 *
 * Provides a shared, synchronized timestamp that updates every second.
 * All components using this hook receive the exact same timestamp value,
 * ensuring all "live" durations across the UI are perfectly aligned.
 *
 * Features:
 * - Single interval shared across all consumers (efficient)
 * - Pauses when document is not visible (saves resources)
 * - All consumers update simultaneously with the same timestamp
 *
 * Usage:
 * ```tsx
 * function LiveDuration({ startTime }: { startTime: Date }) {
 *   const now = useTick();
 *   const duration = Math.floor((now - startTime.getTime()) / 1000);
 *   return <span>{formatDuration(duration)}</span>;
 * }
 * ```
 */

import { useSyncExternalStore } from "react";
import { useDocumentVisibility } from "@react-hookz/web";
import { useInterval } from "usehooks-ts";

// ============================================================================
// Tick Store (Module-level singleton)
// ============================================================================

/** Current tick timestamp (milliseconds since epoch) */
let tickNow = Date.now();

/** Set of listener callbacks to notify on tick */
const listeners = new Set<() => void>();

/** Subscribe a listener to tick updates */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Get current tick value (snapshot for useSyncExternalStore) */
function getSnapshot(): number {
  return tickNow;
}

/** Get server snapshot (for SSR - returns current time) */
function getServerSnapshot(): number {
  return Date.now();
}

/** Advance the tick and notify all listeners */
function tick(): void {
  tickNow = Date.now();
  listeners.forEach((listener) => listener());
}

// ============================================================================
// Tick Controller Hook (drives the interval)
// ============================================================================

/**
 * Internal hook that drives the tick interval.
 * Should be used once at a high level in the component tree.
 * Automatically pauses when:
 * - Document is not visible (tab in background)
 * - Explicitly disabled via `enabled` parameter (e.g., workflow not running)
 *
 * @param enabled - Whether ticking is needed (default: true). Set to false for completed workflows.
 * @param intervalMs - Tick interval in milliseconds (default: 1000)
 */
export function useTickController(enabled: boolean = true, intervalMs: number = 1000): void {
  const isVisible = useDocumentVisibility();

  // Only run interval when document is visible AND ticking is enabled
  useInterval(tick, isVisible && enabled ? intervalMs : null);
}

// ============================================================================
// Consumer Hook
// ============================================================================

/**
 * Hook to get the current synchronized tick timestamp.
 *
 * Returns a timestamp (milliseconds since epoch) that updates every second.
 * All components using this hook receive the exact same value, ensuring
 * all live durations are perfectly aligned.
 *
 * @returns Current tick timestamp in milliseconds
 */
export function useTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ============================================================================
// Utility Hook for Duration Calculation
// ============================================================================

/**
 * Hook to calculate a live duration from a start time.
 * Returns duration in seconds, updating every tick.
 *
 * @param startTimeMs - Start time in milliseconds (or null if not started)
 * @param endTimeMs - End time in milliseconds (or null if still running)
 * @returns Duration in seconds, or null if startTimeMs is null
 */
export function useLiveDuration(startTimeMs: number | null, endTimeMs: number | null = null): number | null {
  const now = useTick();

  if (startTimeMs === null) return null;

  const end = endTimeMs ?? now;
  const durationMs = end - startTimeMs;

  // Never return negative durations
  return Math.max(0, Math.floor(durationMs / 1000));
}

/**
 * Calculate phase duration using the synchronized tick.
 * For use within components that need to calculate durations for multiple phases.
 *
 * @param now - Current tick timestamp from useTick()
 * @param start - Start time as Date or null
 * @param end - End time as Date or null (uses `now` if null)
 * @returns Duration in seconds, or null if start is null
 */
export function calculateLiveDuration(now: number, start: Date | null, end: Date | null): number | null {
  if (!start) return null;
  const endTime = end ? end.getTime() : now;
  const duration = Math.floor((endTime - start.getTime()) / 1000);
  // Never return negative durations
  return Math.max(0, duration);
}
