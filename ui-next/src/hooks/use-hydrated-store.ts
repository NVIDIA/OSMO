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
 * Hydration-Safe Store Hook
 *
 * Problem:
 * Zustand stores with localStorage persistence cause hydration mismatches because:
 * 1. Server renders with initial state (no localStorage)
 * 2. Client hydrates but Zustand immediately reads localStorage
 * 3. React sees different values → hydration error
 *
 * Solution:
 * This hook uses useSyncExternalStore to ensure hydration-safe behavior:
 * 1. Server snapshot returns initial state
 * 2. Client snapshot returns initial state during hydration
 * 3. After hydration, client switches to actual store value
 *
 * Usage:
 * ```tsx
 * // Instead of:
 * const displayMode = useSharedPreferences((s) => s.displayMode);
 *
 * // Use:
 * const displayMode = useHydratedStore(
 *   useSharedPreferences,
 *   (s) => s.displayMode,
 *   sharedPreferencesInitialState.displayMode
 * );
 * ```
 *
 * This pattern should be used for any Zustand store value that:
 * 1. Is persisted to localStorage
 * 2. Is used in the initial render of a component
 * 3. Could affect the rendered output (not just side effects)
 */

import { useSyncExternalStore } from "react";

// Track if we're past initial hydration globally
let isHydrated = false;

// Subscribers waiting for hydration
const hydrationListeners = new Set<() => void>();

/**
 * Subscribe to hydration state changes.
 * Used internally by useSyncExternalStore.
 */
function subscribeToHydration(callback: () => void): () => void {
  hydrationListeners.add(callback);
  return () => hydrationListeners.delete(callback);
}

/**
 * Get current hydration state for client.
 */
function getHydrationSnapshot(): boolean {
  return isHydrated;
}

/**
 * Get hydration state for server - always false.
 */
function getServerHydrationSnapshot(): boolean {
  return false;
}

// Mark as hydrated after first client render
if (typeof window !== "undefined") {
  // Use microtask to ensure this runs after React's initial hydration
  queueMicrotask(() => {
    isHydrated = true;
    hydrationListeners.forEach((listener) => listener());
  });
}

/**
 * Hook that returns true only after hydration is complete.
 * This is more reliable than useMounted for store values because
 * it uses useSyncExternalStore's hydration-safe semantics.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribeToHydration, getHydrationSnapshot, getServerHydrationSnapshot);
}

/**
 * Hydration-safe hook for accessing Zustand store values.
 *
 * Returns the initial state during SSR and first client render (hydration),
 * then switches to the actual store value after hydration completes.
 *
 * @param useStore - The Zustand store hook (e.g., useSharedPreferences)
 * @param selector - Selector function to pick value from store
 * @param initialValue - Initial value that matches what server renders
 *
 * @example
 * ```tsx
 * const displayMode = useHydratedStore(
 *   useSharedPreferences,
 *   (s) => s.displayMode,
 *   sharedPreferencesInitialState.displayMode
 * );
 * ```
 */
export function useHydratedStore<TStore, TValue>(
  useStore: (selector: (state: TStore) => TValue) => TValue,
  selector: (state: TStore) => TValue,
  initialValue: TValue,
): TValue {
  const isHydrated = useIsHydrated();
  const storeValue = useStore(selector);

  // Return initial value during SSR and hydration, actual value after
  return isHydrated ? storeValue : initialValue;
}

/**
 * Creates a hydration-safe wrapper around a Zustand selector.
 *
 * This is useful when you want to create a reusable selector that's
 * always hydration-safe without repeating the pattern.
 *
 * @example
 * ```tsx
 * // In your store file:
 * export const useDisplayMode = createHydratedSelector(
 *   useSharedPreferences,
 *   (s) => s.displayMode,
 *   initialState.displayMode
 * );
 *
 * // In components:
 * const displayMode = useDisplayMode();
 * ```
 */
export function createHydratedSelector<TStore, TValue>(
  useStore: (selector: (state: TStore) => TValue) => TValue,
  selector: (state: TStore) => TValue,
  initialValue: TValue,
): () => TValue {
  return function useHydratedSelector(): TValue {
    return useHydratedStore(useStore, selector, initialValue);
  };
}
