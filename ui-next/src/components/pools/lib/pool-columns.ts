/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import type { ColumnDef, OptionalColumnDef } from "@/lib/table";

export type PoolColumnId = "name" | "description" | "quota" | "capacity" | "platforms" | "backend";

// Column widths:
// - { fit, share }: content-sized minimum, share controls grow/shrink
// - { min, share }: rem-based minimum floor, share controls grow/shrink
// - number: fixed width in rem (no grow/shrink)
export const MANDATORY_COLUMNS: ColumnDef<PoolColumnId>[] = [
  { id: "name", label: "Pool", menuLabel: "Pool Name", width: { fit: true, share: 1.5 }, align: "left", sortable: true },
];

export const OPTIONAL_COLUMNS: OptionalColumnDef<PoolColumnId>[] = [
  { id: "description", label: "Description", menuLabel: "Description", width: { min: 2, share: 2 }, align: "left", sortable: false, defaultVisible: true },
  { id: "quota", label: "Quota (GPU)", menuLabel: "GPU Quota", width: { fit: true, share: 0.8 }, align: "left", sortable: true, defaultVisible: true },
  { id: "capacity", label: "Capacity (GPU)", menuLabel: "GPU Capacity", width: { fit: true, share: 0.8 }, align: "left", sortable: true, defaultVisible: true },
  { id: "platforms", label: "Platforms", menuLabel: "Platforms", width: { min: 6, share: 1.5 }, align: "left", sortable: false, defaultVisible: true },
  { id: "backend", label: "Backend", menuLabel: "Backend", width: { fit: true, share: 0.5 }, align: "left", sortable: true, defaultVisible: false },
];

export const ALL_COLUMNS: ColumnDef<PoolColumnId>[] = [
  ...MANDATORY_COLUMNS,
  ...OPTIONAL_COLUMNS.map(({ defaultVisible, ...rest }) => rest),
];

export const DEFAULT_VISIBLE_OPTIONAL: PoolColumnId[] = OPTIONAL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);
export const DEFAULT_VISIBLE_COLUMNS: PoolColumnId[] = [...MANDATORY_COLUMNS.map((c) => c.id), ...DEFAULT_VISIBLE_OPTIONAL];
export const DEFAULT_COLUMN_ORDER: PoolColumnId[] = ALL_COLUMNS.map((c) => c.id);
export const COLUMN_MAP = new Map(ALL_COLUMNS.map((c) => [c.id, c]));
export const MANDATORY_COLUMN_IDS: ReadonlySet<PoolColumnId> = new Set(MANDATORY_COLUMNS.map((c) => c.id));
