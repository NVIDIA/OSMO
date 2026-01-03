/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Hook for state that persists to localStorage.
 *
 * This is the ONLY place localStorage read/write should happen for
 * user preference state. All other localStorage access should go
 * through domain-specific modules (e.g., token-storage.ts for auth).
 *
 * @example
 * ```tsx
 * const [collapsed, setCollapsed] = usePersistedState("sidebar-collapsed", false);
 * ```
 */

import { useState, useCallback } from "react";

/**
 * React hook for boolean state persisted to localStorage.
 *
 * - SSR-safe: Returns defaultValue during server render
 * - Single callsite: All localStorage access for this key goes through here
 *
 * @param key - localStorage key (will be prefixed with "osmo-")
 * @param defaultValue - Default value if nothing stored
 * @returns Tuple of [value, setValue] like useState
 */
export function usePersistedState(key: string, defaultValue: boolean): [boolean, (value: boolean) => void] {
  const storageKey = `osmo-${key}`;

  // Lazy initializer reads from localStorage (client-side only)
  const [value, setValueState] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultValue;

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === null) return defaultValue;
      return stored === "true";
    } catch {
      return defaultValue;
    }
  });

  const setValue = useCallback(
    (newValue: boolean) => {
      setValueState(newValue);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(storageKey, String(newValue));
        } catch {
          // Ignore storage errors (quota exceeded, private browsing, etc.)
        }
      }
    },
    [storageKey],
  );

  return [value, setValue];
}
