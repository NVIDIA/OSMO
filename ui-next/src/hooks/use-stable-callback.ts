/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * useStableCallback - Returns a stable callback reference that always calls the latest version.
 *
 * This hook solves the common React problem of unstable callback references causing:
 * - Unnecessary re-renders in memoized components
 * - Infinite loops when passed to third-party libraries (TanStack, dnd-kit, etc.)
 * - Stale closure issues
 *
 * @example
 * ```tsx
 * // Instead of this (unstable - new function on each render):
 * const handleChange = useCallback(
 *   (value) => onChange(value, items),
 *   [onChange, items],  // Changes frequently!
 * );
 *
 * // Use this (stable reference):
 * const handleChange = useStableCallback((value) => onChange(value, items));
 * ```
 *
 * @see /src/lib/docs/CALLBACK_STABILITY.md for full documentation
 */

import { useCallback, useLayoutEffect, useRef } from "react";

type AnyFunction = (...args: any[]) => any;

/**
 * Returns a stable callback reference that always invokes the latest version of the callback.
 *
 * The returned function maintains a stable reference across renders, while always
 * calling the most recent version of the callback. This is useful when:
 *
 * 1. Passing callbacks to third-party libraries that trigger updates on option changes
 * 2. Callbacks that depend on frequently-changing data
 * 3. Event handlers that need access to current state without causing re-renders
 *
 * @param callback - The callback function (can change between renders)
 * @returns A stable function reference that invokes the latest callback
 */
export function useStableCallback<T extends AnyFunction>(callback: T | undefined): T {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  return useCallback(
    ((...args: Parameters<T>) => callbackRef.current?.(...args)) as T,
    [],
  );
}

/**
 * useStableValue - Returns a ref that always contains the latest value.
 *
 * Useful when you need to access a frequently-changing value inside a stable callback
 * without adding it to the callback's dependencies.
 *
 * @example
 * ```tsx
 * const itemsRef = useStableValue(items);
 *
 * const getItem = useCallback(
 *   (index) => itemsRef.current[index],
 *   [],  // Stable! No items dependency needed
 * );
 * ```
 *
 * @param value - The value to track
 * @returns A ref object with .current always set to the latest value
 */
export function useStableValue<T>(value: T): React.RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
