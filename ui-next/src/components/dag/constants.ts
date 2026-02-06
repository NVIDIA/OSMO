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
 * Generic DAG Constants
 *
 * Layout, viewport, and animation constants for the DAG visualization.
 * Domain-specific constants (like status colors) should be defined by consumers.
 *
 * Performance: Values are pre-calculated at module load time to avoid
 * getter overhead during hot paths like layout calculations.
 */

// ============================================================================
// Layout Dimensions
// ============================================================================

/**
 * Convert rem to pixels for layout calculations.
 * Uses base font size of 16px.
 */
const REM_BASE = 16;
export const remToPx = (rem: number) => rem * REM_BASE;

/**
 * Default node dimensions.
 * Pre-calculated pixel values avoid getter overhead in hot paths.
 */
export const NODE_DEFAULTS = {
  /** Default width in rem */
  WIDTH_REM: 11.25,
  /** Default height in rem */
  HEIGHT_REM: 4.5,
  /** Pre-calculated width in pixels (180px) */
  width: 11.25 * REM_BASE,
  /** Pre-calculated height in pixels (72px) */
  height: 4.5 * REM_BASE,
} as const;

/**
 * Expanded node dimensions.
 * Pre-calculated pixel values avoid getter overhead in hot paths.
 */
export const NODE_EXPANDED = {
  /** Expanded width in rem */
  WIDTH_REM: 15,
  /** Maximum height in rem */
  MAX_HEIGHT_REM: 20,
  /** Pre-calculated width in pixels (240px) */
  width: 15 * REM_BASE,
  /** Pre-calculated max height in pixels (320px) */
  maxHeight: 20 * REM_BASE,
} as const;

// ============================================================================
// Layout Spacing
// ============================================================================

/** Layout spacing configuration */
export const LAYOUT_SPACING = {
  /** Spacing between sibling nodes in TB (vertical) mode */
  NODES_TB: 60,
  /** Spacing between sibling nodes in LR (horizontal) mode */
  NODES_LR: 100,
  /** Spacing between levels/ranks in TB mode */
  RANKS_TB: 100,
  /** Spacing between levels/ranks in LR mode */
  RANKS_LR: 150,
  /** Margin around the graph */
  MARGIN: 50,
  /** Minimum spacing between nodes after overlap adjustment */
  MIN_NODE_SPACING: 20,
} as const;

// ============================================================================
// Viewport & Zoom
// ============================================================================

export const VIEWPORT = {
  /** Default zoom level (used for initial viewport state before centering) */
  DEFAULT_ZOOM: 0.8,
  /** Zoom level used when centering on a node (initial load, layout change) */
  INITIAL_ZOOM: 1.0,
  /** Maximum zoom level */
  MAX_ZOOM: 1.5,
  /** Minimum zoom level */
  MIN_ZOOM: 0.1,
  /** Estimated viewport dimensions for fit calculations */
  ESTIMATED_WIDTH: 1200,
  ESTIMATED_HEIGHT: 800,
} as const;

// ============================================================================
// ReactFlow Component Configuration
// ============================================================================

/** MiniMap dimensions */
export const MINIMAP = {
  /** Width in pixels */
  WIDTH: 120,
  /** Height in pixels */
  HEIGHT: 80,
  /** Node stroke width */
  NODE_STROKE_WIDTH: 1,
} as const;

/** Background grid configuration */
export const BACKGROUND = {
  /** Gap between grid dots in pixels */
  GAP: 20,
  /** Size of grid dots in pixels */
  DOT_SIZE: 1,
  /** Color of grid dots - light mode */
  COLOR_LIGHT: "#d4d4d8", // zinc-300
  /** Color of grid dots - dark mode */
  COLOR_DARK: "#27272a", // zinc-800
} as const;

/** Handle positioning (offset from node edge) */
export const HANDLE_OFFSET = 6;

// ============================================================================
// Edge Styling
// ============================================================================

export const EDGE_STYLE = {
  /** Edge stroke width */
  STROKE_WIDTH: 2,
  /** Edge dash array for pending/inactive edges */
  DASH_ARRAY: "5 3",
  /** Arrow marker dimensions */
  ARROW_WIDTH: 16,
  ARROW_HEIGHT: 16,
} as const;

// ============================================================================
// Animation
// ============================================================================

/**
 * Animation timing constants.
 * These values are tuned for smooth UX across different interaction types.
 */
export const ANIMATION = {
  /** Duration for viewport animations (ms) - used for node centering, direction changes */
  VIEWPORT_DURATION: 400,
  /** Initial viewport animation duration (ms) - slightly longer for first load visual polish */
  INITIAL_DURATION: 500,
  /** Delay before initial animation (ms) - allows DOM to stabilize */
  DELAY: 100,
  /** Duration for zoom in/out button animations (ms) - fast for responsive feel */
  ZOOM: 200,
  /** Duration for boundary enforcement during resize (ms) - quick to prevent visible drift */
  BOUNDARY_ENFORCE: 100,
  /**
   * Duration matching the panel CSS transition (ease-out 200ms).
   * Used for re-centering during panel resize/collapse to create
   * a seamless single-motion animation.
   */
  PANEL_TRANSITION: 200,
  /** Debounce interval for window resize handling (ms) - wait for resize to settle */
  RESIZE_THROTTLE_MS: 150,
} as const;

// ============================================================================
// Viewport Adjustment Thresholds
// ============================================================================

export const VIEWPORT_THRESHOLDS = {
  /**
   * Minimum squared distance (px²) to trigger a viewport animation.
   * Using squared distance avoids expensive Math.sqrt calls.
   * A value of 1 means: animate if moved more than 1px in any direction.
   */
  MIN_ADJUSTMENT_DISTANCE_SQ: 1,
} as const;

// ============================================================================
// Panel Configuration
// ============================================================================

// Re-export canonical panel constants for DAG usage
// DAG panels use the same configuration as other resizable panels
export { PANEL } from "@/components/panel/panel-header-controls";

// ============================================================================
// Layout Cache
// ============================================================================

export const LAYOUT_CACHE = {
  /** Maximum number of cached layouts */
  MAX_SIZE: 20,
} as const;
