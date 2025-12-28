// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Status Utilities
 *
 * Helper functions for task/group status categorization, icons, and styling.
 * Follows the production pattern from lib/constants/ui.ts (PoolStatusDisplay).
 */

import { memo } from "react";
import { Clock, Loader2, CheckCircle, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_STYLES, type StatusCategory } from "../constants";
import {
  getStatusCategory as getStatusCategoryFromTypes,
  isFailedStatus as isFailedStatusFromTypes,
} from "../../workflow-types";

// =============================================================================
// Re-exports from workflow-types
// =============================================================================

export const getStatusCategory = getStatusCategoryFromTypes;
export const isFailedStatus = isFailedStatusFromTypes;

// =============================================================================
// Status Display Configuration
// =============================================================================

/**
 * Status display configuration for DAG nodes and tasks.
 * Keys match StatusCategory values.
 *
 * @example
 * ```tsx
 * const { Icon, label, iconClass } = StatusDisplay[category];
 * return <Icon className={iconClass} aria-label={label} />;
 * ```
 */
export const StatusDisplay: Record<
  StatusCategory,
  {
    Icon: LucideIcon;
    label: string;
    iconClass: string;
    animate?: string;
  }
> = {
  waiting: {
    Icon: Clock,
    label: "Waiting",
    iconClass: "text-zinc-400",
  },
  running: {
    Icon: Loader2,
    label: "Running",
    iconClass: "text-blue-400",
    animate: "animate-spin motion-reduce:animate-none",
  },
  completed: {
    Icon: CheckCircle,
    label: "Completed",
    iconClass: "text-emerald-400",
  },
  failed: {
    Icon: XCircle,
    label: "Failed",
    iconClass: "text-red-400",
  },
} as const;

// =============================================================================
// Status Icon Component (Memoized)
// =============================================================================

interface StatusIconProps {
  status: string;
  size?: string;
}

/**
 * Memoized status icon component.
 * Prevents icon re-creation on every parent render.
 */
const StatusIconComponent = memo(function StatusIcon({ status, size = "h-4 w-4" }: StatusIconProps) {
  const category = getStatusCategory(status);
  const { Icon, iconClass, animate } = StatusDisplay[category];

  return (
    <Icon
      className={cn(size, iconClass, animate)}
      aria-hidden="true"
    />
  );
});

/**
 * Get the appropriate status icon for a given status.
 *
 * @param status - The status string from the backend
 * @param size - Tailwind size classes (default "h-4 w-4")
 * @returns JSX element for the status icon
 *
 * @example
 * ```tsx
 * {getStatusIcon(task.status, "h-3 w-3")}
 * ```
 */
export function getStatusIcon(status: string, size = "h-4 w-4") {
  return (
    <StatusIconComponent
      status={status}
      size={size}
    />
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get styling for a status category.
 *
 * @param status - The status string from the backend
 * @returns Status styling object from STATUS_STYLES
 */
export function getStatusStyle(status: string) {
  const category = getStatusCategory(status);
  return STATUS_STYLES[category];
}

/**
 * Get edge color for a status category.
 *
 * @param category - The status category
 * @returns Hex color string for edge stroke
 */
export function getEdgeColor(category: StatusCategory): string {
  return STATUS_STYLES[category].color;
}

/**
 * Get accessible status label.
 *
 * @param status - The status string from the backend
 * @returns Human-readable status label for accessibility
 */
export function getStatusLabel(status: string): string {
  const category = getStatusCategory(status);
  return StatusDisplay[category].label;
}
