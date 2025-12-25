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

// Resources (cross-pool view with pagination)
export { useResources } from "./use-resources";
export type { UseResourcesReturn } from "./use-resources";

// Display Mode (shared preference for free vs used display)
export { useDisplayMode } from "./use-display-mode";
export type { UseDisplayModeReturn } from "./use-display-mode";
