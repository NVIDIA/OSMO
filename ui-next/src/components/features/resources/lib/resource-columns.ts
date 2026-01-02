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

export type ResourceColumnId = "resource" | "type" | "pools" | "platform" | "backend" | "gpu" | "cpu" | "memory" | "storage";

/**
 * All resource columns with their layout configuration.
 */
export const ALL_RESOURCE_COLUMNS = defineColumns([
  { id: "resource", minWidth: COLUMN_MIN_WIDTHS.TEXT_TRUNCATE, flex: COLUMN_FLEX.PRIMARY },
  { id: "type", minWidth: 90, flex: 0.8 },
  { id: "pools", minWidth: COLUMN_MIN_WIDTHS.TEXT_SHORT, flex: COLUMN_FLEX.SECONDARY },
  { id: "platform", minWidth: COLUMN_MIN_WIDTHS.TEXT_SHORT, flex: COLUMN_FLEX.SECONDARY },
  { id: "backend", minWidth: 70, flex: COLUMN_FLEX.TERTIARY },
  { id: "gpu", minWidth: COLUMN_MIN_WIDTHS.NUMBER_SHORT, flex: COLUMN_FLEX.NUMERIC },
  { id: "cpu", minWidth: COLUMN_MIN_WIDTHS.NUMBER_SHORT, flex: COLUMN_FLEX.NUMERIC },
  { id: "memory", minWidth: COLUMN_MIN_WIDTHS.NUMBER_SHORT, flex: COLUMN_FLEX.NUMERIC },
  { id: "storage", minWidth: COLUMN_MIN_WIDTHS.NUMBER_SHORT, flex: COLUMN_FLEX.NUMERIC },
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
 * Get column configuration for a given set of visible column IDs.
 * Respects the provided column order.
 */
export function getVisibleColumnsConfig(
  visibleIds: string[],
  columnOrder: ResourceColumnId[] = DEFAULT_COLUMN_ORDER,
): {
  gridTemplate: string;
  minWidth: number;
  columnIds: ResourceColumnId[];
} {
  // Filter to only valid, visible columns in the user's order
  const orderedVisibleIds = columnOrder.filter(
    (id) => id === "resource" || visibleIds.includes(id)
  );

  const config = selectColumns(ALL_RESOURCE_COLUMNS, orderedVisibleIds);

  return {
    gridTemplate: config.gridTemplate,
    minWidth: config.minWidth,
    columnIds: orderedVisibleIds,
  };
}
