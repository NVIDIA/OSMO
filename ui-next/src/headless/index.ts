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

// Pools
export { usePoolsList } from "./use-pools-list";
export type {
  PoolGroup,
  UsePoolsListOptions,
  UsePoolsListReturn,
} from "./use-pools-list";

