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

import { useCallback, useEffect, useRef } from "react";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";

interface UseRafCallbackOptions {
  /** Use throttle mode: skip calls while RAF is pending (process first value) */
  throttle?: boolean;
}

/**
 * Returns a RAF-throttled version of a callback for 60fps performance.
 *
 * By default uses "debounce" behavior: each call cancels the previous pending
 * RAF and schedules a new one (processes the LAST value).
 *
 * With `throttle: true`, uses "throttle" behavior: skips calls while a RAF is
 * pending (processes the FIRST value, ignores intermediates).
 *
 * Automatically cleans up pending RAF on unmount.
 *
 * @example Debounce (default) - process last value
 * ```tsx
 * const [scheduleUpdate, cancelUpdate] = useRafCallback((sizing: ColumnSizingState) => {
 *   for (const [colId, width] of Object.entries(sizing)) {
 *     table.style.setProperty(`--col-${colId}`, `${width}px`);
 *   }
 * });
 *
 * // In resize handler - only last value is processed
 * scheduleUpdate(newSizing);
 * ```
 *
 * @example Throttle - process first value, skip intermediates
 * ```tsx
 * const [scheduleUpdate] = useRafCallback(
 *   (pct: number) => setPanelPct(pct),
 *   { throttle: true }
 * );
 *
 * // In mousemove - first value processed, intermediates dropped
 * scheduleUpdate(newPct);
 * ```
 *
 * @example Void callback (no value needed)
 * ```tsx
 * const [scheduleRecalc] = useRafCallback(() => {
 *   setVisibleCount(calculateVisibleCount());
 * });
 *
 * // Trigger recalculation
 * scheduleRecalc();
 * ```
 */
export function useRafCallback<T>(
  callback: (value: T) => void,
  options?: UseRafCallbackOptions,
): [(value: T) => void, () => void] {
  const rafIdRef = useRef<number | null>(null);
  // Store pending value in a wrapper to distinguish "no value" from "value is null/undefined"
  const pendingRef = useRef<{ value: T } | null>(null);
  const callbackRef = useRef(callback);
  const throttle = options?.throttle ?? false;

  // Keep callback ref fresh (must use effect, not during render)
  useIsomorphicLayoutEffect(() => {
    callbackRef.current = callback;
  });

  const cancel = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const schedule = useCallback(
    (value: T) => {
      if (throttle) {
        // Throttle: skip if already pending, keeping first value
        if (rafIdRef.current !== null) return;
        pendingRef.current = { value };
      } else {
        // Debounce: cancel previous RAF, use latest value
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        pendingRef.current = { value };
      }

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending !== null) {
          callbackRef.current(pending.value);
        }
      });
    },
    [throttle],
  );

  // Cleanup on unmount
  useEffect(() => cancel, [cancel]);

  return [schedule, cancel];
}
