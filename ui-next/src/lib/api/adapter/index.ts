/**
 * Backend Adapter Layer
 *
 * Transforms backend responses that UI cannot use directly.
 * Things backend does correctly are used directly from generated.ts.
 *
 * Usage:
 * ```typescript
 * // Transformed types and hooks
 * import { usePools, type Pool, type Resource } from "@/lib/api/adapter";
 *
 * // Correct backend types - use directly
 * import { PoolStatus, BackendResourceType } from "@/lib/api/generated";
 * ```
 */

// Transformed types (shapes after backend transforms)
export type {
  Pool,
  PoolsResponse,
  Quota,
  PlatformConfig,
  GpuResources,
  TimeoutConfig,
  Resource,
  PoolResourcesResponse,
  AllResourcesResponse,
  ResourceCapacity,
  PoolMembership,
  TaskConfig,
  Version,
  // Workflow types (re-exported unchanged for stable API)
  WorkflowQueryResponse,
  GroupQueryResponse,
  TaskQueryResponse,
  WorkflowListEntry,
} from "./types";

// Clean hooks
export {
  usePools,
  usePool,
  useFilteredPools,
  usePoolResources,
  useAllResources,
  useVersion,
  useResourceDetail,
  useWorkflow,
  // Resource fetchers and cache utilities
  fetchResources,
  invalidateResourcesCache,
  getResourceFilterOptions,
} from "./hooks";

// Pool filtering types (from shim - will be simplified when backend ready)
export type { PoolFilterParams, FilteredPoolsResult, PoolMetadata } from "./hooks";

// Resource shim types (will be simplified when backend supports pagination)
export type { PaginatedResourcesResult, ResourceFilterParams } from "./resources-shim";

// Utilities
export { deriveResourceTypes } from "./utils";
// Note: normalizeTimestamp, normalizeWorkflowTimestamps are internal -
// useWorkflow() applies them automatically so UI doesn't need to call them

// Transform utilities
export { getSharingInfo } from "./transforms";

// Workflow shim (backend workarounds for workflow list API)
export {
  fetchPaginatedWorkflows,
  parseWorkflowsResponse,
  hasActiveFilters as hasActiveWorkflowFilters,
  buildWorkflowsQueryKey,
  type WorkflowFilterParams,
  type RawWorkflowsResponse,
} from "./workflows-shim";
