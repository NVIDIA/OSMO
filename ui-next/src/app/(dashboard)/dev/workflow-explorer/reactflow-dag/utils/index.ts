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
  // MiniMap helpers (pure functions)
  getMiniMapNodeColor,
  getMiniMapStrokeColor,
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
