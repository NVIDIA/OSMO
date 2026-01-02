/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { useMemo } from "react";
import { useSharedPreferences } from "@/lib/stores";
import { LAYOUT } from "../lib/constants";

// =============================================================================
// CSS Variable Parsing Utilities
// =============================================================================

function parseCssValue(value: string, rootFontSize: number): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("rem")) return parseFloat(trimmed) * rootFontSize;
  if (trimmed.endsWith("px")) return parseFloat(trimmed);
  return parseFloat(trimmed) || 0;
}

function getCssVarPx(name: string, fallbackRem: string): number {
  if (typeof document === "undefined") {
    return parseFloat(fallbackRem) * 16;
  }
  const root = document.documentElement;
  const rootFontSize = parseFloat(getComputedStyle(root).fontSize) || 16;
  const val = getComputedStyle(root).getPropertyValue(name).trim() || fallbackRem;
  return parseCssValue(val, rootFontSize);
}

// =============================================================================
// Layout Dimensions
// =============================================================================

export interface LayoutDimensions {
  /** Height of a table row */
  rowHeight: number;
  /** Height of the table header */
  headerHeight: number;
}

/**
 * Returns layout dimensions based on current preferences.
 */
export function useLayoutDimensions(): LayoutDimensions {
  const compactMode = useSharedPreferences((s) => s.compactMode);

  return useMemo(
    () => ({
      rowHeight: compactMode ? LAYOUT.ROW_HEIGHT_COMPACT : LAYOUT.ROW_HEIGHT,
      headerHeight: LAYOUT.HEADER_HEIGHT,
    }),
    [compactMode],
  );
}

/**
 * Get the shell header height for panel positioning.
 * Reads from CSS variable with fallback to 3.5rem (56px).
 */
export function getShellHeaderHeight(): number {
  // Use the same CSS variable as pools for consistency
  return getCssVarPx("--pools-shell-header-height", "3.5rem");
}
