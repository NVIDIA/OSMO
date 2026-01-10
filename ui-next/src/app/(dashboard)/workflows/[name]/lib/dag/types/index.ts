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
 * DAG Types - Consolidated Exports
 *
 * Single entry point for all DAG-related types.
 * Re-exports generic types from @/components/dag and adds workflow-specific types.
 */

// ============================================================================
// Generic Types (from @/components/dag)
// ============================================================================

export type {
  LayoutDirection,
  NodeDimensions,
  LayoutResult,
  LayoutPosition,
  LayoutPositionResult,
  ElkNode,
  ElkEdge,
  ElkGraph,
  ElkLayoutNode,
  ElkLayoutResult,
  EdgeStyle,
  OnNodeSelect,
  OnNodeToggleExpand,
} from "@/components/dag";

// ============================================================================
// Backend Types (from generated API)
// ============================================================================

export type { GroupQueryResponse, TaskQueryResponse, WorkflowQueryResponse } from "@/lib/api/generated";

export { TaskGroupStatus } from "@/lib/api/generated";

// Frontend extension of backend types
export type { GroupWithLayout, WorkflowWithLayout } from "../workflow-types";

// ============================================================================
// Workflow-Specific Layout Types
// ============================================================================

export type { GroupNodeData } from "./dag-layout";

// ============================================================================
// Panel Types
// ============================================================================

export type {
  DetailsPanelView,
  DetailsPanelProps,
  GroupDetailsProps,
  TaskDetailsProps,
  HeaderViewType,
  SiblingTask,
  DetailsPanelHeaderProps,
} from "./panel";

// ============================================================================
// Table Types
// ============================================================================

export type { TaskWithDuration } from "../workflow-types";

// Column types are now defined in components/GroupPanel/task-columns.ts
export type { TaskColumnId } from "../components/GroupPanel/task-columns";

// Sort and search types are from canonical data-table and smart-search components
export type { SortState, SortDirection } from "@/components/data-table";
export type { SearchChip, SearchField } from "@/components/smart-search";
