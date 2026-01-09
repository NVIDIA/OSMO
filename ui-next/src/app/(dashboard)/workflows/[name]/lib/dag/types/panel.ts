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

import type { WorkflowQueryResponse } from "@/lib/api/generated";
import type { TaskQueryResponse, GroupWithLayout } from "../workflow-types";

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
  /** Callback when panel is closed/collapsed */
  onClose: () => void;
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
  /** Whether the panel is being resized */
  isDragging: boolean;
  /** Bind function for resize handle (from @use-gesture/react) */
  bindResizeHandle: () => React.HTMLAttributes<HTMLDivElement>;
  /** Whether the header details section is expanded */
  isDetailsExpanded: boolean;
  /** Toggle the details expansion state */
  onToggleDetailsExpanded: () => void;
  /** Whether the panel is collapsed to an edge strip */
  isCollapsed?: boolean;
  /** Callback to toggle collapsed state */
  onToggleCollapsed?: () => void;
  /** Callback when workflow cancel is requested */
  onCancelWorkflow?: () => void;
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
