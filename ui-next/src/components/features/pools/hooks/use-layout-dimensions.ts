/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { useState, useEffect } from "react";

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
// Table Layout Dimensions (hook for reactive updates)
// =============================================================================

interface LayoutDimensions {
  headerHeight: number;
  sectionHeight: number;
  rowHeight: number;
  rowHeightCompact: number;
}

const DEFAULTS: LayoutDimensions = {
  headerHeight: 36,
  sectionHeight: 36,
  rowHeight: 48,
  rowHeightCompact: 32,
};

export function useLayoutDimensions(): LayoutDimensions {
  const [dimensions, setDimensions] = useState<LayoutDimensions>(DEFAULTS);

  useEffect(() => {
    setDimensions({
      headerHeight: getCssVarPx("--pools-header-height", "2.25rem"),
      sectionHeight: getCssVarPx("--pools-section-height", "2.25rem"),
      rowHeight: getCssVarPx("--pools-row-height", "3rem"),
      rowHeightCompact: getCssVarPx("--pools-row-height-compact", "2rem"),
    });
  }, []);

  return dimensions;
}

// =============================================================================
// Chip Layout Dimensions (static, read once)
// CSS variables ensure single source of truth across components
// =============================================================================

export interface ChipLayoutDimensions {
  overflowButtonWidth: number;
  chipGap: number;
  chipPadding: number;
  charWidth: number;
  containerPadding: number;
}

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

/** Shell header height for panel positioning */
export function getShellHeaderHeight(): number {
  return getCssVarPx("--pools-shell-header-height", "3.5rem");
}
