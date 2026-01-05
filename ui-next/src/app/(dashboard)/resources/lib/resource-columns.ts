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

import { COLUMN_MIN_WIDTHS_REM, COLUMN_FLEX } from "@/components/data-table";
import type { ColumnSizeConfig } from "@/components/data-table";

export type ResourceColumnId =
  | "resource"
  | "hostname"
  | "type"
  | "pools"
  | "platform"
  | "backend"
  | "gpu"
  | "cpu"
  | "memory"
  | "storage";

/** Set of all valid resource column IDs for type validation */
const VALID_COLUMN_IDS = new Set<string>([
  "resource",
  "hostname",
  "type",
  "pools",
  "platform",
  "backend",
  "gpu",
  "cpu",
  "memory",
  "storage",
]);

/** Type guard to check if a string is a valid ResourceColumnId */
export function isResourceColumnId(id: string): id is ResourceColumnId {
  return VALID_COLUMN_IDS.has(id);
}

/** Filter and type an array of strings to ResourceColumnId[] (filters out invalid IDs) */
export function asResourceColumnIds(ids: string[]): ResourceColumnId[] {
  return ids.filter(isResourceColumnId);
}

/**
 * Column labels for header display.
 */
export const COLUMN_LABELS: Record<ResourceColumnId, string> = {
  resource: "Resource",
  hostname: "Hostname",
  type: "Type",
  pools: "Pools",
  platform: "Platform",
  backend: "Backend",
  gpu: "GPU",
  cpu: "CPU",
  memory: "Memory",
  storage: "Storage",
};

/**
 * Optional columns that can be toggled.
 */
export const OPTIONAL_COLUMNS: { id: ResourceColumnId; label: string; menuLabel: string }[] = [
  { id: "type", label: "Type", menuLabel: "Type" },
  { id: "pools", label: "Pools", menuLabel: "Pools" },
  { id: "platform", label: "Platform", menuLabel: "Platform" },
  { id: "backend", label: "Backend", menuLabel: "Backend" },
  { id: "hostname", label: "Hostname", menuLabel: "Hostname" },
  { id: "gpu", label: "GPU", menuLabel: "GPU" },
  { id: "cpu", label: "CPU", menuLabel: "CPU" },
  { id: "memory", label: "Memory", menuLabel: "Memory" },
  { id: "storage", label: "Storage", menuLabel: "Storage" },
];

/**
 * Default visible columns.
 */
export const DEFAULT_VISIBLE_COLUMNS: ResourceColumnId[] = [
  "resource",
  "type",
  "platform",
  "backend",
  "gpu",
  "cpu",
  "memory",
  "storage",
];

/**
 * Default column order.
 */
export const DEFAULT_COLUMN_ORDER: ResourceColumnId[] = [
  "resource",
  "type",
  "pools",
  "platform",
  "backend",
  "hostname",
  "gpu",
  "cpu",
  "memory",
  "storage",
];

/**
 * Mandatory columns that cannot be reordered (always first).
 */
export const MANDATORY_COLUMN_IDS = new Set<ResourceColumnId>(["resource"]);

/**
 * Default sort configuration.
 */
export const DEFAULT_SORT = { column: "resource" as ResourceColumnId, direction: "asc" as const };

/**
 * Default panel width percentage.
 */
export const DEFAULT_PANEL_WIDTH = 40;

/**
 * Column sizing configuration for the new DataTable.
 *
 * Uses rem-based minimum widths for accessibility (scales with user font size).
 * At 16px base: 1rem = 16px.
 *
 * - minWidthRem: Minimum width in rem units
 * - share: Proportional weight for space distribution (like CSS flex-grow)
 */
export const RESOURCE_COLUMN_SIZE_CONFIG: ColumnSizeConfig[] = [
  { id: "resource", minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE, share: COLUMN_FLEX.PRIMARY },
  { id: "type", minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT, share: COLUMN_FLEX.TERTIARY },
  { id: "pools", minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE, share: COLUMN_FLEX.SECONDARY },
  { id: "platform", minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT, share: COLUMN_FLEX.SECONDARY },
  { id: "backend", minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT, share: COLUMN_FLEX.TERTIARY },
  { id: "hostname", minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT, share: COLUMN_FLEX.SECONDARY },
  { id: "gpu", minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT, share: COLUMN_FLEX.NUMERIC },
  { id: "cpu", minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT, share: COLUMN_FLEX.NUMERIC },
  { id: "memory", minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_WITH_UNIT, share: COLUMN_FLEX.NUMERIC_WIDE },
  { id: "storage", minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_WITH_UNIT, share: COLUMN_FLEX.NUMERIC_WIDE },
];
