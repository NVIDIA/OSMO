// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * DetailsPanel Types
 *
 * Unified types for the DetailsPanel component system.
 */

import type { TaskQueryResponse, GroupWithLayout } from "../../workflow-types";

// ============================================================================
// Panel View Types
// ============================================================================

/**
 * Current view state of the DetailsPanel.
 */
export type DetailsPanelView = "group" | "task";

// ============================================================================
// Component Props
// ============================================================================

/**
 * Props for the main DetailsPanel container.
 */
export interface DetailsPanelProps {
  /** Current view (group or task) */
  view: DetailsPanelView;
  /** The selected group */
  group: GroupWithLayout;
  /** All groups in the workflow (for dependency display) */
  allGroups: GroupWithLayout[];
  /** The selected task (only for task view) */
  task: TaskQueryResponse | null;
  /** Callback when panel is closed */
  onClose: () => void;
  /** Callback when navigating back to group from task */
  onBackToGroup: () => void;
  /** Callback when selecting a task */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /** Callback when selecting a different group (for dependency navigation) */
  onSelectGroup?: (group: GroupWithLayout) => void;
  /** Current panel width percentage */
  panelPct: number;
  /** Callback to resize panel */
  onPanelResize: (pct: number) => void;
  /** Whether the panel is being resized */
  isDragging: boolean;
  /** Mouse down handler for resize handle */
  onResizeMouseDown: (e: React.MouseEvent) => void;
  /** Whether the header details section is expanded */
  isDetailsExpanded: boolean;
  /** Toggle the details expansion state */
  onToggleDetailsExpanded: () => void;
}

/**
 * Props for the GroupDetails content component.
 */
export interface GroupDetailsProps {
  /** The group to display */
  group: GroupWithLayout;
  /** All groups in the workflow (for dependency display) */
  allGroups: GroupWithLayout[];
  /** Callback when selecting a task */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /** Callback when selecting a different group (for dependency navigation) */
  onSelectGroup?: (group: GroupWithLayout) => void;
}

/**
 * Props for the TaskDetails content component.
 */
export interface TaskDetailsProps {
  /** The group containing the task */
  group: GroupWithLayout;
  /** The task to display */
  task: TaskQueryResponse;
  /** Callback when navigating back to group */
  onBackToGroup: () => void;
  /** Callback when selecting a different task in the same group */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
}

/** View type for visual differentiation */
export type HeaderViewType = "group" | "task";

/**
 * Sibling task for inline task switcher.
 */
export interface SiblingTask {
  /** Task name */
  name: string;
  /** Retry ID for uniqueness */
  retryId: number;
  /** Task status for display */
  status: string;
  /** Whether this is the currently selected task */
  isCurrent: boolean;
  /** Whether this task is the leader */
  isLead?: boolean;
}

/**
 * Props for the shared panel header.
 *
 * Layout structure (consistent across views):
 * - Row 1: [Back] [Icon] Breadcrumb / Title · Subtitle    [Menu] [Close]
 * - Row 2: Status · Additional info
 * - Row 3 (optional): Expandable details section
 */
export interface DetailsPanelHeaderProps {
  /** Title text */
  title: string;
  /** Subtitle text (shown after title with · separator) */
  subtitle?: string;
  /** Status indicator content (Row 2) */
  statusContent?: React.ReactNode;
  /** Breadcrumb text (shown before title with / separator) */
  breadcrumb?: string;
  /** Back button handler (optional - shown when provided) */
  onBack?: () => void;
  /** Close button handler */
  onClose: () => void;
  /** Panel resize callback for snap presets */
  onPanelResize?: (pct: number) => void;
  /** Additional menu content */
  menuContent?: React.ReactNode;
  /** View type for visual differentiation (shows colored icon) */
  viewType?: HeaderViewType;
  /** Whether the task is a leader (for distributed training) */
  isLead?: boolean;
  /** Sibling tasks for inline task switcher (task view only) */
  siblingTasks?: SiblingTask[];
  /** Callback when selecting a sibling task */
  onSelectSibling?: (name: string, retryId: number) => void;
  /** Expandable details content (collapsed by default) */
  expandableContent?: React.ReactNode;
  /** Whether the expandable section is currently expanded */
  isExpanded?: boolean;
  /** Toggle the expanded state */
  onToggleExpand?: () => void;
}
