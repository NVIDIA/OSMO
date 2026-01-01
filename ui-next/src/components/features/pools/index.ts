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
 * These components use the headless hooks for behavior.
 *
 * Note: Resource components (ResourceTable, ResourcePanel, AdaptiveSummary)
 * have been moved to @/components/features/resources as they are
 * resource-domain components used across multiple pages.
 */

// Legacy exports (for backwards compatibility during migration)
export { PoolRow, PoolRowSkeleton } from "./pool-row";
export { QuotaBar } from "./quota-bar";

// New table-based components
export { PoolsTable } from "./pools-table";
export { PoolsToolbar } from "./pools-toolbar";
export { PoolPanelLayout } from "./pool-panel";
export { PoolsTableRow } from "./pools-table-row";
export { GpuProgressCell } from "./gpu-progress-cell";
export { PlatformPills } from "./platform-pills";
export { PoolsLoading } from "./pools-loading";

// Column definitions and configuration
export { POOL_COLUMNS, getGridTemplate, getMinTableWidth } from "./pool-columns";
export type { PoolColumnDef } from "./pool-columns";

// Search fields
export { POOL_SEARCH_FIELDS } from "./pool-search-fields";

// Constants
export * from "./constants";

// Stores
export { usePoolsTableStore, usePoolsExtendedStore } from "./stores/pools-table-store";
