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
 * DetailsPanel Types
 *
 * Unified types for the DetailsPanel component system.
 */

import type { WorkflowQueryResponse } from "@/lib/api/adapter";
import type { TaskQueryResponse, GroupWithLayout } from "./workflow-types";
import type { TaskTab, WorkflowTab, GroupTab } from "../hooks/use-navigation-state";

// ============================================================================
// Panel View Types
// ============================================================================

/**
 * Current view state of the DetailsPanel.
 * - "workflow": Base layer showing workflow-level details (default when nothing selected)
 * - "group": Showing group details (when a group node is selected)
 * - "task": Showing task details (when drilling into a specific task)
 */
export type DetailsPanelView = "workflow" | "group" | "task";

// ============================================================================
// Component Props
// ============================================================================

/**
 * Props for the main DetailsPanel container.
 *
 * Uses SidePanel from @/components/panel for resize/collapse functionality.
 * Designed for side-by-side (master/detail) layout with DAG canvas.
 */
export interface DetailsPanelProps {
  /** Current view (workflow, group, or task) */
  view: DetailsPanelView;
  /** The workflow data (for workflow view) */
  workflow?: WorkflowQueryResponse;
  /** The selected group (for group/task views) */
  group: GroupWithLayout | null;
  /** All groups in the workflow (for dependency display) */
  allGroups: GroupWithLayout[];
  /** The selected task (only for task view) */
  task: TaskQueryResponse | null;
  /** Callback when navigating back from task to group */
  onBackToGroup: () => void;
  /** Callback when navigating back from group to workflow */
  onBackToWorkflow: () => void;
  /** Callback when selecting a task */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /** Callback when selecting a different group (for dependency navigation) */
  onSelectGroup?: (group: GroupWithLayout) => void;
  /** Current panel width percentage */
  panelPct: number;
  /** Callback to resize panel */
  onPanelResize: (pct: number) => void;
  /** Whether the header details section is expanded */
  isDetailsExpanded: boolean;
  /** Toggle the details expansion state */
  onToggleDetailsExpanded: () => void;
  /** Whether the panel is collapsed to an edge strip */
  isCollapsed?: boolean;
  /** Callback to toggle collapsed state */
  onToggleCollapsed?: () => void;
  /**
   * Keyboard shortcut to toggle panel expand/collapse (e.g., "mod+]").
   * Uses react-hotkeys-hook syntax: mod = Cmd on Mac, Ctrl on Windows/Linux.
   * Displayed in tooltips and passed to SidePanel for global handling.
   */
  toggleHotkey?: string;
  /** Callback when workflow cancel is requested */
  onCancelWorkflow?: () => void;
  /**
   * Fallback content to render in the panel when no view matches.
   * Used for loading skeletons, error states, etc.
   */
  fallbackContent?: React.ReactNode;
  /**
   * Ref to the parent container (for resize calculations).
   * Should be the flex container wrapping both DAG and panel.
   */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * Callback when panel drag state changes (for viewport centering coordination).
   * Called with true when resize drag starts, false when it ends.
   */
  onDraggingChange?: (isDragging: boolean) => void;
  /**
   * Callback when shell tab activation changes.
   * Called with taskName when shell tab becomes active, null when deactivated.
   */
  onShellTabChange?: (taskName: string | null) => void;
  /**
   * Currently selected task tab (URL-synced).
   * Defaults to "overview" when not specified.
   */
  selectedTab?: TaskTab;
  /**
   * Callback to change the selected task tab.
   * Updates the URL with the new tab value.
   */
  setSelectedTab?: (tab: TaskTab) => void;
  /**
   * Currently selected workflow tab (URL-synced).
   * Defaults to "overview" when not specified.
   */
  selectedWorkflowTab?: WorkflowTab;
  /**
   * Callback to change the selected workflow tab.
   * Updates the URL with the new tab value.
   */
  setSelectedWorkflowTab?: (tab: WorkflowTab) => void;
  /**
   * Currently selected group tab (URL-synced).
   * Defaults to "overview" when not specified.
   */
  selectedGroupTab?: GroupTab;
  /**
   * Callback to change the selected group tab.
   * Updates the URL with the new tab value.
   */
  setSelectedGroupTab?: (tab: GroupTab) => void;
  /**
   * Minimum width percentage for the panel.
   * Defaults to PANEL.MIN_WIDTH_PCT (20%).
   */
  minWidth?: number;
  /**
   * Maximum width percentage for the panel.
   * Defaults to PANEL.MAX_WIDTH_PCT (80%).
   * Set to 100 in table view to allow panel to fill its wrapper.
   */
  maxWidth?: number;
  /**
   * Additional className to merge with the panel's default classes.
   * Used for overlay positioning (e.g., pointer-events-auto).
   */
  className?: string;
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
  /**
   * Currently selected group tab (URL-synced).
   * Defaults to "overview" when not specified.
   */
  selectedGroupTab?: GroupTab;
  /**
   * Callback to change the selected group tab.
   * Updates the URL with the new tab value.
   */
  setSelectedGroupTab?: (tab: GroupTab) => void;
}

/**
 * Props for the TaskDetails content component.
 */
export interface TaskDetailsProps {
  /** The group containing the task */
  group: GroupWithLayout;
  /** The task to display */
  task: TaskQueryResponse;
  /** Workflow name (for shell terminal) */
  workflowName?: string;
  /** Callback when navigating back to group */
  onBackToGroup: () => void;
  /** Callback when selecting a different task in the same group */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /**
   * Currently selected task tab (URL-synced).
   * Defaults to "overview" when not specified.
   */
  selectedTab?: TaskTab;
  /**
   * Callback to change the selected task tab.
   * Updates the URL with the new tab value.
   */
  setSelectedTab?: (tab: TaskTab) => void;
}

/** View type for visual differentiation */
export type HeaderViewType = "workflow" | "group" | "task";

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
 * Breadcrumb segment for hierarchical navigation.
 * Multiple segments create a multi-level breadcrumb trail.
 *
 * @example
 * ```ts
 * // Task within a group: Workflow / Group > Task
 * breadcrumbs={[
 *   { label: "Workflow", onClick: onBackToWorkflow },
 *   { label: "my-group", onClick: onBackToGroup }
 * ]}
 * ```
 */
export interface BreadcrumbSegment {
  /** Display label for the breadcrumb */
  label: string;
  /** Click handler to navigate to this level */
  onClick: () => void;
}

/**
 * Props for the shared panel header.
 *
 * Layout structure (consistent across views):
 * - Row 1: [Back] Breadcrumb(s) / Title · Subtitle    [Menu] [Close]
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
  /**
   * Multi-level breadcrumb segments for hierarchical navigation.
   * Each segment renders as a clickable back link.
   * @example
   * ```tsx
   * // Task within a group:
   * breadcrumbs={[
   *   { label: "Workflow", onClick: onBackToWorkflow },
   *   { label: "my-group", onClick: onBackToGroup }
   * ]}
   * ```
   */
  breadcrumbs?: BreadcrumbSegment[];
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
