/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Resource Feature Components
 *
 * Domain-specific components for displaying and managing resources.
 * Uses the same architecture as the pools feature.
 */

// Main components
export { ResourcesTable, type ResourcesTableProps } from "./components/table";
export { ResourcePanelLayout, type ResourcePanelLayoutProps } from "./components/panel";
export { CapacityCell } from "./components/cells";
export { ResourcesToolbar, type ResourcesToolbarProps } from "./resources-toolbar";
export { AdaptiveSummary } from "./resource-summary-card";

// Lib exports (use specific exports to avoid conflicts with pools)
export {
  PANEL as RESOURCE_PANEL,
  LAYOUT as RESOURCE_LAYOUT,
  COLUMNS_WITH_POOLS,
  COLUMNS_NO_POOLS,
  COLUMN_LABELS,
  type ResourceColumnId,
} from "./lib";
export { createResourceSearchFields } from "./lib";

// Hooks
export {
  useLayoutDimensions as useResourceLayoutDimensions,
  getShellHeaderHeight as getResourceShellHeaderHeight,
  type LayoutDimensions as ResourceLayoutDimensions,
} from "./hooks";

// Stores
export { useResourcesTableStore } from "./stores/resources-table-store";
