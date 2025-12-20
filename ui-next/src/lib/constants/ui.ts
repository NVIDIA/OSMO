/**
 * UI Display Constants
 *
 * Constants for UI rendering that depend on generated API types.
 * Import from here or from the main constants index.
 */

import { PoolStatus } from "@/lib/api/generated";

// Re-export generated enums for convenience
export {
  PoolStatus,
  type PoolStatus as PoolStatusType,
  BackendResourceType,
  type BackendResourceType as BackendResourceTypeType,
  WorkflowStatus,
  type WorkflowStatus as WorkflowStatusType,
  WorkflowPriority,
  type WorkflowPriority as WorkflowPriorityType,
  TaskGroupStatus,
  type TaskGroupStatus as TaskGroupStatusType,
} from "@/lib/api/generated";

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
