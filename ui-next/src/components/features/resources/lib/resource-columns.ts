/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { defineColumns, selectColumns, COLUMN_MIN_WIDTHS, COLUMN_FLEX } from "@/lib/table-columns";

export type ResourceColumnId = "resource" | "pools" | "platform" | "gpu" | "cpu" | "memory" | "storage";

/**
 * All resource columns with their layout configuration.
 */
export const ALL_RESOURCE_COLUMNS = defineColumns([
  { id: "resource", minWidth: COLUMN_MIN_WIDTHS.TEXT_TRUNCATE, flex: COLUMN_FLEX.PRIMARY },
  { id: "pools", minWidth: COLUMN_MIN_WIDTHS.TEXT_SHORT, flex: COLUMN_FLEX.SECONDARY },
  { id: "platform", minWidth: COLUMN_MIN_WIDTHS.TEXT_SHORT, flex: COLUMN_FLEX.SECONDARY },
  { id: "gpu", minWidth: COLUMN_MIN_WIDTHS.NUMBER_SHORT, flex: COLUMN_FLEX.NUMERIC },
  { id: "cpu", minWidth: COLUMN_MIN_WIDTHS.NUMBER_SHORT, flex: COLUMN_FLEX.NUMERIC },
  { id: "memory", minWidth: COLUMN_MIN_WIDTHS.NUMBER_WITH_UNIT, flex: COLUMN_FLEX.NUMERIC_WIDE },
  { id: "storage", minWidth: COLUMN_MIN_WIDTHS.NUMBER_WITH_UNIT, flex: COLUMN_FLEX.NUMERIC_WIDE },
]);

/**
 * Columns when pools column is shown (cross-pool view).
 */
export const COLUMNS_WITH_POOLS = ALL_RESOURCE_COLUMNS;

/**
 * Columns when pools column is hidden (single pool view).
 */
export const COLUMNS_NO_POOLS = selectColumns(
  ALL_RESOURCE_COLUMNS,
  ["resource", "platform", "gpu", "cpu", "memory", "storage"],
);

/**
 * Column labels for header display.
 */
export const COLUMN_LABELS: Record<ResourceColumnId, string> = {
  resource: "Resource",
  pools: "Pools",
  platform: "Platform",
  gpu: "GPU",
  cpu: "CPU",
  memory: "Memory",
  storage: "Storage",
};

/**
 * Optional columns that can be toggled.
 */
export const OPTIONAL_COLUMNS: { id: ResourceColumnId; label: string; menuLabel: string }[] = [
  { id: "pools", label: "Pools", menuLabel: "Pool Membership" },
  { id: "platform", label: "Platform", menuLabel: "Platform" },
  { id: "gpu", label: "GPU", menuLabel: "GPU Capacity" },
  { id: "cpu", label: "CPU", menuLabel: "CPU Capacity" },
  { id: "memory", label: "Memory", menuLabel: "Memory" },
  { id: "storage", label: "Storage", menuLabel: "Storage" },
];

/**
 * Default visible columns.
 */
export const DEFAULT_VISIBLE_COLUMNS: ResourceColumnId[] = [
  "resource",
  "platform",
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
  "pools",
  "platform",
  "gpu",
  "cpu",
  "memory",
  "storage",
];

/**
 * Get column configuration for a given set of visible column IDs.
 * Maintains the order from DEFAULT_COLUMN_ORDER.
 */
export function getVisibleColumnsConfig(visibleIds: string[]): {
  gridTemplate: string;
  minWidth: number;
  columnIds: ResourceColumnId[];
} {
  // Filter to only valid, visible columns in the correct order
  const orderedVisibleIds = DEFAULT_COLUMN_ORDER.filter(
    (id) => id === "resource" || visibleIds.includes(id)
  );
  
  const config = selectColumns(ALL_RESOURCE_COLUMNS, orderedVisibleIds);
  
  return {
    gridTemplate: config.gridTemplate,
    minWidth: config.minWidth,
    columnIds: orderedVisibleIds,
  };
}
