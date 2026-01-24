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
 * CSS Variable Parsing Utilities
 *
 * Shared utilities for reading CSS custom properties and converting
 * rem/px values to numeric pixels.
 */

import { useMemo } from "react";

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
 * CSS variable configuration for useCssVarDimensions.
 * Maps dimension names to [CSS variable, fallback value] pairs.
 */
export type CssVarConfig<T extends string> = Record<T, [cssVar: string, fallback: string]>;

/**
 * Generic hook to read multiple CSS custom properties as pixel values.
 *
 * Reads values once on mount (stable reference via useMemo).
 * SSR-safe with fallback values.
 *
 * @example
 * ```tsx
 * const TABLE_DIMENSIONS = {
 *   rowHeight: ["--table-row-height", "3rem"],
 *   rowHeightCompact: ["--table-row-height-compact", "2rem"],
 *   headerHeight: ["--table-header-height", "2.25rem"],
 * } as const;
 *
 * // In component:
 * const dims = useCssVarDimensions(TABLE_DIMENSIONS);
 * // dims.rowHeight, dims.rowHeightCompact, dims.headerHeight are all numbers (px)
 * ```
 */
export function useCssVarDimensions<T extends string>(config: CssVarConfig<T>): Record<T, number> {
  return useMemo(() => {
    const result = {} as Record<T, number>;
    for (const key of Object.keys(config) as T[]) {
      const [cssVar, fallback] = config[key];
      result[key] = getCssVarPx(cssVar, fallback);
    }
    return result;
  }, [config]);
}
