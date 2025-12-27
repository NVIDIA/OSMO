// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * DAG Visualizer Constants
 *
 * Single source of truth for dimensions, styling, and thresholds.
 * These values are used by both the layout algorithm and node components.
 */

// ============================================================================
// Node Dimensions
// ============================================================================

/** Collapsed node width in pixels */
export const NODE_COLLAPSED_WIDTH = 180;

/** Collapsed node height in pixels */
export const NODE_COLLAPSED_HEIGHT = 72;

/** Expanded node width in pixels */
export const NODE_EXPANDED_WIDTH = 240;

/** Maximum expanded node height in pixels */
export const NODE_MAX_EXPANDED_HEIGHT = 320;

/** Height of each task row in the expanded list (pixels) */
export const TASK_ROW_HEIGHT = 28;

/** Padding for task list container (pixels) */
export const TASK_LIST_PADDING = 16;

/** Header height for expanded nodes (pixels) */
export const NODE_HEADER_HEIGHT = 48;

// ============================================================================
// Layout Spacing
// ============================================================================

/** Spacing between sibling nodes in TB (vertical) mode */
export const SPACING_NODES_TB = 60;

/** Spacing between sibling nodes in LR (horizontal) mode */
export const SPACING_NODES_LR = 100;

/** Spacing between levels/ranks in TB mode */
export const SPACING_RANKS_TB = 100;

/** Spacing between levels/ranks in LR mode */
export const SPACING_RANKS_LR = 150;

/** Margin around the graph */
export const LAYOUT_MARGIN = 50;

/** Minimum spacing between nodes after overlap adjustment */
export const MIN_NODE_SPACING = 20;

// ============================================================================
// Auto-collapse Thresholds
// ============================================================================

/** Collapse groups with this many or more tasks */
export const AUTO_COLLAPSE_TASK_THRESHOLD = 20;

/** Collapse all groups if there are this many or more groups */
export const AUTO_COLLAPSE_GROUP_THRESHOLD = 10;

// ============================================================================
// Viewport & Zoom
// ============================================================================

/** Default zoom level */
export const DEFAULT_ZOOM = 0.8;

/** Maximum zoom level */
export const MAX_ZOOM = 1.5;

/** Minimum zoom level (will be calculated dynamically) */
export const MIN_ZOOM = 0.1;

/** Estimated viewport dimensions for fit calculations */
export const ESTIMATED_VIEWPORT_WIDTH = 1200;
export const ESTIMATED_VIEWPORT_HEIGHT = 800;

// ============================================================================
// Status Styling
// ============================================================================

/**
 * Status category styling for nodes and UI elements.
 * Colors aligned with legacy UI:
 * - Waiting: Muted gray (no activity yet)
 * - Running: Blue
 * - Completed: Green
 * - Failed: Red
 */
export const STATUS_STYLES = {
  waiting: {
    bg: "bg-zinc-800/60",
    border: "border-zinc-600",
    text: "text-zinc-400",
    dot: "bg-zinc-500",
    color: "#71717a", // zinc-500
    strokeColor: "#52525b", // zinc-600
  },
  running: {
    bg: "bg-blue-950/60",
    border: "border-blue-500",
    text: "text-blue-400",
    dot: "bg-blue-500",
    color: "#3b82f6", // blue-500
    strokeColor: "#1d4ed8", // blue-700
  },
  completed: {
    bg: "bg-emerald-950/60",
    border: "border-emerald-600",
    text: "text-emerald-400",
    dot: "bg-emerald-500",
    color: "#10b981", // emerald-500
    strokeColor: "#047857", // emerald-700
  },
  failed: {
    bg: "bg-red-950/60",
    border: "border-red-500",
    text: "text-red-400",
    dot: "bg-red-500",
    color: "#ef4444", // red-500
    strokeColor: "#b91c1c", // red-700
  },
} as const;

export type StatusCategory = keyof typeof STATUS_STYLES;

// ============================================================================
// Edge Styling
// ============================================================================

/** Edge stroke width */
export const EDGE_STROKE_WIDTH = 2;

/** Edge dash array for waiting/pending edges */
export const EDGE_DASH_ARRAY = "5 3";

/** Arrow marker dimensions */
export const ARROW_WIDTH = 16;
export const ARROW_HEIGHT = 16;

// ============================================================================
// Virtualization
// ============================================================================

/** Number of items to render outside the visible area */
export const VIRTUAL_OVERSCAN = 5;

// ============================================================================
// Animation
// ============================================================================

/** Duration for viewport animations (ms) */
export const VIEWPORT_ANIMATION_DURATION = 400;

/** Initial viewport animation duration (ms) */
export const INITIAL_ANIMATION_DURATION = 500;

/** Delay before initial zoom animation (ms) */
export const ANIMATION_DELAY = 100;
