// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Panel Components
 *
 * Unified inspector panel for workflow, group, and task details.
 * Re-exports all panel-related components from a single entry point.
 *
 * Structure:
 * - shared/: Components used across all views (DetailsPanel, Header, Timeline, etc.)
 * - workflow/: Workflow-specific components
 * - group/: Group-specific components
 * - task/: Task-specific components
 */

// =============================================================================
// Shared Components
// =============================================================================

export { DetailsPanel } from "./shared/DetailsPanel";
export { DetailsPanelHeader, ColumnMenuContent } from "./shared/DetailsPanelHeader";
export type { HeaderViewType } from "./shared/DetailsPanelHeader";
export { Timeline, parseTime } from "./shared/Timeline";
export { DependencyPills } from "./shared/DependencyPills";

// =============================================================================
// Workflow Components
// =============================================================================

export { WorkflowDetails } from "./workflow/WorkflowDetails";
export type { WorkflowDetailsProps } from "./workflow/WorkflowDetails";
export { WorkflowTimeline } from "./workflow/WorkflowTimeline";

// =============================================================================
// Group Components
// =============================================================================

export { GroupDetails } from "./group/GroupDetails";
export { GroupTimeline } from "./group/GroupTimeline";

// =============================================================================
// Task Components
// =============================================================================

export { TaskDetails } from "./task/TaskDetails";
export { TaskTimeline } from "./task/TaskTimeline";

// =============================================================================
// Types (re-exported from lib/panel for convenience)
// =============================================================================

export type {
  DetailsPanelView,
  DetailsPanelProps,
  GroupDetailsProps,
  TaskDetailsProps,
  DetailsPanelHeaderProps,
  SiblingTask,
  BreadcrumbSegment,
} from "../../lib/panel-types";
