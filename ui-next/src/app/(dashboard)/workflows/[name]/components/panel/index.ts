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
 * Panel Components
 *
 * Unified inspector panel for workflow, group, and task details.
 * Re-exports all panel-related components from a single entry point.
 *
 * Main Components:
 * - DetailsPanel: Main container with resize, collapse, and view switching
 * - WorkflowDetails: Workflow-level info (base layer)
 * - GroupDetails: Task list with search, sort, filter
 * - TaskDetails: Task info, actions, sibling navigation
 *
 * Supporting Components:
 * - DetailsPanelHeader: Shared header with breadcrumbs, menus, badges
 * - GroupTimeline: Visual timeline for group lifecycle
 * - TaskTimeline: Visual timeline for task lifecycle
 * - DependencyPills: Upstream/downstream group navigation
 */

// Main panel components
export { DetailsPanel } from "./DetailsPanel";
export { WorkflowDetails } from "./WorkflowDetails";
export type { WorkflowDetailsProps } from "./WorkflowDetails";
export { GroupDetails } from "./GroupDetails";
export { TaskDetails } from "./TaskDetails";

// Header and supporting components
export { DetailsPanelHeader, ColumnMenuContent } from "./DetailsPanelHeader";
export type { HeaderViewType } from "./DetailsPanelHeader";

// Timeline components
export { GroupTimeline } from "./GroupTimeline";
export { TaskTimeline } from "./TaskTimeline";

// Dependency pills
export { DependencyPills } from "./DependencyPills";

// Re-export types from lib/panel for convenience
export type {
  DetailsPanelView,
  DetailsPanelProps,
  GroupDetailsProps,
  TaskDetailsProps,
  DetailsPanelHeaderProps,
  SiblingTask,
  BreadcrumbSegment,
} from "../../lib/panel-types";
