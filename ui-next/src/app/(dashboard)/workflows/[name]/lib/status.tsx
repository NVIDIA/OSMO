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

// Status utilities with React components. Pure functions are in status-utils.ts.

"use client";

import { memo, useMemo } from "react";
import { useTheme } from "next-themes";
import { Clock, Loader2, CheckCircle, XCircle, AlertCircle, Check, Circle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GroupNodeData } from "@/app/(dashboard)/workflows/[name]/lib/dag-layout";

export {
  // Types
  type StatusCategory,
  type StateCategory,
  type TaskStats,
  type GroupStatus,
  // Category and label functions
  getStatusCategory,
  getStatusLabel,
  getStatusStyle,
  // Stats computation
  computeTaskStats,
  computeGroupStatus,
  computeGroupDuration,
  // Constants
  STATUS_CATEGORY_MAP,
  STATUS_SORT_ORDER,
  STATUS_LABELS,
  STATUS_STYLES,
  STATE_CATEGORIES,
  STATE_CATEGORY_NAMES,
  // Generated metadata (from Python backend)
  TASK_STATUS_METADATA,
  getTaskStatusCategory,
  isTaskOngoing,
  isTaskTerminal,
  isTaskFailed,
  isTaskInQueue,
} from "@/app/(dashboard)/workflows/[name]/lib/status-utils";

import { getStatusCategory, STATUS_STYLES } from "@/app/(dashboard)/workflows/[name]/lib/status-utils";
import type { StatusCategory } from "@/app/(dashboard)/workflows/[name]/lib/status-utils";

const ICON_CONFIG: Record<StatusCategory, { Icon: LucideIcon; className: string }> = {
  waiting: { Icon: Clock, className: "text-gray-400 dark:text-zinc-400" },
  pending: { Icon: Loader2, className: "text-amber-400 animate-spin motion-reduce:animate-none" },
  running: { Icon: Loader2, className: "text-blue-400 animate-spin motion-reduce:animate-none" },
  completed: { Icon: CheckCircle, className: "text-emerald-400" },
  failed: { Icon: XCircle, className: "text-red-400" },
};

const COMPACT_ICON_CONFIG: Record<StatusCategory, { Icon: LucideIcon; className: string }> = {
  waiting: { Icon: Clock, className: "text-gray-400 dark:text-zinc-400" },
  pending: { Icon: Loader2, className: "text-amber-500 animate-spin motion-reduce:animate-none" },
  running: { Icon: Loader2, className: "text-blue-500 animate-spin motion-reduce:animate-none" },
  completed: { Icon: Check, className: "text-emerald-500" },
  failed: { Icon: AlertCircle, className: "text-red-500" },
};

// Pre-rendered icon cache for performance (avoids element allocation on every render)
type IconCacheKey = `${StatusCategory}:${string}`;

/** Pre-rendered icon element cache (module-level singleton) */
const iconCache = new Map<IconCacheKey, React.ReactNode>();
const compactIconCache = new Map<IconCacheKey, React.ReactNode>();

function getCachedIcon(category: StatusCategory, size: string): React.ReactNode {
  const key: IconCacheKey = `${category}:${size}`;
  let cached = iconCache.get(key);
  if (!cached) {
    const { Icon, className: iconClass } = ICON_CONFIG[category];
    cached = (
      <Icon
        className={cn(size, iconClass)}
        aria-hidden="true"
      />
    );
    iconCache.set(key, cached);
  }
  return cached;
}

function getCachedCompactIcon(category: StatusCategory, size: string): React.ReactNode {
  const key: IconCacheKey = `${category}:${size}`;
  let cached = compactIconCache.get(key);
  if (!cached) {
    const config = COMPACT_ICON_CONFIG[category];
    const { Icon, className: iconClass } = config;
    cached = (
      <Icon
        className={cn(size, iconClass)}
        aria-hidden="true"
      />
    );
    compactIconCache.set(key, cached);
  }
  return cached;
}

interface StatusIconProps {
  status: string;
  size?: string;
  className?: string;
}

const StatusIconLucide = memo(function StatusIconLucide({ status, size = "size-4", className }: StatusIconProps) {
  const category = getStatusCategory(status);

  // Fast path: use cached icon if no custom className
  if (!className) {
    return getCachedIcon(category, size);
  }

  // Slow path: create new element with custom className
  const { Icon, className: iconClass } = ICON_CONFIG[category];
  return (
    <Icon
      className={cn(size, iconClass, className)}
      aria-hidden="true"
    />
  );
});

const StatusIconCompact = memo(function StatusIconCompact({ status, size = "size-3.5", className }: StatusIconProps) {
  const category = getStatusCategory(status);
  const config = COMPACT_ICON_CONFIG[category];
  if (!config) {
    return (
      <Circle
        className={cn(size, "text-gray-400 dark:text-zinc-400", className)}
        aria-hidden="true"
      />
    );
  }

  // Fast path: use cached icon if no custom className
  if (!className) {
    return getCachedCompactIcon(category, size);
  }

  // Slow path: create new element with custom className
  const { Icon, className: iconClass } = config;
  return (
    <Icon
      className={cn(size, iconClass, className)}
      aria-hidden="true"
    />
  );
});

export function getStatusIcon(status: string, size = "size-4") {
  return (
    <StatusIconLucide
      status={status}
      size={size}
    />
  );
}

export function getStatusIconCompact(status: string, size = "size-3.5") {
  return (
    <StatusIconCompact
      status={status}
      size={size}
    />
  );
}

/**
 * Hook to get theme-aware minimap color functions.
 * Returns memoized color and strokeColor functions that adapt to the current theme.
 *
 * Usage:
 * ```tsx
 * const { getMiniMapNodeColor, getMiniMapStrokeColor } = useMiniMapColors();
 * ```
 */
export function useMiniMapColors() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  // Memoize the color functions to prevent unnecessary re-renders
  return useMemo(() => {
    const getMiniMapNodeColor = (node: { data: unknown }): string => {
      const data = node.data as GroupNodeData;
      if (!data?.group) {
        // Read CSS variable for theme-aware colors
        return getComputedStyle(document.documentElement).getPropertyValue("--minimap-node-fill").trim();
      }
      const category = getStatusCategory(data.group.status);
      const themeColors = isDark ? STATUS_STYLES[category].dark : STATUS_STYLES[category].light;
      return themeColors.color;
    };

    const getMiniMapStrokeColor = (node: { data: unknown }): string => {
      const data = node.data as GroupNodeData;
      if (!data?.group) {
        // Read CSS variable for theme-aware colors
        return getComputedStyle(document.documentElement).getPropertyValue("--minimap-node-stroke").trim();
      }
      const category = getStatusCategory(data.group.status);
      const themeColors = isDark ? STATUS_STYLES[category].dark : STATUS_STYLES[category].light;
      return themeColors.strokeColor;
    };

    return { getMiniMapNodeColor, getMiniMapStrokeColor };
  }, [isDark]);
}

// Prewarm icon cache during idle time with deadline-aware chunking
// This avoids long task violations by yielding to the browser when time runs out
function prewarmIconCache(deadline?: IdleDeadline): void {
  const categories: StatusCategory[] = ["waiting", "pending", "running", "completed", "failed"];
  const sizes = ["size-3", "size-3.5", "size-4"];

  // Use a generator to enable incremental processing
  const items: Array<{ category: StatusCategory; size: string }> = [];
  for (const category of categories) {
    for (const size of sizes) {
      items.push({ category, size });
    }
  }

  // Track progress across calls
  let index = (prewarmIconCache as { _index?: number })._index ?? 0;

  // Process items while we have time remaining (or process all if no deadline)
  while (index < items.length) {
    // If we have a deadline, check if we should yield
    if (deadline && deadline.timeRemaining() < 2) {
      // Save progress and reschedule
      (prewarmIconCache as { _index?: number })._index = index;
      requestIdleCallback(prewarmIconCache, { timeout: 3000 });
      return;
    }

    const { category, size } = items[index];
    getCachedIcon(category, size);
    getCachedCompactIcon(category, size);
    index++;
  }

  // Reset index for potential future calls
  (prewarmIconCache as { _index?: number })._index = 0;
}

// Schedule prewarm during idle time after module load
if (typeof window !== "undefined") {
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(prewarmIconCache, { timeout: 3000 });
  } else {
    // Safari fallback: Use RAF to spread work across frames
    // Process one item per frame to avoid long task violations
    const categories: StatusCategory[] = ["waiting", "pending", "running", "completed", "failed"];
    const sizes = ["size-3", "size-3.5", "size-4"];
    const items: Array<{ category: StatusCategory; size: string }> = [];
    for (const category of categories) {
      for (const size of sizes) {
        items.push({ category, size });
      }
    }

    let index = 0;
    const processNextItem = () => {
      if (index < items.length) {
        const { category, size } = items[index];
        getCachedIcon(category, size);
        getCachedCompactIcon(category, size);
        index++;
        requestAnimationFrame(processNextItem);
      }
    };

    // Start after initial render settles
    requestAnimationFrame(processNextItem);
  }
}
