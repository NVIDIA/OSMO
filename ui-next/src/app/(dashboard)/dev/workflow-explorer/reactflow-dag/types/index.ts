// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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
export type { GroupWithLayout, WorkflowWithLayout } from "../../workflow-types";

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
