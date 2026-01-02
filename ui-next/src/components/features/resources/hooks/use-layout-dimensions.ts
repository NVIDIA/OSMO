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
 * Get the shell header height from CSS variables.
 * Returns 0 if not available (SSR or before hydration).
 */
export function getShellHeaderHeight(): number {
  if (typeof document === "undefined") return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--shell-header-height");
  return parseInt(value, 10) || 0;
}
