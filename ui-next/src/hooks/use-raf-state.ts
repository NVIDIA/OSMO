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
 * useRafState - RAF-Throttled State for 60fps Interactions
 *
 * A performance-optimized state hook that provides buttery smooth updates
 * for continuous interactions like dragging, resizing, or scrubbing.
 *
 * ## The Problem
 * React state updates trigger re-renders. During continuous interactions
 * (mouse move, drag), this can cause:
 * - Jank from too many re-renders
 * - Dropped frames
 * - Input lag
 *
 * ## The Solution
 * This hook provides two modes:
 * 1. **Normal mode**: Updates go through React state (standard behavior)
 * 2. **Deferred mode**: Updates bypass React, apply directly to DOM via RAF
 *
 * During deferred mode:
 * - Updates are throttled to 60fps via requestAnimationFrame
 * - DOM is updated directly (no React re-renders)
 * - A CSS class is applied for performance hints
 * - When deferred mode ends, final state is synced to React
 *
 * ## Usage
 *
 * ```tsx
 * const {
 *   value,
 *   setValue,
 *   startDeferred,
 *   endDeferred,
 *   isDeferred,
 * } = useRafState({
 *   initialValue: 100,
 *   onDeferredUpdate: (val) => {
 *     // Direct DOM update during interaction
 *     element.style.width = `${val}px`;
 *   },
 *   containerRef: scrollContainerRef,
 *   deferredClassName: 'is-resizing',
 * });
 *
 * // In drag handler:
 * const onDragStart = () => startDeferred();
 * const onDrag = (newWidth) => setValue(newWidth);
 * const onDragEnd = () => endDeferred();
 * ```
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useStableCallback } from "./use-stable-callback";

// =============================================================================
// Types
// =============================================================================

export interface UseRafStateOptions<T> {
  /** Initial value */
  initialValue: T;

  /**
   * Called during deferred mode to apply value directly to DOM.
   * This runs inside requestAnimationFrame for 60fps updates.
   */
  onDeferredUpdate?: (value: T) => void;

  /**
   * Container element to apply deferredClassName to.
   * Enables CSS-based performance optimizations during interaction.
   */
  containerRef?: React.RefObject<HTMLElement | null>;

  /**
   * CSS class to add during deferred mode.
   * Use this to enable will-change, disable transitions, etc.
   * @default undefined (no class added)
   */
  deferredClassName?: string;

  /**
   * Called when deferred mode ends, after state is synced.
   * Useful for persistence or triggering side effects.
   */
  onDeferredEnd?: (value: T) => void;
}

export interface UseRafStateResult<T> {
  /** Current value (React state - may lag during deferred mode) */
  value: T;

  /**
   * Set value. Behavior depends on mode:
   * - Normal: Updates React state immediately
   * - Deferred: Stores pending value, updates DOM via RAF
   */
  setValue: (value: T | ((prev: T) => T)) => void;

  /** Start deferred mode (for beginning of drag/resize) */
  startDeferred: () => void;

  /** End deferred mode (syncs final value to React state) */
  endDeferred: () => void;

  /** Whether currently in deferred mode */
  isDeferred: boolean;

  /** Get the pending value (latest value, even during deferred mode) */
  getPendingValue: () => T;
}

// =============================================================================
// Hook
// =============================================================================

export function useRafState<T>({
  initialValue,
  onDeferredUpdate,
  containerRef,
  deferredClassName,
  onDeferredEnd,
}: UseRafStateOptions<T>): UseRafStateResult<T> {
  // React state (source of truth when not deferred)
  const [value, setValueState] = useState<T>(initialValue);

  // Refs for deferred mode
  const isDeferredRef = useRef(false);
  const pendingValueRef = useRef<T>(initialValue);
  const rafIdRef = useRef<number | null>(null);

  // Stable callbacks
  const stableOnDeferredUpdate = useStableCallback(onDeferredUpdate ?? (() => {}));
  const stableOnDeferredEnd = useStableCallback(onDeferredEnd ?? (() => {}));

  // Track deferred state for external consumers
  const [isDeferred, setIsDeferred] = useState(false);

  // =========================================================================
  // Start deferred mode
  // =========================================================================
  const startDeferred = useCallback(() => {
    if (isDeferredRef.current) return;

    isDeferredRef.current = true;
    pendingValueRef.current = value;
    setIsDeferred(true);

    // Apply performance class
    if (deferredClassName && containerRef?.current) {
      containerRef.current.classList.add(deferredClassName);
    }
  }, [value, deferredClassName, containerRef]);

  // =========================================================================
  // End deferred mode
  // =========================================================================
  const endDeferred = useCallback(() => {
    if (!isDeferredRef.current) return;

    isDeferredRef.current = false;
    setIsDeferred(false);

    // Remove performance class
    if (deferredClassName && containerRef?.current) {
      containerRef.current.classList.remove(deferredClassName);
    }

    // Cancel any pending RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Sync final value to React state
    const finalValue = pendingValueRef.current;
    setValueState(finalValue);

    // Notify listener
    stableOnDeferredEnd(finalValue);
  }, [deferredClassName, containerRef, stableOnDeferredEnd]);

  // =========================================================================
  // Set value (mode-aware)
  // =========================================================================
  const setValue = useCallback(
    (newValue: T | ((prev: T) => T)) => {
      // Calculate actual value
      const actualValue =
        typeof newValue === "function"
          ? (newValue as (prev: T) => T)(pendingValueRef.current)
          : newValue;

      // Always update pending ref
      pendingValueRef.current = actualValue;

      if (isDeferredRef.current) {
        // Deferred mode: RAF-throttled DOM update
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
        }

        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          stableOnDeferredUpdate(pendingValueRef.current);
        });
      } else {
        // Normal mode: update React state directly
        setValueState(actualValue);

        // Also call onDeferredUpdate for immediate DOM sync
        stableOnDeferredUpdate(actualValue);
      }
    },
    [stableOnDeferredUpdate],
  );

  // =========================================================================
  // Get pending value
  // =========================================================================
  const getPendingValue = useCallback(() => pendingValueRef.current, []);

  // =========================================================================
  // Cleanup
  // =========================================================================
  useEffect(() => {
    // Capture ref value at effect start for cleanup
    const container = containerRef?.current;

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (deferredClassName && container) {
        container.classList.remove(deferredClassName);
      }
    };
  }, [deferredClassName, containerRef]);

  return {
    value,
    setValue,
    startDeferred,
    endDeferred,
    isDeferred,
    getPendingValue,
  };
}
