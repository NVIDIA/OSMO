// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Utils Index
 *
 * Re-exports all utility functions for cleaner imports.
 */

export {
  // Status functions
  getStatusCategory,
  isFailedStatus,
  getStatusOrder,
  statusMatchesState,
  getStatusLabel,
  getStatusStyle,
  getEdgeColor,
  getStatusIcon,
  getStatusIconCompact,
  // Stats computation
  computeTaskStats,
  computeGroupStatus,
  computeGroupDuration,
  // Constants re-exports
  STATUS_STYLES,
  STATUS_CATEGORY_MAP,
  STATUS_SORT_ORDER,
  STATUS_LABELS,
  StatusDisplay,
  STATE_CATEGORIES,
  STATE_CATEGORY_NAMES,
  // Types
  type StatusCategory,
  type StateCategory,
  type TaskStats,
  type GroupStatus,
} from "./status";
