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
 * Timeline State Hook
 *
 * Unified state management for timeline component.
 * Replaces multiple pending state variables with single source of truth.
 *
 * ## State Structure
 *
 * - **display**: What's visible on screen (includes padding)
 * - **effective**: Actual query bounds (what logs to fetch)
 * - **bounds**: Entity boundaries (workflow/task start/end times)
 * - **pending**: Temporary changes before Apply button
 *
 * ## Derived Values
 *
 * - currentDisplay: display + pending (what user sees right now)
 * - currentEffective: effective + pending (what logs would be fetched)
 *
 * All Date objects are immutable - updates create new Date instances.
 */

import { useState, useMemo } from "react";
import type { HistogramBucket } from "@/lib/api/log-adapter";
import { calculateDisplayRangeWithPadding } from "./timeline-utils";

// =============================================================================
// Constants
// =============================================================================

/** Padding ratio for display range (7.5% on each side) */
const DISPLAY_PADDING_RATIO = 0.075;

/** Minimum padding in milliseconds (30 seconds) */
const MIN_PADDING_MS = 30_000;

/** Default fallback duration when no data (1 hour in milliseconds) */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

// =============================================================================
// Types
// =============================================================================

/**
 * Timeline state structure.
 */
export interface TimelineState {
  /** Display range (what's visible on screen with padding) */
  display: {
    start: Date;
    end: Date;
  };

  /** Effective range (actual query bounds) */
  effective: {
    start: Date | undefined;
    end: Date | undefined;
  };

  /** Entity boundaries (workflow/task/group start/end times) */
  bounds: {
    start: Date | undefined;
    end: Date | undefined;
  };

  /** Pending changes before Apply */
  pending: {
    displayStart: Date | undefined;
    displayEnd: Date | undefined;
    effectiveStart: Date | undefined;
    effectiveEnd: Date | undefined;
  } | null;
}

/**
 * Props for initializing timeline state.
 */
export interface UseTimelineStateProps {
  /** Effective start time (query bound) */
  startTime?: Date;
  /** Effective end time (query bound) */
  endTime?: Date;
  /** Display range start (with padding) */
  displayStart?: Date;
  /** Display range end (with padding) */
  displayEnd?: Date;
  /** Entity start time (workflow start) */
  entityStartTime?: Date;
  /** Entity end time (workflow end) */
  entityEndTime?: Date;
  /** Histogram buckets for deriving ranges */
  buckets: HistogramBucket[];
  /** Synchronized NOW timestamp (for running entities) */
  now?: number;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Derive initial state from props.
 */
function deriveInitialState(props: UseTimelineStateProps): TimelineState {
  const { startTime, endTime, displayStart, displayEnd, entityStartTime, entityEndTime, buckets, now } = props;

  // Derive display range with fallbacks
  const derivedDisplayStart =
    displayStart ??
    buckets[0]?.timestamp ??
    entityStartTime ??
    new Date(now ? now - DEFAULT_DURATION_MS : Date.now() - DEFAULT_DURATION_MS);

  const derivedDisplayEnd =
    displayEnd ?? buckets[buckets.length - 1]?.timestamp ?? entityEndTime ?? new Date(now ?? Date.now());

  return {
    display: {
      start: derivedDisplayStart,
      end: derivedDisplayEnd,
    },
    effective: {
      start: startTime,
      end: endTime,
    },
    bounds: {
      start: entityStartTime,
      end: entityEndTime,
    },
    pending: null,
  };
}

/**
 * Hook for managing timeline state.
 *
 * Provides unified state management and derived values.
 *
 * @param props - Initial state props
 * @returns State, derived values, and actions
 */
export function useTimelineState(props: UseTimelineStateProps) {
  // Single state object
  const [state, setState] = useState<TimelineState>(() => deriveInitialState(props));

  // Memoized derived values (current = committed + pending)
  const currentDisplay = useMemo(
    () => ({
      start: state.pending?.displayStart ?? state.display.start,
      end: state.pending?.displayEnd ?? state.display.end,
    }),
    [state.pending?.displayStart, state.pending?.displayEnd, state.display.start, state.display.end],
  );

  const currentEffective = useMemo(
    () => ({
      start: state.pending?.effectiveStart ?? state.effective.start ?? state.bounds.start,
      end: state.pending?.effectiveEnd ?? state.effective.end ?? state.bounds.end,
    }),
    [
      state.pending?.effectiveStart,
      state.pending?.effectiveEnd,
      state.effective.start,
      state.effective.end,
      state.bounds.start,
      state.bounds.end,
    ],
  );

  // Calculate dragger position as percentage (0-1)
  const currentStartPercent = useMemo(() => {
    const displayRangeMs = currentDisplay.end.getTime() - currentDisplay.start.getTime();
    if (displayRangeMs <= 0) return undefined;

    const effectiveStart = currentEffective.start;
    if (!effectiveStart) return undefined;

    return (effectiveStart.getTime() - currentDisplay.start.getTime()) / displayRangeMs;
  }, [currentDisplay.start, currentDisplay.end, currentEffective.start]);

  // Check if there are pending changes
  const hasPendingChanges = state.pending !== null;

  // Actions (memoized to prevent unnecessary re-renders)
  const actions = useMemo(
    () => ({
      /**
       * Set pending display range (pan/zoom operations).
       * Freezes effective times at current values.
       */
      setPendingDisplay: (start: Date, end: Date) => {
        setState((s) => ({
          ...s,
          pending: {
            displayStart: start,
            displayEnd: end,
            // Freeze effective times at current values (or committed if no pending)
            effectiveStart: s.pending?.effectiveStart ?? s.effective.start,
            effectiveEnd: s.pending?.effectiveEnd ?? s.effective.end,
          },
        }));
      },

      /**
       * Set pending effective range (dragger operations).
       * Auto-adjusts display range to keep draggers visible.
       */
      setPendingEffective: (start: Date | undefined, end: Date | undefined) => {
        setState((s) => {
          // Calculate display range with padding around new effective range
          const { displayStart: newDisplayStart, displayEnd: newDisplayEnd } = calculateDisplayRangeWithPadding(
            start,
            end,
            s.bounds.start ?? new Date(Date.now() - DEFAULT_DURATION_MS),
            s.bounds.end ?? new Date(Date.now()),
            DISPLAY_PADDING_RATIO,
            MIN_PADDING_MS,
          );

          return {
            ...s,
            pending: {
              effectiveStart: start,
              effectiveEnd: end,
              displayStart: newDisplayStart,
              displayEnd: newDisplayEnd,
            },
          };
        });
      },

      /**
       * Commit pending changes to committed state.
       * Clears pending state.
       */
      commitPending: () => {
        setState((s) => {
          if (!s.pending) return s;
          return {
            ...s,
            effective: {
              start: s.pending.effectiveStart ?? s.effective.start,
              end: s.pending.effectiveEnd ?? s.effective.end,
            },
            display: {
              start: s.pending.displayStart ?? s.display.start,
              end: s.pending.displayEnd ?? s.display.end,
            },
            pending: null,
          };
        });
      },

      /**
       * Cancel pending changes.
       * Reverts to committed state.
       */
      cancelPending: () => {
        setState((s) => ({ ...s, pending: null }));
      },
    }),
    [], // Actions never change (use functional updates)
  );

  return {
    state,
    currentDisplay,
    currentEffective,
    currentStartPercent,
    hasPendingChanges,
    actions,
  };
}
