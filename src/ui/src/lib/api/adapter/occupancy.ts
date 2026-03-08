//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Occupancy types — the shape of aggregated task summary data used by the occupancy page.
 *
 * Raw data source: GET /api/task?summary=true → ListTaskSummaryEntry[]
 * One entry per (user, pool, priority) — pre-aggregated by the backend.
 *
 * The occupancy shim (occupancy-shim.ts) further aggregates these into OccupancyGroup[]
 * keyed by user or pool, depending on the groupBy setting.
 */

// =============================================================================
// Aggregated Types
// =============================================================================

/** One aggregated row per user (groupBy=user) or pool (groupBy=pool). */
export interface OccupancyGroup {
  /** Primary key: user name when groupBy=user, pool name when groupBy=pool */
  key: string;
  /** Total GPU slots in use across all workflows for this group */
  gpu: number;
  /** Total CPU cores in use */
  cpu: number;
  /** Total memory in use */
  memory: number;
  /** Total storage in use */
  storage: number;
  /** Count of HIGH priority workflows */
  high: number;
  /** Count of NORMAL priority workflows */
  normal: number;
  /** Count of LOW priority workflows */
  low: number;
  /** Children: pools (when groupBy=user) or users (when groupBy=pool) */
  children: OccupancyChild[];
}

/** A child row within an OccupancyGroup. */
export interface OccupancyChild {
  /** Secondary key: pool name (when groupBy=user) or user name (when groupBy=pool) */
  key: string;
  gpu: number;
  cpu: number;
  memory: number;
  storage: number;
  high: number;
  normal: number;
  low: number;
}

// =============================================================================
// Flat Row (discriminated union for DataTable)
// =============================================================================

/**
 * Flat row for DataTable rendering — discriminated union of parent and child rows.
 *
 * flattenForTable() converts OccupancyGroup[] → OccupancyFlatRow[] by interleaving
 * parent rows with their visible children (when expanded).
 */
export type OccupancyFlatRow =
  | ({
      _type: "parent";
      isExpanded: boolean;
      childCount: number;
      /** Index of this group among all groups — used for zebra striping */
      _visualGroupIndex: number;
    } & OccupancyGroup)
  | ({
      _type: "child";
      parentKey: string;
      /** Inherited from parent — children share the same stripe as their parent */
      _visualGroupIndex: number;
    } & OccupancyChild);

// =============================================================================
// Config Types
// =============================================================================

export type OccupancyGroupBy = "user" | "pool";
export type OccupancySortBy = "key" | "gpu" | "cpu" | "memory" | "storage";

// =============================================================================
// Summary Totals (for KPI cards)
// =============================================================================

export type OccupancyTotals = Omit<OccupancyGroup, "key" | "children">;
