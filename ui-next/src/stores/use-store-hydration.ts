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
 * Hydration utilities for Zustand stores with persistence.
 *
 * These utilities help prevent hydration mismatches in Next.js when using
 * Zustand stores with localStorage persistence. The pattern ensures that
 * server-rendered content matches the initial client render before the
 * store hydrates from localStorage.
 *
 * Best Practices (from https://tkdodo.eu/blog/working-with-zustand):
 * - Use atomic selectors to minimize re-renders
 * - Use useShallow when selecting objects/arrays
 * - Handle hydration to prevent SSR/client mismatches
 *
 * @see https://zustand.docs.pmnd.rs/guides/nextjs
 * @see https://tkdodo.eu/blog/working-with-zustand
 */

import { useSyncExternalStore } from "react";

// =============================================================================
// Hydration Hook
// =============================================================================

/**
 * Returns true only after the component has hydrated on the client.
 *
 * Use this to conditionally render content that depends on hydrated store state,
 * preventing hydration mismatches between server and client renders.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isHydrated = useIsHydrated();
 *   const savedValue = useMyStore((s) => s.savedValue);
 *
 *   // Show default until hydrated, then show persisted value
 *   return <div>{isHydrated ? savedValue : "Loading..."}</div>;
 * }
 * ```
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    // Subscribe - no-op since this never changes after initial mount
    () => () => {},
    // Client value - always true after hydration
    () => true,
    // Server value - always false during SSR
    () => false,
  );
}

// =============================================================================
// Hydration-Safe Value Hook
// =============================================================================

/**
 * Returns a hydration-safe value from a Zustand store.
 *
 * During SSR and initial hydration, returns the fallback value.
 * After hydration, returns the actual store value.
 *
 * This prevents hydration mismatches when the store value differs
 * between server (default) and client (persisted from localStorage).
 *
 * @param value - The value from the Zustand store
 * @param fallback - The fallback value to use during SSR/hydration
 * @returns The fallback during SSR, the actual value after hydration
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const rawCompactMode = useMyStore((s) => s.compactMode);
 *   const compactMode = useHydratedValue(rawCompactMode, false);
 *   // During SSR: false (matches server render)
 *   // After hydration: actual localStorage value
 * }
 * ```
 */
export function useHydratedValue<T>(value: T, fallback: T): T {
  const isHydrated = useIsHydrated();
  return isHydrated ? value : fallback;
}

// =============================================================================
// Type-Safe Store Subscription
// =============================================================================

/**
 * Type helper for stores with persist middleware.
 *
 * The persist middleware adds a `.persist` property with hydration methods.
 * This type extracts the store state type for creating typed selectors.
 */
export type StoreWithPersist<T> = {
  getState: () => T;
  subscribe: (listener: (state: T, prevState: T) => void) => () => void;
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (fn: (state: T) => void) => () => void;
    rehydrate: () => Promise<void>;
  };
};

/**
 * Hook to track whether a persisted store has finished hydrating from localStorage.
 *
 * This is useful when you need to wait for the store to be fully hydrated
 * before performing certain operations.
 *
 * @param store - A Zustand store with persist middleware
 * @returns true once the store has hydrated from localStorage
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const store = useMyStore;
 *   const hasHydrated = useStoreHydrated(store);
 *
 *   if (!hasHydrated) {
 *     return <Skeleton />;
 *   }
 *
 *   return <ActualContent />;
 * }
 * ```
 */
export function useStoreHydrated<T>(store: StoreWithPersist<T>): boolean {
  return useSyncExternalStore(
    // Subscribe to hydration completion
    (onStoreChange) => store.persist.onFinishHydration(onStoreChange),
    // Get current hydration state on client
    () => store.persist.hasHydrated(),
    // Always false on server
    () => false,
  );
}
