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
 * Shared hook for resource display mode preference.
 *
 * Controls whether capacity values show "free" (available) or "used" (consumed).
 * Persisted to localStorage so the preference survives page refreshes.
 *
 * Used by:
 * - usePoolDetail (pool detail page)
 * - useResources (all resources page)
 */

import { useState, useCallback } from "react";
import { StorageKeys } from "@/lib/constants/storage";
import type { ResourceDisplayMode } from "./types";

export interface UseDisplayModeReturn {
  /** Current display mode: "free" or "used" */
  displayMode: ResourceDisplayMode;
  /** Update display mode (persists to localStorage) */
  setDisplayMode: (mode: ResourceDisplayMode) => void;
}

/**
 * Hook for managing resource display mode preference.
 *
 * @example
 * ```tsx
 * const { displayMode, setDisplayMode } = useDisplayMode();
 *
 * return (
 *   <button onClick={() => setDisplayMode(displayMode === "free" ? "used" : "free")}>
 *     Show: {displayMode === "free" ? "Available" : "Used"}
 *   </button>
 * );
 * ```
 */
export function useDisplayMode(): UseDisplayModeReturn {
  // Lazy initializer reads from localStorage (client-side only)
  const [displayMode, setDisplayModeState] = useState<ResourceDisplayMode>(() => {
    if (typeof window === "undefined") return "free";

    const stored = localStorage.getItem(StorageKeys.RESOURCE_DISPLAY_MODE);
    if (stored === "free" || stored === "used") {
      return stored;
    }
    return "free";
  });

  const setDisplayMode = useCallback((mode: ResourceDisplayMode) => {
    setDisplayModeState(mode);
    localStorage.setItem(StorageKeys.RESOURCE_DISPLAY_MODE, mode);
  }, []);

  return { displayMode, setDisplayMode };
}
