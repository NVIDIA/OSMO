/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * CSS Variable Parsing Utilities
 *
 * Shared utilities for reading CSS custom properties and converting
 * rem/px values to numeric pixels.
 */

/**
 * Parse a CSS value (rem or px) to pixels.
 */
export function parseCssValue(value: string, rootFontSize: number): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("rem")) return parseFloat(trimmed) * rootFontSize;
  if (trimmed.endsWith("px")) return parseFloat(trimmed);
  return parseFloat(trimmed) || 0;
}

/**
 * Get a CSS custom property value in pixels.
 * @param name - CSS variable name (e.g., "--header-height")
 * @param fallbackRem - Fallback value in rem (e.g., "3.5rem")
 */
export function getCssVarPx(name: string, fallbackRem: string): number {
  if (typeof document === "undefined") {
    return parseFloat(fallbackRem) * 16;
  }
  const root = document.documentElement;
  const rootFontSize = parseFloat(getComputedStyle(root).fontSize) || 16;
  const val = getComputedStyle(root).getPropertyValue(name).trim() || fallbackRem;
  return parseCssValue(val, rootFontSize);
}

/**
 * Get the shell header height for panel positioning.
 * Reads from CSS variable with fallback to 3.5rem (56px).
 */
export function getShellHeaderHeight(): number {
  return getCssVarPx("--pools-shell-header-height", "3.5rem");
}
