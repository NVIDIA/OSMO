/**
 * Headless Layer
 *
 * This layer provides behavior without styling. Use these hooks
 * to build custom themed components while maintaining consistent
 * business logic across implementations.
 *
 * External teams building custom themes should import from here.
 *
 * @example
 * ```tsx
 * import { usePoolsList } from "@/headless";
 *
 * function MyCustomPoolsList() {
 *   const { groupedPools, search, setSearch } = usePoolsList();
 *   // Apply your own styling
 * }
 * ```
 */

// Shared types
export type {
  FilterType,
  PoolDetailFilterType,
  AllResourcesFilterType,
  ActiveFilter,
  ResourceDisplayMode,
} from "./types";

// Pools List
export { usePoolsList } from "./use-pools-list";
export type { PoolGroup, UsePoolsListOptions, UsePoolsListReturn } from "./use-pools-list";

// Pool Detail
export { usePoolDetail } from "./use-pool-detail";
export type { UsePoolDetailOptions, UsePoolDetailReturn } from "./use-pool-detail";

// All Resources (cross-pool view)
export { useAllResources } from "./use-all-resources";
export type { UseAllResourcesReturn } from "./use-all-resources";

// Infinite Resources (with pagination support)
export { useInfiniteResources } from "./use-infinite-resources";
export type { UseInfiniteResourcesReturn } from "./use-infinite-resources";

// UI Behavior Hooks
export { useAutoCollapse } from "./use-auto-collapse";
export { useHorizontalScrollSync, useScrollShadow } from "./use-horizontal-scroll-sync";
