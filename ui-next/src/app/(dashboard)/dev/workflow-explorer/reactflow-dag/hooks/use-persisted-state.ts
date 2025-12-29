// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * usePersistedState Hook
 *
 * A hook for persisting state to localStorage with debounced writes.
 * Provides type-safe storage with automatic serialization/deserialization.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PERSISTENCE } from "../constants";

// ============================================================================
// Types
// ============================================================================

/** Settings that can be persisted */
export interface PersistedSettings {
  panelPct: number;
  visibleColumnIds: string[];
  columnOrder: string[];
  sort: {
    column: string | null;
    direction: "asc" | "desc";
  };
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
 * Hook for persisting state to localStorage.
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
 * const [panelWidth, setPanelWidth] = usePersistedState("panelPct", 50);
 * ```
 */
export function usePersistedState<K extends keyof PersistedSettings>(
  key: K,
  defaultValue: PersistedSettings[K],
): [PersistedSettings[K], (value: PersistedSettings[K] | ((prev: PersistedSettings[K]) => PersistedSettings[K])) => void] {
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
