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

/** Default node dimensions */
export const NODE_DEFAULTS = {
  /** Default width in rem */
  WIDTH_REM: 11.25, // 180px
  /** Default height in rem */
  HEIGHT_REM: 4.5, // 72px
  /** Get width in pixels */
  get width() {
    return remToPx(this.WIDTH_REM);
  },
  /** Get height in pixels */
  get height() {
    return remToPx(this.HEIGHT_REM);
  },
} as const;

/** Expanded node dimensions */
export const NODE_EXPANDED = {
  /** Expanded width in rem */
  WIDTH_REM: 15, // 240px
  /** Maximum height in rem */
  MAX_HEIGHT_REM: 20, // 320px
  /** Get width in pixels */
  get width() {
    return remToPx(this.WIDTH_REM);
  },
  /** Get max height in pixels */
  get maxHeight() {
    return remToPx(this.MAX_HEIGHT_REM);
  },
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

export const ANIMATION = {
  /** Duration for viewport animations (ms) */
  VIEWPORT_DURATION: 400,
  /** Initial viewport animation duration (ms) */
  INITIAL_DURATION: 500,
  /** Delay before initial animation (ms) */
  DELAY: 100,
  /** Duration for centering on a node when selected (ms) */
  NODE_CENTER: 300,
  /** Duration for zoom in/out button animations (ms) */
  ZOOM: 200,
  /** Duration for boundary enforcement during resize (ms) */
  BOUNDARY_ENFORCE: 100,
  /** Duration for move end cleanup (ms) */
  MOVE_END: 150,
  /** Buffer time added after animations to ensure completion (ms) */
  BUFFER: 50,
} as const;

// ============================================================================
// Panel Configuration
// ============================================================================

// Re-export canonical panel constants for DAG usage
// DAG panels use the same configuration as other resizable panels
export { PANEL } from "@/components/panel";

// ============================================================================
// Layout Cache
// ============================================================================

export const LAYOUT_CACHE = {
  /** Maximum number of cached layouts */
  MAX_SIZE: 20,
} as const;
