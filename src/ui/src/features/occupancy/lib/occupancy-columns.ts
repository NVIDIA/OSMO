//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

import { createColumnConfig } from "@/components/data-table/create-column-config";
import { COLUMN_MIN_WIDTHS_REM, COLUMN_PREFERRED_WIDTHS_REM } from "@/components/data-table/utils/column-constants";

// =============================================================================
// Column IDs
// =============================================================================

export type OccupancyColumnId =
  | "expand"
  | "key"
  | "count"
  | "gpu"
  | "cpu"
  | "memory"
  | "storage"
  | "high"
  | "normal"
  | "low";

// =============================================================================
// Column Configuration (via factory)
// =============================================================================

const occupancyColumnConfig = createColumnConfig<OccupancyColumnId>({
  columns: ["expand", "key", "count", "gpu", "cpu", "memory", "storage", "high", "normal", "low"] as const,
  labels: {
    expand: "",
    key: "Name",
    count: "Count",
    gpu: "GPU",
    cpu: "CPU",
    memory: "Memory",
    storage: "Storage",
    high: "High",
    normal: "Normal",
    low: "Low",
  },
  mandatory: ["expand", "key"],
  defaultVisible: ["expand", "key", "count", "gpu", "cpu", "memory", "storage", "high", "normal", "low"],
  defaultOrder: ["expand", "key", "count", "gpu", "cpu", "memory", "storage", "high", "normal", "low"],
  sizeConfig: [
    {
      id: "expand",
      minWidthRem: 2,
      preferredWidthRem: 2,
    },
    {
      id: "key",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE,
    },
    {
      id: "count",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
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
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
    },
    {
      id: "storage",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
    },
    {
      id: "high",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
    },
    {
      id: "normal",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
    },
    {
      id: "low",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
    },
  ],
  defaultSort: { column: "gpu", direction: "desc" },
});

// =============================================================================
// Exports
// =============================================================================

export const asOccupancyColumnIds = occupancyColumnConfig.asColumnIds;
export const OPTIONAL_COLUMNS = occupancyColumnConfig.OPTIONAL_COLUMNS;
export const DEFAULT_VISIBLE_COLUMNS = occupancyColumnConfig.DEFAULT_VISIBLE_COLUMNS;
export const DEFAULT_COLUMN_ORDER = occupancyColumnConfig.DEFAULT_COLUMN_ORDER;
export const MANDATORY_COLUMN_IDS = occupancyColumnConfig.MANDATORY_COLUMN_IDS;
export const OCCUPANCY_COLUMN_SIZE_CONFIG = occupancyColumnConfig.COLUMN_SIZE_CONFIG;
export const DEFAULT_SORT = occupancyColumnConfig.DEFAULT_SORT;
