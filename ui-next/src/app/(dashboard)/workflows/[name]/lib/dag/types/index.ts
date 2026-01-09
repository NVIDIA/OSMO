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
 * Organizes types into logical categories:
 *
 * 1. Backend types (from API generated code)
 * 2. Layout types (DAG visualization)
 * 3. Panel types (DetailsPanel, GroupDetails, TaskDetails)
 * 4. Table types (columns, sorting, search)
 */

// ============================================================================
// Backend Types (from generated API)
// ============================================================================

export type { GroupQueryResponse, TaskQueryResponse, WorkflowQueryResponse } from "@/lib/api/generated";

export { TaskGroupStatus } from "@/lib/api/generated";

// Frontend extension of backend types
export type { GroupWithLayout, WorkflowWithLayout } from "../workflow-types";

// ============================================================================
// Layout Types
// ============================================================================

export type {
  LayoutDirection,
  NodeDimensions,
  GroupNodeData,
  LayoutResult,
  ElkNode,
  ElkEdge,
  ElkGraph,
  ElkLayoutNode,
  ElkLayoutResult,
} from "./dag-layout";

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
// Table Types (columns, sorting, search)
// ============================================================================

export type {
  TaskWithDuration,
  ColumnId,
  ColumnWidth,
  ColumnDef,
  OptionalColumnDef,
  SortColumn,
  SortDirection,
  SortState,
  SearchChip,
  SearchField,
} from "./table";
