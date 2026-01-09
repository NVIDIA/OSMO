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
 * usePersistedSettings Hook
 *
 * A hook for persisting typed settings to localStorage with debounced writes.
 * Provides type-safe storage with automatic serialization/deserialization.
 *
 * For simple boolean preferences, use `usePersistedBoolean` from `@/hooks`.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PERSISTENCE } from "../constants";
import type { SortState, ColumnId } from "../types/table";

// ============================================================================
// Types
// ============================================================================

/** Settings that can be persisted for the workflow explorer */
export interface PersistedSettings {
  panelPct: number;
  visibleColumnIds: ColumnId[];
  columnOrder: ColumnId[];
  sort: SortState;
}

// ============================================================================
// Cache & Storage Management
// ============================================================================

let settingsCache: Partial<PersistedSettings> | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Load settings from localStorage with caching.
 */
function loadPersistedSettings(): Partial<PersistedSettings> {
  if (typeof window === "undefined") return {};
  if (settingsCache) return settingsCache;

  try {
    const stored = localStorage.getItem(PERSISTENCE.STORAGE_KEY);
    if (!stored) return {};
    settingsCache = JSON.parse(stored) as Partial<PersistedSettings>;
    return settingsCache;
  } catch {
    return {};
  }
}

/**
 * Save settings to localStorage with debouncing.
 */
function savePersistedSettings(settings: Partial<PersistedSettings>): void {
  if (typeof window === "undefined") return;

  if (saveTimeout) clearTimeout(saveTimeout);
  settingsCache = { ...settingsCache, ...settings };

  saveTimeout = setTimeout(() => {
    try {
      localStorage.setItem(PERSISTENCE.STORAGE_KEY, JSON.stringify(settingsCache));
    } catch {
      // Ignore storage errors (quota exceeded, private browsing, etc.)
    }
  }, PERSISTENCE.DEBOUNCE_MS);
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for persisting typed settings to localStorage.
 *
 * Features:
 * - Automatic serialization/deserialization
 * - Debounced writes to prevent performance issues
 * - In-memory cache for fast reads
 * - SSR-safe (no localStorage access during SSR)
 *
 * @param key - The key in the settings object
 * @param defaultValue - Default value if not found in storage
 * @returns Tuple of [value, setValue] similar to useState
 *
 * @example
 * ```tsx
 * const [panelWidth, setPanelWidth] = usePersistedSettings("panelPct", 50);
 * const [sort, setSort] = usePersistedSettings("sort", { column: null, direction: "asc" });
 * ```
 */
export function usePersistedSettings<K extends keyof PersistedSettings>(
  key: K,
  defaultValue: PersistedSettings[K],
): [
  PersistedSettings[K],
  (value: PersistedSettings[K] | ((prev: PersistedSettings[K]) => PersistedSettings[K])) => void,
] {
  const [value, setValue] = useState<PersistedSettings[K]>(() => {
    const persisted = loadPersistedSettings();
    return (persisted[key] as PersistedSettings[K]) ?? defaultValue;
  });

  // Track if this is the initial mount to prevent saving on first render
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    savePersistedSettings({ [key]: value } as Partial<PersistedSettings>);
  }, [key, value]);

  const setValueWrapper = useCallback(
    (newValue: PersistedSettings[K] | ((prev: PersistedSettings[K]) => PersistedSettings[K])) => {
      setValue((prev) => {
        if (typeof newValue === "function") {
          return (newValue as (prev: PersistedSettings[K]) => PersistedSettings[K])(prev);
        }
        return newValue;
      });
    },
    [],
  );

  return [value, setValueWrapper];
}

/**
 * Clear all persisted settings.
 * Useful for testing or resetting user preferences.
 */
export function clearPersistedSettings(): void {
  if (typeof window === "undefined") return;
  settingsCache = null;
  try {
    localStorage.removeItem(PERSISTENCE.STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}
