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
 * State Types for Workflow Detail Page
 *
 * This module defines the focused interfaces for the application layer.
 * Each interface follows Interface Segregation Principle (ISP) - small,
 * focused interfaces that can be composed as needed.
 *
 * These types are used by:
 * - useWorkflowDetailState (orchestrator hook)
 * - WorkflowDetailInner (presentation component)
 * - WorkflowDAGView / WorkflowTableView (view components)
 *
 * @example
 * ```typescript
 * // Import specific slices you need
 * import type { WorkflowDataState, WorkflowNavigationState } from "./state-types";
 *
 * // Or import the full composed state
 * import type { WorkflowDetailState } from "./state-types";
 * ```
 */

import type { WorkflowQueryResponse } from "@/lib/api/adapter/types";
import type { GroupWithLayout, TaskQueryResponse } from "./workflow-types";
import type { NavigationContext, WorkflowProgress } from "./workflow-selectors";
import type { TaskTab, WorkflowTab, GroupTab } from "../hooks/use-navigation-state";

// =============================================================================
// Data Slice (Server State)
// =============================================================================

/**
 * Data slice - server state from API.
 *
 * Focused interface for data concerns only.
 * Contains the workflow data and loading/error states.
 *
 * Single Responsibility: Only manages server data state.
 */
export interface WorkflowDataState {
  /** The workflow data (null when loading or error) */
  readonly workflow: WorkflowQueryResponse | null;
  /** Groups with computed layout (empty when loading) */
  readonly groups: readonly GroupWithLayout[];
  /** Loading state */
  readonly isLoading: boolean;
  /** Error state (null when no error) */
  readonly error: Error | null;
  /** Whether workflow exists (404 case) */
  readonly isNotFound: boolean;
  /** Refetch function for manual refresh */
  readonly refetch: () => void;
}

// =============================================================================
// Navigation Slice (URL State)
// =============================================================================

/**
 * Navigation slice - URL-synced selection state.
 *
 * Focused interface for navigation concerns only.
 * Contains resolved selection context and tab states.
 *
 * Single Responsibility: Only manages URL-derived navigation state.
 */
export interface WorkflowNavigationState {
  /** Resolved navigation context (view level + selected objects) */
  readonly context: NavigationContext;
  /** Selected tab for task view */
  readonly selectedTab: TaskTab;
  /** Selected tab for workflow view */
  readonly selectedWorkflowTab: WorkflowTab;
  /** Selected tab for group view */
  readonly selectedGroupTab: GroupTab;
}

/**
 * Navigation handlers - callbacks for navigation actions.
 *
 * Separated from state for cleaner interface segregation.
 * All handlers are stable references (useEventCallback).
 *
 * Single Responsibility: Only provides navigation actions.
 */
export interface WorkflowNavigationHandlers {
  /**
   * Navigate to a group.
   * For single-task groups, auto-navigates to the task.
   */
  readonly navigateToGroup: (group: GroupWithLayout) => void;

  /**
   * Navigate to a task within a group.
   */
  readonly navigateToTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;

  /**
   * Navigate back to workflow view (clear all selection).
   */
  readonly navigateToWorkflow: () => void;

  /**
   * Navigate from task back to its parent group.
   */
  readonly navigateBackToGroup: () => void;

  /**
   * Set the active task tab (overview, shell, logs, events).
   */
  readonly setSelectedTab: (tab: TaskTab) => void;

  /**
   * Set the active workflow tab (overview, logs, events).
   */
  readonly setSelectedWorkflowTab: (tab: WorkflowTab) => void;

  /**
   * Set the active group tab (overview, tasks).
   */
  readonly setSelectedGroupTab: (tab: GroupTab) => void;
}

// =============================================================================
// Panel Slice (UI State)
// =============================================================================

/**
 * Panel slice - UI state for details panel.
 *
 * Focused interface for panel concerns only.
 * Contains panel width, expansion, and collapse states.
 *
 * Single Responsibility: Only manages panel UI state.
 */
export interface WorkflowPanelState {
  /** Panel width as percentage of container (20-80) */
  readonly panelPct: number;
  /** Whether header details section is expanded */
  readonly isDetailsExpanded: boolean;
  /** Whether panel is collapsed to edge strip */
  readonly isPanelCollapsed: boolean;
}

/**
 * Panel handlers - callbacks for panel actions.
 *
 * Separated from state for cleaner interface segregation.
 * All handlers are stable references.
 *
 * Single Responsibility: Only provides panel actions.
 */
export interface WorkflowPanelHandlers {
  /**
   * Update panel width percentage.
   * @param pct - New width percentage (20-80)
   */
  readonly setPanelPct: (pct: number) => void;

  /**
   * Toggle the header details expansion state.
   */
  readonly toggleDetailsExpanded: () => void;

  /**
   * Toggle the panel collapsed/expanded state.
   */
  readonly togglePanelCollapsed: () => void;

  /**
   * Expand the panel (for re-click behavior).
   * Does nothing if already expanded.
   */
  readonly expandPanel: () => void;
}

// =============================================================================
// View Preference Slice (User Preference)
// =============================================================================

/**
 * View preference slice - DAG vs Table toggle.
 *
 * This is a user preference stored in Zustand (localStorage).
 * NOT shareable via URL - it's a personal viewing preference.
 *
 * Single Responsibility: Only manages view mode preference.
 */
export interface WorkflowViewPreference {
  /** Current view mode */
  readonly viewMode: "dag" | "table";

  /**
   * Toggle view mode between DAG and Table.
   * Persisted to localStorage for cross-session preference.
   */
  readonly toggleViewMode: () => void;
}

// =============================================================================
// Computed Slice (Derived State)
// =============================================================================

/**
 * Computed state derived from data.
 *
 * Pure derivations with no side effects.
 * All values are computed from other state slices.
 *
 * Single Responsibility: Only provides derived values.
 */
export interface WorkflowComputedState {
  /** Progress statistics computed from groups */
  readonly progress: WorkflowProgress;
  /** Whether workflow is active (needs live tick updates) */
  readonly isActive: boolean;
  /** Whether data is ready for rendering */
  readonly isReady: boolean;
  /** Selection key for panel behavior (changes trigger auto-expand) */
  readonly selectionKey: string | null;
}

// =============================================================================
// Shell Slice (Task Shell State)
// =============================================================================

/**
 * Shell state for task terminal interactions.
 *
 * Manages which task's shell is currently active.
 * Shell is heavy (xterm.js), so we track active state separately.
 *
 * Single Responsibility: Only manages shell activation state.
 */
export interface WorkflowShellState {
  /** Currently active shell task name (null if no shell active) */
  readonly activeShellTaskName: string | null;
}

/**
 * Shell handlers for shell activation changes.
 */
export interface WorkflowShellHandlers {
  /**
   * Called when shell tab becomes active or inactive.
   * @param taskName - Task name when shell activates, null when deactivates
   */
  readonly onShellTabChange: (taskName: string | null) => void;
}

// =============================================================================
// Ephemeral Slice (Component-Local State)
// =============================================================================

/**
 * Ephemeral state that exists only in component lifecycle.
 *
 * This state is NOT persisted and NOT shareable.
 * Used for transient UI states like panning, dragging.
 *
 * Single Responsibility: Only manages transient UI state.
 */
export interface WorkflowEphemeralState {
  /** Whether DAG canvas is being panned */
  readonly isPanning: boolean;
  /** Whether panel is being dragged (resized) */
  readonly isPanelDragging: boolean;
  /** Whether minimap is shown (DAG view only) */
  readonly showMinimap: boolean;
}

/**
 * Ephemeral handlers for transient state changes.
 */
export interface WorkflowEphemeralHandlers {
  /** Called when panning state changes */
  readonly onPanningChange: (isPanning: boolean) => void;
  /** Called when panel drag state changes */
  readonly onPanelDraggingChange: (isDragging: boolean) => void;
  /** Toggle minimap visibility */
  readonly toggleMinimap: () => void;
}

// =============================================================================
// Composed State (Full Interface)
// =============================================================================

/**
 * Complete workflow detail state interface.
 *
 * Composed from focused slices for full functionality.
 * This is the return type of useWorkflowDetailState.
 *
 * Usage:
 * ```typescript
 * const state = useWorkflowDetailState({ name, initialView });
 *
 * // Destructure what you need
 * const { data, navigation, panel, computed } = state;
 *
 * // Check readiness
 * if (!state.computed.isReady) return <Loading />;
 *
 * // Use in components
 * return <WorkflowView {...state} />;
 * ```
 */
export interface WorkflowDetailState {
  /** Server data state */
  readonly data: WorkflowDataState;
  /** URL-synced navigation state */
  readonly navigation: WorkflowNavigationState;
  /** Navigation action handlers */
  readonly navigationHandlers: WorkflowNavigationHandlers;
  /** Panel UI state */
  readonly panel: WorkflowPanelState;
  /** Panel action handlers */
  readonly panelHandlers: WorkflowPanelHandlers;
  /** View mode preference (DAG/Table) */
  readonly viewPreference: WorkflowViewPreference;
  /** Derived/computed state */
  readonly computed: WorkflowComputedState;
}

// =============================================================================
// Props Interfaces (For Presentation Layer)
// =============================================================================

/**
 * Props for presentation components that need data + navigation.
 *
 * This is a subset of WorkflowDetailState for components that
 * only need data and navigation, not panel or preferences.
 */
export interface WorkflowDataNavigationProps {
  readonly data: WorkflowDataState;
  readonly navigation: WorkflowNavigationState;
  readonly navigationHandlers: WorkflowNavigationHandlers;
}

/**
 * Props for components that need the full panel interface.
 *
 * Extends data/navigation with panel state and handlers.
 */
export interface WorkflowPanelProps extends WorkflowDataNavigationProps {
  readonly panel: WorkflowPanelState;
  readonly panelHandlers: WorkflowPanelHandlers;
}

/**
 * Props for the view toggle component.
 *
 * Minimal props for the DAG/Table toggle button.
 */
export interface WorkflowViewToggleProps {
  readonly viewMode: "dag" | "table";
  readonly onToggle: () => void;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if data is ready for rendering.
 */
export function isDataReady(data: WorkflowDataState): data is WorkflowDataState & {
  workflow: WorkflowQueryResponse;
  isLoading: false;
  error: null;
  isNotFound: false;
} {
  return !data.isLoading && data.error === null && !data.isNotFound && data.workflow !== null;
}

/**
 * Type guard to check if we're in task view.
 */
export function isTaskView(navigation: WorkflowNavigationState): navigation is WorkflowNavigationState & {
  context: NavigationContext & { view: "task"; group: GroupWithLayout; task: TaskQueryResponse };
} {
  return navigation.context.view === "task" && navigation.context.task !== null;
}

/**
 * Type guard to check if we're in group view.
 */
export function isGroupView(navigation: WorkflowNavigationState): navigation is WorkflowNavigationState & {
  context: NavigationContext & { view: "group"; group: GroupWithLayout };
} {
  return navigation.context.view === "group" && navigation.context.group !== null;
}
