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
 * Chrome Layout Constants
 *
 * Single source of truth for sidebar dimensions and animation timings.
 * Used by the chrome, sidebar, and any consumers that need layout-aware calculations.
 */

// ============================================================================
// Sidebar Dimensions
// ============================================================================

/** Sidebar width in rem when expanded */
export const SIDEBAR_WIDTH_REM = 12; // 12rem

/** Sidebar width in rem when collapsed (icon-only mode) */
export const SIDEBAR_WIDTH_ICON_REM = 3.25; // 3.25rem

/** Base font size for rem to px conversion */
const REM_BASE = 16;

/** Sidebar width in pixels when expanded */
export const SIDEBAR_WIDTH_EXPANDED_PX = SIDEBAR_WIDTH_REM * REM_BASE; // 192px

/** Sidebar width in pixels when collapsed (icon-only mode) */
export const SIDEBAR_WIDTH_COLLAPSED_PX = SIDEBAR_WIDTH_ICON_REM * REM_BASE; // 52px

// ============================================================================
// Animation Timings
// ============================================================================

/** Sidebar CSS transition duration in milliseconds */
export const SIDEBAR_TRANSITION_MS = 200;

// ============================================================================
// CSS Variables (for SidebarProvider style prop)
// ============================================================================

/** CSS variable values for sidebar widths */
export const SIDEBAR_CSS_VARS = {
  "--sidebar-width": `${SIDEBAR_WIDTH_REM}rem`,
  "--sidebar-width-icon": `${SIDEBAR_WIDTH_ICON_REM}rem`,
} as const;

// ============================================================================
// Convenience Object Export
// ============================================================================

/**
 * Sidebar configuration object for easy destructuring.
 *
 * @example
 * ```tsx
 * import { SIDEBAR } from "@/components/chrome";
 *
 * const mainAreaWidth = windowWidth - (isCollapsed ? SIDEBAR.COLLAPSED_PX : SIDEBAR.EXPANDED_PX);
 * ```
 */
export const SIDEBAR = {
  /** Width in rem when expanded */
  WIDTH_REM: SIDEBAR_WIDTH_REM,
  /** Width in rem when collapsed */
  WIDTH_ICON_REM: SIDEBAR_WIDTH_ICON_REM,
  /** Width in pixels when expanded */
  EXPANDED_PX: SIDEBAR_WIDTH_EXPANDED_PX,
  /** Width in pixels when collapsed */
  COLLAPSED_PX: SIDEBAR_WIDTH_COLLAPSED_PX,
  /** CSS transition duration in ms */
  TRANSITION_MS: SIDEBAR_TRANSITION_MS,
  /** CSS variable values */
  CSS_VARS: SIDEBAR_CSS_VARS,
} as const;
