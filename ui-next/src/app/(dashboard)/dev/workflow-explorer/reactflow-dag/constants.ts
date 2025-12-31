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

/** Header height for expanded nodes (pixels) - py-3 (24px) + name (~20px) + hint (~20px) + buffer */
export const NODE_HEADER_HEIGHT = 68;

/** Action bar height (Show/Hide tasks bar) in pixels - py-1.5 (12px) + text + border */
export const NODE_ACTION_BAR_HEIGHT = 28;

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
// ReactFlow Components Configuration
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
export const HANDLE_OFFSET = 6; // pixels

/** Node border width for dimension calculations */
export const NODE_BORDER_WIDTH = 3; // 1.5px border * 2 sides

// ============================================================================
// Status Category Types
// ============================================================================

export type StatusCategory = "waiting" | "running" | "completed" | "failed";

/**
 * Pre-computed status category lookup for O(1) access.
 * Maps status string values to their category.
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
 *
 * Uses dark: prefix for dark mode variants.
 * Text colors use semantic naming for accessibility.
 */
export const STATUS_STYLES = {
  waiting: {
    bg: "bg-gray-100 dark:bg-zinc-800/60",
    border: "border-gray-300 dark:border-zinc-600",
    text: "text-gray-500 dark:text-zinc-400",
    dot: "bg-gray-400 dark:bg-zinc-500",
    // Raw colors for programmatic use (minimap, edges)
    color: "#71717a", // zinc-500
    strokeColor: "#52525b", // zinc-600
  },
  running: {
    bg: "bg-blue-50 dark:bg-blue-950/60",
    border: "border-blue-400 dark:border-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
    color: "#3b82f6", // blue-500
    strokeColor: "#1d4ed8", // blue-700
  },
  completed: {
    bg: "bg-emerald-50 dark:bg-emerald-950/60",
    border: "border-emerald-400 dark:border-emerald-600",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    color: "#10b981", // emerald-500
    strokeColor: "#047857", // emerald-700
  },
  failed: {
    bg: "bg-red-50 dark:bg-red-950/60",
    border: "border-red-400 dark:border-red-500",
    text: "text-red-600 dark:text-red-400",
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
  /** Duration for centering on a node (ms) */
  NODE_CENTER: 300,
  /** Duration for boundary enforcement during resize (ms) */
  BOUNDARY_ENFORCE: 100,
  /** Duration for move end cleanup (ms) */
  MOVE_END: 150,
  /** Duration for row hover transitions (ms) */
  ROW_HOVER: 75,
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
// GPU Acceleration - Now handled via CSS classes in dag.css
// ============================================================================
// All GPU acceleration and containment is now in CSS for consistency:
// - .dag-gpu-accelerated: Base GPU acceleration (transform, will-change)
// - .dag-contained: Strict containment (layout style paint)
// - .dag-virtual-item: Virtual list items (strict containment + content-visibility)
// - .dag-contained-layout: Layout + style containment only
// - .dag-details-panel: Panel container with GPU acceleration
// - .dag-table-container: Table scroll container
// - .dag-dropdown: Dropdown/popover containers
