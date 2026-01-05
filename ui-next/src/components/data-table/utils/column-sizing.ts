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
 * Column Sizing Utilities
 *
 * Minimal utilities for column sizing with TanStack Table.
 * TanStack handles the heavy lifting; we just provide:
 * - rem → px conversion (for accessibility-based min widths)
 * - CSS variable helpers (for performant column width application)
 */

// =============================================================================
// Constants
// =============================================================================

/** Default base font size in pixels */
const DEFAULT_BASE_FONT_SIZE = 16;

// =============================================================================
// Rem ↔ Pixel Conversion
// =============================================================================

/** Get base font size from document (for rem → px conversion) */
function getBaseFontSize(): number {
  if (typeof document === "undefined") return DEFAULT_BASE_FONT_SIZE;
  try {
    const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return fontSize > 0 ? fontSize : DEFAULT_BASE_FONT_SIZE;
  } catch {
    return DEFAULT_BASE_FONT_SIZE;
  }
}

/** Convert rem to pixels */
export function remToPx(rem: number, baseFontSize?: number): number {
  return rem * (baseFontSize ?? getBaseFontSize());
}

// =============================================================================
// CSS Variable Helpers
// =============================================================================

/** Generate CSS variable name for a column */
export function getColumnCSSVariable(columnId: string): string {
  return `--col-${columnId.replace(/[^a-zA-Z0-9-_]/g, "-")}`;
}

/** Generate CSS var() reference for a column */
export function getColumnCSSValue(columnId: string, fallback: number = 150): string {
  return `var(${getColumnCSSVariable(columnId)}, ${fallback}px)`;
}
