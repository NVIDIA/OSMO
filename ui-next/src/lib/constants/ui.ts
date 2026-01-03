/**
 * UI Display Constants
 *
 * Configuration for UI rendering (display labels, styles, etc.).
 * Import enums directly from @/lib/api/generated.
 */

import { PoolStatus, BackendResourceType } from "@/lib/api/generated";

/**
 * All possible resource allocation types as an array.
 * Use this instead of hardcoding ["SHARED", "RESERVED", "UNUSED"].
 */
export const ALL_RESOURCE_TYPES = Object.values(BackendResourceType) as BackendResourceType[];

/**
 * Type guard to check if a string is a valid BackendResourceType.
 */
export function isBackendResourceType(value: string): value is BackendResourceType {
  return (ALL_RESOURCE_TYPES as readonly string[]).includes(value);
}

/**
 * Status display configuration for pools.
 * Keys match the generated PoolStatus enum values.
 */
export const PoolStatusDisplay: Record<
  (typeof PoolStatus)[keyof typeof PoolStatus],
  { icon: string; label: string; className: string }
> = {
  [PoolStatus.ONLINE]: { icon: "🟢", label: "Online", className: "text-emerald-600" },
  [PoolStatus.OFFLINE]: { icon: "🔴", label: "Offline", className: "text-red-600" },
  [PoolStatus.MAINTENANCE]: { icon: "🟡", label: "Maintenance", className: "text-yellow-600" },
};

/**
 * Default/fallback status display for unknown status values.
 */
export const DefaultPoolStatusDisplay = {
  icon: "⚪",
  label: "Unknown",
  className: "text-zinc-500",
} as const;

/**
 * Helper to get pool status display configuration.
 * Handles undefined status and unknown values gracefully.
 */
export function getPoolStatusDisplay(status?: (typeof PoolStatus)[keyof typeof PoolStatus]) {
  if (!status) return DefaultPoolStatusDisplay;
  return PoolStatusDisplay[status] ?? DefaultPoolStatusDisplay;
}

/**
 * UI-friendly resource type names.
 * Maps to platform names from the backend.
 */
export const ResourceTypes = {
  DGX: "DGX",
  HGX: "HGX",
  OVX: "OVX",
  GDX: "GDX",
  MGX: "MGX",
  UNKNOWN: "UNKNOWN",
} as const;

export type ResourceType = (typeof ResourceTypes)[keyof typeof ResourceTypes];

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

// =============================================================================
// Panel Constants
// =============================================================================

/**
 * Shared panel configuration for resizable detail panels.
 * Used by both pools and resources panels.
 */
export const PANEL = {
  /** Width presets for snap-to menu (percentage) */
  WIDTH_PRESETS: [33, 50, 75] as const,
  /** Minimum width percentage */
  MIN_WIDTH_PCT: 20,
  /** Maximum width percentage */
  MAX_WIDTH_PCT: 80,
} as const;
