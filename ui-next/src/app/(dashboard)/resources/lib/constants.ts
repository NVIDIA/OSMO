/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

// Re-export PANEL from canonical location
export { PANEL } from "@/components/panel";

// Layout constants specific to resources table
export const LAYOUT = {
  HEADER_HEIGHT: 41,
  ROW_HEIGHT: 48,
  ROW_HEIGHT_COMPACT: 32,
} as const;

// =============================================================================
// Resource Allocation Type Display
// =============================================================================

/**
 * Display configuration for resource allocation types.
 * Used for consistent styling of resource type badges across the UI.
 */
export const ResourceAllocationTypeDisplay = {
  RESERVED: {
    label: "Reserved",
    className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  },
  SHARED: {
    label: "Shared",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  UNUSED: {
    label: "Unused",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
} as const;

/**
 * Helper to get resource allocation type display configuration.
 * Handles unknown values gracefully.
 */
export function getResourceAllocationTypeDisplay(type: string) {
  return (
    ResourceAllocationTypeDisplay[type as keyof typeof ResourceAllocationTypeDisplay] ??
    ResourceAllocationTypeDisplay.UNUSED
  );
}
