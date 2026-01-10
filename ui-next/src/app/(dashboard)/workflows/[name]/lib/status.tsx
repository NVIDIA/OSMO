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
 * Task/Group Status Utilities
 *
 * Re-exports pure functions from status-utils.ts and adds React components.
 *
 * Architecture:
 * - status-utils.ts: Pure functions (testable, no React dependencies)
 * - status.tsx: React components + re-exports from status-utils
 *
 * This split enables easier testing of the pure logic while keeping
 * the API surface the same for consumers.
 */

"use client";

import { memo } from "react";
import { Clock, Loader2, CheckCircle, XCircle, AlertCircle, Check, Circle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GroupNodeData } from "./dag-layout";

// =============================================================================
// Re-export Pure Functions and Constants from status-utils.ts
// =============================================================================

export {
  // Types
  type StatusCategory,
  type StateCategory,
  type TaskStats,
  type GroupStatus,
  // Bitwise checks
  isFailedFast,
  isRunningFast,
  isCompletedFast,
  isWaitingFast,
  isFailedStatus,
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
} from "./status-utils";

import { getStatusCategory, STATUS_STYLES } from "./status-utils";
import type { StatusCategory } from "./status-utils";

// =============================================================================
// Status Icon Components (Optimized with Pre-rendering)
// =============================================================================

/** Icon configuration per category */
const ICON_CONFIG: Record<StatusCategory, { Icon: LucideIcon; className: string }> = {
  waiting: { Icon: Clock, className: "text-gray-400 dark:text-zinc-400" },
  running: { Icon: Loader2, className: "text-blue-400 animate-spin motion-reduce:animate-none" },
  completed: { Icon: CheckCircle, className: "text-emerald-400" },
  failed: { Icon: XCircle, className: "text-red-400" },
};

/** Compact icon configuration for tables */
const COMPACT_ICON_CONFIG: Record<StatusCategory, { Icon: LucideIcon; className: string }> = {
  waiting: { Icon: Clock, className: "text-gray-400 dark:text-zinc-400" },
  running: { Icon: Loader2, className: "text-blue-500 animate-spin motion-reduce:animate-none" },
  completed: { Icon: Check, className: "text-emerald-500" },
  failed: { Icon: AlertCircle, className: "text-red-500" },
};

// =============================================================================
// Pre-rendered Icon Cache
//
// Instead of creating new React elements on every render, we pre-render
// icons for common sizes and cache them. This eliminates:
// - Object allocation for props
// - React.createElement calls
// - Reconciliation work for identical elements
// =============================================================================

/** Cache key format: "category:size" */
type IconCacheKey = `${StatusCategory}:${string}`;

/** Pre-rendered icon element cache (module-level singleton) */
const iconCache = new Map<IconCacheKey, React.ReactNode>();
const compactIconCache = new Map<IconCacheKey, React.ReactNode>();

/** Generate and cache a status icon */
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

/** Generate and cache a compact status icon */
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

/**
 * Get the appropriate status icon for a given status.
 *
 * Performance: Uses pre-rendered icon cache for common sizes.
 * First call for a category+size combo creates the element,
 * subsequent calls return the cached React element directly.
 */
export function getStatusIcon(status: string, size = "size-4") {
  return (
    <StatusIconLucide
      status={status}
      size={size}
    />
  );
}

/**
 * Get a compact status icon for table rows.
 *
 * Performance: Uses pre-rendered icon cache for common sizes.
 */
export function getStatusIconCompact(status: string, size = "size-3.5") {
  return (
    <StatusIconCompact
      status={status}
      size={size}
    />
  );
}

// =============================================================================
// MiniMap Color Helpers (for ReactFlow)
// =============================================================================

/** Get node fill color for MiniMap based on status. */
export function getMiniMapNodeColor(node: { data: unknown }): string {
  const data = node.data as GroupNodeData;
  if (!data?.group) return "#52525b";
  const category = getStatusCategory(data.group.status);
  return STATUS_STYLES[category].color;
}

/** Get node stroke color for MiniMap based on status. */
export function getMiniMapStrokeColor(node: { data: unknown }): string {
  const data = node.data as GroupNodeData;
  if (!data?.group) return "#3f3f46";
  const category = getStatusCategory(data.group.status);
  return STATUS_STYLES[category].strokeColor;
}

// =============================================================================
// Cold Start Optimization: Prewarm Icon Cache
// =============================================================================

/**
 * Prewarm the icon cache during browser idle time.
 * This ensures icons are ready before they're needed, eliminating
 * first-render allocation overhead.
 */
function prewarmIconCache(): void {
  const categories: StatusCategory[] = ["waiting", "running", "completed", "failed"];
  const sizes = ["size-3", "size-3.5", "size-4"];

  for (const category of categories) {
    for (const size of sizes) {
      getCachedIcon(category, size);
      getCachedCompactIcon(category, size);
    }
  }
}

// Schedule prewarm during idle time after module load
if (typeof window !== "undefined") {
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(() => prewarmIconCache(), { timeout: 3000 });
  } else {
    // Fallback for Safari
    setTimeout(prewarmIconCache, 200);
  }
}
