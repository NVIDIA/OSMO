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
 * ## State Architecture (Hybrid Controlled/Uncontrolled)
 *
 * This hook implements a hybrid pattern where:
 * - **Controlled from props**: `effective` range (filter times) and `display` range
 * - **Internal state only**: `pending` changes and `bounds`
 *
 * This ensures the timeline always reflects the parent's filter state (HIGH-1 fix)
 * while maintaining internal pending state for user interactions.
 *
 * ## State Structure
 *
 * - **display**: What's visible on screen (includes padding) - from props
 * - **effective**: Actual query bounds (what logs to fetch) - from props
 * - **bounds**: Entity boundaries (workflow/task start/end times) - internal
 * - **pending**: Temporary changes before Apply button - internal
 *
 * ## Derived Values
 *
 * - currentDisplay: display + pending (what user sees right now)
 * - currentEffective: effective + pending (what logs would be fetched)
 *
 * ## Time Semantics
 *
 * - filterStartTime/filterEndTime: USER INTENT (what to filter)
 * - entityStartTime/entityEndTime: REALITY (workflow lifecycle)
 * - now: REFERENCE (synchronized timestamp)
 *
 * All Date objects are immutable - updates create new Date instances.
 */

import { useState, useMemo, useRef, useEffect } from "react";
import type { HistogramBucket } from "@/lib/api/log-adapter/types";
import { calculateDisplayRangeWithPadding } from "../lib/timeline-utils";
import { DISPLAY_PADDING_RATIO, MIN_PADDING_MS, DEFAULT_DURATION_MS } from "../lib/timeline-constants";

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
 * Internal state - only pending and bounds (not controlled by props).
 */
interface InternalState {
  bounds: { start: Date | undefined; end: Date | undefined };
  pending: TimelineState["pending"];
}

/**
 * Props for initializing timeline state.
 */
export interface UseTimelineStateProps {
  /** USER INTENT: Filter start time (query bound) */
  filterStartTime?: Date;
  /** USER INTENT: Filter end time (query bound) */
  filterEndTime?: Date;
  /** Display range start (with padding) */
  displayStart?: Date;
  /** Display range end (with padding) */
  displayEnd?: Date;
  /** REALITY: Entity start time (workflow start) - GUARANTEED to exist */
  entityStartTime: Date;
  /** REALITY: Entity end time (workflow end) */
  entityEndTime?: Date;
  /** Histogram buckets for deriving ranges */
  buckets: HistogramBucket[];
  /** REFERENCE: Synchronized NOW timestamp from useTick() - REQUIRED for consistency */
  now: number;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Derive display range from props with fallbacks.
 */
function deriveDisplayRange(props: UseTimelineStateProps): { start: Date; end: Date } {
  const { displayStart, displayEnd, entityStartTime, entityEndTime, buckets, now } = props;

  // Derive display range with simplified fallbacks (entityStartTime is guaranteed)
  const start = displayStart ?? buckets[0]?.timestamp ?? entityStartTime;
  const end = displayEnd ?? buckets[buckets.length - 1]?.timestamp ?? entityEndTime ?? new Date(now);

  return { start, end };
}

/**
 * Hook for managing timeline state.
 *
 * Provides unified state management and derived values.
 *
 * ## Architecture Notes (HIGH-1 & HIGH-2 Fixes)
 *
 * - **HIGH-1**: `effective` and `display` ranges are derived from props during render,
 *   ensuring the timeline always reflects the parent's filter state without needing
 *   useEffect sync (which violates React Compiler rules).
 *
 * - **HIGH-2**: The `actions` object has a stable reference (empty dependency array)
 *   by using refs to access `now` and `effective` values inside event handlers.
 *
 * @param props - Initial state props
 * @returns State, derived values, and actions
 */
export function useTimelineState(props: UseTimelineStateProps) {
  // Extract props
  const { now, filterStartTime, filterEndTime, entityStartTime, entityEndTime } = props;

  // Derive display range from props (with fallbacks)
  const displayRange = useMemo(() => deriveDisplayRange(props), [props]);

  // Internal state: only pending and bounds (not controlled by props)
  const [internalState, setInternalState] = useState<InternalState>(() => ({
    bounds: { start: entityStartTime, end: entityEndTime },
    pending: null,
  }));

  // HIGH-1 FIX: Compose full state from props (controlled) + internal state (uncontrolled).
  // This ensures effective/display always reflect props without useEffect sync.
  const state: TimelineState = useMemo(
    () => ({
      display: displayRange,
      effective: {
        start: filterStartTime,
        end: filterEndTime,
      },
      bounds: internalState.bounds,
      pending: internalState.pending,
    }),
    [displayRange, filterStartTime, filterEndTime, internalState],
  );

  // HIGH-2 FIX: Use refs for values needed in actions to avoid dependency array changes.
  // Updated via useEffect to comply with React Compiler rules (no ref writes during render).
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);

  const effectiveRef = useRef({ start: filterStartTime, end: filterEndTime });
  useEffect(() => {
    effectiveRef.current = { start: filterStartTime, end: filterEndTime };
  }, [filterStartTime, filterEndTime]);

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
  // HIGH-2 FIX: Uses refs instead of props in dependency array for stable reference.
  // Actions are event handlers, so accessing ref.current is safe (not during render).
  const actions = useMemo(
    () => ({
      /**
       * Set pending display range (pan/zoom operations).
       * Freezes effective times at current values.
       */
      setPendingDisplay: (start: Date, end: Date) => {
        const currentEffective = effectiveRef.current;
        setInternalState((s) => ({
          ...s,
          pending: {
            displayStart: start,
            displayEnd: end,
            // Freeze effective times at current values (or committed if no pending)
            effectiveStart: s.pending?.effectiveStart ?? currentEffective.start,
            effectiveEnd: s.pending?.effectiveEnd ?? currentEffective.end,
          },
        }));
      },

      /**
       * Set pending effective range (dragger operations).
       * Auto-adjusts display range to keep draggers visible.
       */
      setPendingEffective: (start: Date | undefined, end: Date | undefined) => {
        setInternalState((s) => {
          // Calculate display range with padding around new effective range
          // Use synchronized NOW for fallback bounds (guaranteed to exist from props)
          const currentNow = nowRef.current;
          const { displayStart: newDisplayStart, displayEnd: newDisplayEnd } = calculateDisplayRangeWithPadding(
            start,
            end,
            s.bounds.start ?? new Date(currentNow - DEFAULT_DURATION_MS),
            s.bounds.end ?? new Date(currentNow),
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
       * NOTE: This only commits display changes internally. Effective range changes
       * should be communicated to the parent via onApply callback, as effective is controlled.
       */
      commitPending: () => {
        setInternalState((s) => {
          if (!s.pending) return s;
          return {
            ...s,
            pending: null,
          };
        });
      },

      /**
       * Cancel pending changes.
       * Reverts to committed state.
       */
      cancelPending: () => {
        setInternalState((s) => ({ ...s, pending: null }));
      },
    }),
    [], // Stable reference - refs accessed inside event handlers, not during render
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
