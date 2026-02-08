/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Column Configuration Factory
 *
 * Creates typed column configuration with type guards and helpers.
 * Reduces boilerplate across pools, resources, workflows, and other features.
 *
 * @example
 * ```ts
 * const poolColumnConfig = createColumnConfig({
 *   columns: ["name", "status", "quota"] as const,
 *   labels: { name: "Pool", status: "Status", quota: "Quota" },
 *   mandatory: ["name"],
 *   defaultVisible: ["name", "status", "quota"],
 *   defaultOrder: ["name", "status", "quota"],
 *   sizeConfig: [...],
 *   defaultSort: { column: "name", direction: "asc" },
 * });
 *
 * // Use the generated helpers
 * poolColumnConfig.isColumnId("name"); // true
 * poolColumnConfig.asColumnIds(["name", "invalid"]); // ["name"]
 * ```
 */

import type { ColumnSizeConfig } from "@/components/data-table/types";
import type { ColumnDefinition } from "@/components/data-table/TableToolbar";

// =============================================================================
// Types
// =============================================================================

export interface ColumnConfigInput<TColumnId extends string> {
  /** All column IDs as a readonly tuple */
  columns: readonly TColumnId[];
  /** Human-readable labels for each column */
  labels: Record<TColumnId, string>;
  /** Columns that cannot be hidden */
  mandatory: readonly TColumnId[];
  /** Columns visible by default */
  defaultVisible: readonly TColumnId[];
  /** Default column order */
  defaultOrder: readonly TColumnId[];
  /** Column size configuration */
  sizeConfig: ColumnSizeConfig[];
  /** Optional columns that can be toggled in the visibility menu */
  optionalColumns?: ColumnDefinition[];
  /** Default sort configuration */
  defaultSort?: { column: TColumnId; direction: "asc" | "desc" };
  /** Default panel width percentage (if feature uses panels) */
  defaultPanelWidth?: number;
}

export interface ColumnConfig<TColumnId extends string> {
  /** Type guard to check if a string is a valid column ID */
  isColumnId: (id: string) => id is TColumnId;
  /** Filter and type an array of strings to column IDs */
  asColumnIds: (ids: string[]) => TColumnId[];
  /** Human-readable labels for each column */
  COLUMN_LABELS: Readonly<Record<TColumnId, string>>;
  /** Set of column IDs that cannot be hidden */
  MANDATORY_COLUMN_IDS: ReadonlySet<TColumnId>;
  /** Columns visible by default */
  DEFAULT_VISIBLE_COLUMNS: readonly TColumnId[];
  /** Default column order */
  DEFAULT_COLUMN_ORDER: readonly TColumnId[];
  /** Column size configuration */
  COLUMN_SIZE_CONFIG: readonly ColumnSizeConfig[];
  /** Optional columns that can be toggled */
  OPTIONAL_COLUMNS: readonly ColumnDefinition[];
  /** Default sort configuration */
  DEFAULT_SORT: { column: TColumnId; direction: "asc" | "desc" };
  /** Default panel width percentage */
  DEFAULT_PANEL_WIDTH: number;
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a typed column configuration with helpers.
 *
 * @param config - Column configuration input
 * @returns Column configuration with type guards and constants
 */
export function createColumnConfig<TColumnId extends string>(
  config: ColumnConfigInput<TColumnId>,
): ColumnConfig<TColumnId> {
  const validColumnIds = new Set<string>(config.columns);

  // Type guard
  const isColumnId = (id: string): id is TColumnId => validColumnIds.has(id);

  // Type cast helper
  const asColumnIds = (ids: string[]): TColumnId[] => ids.filter(isColumnId);

  // Build optional columns from labels if not provided
  const optionalColumns: ColumnDefinition[] =
    config.optionalColumns ??
    config.columns
      .filter((id) => !config.mandatory.includes(id))
      .map((id) => ({
        id,
        label: config.labels[id],
        menuLabel: config.labels[id],
      }));

  return {
    isColumnId,
    asColumnIds,
    COLUMN_LABELS: Object.freeze({ ...config.labels }),
    MANDATORY_COLUMN_IDS: new Set(config.mandatory),
    DEFAULT_VISIBLE_COLUMNS: Object.freeze([...config.defaultVisible]),
    DEFAULT_COLUMN_ORDER: Object.freeze([...config.defaultOrder]),
    COLUMN_SIZE_CONFIG: Object.freeze([...config.sizeConfig]),
    OPTIONAL_COLUMNS: Object.freeze(optionalColumns),
    DEFAULT_SORT: config.defaultSort ?? { column: config.columns[0], direction: "asc" as const },
    DEFAULT_PANEL_WIDTH: config.defaultPanelWidth ?? 40,
  };
}
