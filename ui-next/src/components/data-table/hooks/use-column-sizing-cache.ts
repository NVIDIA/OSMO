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
 * Column Sizing Cache Hook
 *
 * Precomputes derived values during idle time for O(1) lookups during user actions.
 *
 * ## What's Cached
 * - Total min/preferred widths (sum of all visible columns)
 * - Floor widths per column (mode-dependent: min or preferred)
 * - Natural ratio (for new column width calculation)
 *
 * ## Performance Strategy
 * - Use `requestIdleCallback` for background computation
 * - Invalidate on: column visibility change, preference change
 * - Expose sync accessor for critical paths
 */

import { useRef, useEffect, useCallback } from "react";
import { useStableValue } from "@/hooks";
import type { ColumnSizingCache, ColumnSizingPreferences, ColumnSizeConfig } from "../types";

// =============================================================================
// Types
// =============================================================================

export interface UseColumnSizingCacheOptions {
  /** Visible column IDs */
  columnIds: string[];
  /** Column size configurations */
  columnConfigs?: ColumnSizeConfig[];
  /** User sizing preferences */
  sizingPreferences?: ColumnSizingPreferences;
  /** Current rem-to-px ratio */
  remToPx?: number;
}

export interface UseColumnSizingCacheResult {
  /** Get the current cache (computed synchronously if stale) */
  getCache: () => ColumnSizingCache;
  /** Invalidate the cache (will recompute on next idle or access) */
  invalidate: () => void;
}

// =============================================================================
// Helpers
// =============================================================================

function computeCache(
  columnIds: string[],
  columnConfigs: ColumnSizeConfig[] | undefined,
  sizingPreferences: ColumnSizingPreferences | undefined,
  remToPx: number,
): ColumnSizingCache {
  const minWidths: Record<string, number> = {};
  const preferredWidths: Record<string, number> = {};
  const floors: Record<string, number> = {};
  const shares: Record<string, number> = {};
  const naturalColumnIds = new Set<string>();
  const overriddenColumnIds = new Set<string>();

  let totalMinWidth = 0;
  let totalPreferredWidth = 0;
  let totalFloorWidth = 0;
  let naturalPreferredSum = 0;
  let naturalActualSum = 0;

  // First pass: calculate min/preferred widths and categorize columns
  for (const colId of columnIds) {
    const config = columnConfigs?.find((c) => c.id === colId);
    const pref = sizingPreferences?.[colId];

    // Min width from config or default
    const minRem = config?.minWidthRem ?? 5;
    const minPx = minRem * remToPx;
    minWidths[colId] = minPx;
    totalMinWidth += minPx;

    // Preferred width from config or 1.5x min
    const prefRem = config?.preferredWidthRem ?? minRem * 1.5;
    const prefPx = prefRem * remToPx;
    preferredWidths[colId] = prefPx;
    totalPreferredWidth += prefPx;

    // Floor depends on mode
    if (pref) {
      overriddenColumnIds.add(colId);
      const floor = pref.mode === "no-truncate" ? Math.max(prefPx, minPx) : minPx;
      floors[colId] = floor;
      totalFloorWidth += floor;
    } else {
      naturalColumnIds.add(colId);
      floors[colId] = minPx;
      totalFloorWidth += minPx;
      naturalPreferredSum += prefPx;
      naturalActualSum += prefPx; // Natural columns use preferred width
    }
  }

  // Shares are calculated based on table width (deferred until sizing is known)
  // For now, use preferred widths as proxy
  const tableWidth = totalPreferredWidth || 1;
  for (const colId of columnIds) {
    shares[colId] = (preferredWidths[colId] ?? 0) / tableWidth;
  }

  // Natural ratio: how much natural columns are scaled
  const naturalRatio = naturalPreferredSum > 0 ? naturalActualSum / naturalPreferredSum : 1;

  return {
    totalMinWidth,
    totalPreferredWidth,
    floors,
    totalFloorWidth,
    shares,
    naturalColumnIds,
    overriddenColumnIds,
    naturalRatio,
  };
}

// =============================================================================
// Hook
// =============================================================================

export function useColumnSizingCache({
  columnIds,
  columnConfigs,
  sizingPreferences,
  remToPx = 16,
}: UseColumnSizingCacheOptions): UseColumnSizingCacheResult {
  const cacheRef = useRef<ColumnSizingCache | null>(null);
  const isStaleRef = useRef(true);
  const idleCallbackRef = useRef<number | null>(null);

  // Stable refs for inputs
  const columnIdsRef = useStableValue(columnIds);
  const columnConfigsRef = useStableValue(columnConfigs);
  const sizingPreferencesRef = useStableValue(sizingPreferences);
  const remToPxRef = useStableValue(remToPx);

  // Compute cache synchronously
  const computeSync = useCallback((): ColumnSizingCache => {
    const cache = computeCache(
      columnIdsRef.current,
      columnConfigsRef.current,
      sizingPreferencesRef.current,
      remToPxRef.current,
    );
    cacheRef.current = cache;
    isStaleRef.current = false;
    return cache;
  }, [columnIdsRef, columnConfigsRef, sizingPreferencesRef, remToPxRef]);

  // Get cache (compute if stale)
  const getCache = useCallback((): ColumnSizingCache => {
    if (isStaleRef.current || !cacheRef.current) {
      return computeSync();
    }
    return cacheRef.current;
  }, [computeSync]);

  // Invalidate cache
  const invalidate = useCallback(() => {
    isStaleRef.current = true;

    // Cancel any pending idle callback
    if (idleCallbackRef.current !== null) {
      if (typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(idleCallbackRef.current);
      }
      idleCallbackRef.current = null;
    }

    // Schedule idle recomputation
    if (typeof requestIdleCallback !== "undefined") {
      idleCallbackRef.current = requestIdleCallback(
        () => {
          if (isStaleRef.current) {
            computeSync();
          }
          idleCallbackRef.current = null;
        },
        { timeout: 500 },
      );
    }
  }, [computeSync]);

  // Invalidate when inputs change
  useEffect(() => {
    invalidate();
  }, [columnIds, columnConfigs, sizingPreferences, remToPx, invalidate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (idleCallbackRef.current !== null && typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(idleCallbackRef.current);
      }
    };
  }, []);

  return {
    getCache,
    invalidate,
  };
}
