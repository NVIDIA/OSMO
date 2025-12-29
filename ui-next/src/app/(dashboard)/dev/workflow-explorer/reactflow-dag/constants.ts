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
 * Uses CSS custom properties where possible for runtime flexibility.
 *
 * STRUCTURE:
 * - Layout & Dimensions: Node sizes, spacing, viewport
 * - Status Styling: Colors, borders, text for each status category
 * - Edge Styling: Stroke, arrows, animation
 * - Table/Panel: Column definitions, row heights, virtualization
 * - Animation: Timing and easing
 */

import type { TaskGroupStatus } from "../workflow-types";

// ============================================================================
// Layout Dimensions (in rem for scalability)
// ============================================================================

/**
 * Convert rem to pixels for layout calculations.
 * Uses base font size of 16px.
 */
const REM_BASE = 16;
const remToPx = (rem: number) => rem * REM_BASE;

/** Collapsed node dimensions */
export const NODE_COLLAPSED = {
  WIDTH_REM: 11.25, // 180px
  HEIGHT_REM: 4.5, // 72px
  get width() {
    return remToPx(this.WIDTH_REM);
  },
  get height() {
    return remToPx(this.HEIGHT_REM);
  },
} as const;

/** Expanded node dimensions */
export const NODE_EXPANDED = {
  WIDTH_REM: 15, // 240px
  MAX_HEIGHT_REM: 20, // 320px
  get width() {
    return remToPx(this.WIDTH_REM);
  },
  get maxHeight() {
    return remToPx(this.MAX_HEIGHT_REM);
  },
} as const;

// Legacy exports for backwards compatibility
export const NODE_COLLAPSED_WIDTH = NODE_COLLAPSED.width;
export const NODE_COLLAPSED_HEIGHT = NODE_COLLAPSED.height;
export const NODE_EXPANDED_WIDTH = NODE_EXPANDED.width;
export const NODE_MAX_EXPANDED_HEIGHT = NODE_EXPANDED.maxHeight;

/** Task row height in pixels */
export const TASK_ROW_HEIGHT = 28;

/** Table row height in pixels (for GroupPanel) */
export const TABLE_ROW_HEIGHT = 40;

/** Padding for task list container (pixels) */
export const TASK_LIST_PADDING = 16;

/** Header height for expanded nodes (pixels) */
export const NODE_HEADER_HEIGHT = 56;

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

// Legacy exports
export const SPACING_NODES_TB = LAYOUT_SPACING.NODES_TB;
export const SPACING_NODES_LR = LAYOUT_SPACING.NODES_LR;
export const SPACING_RANKS_TB = LAYOUT_SPACING.RANKS_TB;
export const SPACING_RANKS_LR = LAYOUT_SPACING.RANKS_LR;
export const LAYOUT_MARGIN = LAYOUT_SPACING.MARGIN;
export const MIN_NODE_SPACING = LAYOUT_SPACING.MIN_NODE_SPACING;

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

export const VIEWPORT = {
  /** Default zoom level */
  DEFAULT_ZOOM: 0.8,
  /** Maximum zoom level */
  MAX_ZOOM: 1.5,
  /** Minimum zoom level (calculated dynamically) */
  MIN_ZOOM: 0.1,
  /** Estimated viewport dimensions for fit calculations */
  ESTIMATED_WIDTH: 1200,
  ESTIMATED_HEIGHT: 800,
} as const;

// Legacy exports
export const DEFAULT_ZOOM = VIEWPORT.DEFAULT_ZOOM;
export const MAX_ZOOM = VIEWPORT.MAX_ZOOM;
export const MIN_ZOOM = VIEWPORT.MIN_ZOOM;
export const ESTIMATED_VIEWPORT_WIDTH = VIEWPORT.ESTIMATED_WIDTH;
export const ESTIMATED_VIEWPORT_HEIGHT = VIEWPORT.ESTIMATED_HEIGHT;

// ============================================================================
// Status Category Types
// ============================================================================

export type StatusCategory = "waiting" | "running" | "completed" | "failed";

/**
 * Pre-computed status category lookup for O(1) access.
 * Maps TaskGroupStatus enum values to their category.
 */
export const STATUS_CATEGORY_MAP: Record<string, StatusCategory> = {
  // Waiting states
  SUBMITTING: "waiting",
  WAITING: "waiting",
  PROCESSING: "waiting",
  SCHEDULING: "waiting",
  // Running states
  INITIALIZING: "running",
  RUNNING: "running",
  // Completed states
  COMPLETED: "completed",
  RESCHEDULED: "completed",
  // Failed states
  FAILED: "failed",
  FAILED_CANCELED: "failed",
  FAILED_SERVER_ERROR: "failed",
  FAILED_BACKEND_ERROR: "failed",
  FAILED_EXEC_TIMEOUT: "failed",
  FAILED_QUEUE_TIMEOUT: "failed",
  FAILED_IMAGE_PULL: "failed",
  FAILED_UPSTREAM: "failed",
  FAILED_EVICTED: "failed",
  FAILED_START_ERROR: "failed",
  FAILED_START_TIMEOUT: "failed",
  FAILED_PREEMPTED: "failed",
} as const;

/**
 * Pre-computed sort order for status (failures first, completed last).
 * Lower numbers appear first when sorting ascending.
 */
export const STATUS_SORT_ORDER: Record<string, number> = {
  FAILED: 0,
  FAILED_CANCELED: 1,
  FAILED_SERVER_ERROR: 2,
  FAILED_BACKEND_ERROR: 3,
  FAILED_EXEC_TIMEOUT: 4,
  FAILED_QUEUE_TIMEOUT: 5,
  FAILED_IMAGE_PULL: 6,
  FAILED_UPSTREAM: 7,
  FAILED_EVICTED: 8,
  FAILED_START_ERROR: 9,
  FAILED_START_TIMEOUT: 10,
  FAILED_PREEMPTED: 11,
  RUNNING: 12,
  INITIALIZING: 13,
  PROCESSING: 14,
  SCHEDULING: 15,
  SUBMITTING: 16,
  WAITING: 17,
  RESCHEDULED: 18,
  COMPLETED: 19,
} as const;

/**
 * Human-readable labels for statuses.
 */
export const STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Completed",
  RESCHEDULED: "Rescheduled",
  RUNNING: "Running",
  INITIALIZING: "Initializing",
  FAILED: "Failed",
  FAILED_CANCELED: "Canceled",
  FAILED_SERVER_ERROR: "Server Error",
  FAILED_BACKEND_ERROR: "Backend Error",
  FAILED_EXEC_TIMEOUT: "Exec Timeout",
  FAILED_QUEUE_TIMEOUT: "Queue Timeout",
  FAILED_IMAGE_PULL: "Image Pull",
  FAILED_UPSTREAM: "Upstream",
  FAILED_EVICTED: "Evicted",
  FAILED_START_ERROR: "Start Error",
  FAILED_START_TIMEOUT: "Start Timeout",
  FAILED_PREEMPTED: "Preempted",
  WAITING: "Waiting",
  SCHEDULING: "Scheduling",
  SUBMITTING: "Submitting",
  PROCESSING: "Processing",
} as const;

// ============================================================================
// Status Styling
// ============================================================================

/**
 * Status category styling for nodes and UI elements.
 * Colors aligned with design system:
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

// ============================================================================
// Edge Styling
// ============================================================================

export const EDGE_STYLE = {
  /** Edge stroke width */
  STROKE_WIDTH: 2,
  /** Edge dash array for waiting/pending edges */
  DASH_ARRAY: "5 3",
  /** Arrow marker dimensions */
  ARROW_WIDTH: 16,
  ARROW_HEIGHT: 16,
} as const;

// Legacy exports
export const EDGE_STROKE_WIDTH = EDGE_STYLE.STROKE_WIDTH;
export const EDGE_DASH_ARRAY = EDGE_STYLE.DASH_ARRAY;
export const ARROW_WIDTH = EDGE_STYLE.ARROW_WIDTH;
export const ARROW_HEIGHT = EDGE_STYLE.ARROW_HEIGHT;

// ============================================================================
// Virtualization
// ============================================================================

/** Number of items to render outside the visible area */
export const VIRTUAL_OVERSCAN = 5;

// ============================================================================
// Animation
// ============================================================================

export const ANIMATION = {
  /** Duration for viewport animations (ms) */
  VIEWPORT_DURATION: 400,
  /** Initial viewport animation duration (ms) */
  INITIAL_DURATION: 500,
  /** Delay before initial zoom animation (ms) */
  DELAY: 100,
} as const;

// Legacy exports
export const VIEWPORT_ANIMATION_DURATION = ANIMATION.VIEWPORT_DURATION;
export const INITIAL_ANIMATION_DURATION = ANIMATION.INITIAL_DURATION;
export const ANIMATION_DELAY = ANIMATION.DELAY;

// ============================================================================
// Panel Configuration
// ============================================================================

export const PANEL = {
  /** Default panel width percentage */
  DEFAULT_WIDTH_PCT: 50,
  /** Minimum panel width percentage */
  MIN_WIDTH_PCT: 25,
  /** Maximum panel width percentage */
  MAX_WIDTH_PCT: 80,
  /** Width presets for snap-to */
  WIDTH_PRESETS: [33, 50, 75] as const,
} as const;

// ============================================================================
// Persistence
// ============================================================================

export const PERSISTENCE = {
  /** LocalStorage key for settings */
  STORAGE_KEY: "dag-panel-settings",
  /** Debounce delay for saving (ms) */
  DEBOUNCE_MS: 300,
} as const;

// ============================================================================
// GPU Acceleration Styles (reusable across components)
// ============================================================================

/**
 * GPU-accelerated CSS styles for smooth animations.
 * Uses composite layer promotion for silky smooth transforms.
 */
export const GPU_STYLES = {
  /** Base GPU acceleration */
  accelerated: {
    willChange: "transform",
    transform: "translate3d(0, 0, 0)",
    backfaceVisibility: "hidden",
  } as React.CSSProperties,

  /** Strict containment for maximum layout isolation */
  contained: {
    contain: "layout style paint",
  } as React.CSSProperties,

  /** For virtual list items - maximum isolation */
  virtualItem: {
    contain: "strict",
    contentVisibility: "auto",
  } as React.CSSProperties,
} as const;
