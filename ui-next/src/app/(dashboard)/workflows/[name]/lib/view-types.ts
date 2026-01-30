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
 * Shared View Types
 *
 * Common prop types for WorkflowDAGView and WorkflowTableView components.
 * Consolidates duplicate type definitions into a single source of truth.
 */

import type { GroupWithLayout, TaskQueryResponse, WorkflowQueryResponse } from "./workflow-types";
import type { DetailsPanelView } from "./panel-types";
import type { WorkflowTab, TaskTab } from "../hooks/use-navigation-state";

/**
 * Selection state props shared between DAG and Table views.
 */
export interface ViewSelectionProps {
  /** Currently selected group name from URL */
  selectedGroupName: string | null;
  /** Currently selected task name from URL */
  selectedTaskName: string | null;
  /** Resolved group object for the selected group */
  selectedGroup: GroupWithLayout | null;
  /** Resolved task object for the selected task */
  selectedTask: TaskQueryResponse | null;
  /** Current panel view type (workflow, group, or task) */
  currentPanelView: DetailsPanelView;
}

/**
 * Navigation handler props shared between DAG and Table views.
 */
export interface ViewNavigationProps {
  /** Called when user selects a group */
  onSelectGroup: (group: GroupWithLayout) => void;
  /** Called when user selects a task */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /** Called to navigate back from task to group */
  onBackToGroup: () => void;
  /** Called to navigate back to workflow view */
  onBackToWorkflow: () => void;
}

/**
 * Panel state props shared between DAG and Table views.
 */
export interface ViewPanelProps {
  /** Current panel width percentage */
  panelPct: number;
  /** Called when panel width changes */
  onPanelResize: (pct: number) => void;
  /** Whether the header details section is expanded */
  isDetailsExpanded: boolean;
  /** Toggle the details expansion state */
  onToggleDetailsExpanded: () => void;
  /** Whether the panel is collapsed to an edge strip */
  isPanelCollapsed: boolean;
  /** Toggle the panel collapsed state */
  togglePanelCollapsed: () => void;
  /** Expand the panel (for re-click behavior) */
  expandPanel: () => void;
  /** Override content for loading/error states */
  panelOverrideContent?: React.ReactNode;
  /** Called when panel drag state changes */
  onPanelDraggingChange?: (isDragging: boolean) => void;
}

/**
 * Tab state props shared between DAG and Table views.
 */
export interface ViewTabProps {
  /** Currently selected task tab (URL-synced) */
  selectedTab: TaskTab | null;
  /** Update the selected task tab */
  setSelectedTab: (tab: TaskTab) => void;
  /** Currently selected workflow tab (URL-synced) */
  selectedWorkflowTab: WorkflowTab | null;
  /** Update the selected workflow tab */
  setSelectedWorkflowTab: (tab: WorkflowTab) => void;
  /** Called when shell tab activation changes */
  onShellTabChange: (taskName: string | null) => void;
  /** Currently active shell task name */
  activeShellTaskName: string | null;
}

/**
 * Common props shared between WorkflowDAGView and WorkflowTableView.
 * Both views receive identical data and share most callbacks.
 */
export interface WorkflowViewCommonProps extends ViewSelectionProps, ViewNavigationProps, ViewPanelProps, ViewTabProps {
  /** The workflow data */
  workflow: WorkflowQueryResponse;
  /** All groups in the workflow with layout info */
  groups: GroupWithLayout[];
  /** Called when cancel workflow button is clicked */
  onCancelWorkflow?: () => void;
}

/**
 * DAG-specific props that extend the common view props.
 */
export interface WorkflowDAGViewSpecificProps {
  /** Retry ID for the selected task (used for uniqueness) */
  selectedTaskRetryId: number | null;
  /** Key that changes when selection changes (for panel behavior) */
  selectionKey: string | null;
  /** Whether the canvas is being panned */
  isPanning: boolean;
  /** Called when panning state changes */
  onPanningChange: (isPanning: boolean) => void;
}
