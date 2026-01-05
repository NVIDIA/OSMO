/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { PoolStatus } from "@/lib/api/generated";

// Re-export from canonical locations
export type { DisplayMode } from "@/stores";
export { PANEL } from "@/components/panel";

export type StatusCategory = "online" | "maintenance" | "offline";

export interface StatusDisplay {
  category: StatusCategory;
  label: string;
  sortOrder: number;
}

const STATUS_DISPLAYS: Record<string, StatusDisplay> = {
  [PoolStatus.ONLINE]: { category: "online", label: "Online", sortOrder: 0 },
  [PoolStatus.MAINTENANCE]: { category: "maintenance", label: "Maintenance", sortOrder: 1 },
  [PoolStatus.OFFLINE]: { category: "offline", label: "Offline", sortOrder: 2 },
};

export function getStatusDisplay(status: string): StatusDisplay {
  return STATUS_DISPLAYS[status] ?? { category: "offline", label: status, sortOrder: 99 };
}

export const STATUS_ORDER = [PoolStatus.ONLINE, PoolStatus.MAINTENANCE, PoolStatus.OFFLINE];

// Tailwind classes for status styling (used in pool-panel)
export const STATUS_STYLES = {
  online: { dot: "bg-emerald-500" },
  maintenance: { dot: "bg-amber-500" },
  offline: { dot: "bg-red-500" },
} as const;

export function getStatusStyles(status: string) {
  return STATUS_STYLES[getStatusDisplay(status).category];
}
