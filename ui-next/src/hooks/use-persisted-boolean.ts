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
 * Hook for boolean state that persists to localStorage.
 *
 * This is the ONLY place localStorage read/write should happen for
 * simple boolean user preferences. For complex typed settings, use
 * domain-specific hooks (e.g., usePersistedSettings in workflow-explorer).
 *
 * @example
 * ```tsx
 * const [collapsed, setCollapsed] = usePersistedBoolean("sidebar-collapsed", false);
 * ```
 */

import { useState, useCallback } from "react";

/**
 * React hook for boolean state persisted to localStorage.
 *
 * - SSR-safe: Returns defaultValue during server render
 * - Simple API: Just like useState but persisted
 * - Prefixed keys: All keys are prefixed with "osmo-" to avoid collisions
 *
 * @param key - localStorage key (will be prefixed with "osmo-")
 * @param defaultValue - Default value if nothing stored
 * @returns Tuple of [value, setValue] like useState
 */
export function usePersistedBoolean(key: string, defaultValue: boolean): [boolean, (value: boolean) => void] {
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
