/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { COLUMN_MIN_WIDTHS_REM, COLUMN_PREFERRED_WIDTHS_REM, createColumnConfig } from "@/components/data-table";

// =============================================================================
// Column IDs
// =============================================================================

export type ResourceColumnId =
  | "resource"
  | "hostname"
  | "type"
  | "pools"
  | "platform"
  | "backend"
  | "gpu"
  | "cpu"
  | "memory"
  | "storage";

// =============================================================================
// Column Configuration (via factory)
// =============================================================================

const resourceColumnConfig = createColumnConfig<ResourceColumnId>({
  columns: ["resource", "hostname", "type", "pools", "platform", "backend", "gpu", "cpu", "memory", "storage"] as const,
  labels: {
    resource: "Resource",
    hostname: "Hostname",
    type: "Type",
    pools: "Pools",
    platform: "Platform",
    backend: "Backend",
    gpu: "GPU",
    cpu: "CPU",
    memory: "Memory",
    storage: "Storage",
  },
  mandatory: ["resource"],
  defaultVisible: ["resource", "type", "platform", "backend", "gpu", "cpu", "memory", "storage"],
  defaultOrder: ["resource", "type", "pools", "platform", "backend", "hostname", "gpu", "cpu", "memory", "storage"],
  sizeConfig: [
    {
      id: "resource",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE,
    },
    {
      id: "type",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
    },
    {
      id: "pools",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE,
    },
    {
      id: "platform",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
    },
    {
      id: "backend",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
    },
    {
      id: "hostname",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
    },
    {
      id: "gpu",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
    },
    {
      id: "cpu",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
    },
    {
      id: "memory",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_WITH_UNIT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_WITH_UNIT,
    },
    {
      id: "storage",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_WITH_UNIT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_WITH_UNIT,
    },
  ],
  // Custom optional columns to maintain original order (not alphabetical from labels)
  optionalColumns: [
    { id: "type", label: "Type", menuLabel: "Type" },
    { id: "pools", label: "Pools", menuLabel: "Pools" },
    { id: "platform", label: "Platform", menuLabel: "Platform" },
    { id: "backend", label: "Backend", menuLabel: "Backend" },
    { id: "hostname", label: "Hostname", menuLabel: "Hostname" },
    { id: "gpu", label: "GPU", menuLabel: "GPU" },
    { id: "cpu", label: "CPU", menuLabel: "CPU" },
    { id: "memory", label: "Memory", menuLabel: "Memory" },
    { id: "storage", label: "Storage", menuLabel: "Storage" },
  ],
  defaultSort: { column: "resource", direction: "asc" },
  defaultPanelWidth: 40,
});

// =============================================================================
// Exports (backward compatible)
// =============================================================================

/** Type guard to check if a string is a valid ResourceColumnId */
export const isResourceColumnId = resourceColumnConfig.isColumnId;

/** Filter and type an array of strings to ResourceColumnId[] (filters out invalid IDs) */
export const asResourceColumnIds = resourceColumnConfig.asColumnIds;

/** Column labels for header display */
export const COLUMN_LABELS = resourceColumnConfig.COLUMN_LABELS;

/** Optional columns that can be toggled */
export const OPTIONAL_COLUMNS = resourceColumnConfig.OPTIONAL_COLUMNS;

/** Default visible columns */
export const DEFAULT_VISIBLE_COLUMNS = resourceColumnConfig.DEFAULT_VISIBLE_COLUMNS;

/** Default column order */
export const DEFAULT_COLUMN_ORDER = resourceColumnConfig.DEFAULT_COLUMN_ORDER;

/** Mandatory columns that cannot be reordered (always first) */
export const MANDATORY_COLUMN_IDS = resourceColumnConfig.MANDATORY_COLUMN_IDS;

/** Column sizing configuration */
export const RESOURCE_COLUMN_SIZE_CONFIG = resourceColumnConfig.COLUMN_SIZE_CONFIG;

/** Default sort configuration */
export const DEFAULT_SORT = resourceColumnConfig.DEFAULT_SORT;

/** Default panel width percentage */
export const DEFAULT_PANEL_WIDTH = resourceColumnConfig.DEFAULT_PANEL_WIDTH;
