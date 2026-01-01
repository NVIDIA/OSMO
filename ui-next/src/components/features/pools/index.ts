/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Pool Feature Components
 *
 * Themed components for displaying pools and pool-specific UI.
 * Uses the generic DataTable component with pools-specific configuration.
 */

// Legacy exports (for backwards compatibility during migration)
export { QuotaBar } from "./quota-bar";

// Table-based components
export { PoolsTable } from "./pools-table";
export { PoolsToolbar } from "./pools-toolbar";
export { PoolPanelLayout } from "./pool-panel";
export { GpuProgressCell } from "./gpu-progress-cell";
export { PlatformPills } from "./platform-pills";
export { PoolsLoading } from "./pools-loading";

// Column definitions
export {
  MANDATORY_COLUMNS,
  OPTIONAL_COLUMNS,
  ALL_COLUMNS,
  COLUMN_MAP,
  MANDATORY_COLUMN_IDS,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
} from "./pool-columns";
export type { PoolColumnId } from "./pool-columns";

// Search fields
export { POOL_SEARCH_FIELDS } from "./pool-search-fields";

// Constants
export * from "./constants";

// Stores
export { usePoolsTableStore, usePoolsExtendedStore } from "./stores/pools-table-store";
