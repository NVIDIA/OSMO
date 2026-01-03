/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { useMemo } from "react";
import { getCssVarPx } from "@/lib/css-utils";
import type { ChipLayoutDimensions } from "@/lib/hooks";

// =============================================================================
// Table Layout Dimensions
// =============================================================================

interface LayoutDimensions {
  headerHeight: number;
  sectionHeight: number;
  rowHeight: number;
  rowHeightCompact: number;
}

/**
 * Returns layout dimensions from CSS custom properties.
 *
 * Uses useMemo to read values once on mount (no re-render).
 * Fallbacks ensure correct values even during SSR/initial hydration.
 *
 * Note: Values are static per mount. If CSS variables could change at runtime
 * (e.g., theme switch changes dimensions), use useState + useEffect instead.
 */
export function useLayoutDimensions(): LayoutDimensions {
  // Read CSS variables once on mount - avoids double render from useEffect
  // Safe because CSS custom properties are defined in pools.css which loads before components
  return useMemo(() => ({
    headerHeight: getCssVarPx("--pools-header-height", "2.25rem"),
    sectionHeight: getCssVarPx("--pools-section-height", "2.25rem"),
    rowHeight: getCssVarPx("--pools-row-height", "3rem"),
    rowHeightCompact: getCssVarPx("--pools-row-height-compact", "2rem"),
  }), []);
}

// =============================================================================
// Chip Layout Dimensions (static, read once)
// CSS variables ensure single source of truth across components
// =============================================================================

/** Chip layout for table cells (compact) */
export function getChipLayoutCompact(): ChipLayoutDimensions {
  return {
    overflowButtonWidth: getCssVarPx("--pools-chip-overflow-width", "2rem"),
    chipGap: getCssVarPx("--pools-chip-gap", "0.25rem"),
    chipPadding: getCssVarPx("--pools-chip-padding", "1rem"),
    charWidth: getCssVarPx("--pools-chip-char-width", "0.4375rem"),
    containerPadding: 0,
  };
}

/** Chip layout for panel context (spacious) */
export function getChipLayoutSpacious(): ChipLayoutDimensions {
  return {
    overflowButtonWidth: getCssVarPx("--pools-chip-overflow-width-lg", "2.5rem"),
    chipGap: getCssVarPx("--pools-chip-gap-lg", "0.375rem"),
    chipPadding: getCssVarPx("--pools-chip-padding", "1rem"),
    charWidth: getCssVarPx("--pools-chip-char-width", "0.4375rem"),
    containerPadding: getCssVarPx("--pools-chip-container-padding", "0.25rem"),
  };
}
