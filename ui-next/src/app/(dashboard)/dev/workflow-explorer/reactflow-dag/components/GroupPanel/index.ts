// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * GroupPanel Utilities
 *
 * Shared utilities for task tables: search, virtualization, columns.
 * The main GroupPanel component has been consolidated into DetailsPanel/GroupDetails.
 */

export { SmartSearch, filterTasksByChips } from "./SmartSearch";
export { VirtualizedTaskList } from "./TaskTable";
export type { TaskWithDuration, SearchChip, ColumnId, SortState, SortColumn, ColumnDef } from "./types";
