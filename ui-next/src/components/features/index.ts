/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Feature Components
 *
 * Complete, themed components for each feature area.
 * These components compose headless behavior with styling.
 *
 * Note: Some exports are prefixed to avoid naming conflicts between
 * pools and resources (e.g., POOL_PANEL vs RESOURCE_PANEL).
 */

// Pools feature (explicit exports to control public API)
export {
  PoolsTable,
  type PoolsTableProps,
  PoolPanelLayout,
  type PoolPanelProps,
  GpuProgressCell,
  PlatformPills,
  PoolsToolbar,
  type PoolsToolbarProps,
  QuotaBar,
  usePoolSections,
  useSectionScroll,
  useLayoutDimensions,
  type StatusSection,
  usePoolsTableStore,
  usePoolsExtendedStore,
  createPoolSearchFields,
  getStatusDisplay,
  getStatusStyles,
  PANEL,
  STATUS_ORDER,
  type PoolColumnId,
  COLUMN_MAP,
  MANDATORY_COLUMN_IDS,
  OPTIONAL_COLUMNS,
  ALL_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
} from "./pools";

// Resources feature (explicit exports to control public API)
export {
  // Main components
  ResourcesTable,
  type ResourcesTableProps,
  ResourcePanelLayout,
  type ResourcePanelLayoutProps,
  CapacityCell,
  ResourcesToolbar,
  type ResourcesToolbarProps,
  AdaptiveSummary,
  // Lib (prefixed to avoid conflicts)
  RESOURCE_PANEL,
  RESOURCE_LAYOUT,
  COLUMNS_WITH_POOLS,
  COLUMNS_NO_POOLS,
  COLUMN_LABELS,
  type ResourceColumnId,
  createResourceSearchFields,
  // Hooks (prefixed to avoid conflicts)
  useResourceLayoutDimensions,
  getResourceShellHeaderHeight,
  type ResourceLayoutDimensions,
  // Stores
  useResourcesTableStore,
} from "./resources";
