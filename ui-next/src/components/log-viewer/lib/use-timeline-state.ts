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
 * Timeline State Management Hook
 *
 * Manages three time ranges for the interactive timeline histogram:
 * 1. Display range - What we show in the histogram (includes padding)
 * 2. Effective range - What data we fetch (queried logs)
 * 3. Pending range - Uncommitted dragger changes (for Apply/Cancel pattern)
 *
 * ## State Transitions
 *
 * Initial: effectiveStart=undefined, effectiveEnd=undefined
 *   ↓
 * User drags start dragger to 10:00
 *   → pendingStart=10:00, Apply/Cancel appear
 *   ↓
 * User clicks Apply
 *   → effectiveStart=10:00, pendingStart=undefined
 *   → Re-fetch logs, buttons disappear
 *
 * User clicks Cancel
 *   → pendingStart=undefined, buttons disappear
 *   → Draggers snap back to effectiveStart
 */

import { useState, useCallback, useMemo } from "react";

// =============================================================================
// Constants
// =============================================================================

/**
 * Padding ratio for display range (7.5% on each side).
 * This provides visual breathing room before/after log entries.
 */
const PADDING_RATIO = 0.075;

/**
 * Minimum range duration in milliseconds (1 minute).
 * Prevents users from creating too-narrow time ranges.
 */
const MIN_RANGE_MS = 60_000;

// =============================================================================
// Types
// =============================================================================

export interface TimelineState {
  /** Display range (with padding) - what we show in histogram */
  displayStart: Date;
  displayEnd: Date;

  /** Effective range (queried logs) - what data we fetch */
  effectiveStart: Date | undefined;
  effectiveEnd: Date | undefined;

  /** Pending range (uncommitted dragger changes) */
  pendingStart: Date | undefined;
  pendingEnd: Date | undefined;

  /** Whether there are pending changes */
  hasPendingChanges: boolean;

  /** Actions */
  setPendingStart: (date: Date | undefined) => void;
  setPendingEnd: (date: Date | undefined) => void;
  applyPending: () => void;
  cancelPending: () => void;

  /** Setters for effective range (used by parent for preset selection) */
  setEffectiveStart: (date: Date | undefined) => void;
  setEffectiveEnd: (date: Date | undefined) => void;
}

export interface UseTimelineStateOptions {
  /** Initial effective start time */
  initialStart?: Date;
  /** Initial effective end time */
  initialEnd?: Date;
  /** Log entries for deriving data boundaries */
  logEntries: Array<{ timestamp: Date }>;
  /** Callback when effective range changes (triggers data refetch) */
  onEffectiveRangeChange?: (start: Date | undefined, end: Date | undefined) => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing timeline histogram state.
 */
export function useTimelineState({
  initialStart,
  initialEnd,
  logEntries,
  onEffectiveRangeChange,
}: UseTimelineStateOptions): TimelineState {
  // Effective range state (committed, triggers data fetch)
  const [effectiveStart, setEffectiveStart] = useState<Date | undefined>(initialStart);
  const [effectiveEnd, setEffectiveEnd] = useState<Date | undefined>(initialEnd);

  // Pending range state (uncommitted, for Apply/Cancel pattern)
  const [pendingStart, setPendingStart] = useState<Date | undefined>(undefined);
  const [pendingEnd, setPendingEnd] = useState<Date | undefined>(undefined);

  // Compute display range with padding
  const { displayStart, displayEnd } = useMemo(() => {
    return computeDisplayRange(effectiveStart, effectiveEnd, logEntries);
  }, [effectiveStart, effectiveEnd, logEntries]);

  // Check if there are pending changes
  const hasPendingChanges = pendingStart !== undefined || pendingEnd !== undefined;

  // Apply pending changes
  const applyPending = useCallback(() => {
    const newStart = pendingStart ?? effectiveStart;
    const newEnd = pendingEnd ?? effectiveEnd;

    // Validate the range
    if (!isValidRange(newStart, newEnd)) {
      // Invalid range, cancel instead
      setPendingStart(undefined);
      setPendingEnd(undefined);
      return;
    }

    // Commit changes
    setEffectiveStart(newStart);
    setEffectiveEnd(newEnd);
    setPendingStart(undefined);
    setPendingEnd(undefined);

    // Notify parent
    onEffectiveRangeChange?.(newStart, newEnd);
  }, [pendingStart, pendingEnd, effectiveStart, effectiveEnd, onEffectiveRangeChange]);

  // Cancel pending changes
  const cancelPending = useCallback(() => {
    setPendingStart(undefined);
    setPendingEnd(undefined);
  }, []);

  return {
    displayStart,
    displayEnd,
    effectiveStart,
    effectiveEnd,
    pendingStart,
    pendingEnd,
    hasPendingChanges,
    setPendingStart,
    setPendingEnd,
    applyPending,
    cancelPending,
    setEffectiveStart,
    setEffectiveEnd,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Computes display range with padding around effective range.
 */
function computeDisplayRange(
  effectiveStart: Date | undefined,
  effectiveEnd: Date | undefined,
  logEntries: Array<{ timestamp: Date }>,
): { displayStart: Date; displayEnd: Date } {
  // Determine data boundaries
  const dataStart = effectiveStart ?? getFirstLogTime(logEntries);
  const dataEnd = effectiveEnd ?? new Date(); // NOW

  // Calculate padding
  const rangeMs = dataEnd.getTime() - dataStart.getTime();
  const paddingMs = Math.max(rangeMs * PADDING_RATIO, MIN_RANGE_MS * PADDING_RATIO);

  return {
    displayStart: new Date(dataStart.getTime() - paddingMs),
    displayEnd: new Date(dataEnd.getTime() + paddingMs),
  };
}

/**
 * Gets the timestamp of the first log entry.
 */
function getFirstLogTime(logEntries: Array<{ timestamp: Date }>): Date {
  if (logEntries.length === 0) {
    // Fallback: 1 hour ago
    return new Date(Date.now() - 60 * 60 * 1000);
  }
  return logEntries[0].timestamp;
}

/**
 * Validates a time range.
 */
function isValidRange(start: Date | undefined, end: Date | undefined): boolean {
  // Both undefined is valid (all time)
  if (start === undefined && end === undefined) return true;

  // Only one undefined is valid
  if (start === undefined || end === undefined) return true;

  // Both defined: start must be before end
  if (start >= end) return false;

  // Must have minimum range
  if (end.getTime() - start.getTime() < MIN_RANGE_MS) return false;

  // End must not be in the future (beyond NOW + 1 minute threshold)
  const now = new Date();
  if (end.getTime() > now.getTime() + 60_000) return false;

  return true;
}
