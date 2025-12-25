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
  Resource,
  PoolResourcesResponse,
  AllResourcesResponse,
  ResourceCapacity,
  PoolMembership,
  TaskConfig,
  Version,
} from "./types";

// Clean hooks
export {
  usePools,
  usePool,
  usePoolResources,
  useAllResources,
  useVersion,
  useResourceDetail,
  // Resource fetchers and cache utilities
  fetchResources,
  invalidateResourcesCache,
  getResourceFilterOptions,
} from "./hooks";

// Pagination types
export type { PaginatedResourcesResult } from "./pagination";
