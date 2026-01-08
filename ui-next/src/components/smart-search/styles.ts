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
 * Styles for SmartSearch components.
 *
 * Split into two categories:
 * - `dropdownStyles`: UI layer styles (REPLACEABLE by cmdk/shadcn)
 * - `chipStyles`: Chip-specific styles (keep regardless of dropdown impl)
 *
 * When migrating to cmdk, you may replace dropdownStyles with
 * shadcn Command styles, but chipStyles stay as-is.
 */

// ============================================================================
// Dropdown Styles - REPLACEABLE by cmdk/shadcn Command
// ============================================================================

/** Dropdown/primitive styles - can be replaced when using cmdk */
export const dropdownStyles = {
  // Surfaces & backgrounds
  surface: "bg-white dark:bg-zinc-900",
  border: "border-zinc-200 dark:border-zinc-700",
  borderError: "border-red-200 dark:border-red-800",

  // Text colors
  muted: "text-zinc-500 dark:text-zinc-400",
  mutedLight: "text-zinc-400 dark:text-zinc-500",
  error: "text-red-600 dark:text-red-400",
  prefix: "text-blue-600 dark:text-blue-400",

  // Interactive states
  focusRing: "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-zinc-900",
  hoverBg: "hover:bg-zinc-100 dark:hover:bg-zinc-800",
  highlighted: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100",

  // Components
  kbd: "rounded bg-zinc-200 px-1 dark:bg-zinc-700",
  nonInteractive: "pointer-events-none select-none",
  dropdownItem: "px-3 py-2 text-sm",

  // Dropdown container
  dropdown: "absolute inset-x-0 top-full z-50 mt-1 max-h-[300px] overflow-auto rounded-md border shadow-lg",
} as const;

// ============================================================================
// Input Styles - May keep with cmdk (depends on integration approach)
// ============================================================================

/** Input container styles */
export const inputStyles = {
  container:
    "relative z-50 flex flex-wrap items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500",
  containerError:
    "animate-shake border-red-500 ring-1 ring-red-500 focus-within:border-red-500 focus-within:ring-red-500",
  input:
    "min-w-[150px] flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-zinc-400 focus:ring-0 dark:text-zinc-100 dark:placeholder:text-zinc-500",
  clearButton:
    "ml-1 flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:text-zinc-700 dark:hover:text-zinc-300",
} as const;

// ============================================================================
// Chip Styles - KEEP regardless of dropdown implementation
// ============================================================================

/** Chip component styles - core to SmartSearch, not replaceable */
export const chipStyles = {
  chip: "inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 transition-all dark:bg-blue-900/40 dark:text-blue-300",
  chipButton: "rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800",
} as const;

/** Chip variant colors */
export const chipVariantStyles = {
  free: "text-emerald-600 dark:text-emerald-400",
  used: "text-amber-600 dark:text-amber-400",
} as const;
