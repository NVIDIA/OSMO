// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Log Viewer Component
 *
 * A GCP-inspired log viewer with virtualized scrolling, filtering, and histogram.
 * Uses adapter pattern for backend-agnostic design.
 *
 * Usage:
 * ```tsx
 * import { LogViewer } from "@/components/log-viewer";
 *
 * <LogViewer
 *   entries={entries}
 *   histogram={histogram}
 *   facets={facets}
 *   scope="workflow"
 * />
 * ```
 */

// =============================================================================
// Main Component
// =============================================================================

export { LogViewer } from "./components/LogViewer";
export type { LogViewerProps } from "./components/LogViewer";

// =============================================================================
// Sub-components (for advanced usage)
// =============================================================================

export { LogEntryRow } from "./components/LogEntryRow";
export type { LogEntryRowProps } from "./components/LogEntryRow";

export { LogList } from "./components/LogList";
export type { LogListProps } from "./components/LogList";

export { QueryBar, createLogFields } from "./components/QueryBar";
export type { QueryBarProps } from "./components/QueryBar";

export { TimelineHistogram } from "./components/TimelineHistogram";
export type { TimelineHistogramProps } from "./components/TimelineHistogram";

export { FieldsPane } from "./components/FieldsPane";
export type { FieldsPaneProps } from "./components/FieldsPane";

export { LogContext } from "./components/LogContext";
export type { LogContextProps } from "./components/LogContext";

export { LogToolbar, LogToolbarConnected } from "./components/LogToolbar";
export type { LogToolbarProps } from "./components/LogToolbar";

// =============================================================================
// Store
// =============================================================================

export { useLogViewerStore, initialState as logViewerInitialState } from "./store/log-viewer-store";
export type { LogViewerStore } from "./store/log-viewer-store";

// =============================================================================
// Utilities
// =============================================================================

export {
  getLevelBadgeClasses,
  getLevelDotClasses,
  getLevelLabel,
  getLevelAbbrev,
  getLogRowClasses,
  isLevelAtLeast,
  getLevelsAtLeast,
} from "./lib/level-utils";

// Note: Filter logic is now provided by @/components/filter-bar via filterByChips()
// Use createLogFields() to get field definitions for log filtering.

export {
  ROW_HEIGHT_ESTIMATE,
  EXPANDED_ROW_HEIGHT_ESTIMATE,
  OVERSCAN_COUNT,
  SCROLL_BOTTOM_THRESHOLD,
  HISTOGRAM_HEIGHT,
  HISTOGRAM_BAR_GAP,
  HISTOGRAM_MIN_BAR_WIDTH,
  SKELETON_WIDTHS,
} from "./lib/constants";
