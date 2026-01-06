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
 * useRafCssVar - RAF-Throttled CSS Variable Updates
 *
 * A specialized hook for 60fps updates of CSS custom properties.
 * Perfect for resizable panels, columns, sliders, and other draggable elements.
 *
 * ## Why CSS Variables?
 * CSS variables are:
 * - Inherited down the DOM tree (one update affects many elements)
 * - GPU-accelerated when used with transforms
 * - Easy to use in both JS and CSS
 * - Inspectable in DevTools
 *
 * ## Usage
 *
 * ```tsx
 * const { value, setValue, startDeferred, endDeferred } = useRafCssVar({
 *   name: '--panel-width',
 *   initialValue: 300,
 *   unit: 'px',
 *   min: 200,
 *   max: 600,
 *   targetRef: panelRef,
 *   containerRef: containerRef,
 *   deferredClassName: 'is-resizing',
 *   onPersist: (val) => saveToLocalStorage(val),
 * });
 *
 * // In resize handler:
 * const onResizeStart = () => startDeferred();
 * const onResize = (e) => setValue(e.clientX);
 * const onResizeEnd = () => endDeferred();
 * ```
 *
 * ```css
 * .panel {
 *   width: var(--panel-width, 300px);
 * }
 * ```
 */

import { useCallback, useRef, useEffect, useState } from "react";
import { useStableCallback } from "./use-stable-callback";

// =============================================================================
// Types
// =============================================================================

export interface UseRafCssVarOptions {
  /** CSS variable name (e.g., '--panel-width') */
  name: string;

  /** Initial value (number, unit is applied separately) */
  initialValue: number;

  /** Unit to append (e.g., 'px', 'rem', '%') @default 'px' */
  unit?: string;

  /** Minimum value (clamped during updates) */
  min?: number;

  /** Maximum value (clamped during updates) */
  max?: number;

  /**
   * Element to set the CSS variable on.
   * If not provided, uses document.documentElement (global scope).
   */
  targetRef?: React.RefObject<HTMLElement | null>;

  /**
   * Container to apply deferredClassName to during interaction.
   * Enables CSS-based performance optimizations.
   */
  containerRef?: React.RefObject<HTMLElement | null>;

  /**
   * CSS class to add during deferred mode.
   * @default undefined
   */
  deferredClassName?: string;

  /**
   * Called when interaction ends, for persistence.
   */
  onPersist?: (value: number) => void;
}

export interface UseRafCssVarResult {
  /** Current value */
  value: number;

  /** Set value (clamped to min/max, applies unit) */
  setValue: (value: number) => void;

  /** Start deferred mode (for drag start) */
  startDeferred: () => void;

  /** End deferred mode (syncs and persists) */
  endDeferred: () => void;

  /** Whether currently in deferred mode */
  isDeferred: boolean;

  /** Reset to initial value */
  reset: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useRafCssVar({
  name,
  initialValue,
  unit = "px",
  min = -Infinity,
  max = Infinity,
  targetRef,
  containerRef,
  deferredClassName,
  onPersist,
}: UseRafCssVarOptions): UseRafCssVarResult {
  // State
  const [value, setValueState] = useState(initialValue);
  const [isDeferred, setIsDeferred] = useState(false);

  // Refs
  const isDeferredRef = useRef(false);
  const pendingValueRef = useRef(initialValue);
  const rafIdRef = useRef<number | null>(null);

  // Stable callbacks
  const stableOnPersist = useStableCallback(onPersist ?? (() => {}));

  // =========================================================================
  // Apply CSS variable to DOM
  // =========================================================================
  const applyCssVar = useCallback(
    (val: number) => {
      const target = targetRef?.current ?? document.documentElement;
      target.style.setProperty(name, `${val}${unit}`);
    },
    [name, unit, targetRef],
  );

  // =========================================================================
  // Clamp value to bounds
  // =========================================================================
  const clamp = useCallback(
    (val: number) => Math.min(Math.max(val, min), max),
    [min, max],
  );

  // =========================================================================
  // Set value (with RAF throttling in deferred mode)
  // =========================================================================
  const setValue = useCallback(
    (newValue: number) => {
      const clamped = clamp(newValue);
      pendingValueRef.current = clamped;

      if (isDeferredRef.current) {
        // Deferred: RAF-throttled
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
        }
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          applyCssVar(pendingValueRef.current);
        });
      } else {
        // Normal: immediate update
        setValueState(clamped);
        applyCssVar(clamped);
      }
    },
    [clamp, applyCssVar],
  );

  // =========================================================================
  // Start deferred mode
  // =========================================================================
  const startDeferred = useCallback(() => {
    if (isDeferredRef.current) return;

    isDeferredRef.current = true;
    pendingValueRef.current = value;
    setIsDeferred(true);

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

    if (deferredClassName && containerRef?.current) {
      containerRef.current.classList.remove(deferredClassName);
    }

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const finalValue = pendingValueRef.current;
    setValueState(finalValue);
    stableOnPersist(finalValue);
  }, [deferredClassName, containerRef, stableOnPersist]);

  // =========================================================================
  // Reset to initial
  // =========================================================================
  const reset = useCallback(() => {
    setValue(initialValue);
    if (!isDeferredRef.current) {
      stableOnPersist(initialValue);
    }
  }, [initialValue, setValue, stableOnPersist]);

  // =========================================================================
  // Initialize CSS variable on mount
  // =========================================================================
  useEffect(() => {
    applyCssVar(value);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- Only on mount

  // =========================================================================
  // Cleanup
  // =========================================================================
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (deferredClassName && containerRef?.current) {
        containerRef.current.classList.remove(deferredClassName);
      }
    };
  }, [deferredClassName, containerRef]);

  return {
    value,
    setValue,
    startDeferred,
    endDeferred,
    isDeferred,
    reset,
  };
}
