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

import { PoolStatus } from "@/lib/api/generated";

// Re-export from canonical locations
export type { DisplayMode } from "@/stores";

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

// Tailwind classes for status styling
export const STATUS_STYLES = {
  online: {
    dot: "bg-emerald-500",
    badge: {
      bg: "bg-emerald-100 dark:bg-emerald-900/50",
      text: "text-emerald-700 dark:text-emerald-300",
      icon: "text-emerald-600 dark:text-emerald-400",
    },
  },
  maintenance: {
    dot: "bg-amber-500",
    badge: {
      bg: "bg-amber-100 dark:bg-amber-900/50",
      text: "text-amber-700 dark:text-amber-300",
      icon: "text-amber-600 dark:text-amber-400",
    },
  },
  offline: {
    dot: "bg-red-500",
    badge: {
      bg: "bg-red-100 dark:bg-red-900/50",
      text: "text-red-700 dark:text-red-300",
      icon: "text-red-600 dark:text-red-400",
    },
  },
} as const;

export function getStatusStyles(status: string) {
  return STATUS_STYLES[getStatusDisplay(status).category];
}
