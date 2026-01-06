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

import { useCallback, useRef } from "react";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";

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
 * @param callback - The callback function (must be defined)
 * @returns A stable function reference that invokes the latest callback
 *
 * @example
 * ```tsx
 * const handleClick = useStableCallback((id: string, count: number) => {
 *   console.log(id, count);
 * });
 * // handleClick is typed as (id: string, count: number) => void
 * ```
 */
export function useStableCallback<TReturn>(callback: () => TReturn): () => TReturn;
export function useStableCallback<TArg1, TReturn>(callback: (arg1: TArg1) => TReturn): (arg1: TArg1) => TReturn;
export function useStableCallback<TArg1, TArg2, TReturn>(
  callback: (arg1: TArg1, arg2: TArg2) => TReturn,
): (arg1: TArg1, arg2: TArg2) => TReturn;
export function useStableCallback<TArg1, TArg2, TArg3, TReturn>(
  callback: (arg1: TArg1, arg2: TArg2, arg3: TArg3) => TReturn,
): (arg1: TArg1, arg2: TArg2, arg3: TArg3) => TReturn;
export function useStableCallback<TArg1, TArg2, TArg3, TArg4, TReturn>(
  callback: (arg1: TArg1, arg2: TArg2, arg3: TArg3, arg4: TArg4) => TReturn,
): (arg1: TArg1, arg2: TArg2, arg3: TArg3, arg4: TArg4) => TReturn;
export function useStableCallback<TArg1, TArg2, TArg3, TArg4, TArg5, TReturn>(
  callback: (arg1: TArg1, arg2: TArg2, arg3: TArg3, arg4: TArg4, arg5: TArg5) => TReturn,
): (arg1: TArg1, arg2: TArg2, arg3: TArg3, arg4: TArg4, arg5: TArg5) => TReturn;
export function useStableCallback<TArgs extends [], TReturn>(
  callback: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  const callbackRef = useRef(callback);
  useIsomorphicLayoutEffect(() => {
    callbackRef.current = callback;
  });

  return useCallback(function stableCallback(...args: TArgs): TReturn {
    return callbackRef.current(...args);
  }, []);
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
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
