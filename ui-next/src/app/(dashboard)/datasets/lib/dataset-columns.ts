// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

import { createColumnConfig } from "@/components/data-table/create-column-config";
import { COLUMN_MIN_WIDTHS_REM, COLUMN_PREFERRED_WIDTHS_REM } from "@/components/data-table/utils/column-constants";

// =============================================================================
// Column IDs
// =============================================================================

export type DatasetColumnId =
  | "name"
  | "bucket"
  | "version"
  | "format"
  | "size_bytes"
  | "num_files"
  | "labels"
  | "updated_at";

// =============================================================================
// Column Configuration (via factory)
// =============================================================================

const datasetColumnConfig = createColumnConfig<DatasetColumnId>({
  columns: ["name", "bucket", "version", "format", "size_bytes", "num_files", "labels", "updated_at"] as const,
  labels: {
    name: "Name",
    bucket: "Bucket",
    version: "Version",
    format: "Format",
    size_bytes: "Size",
    num_files: "Files",
    labels: "Labels",
    updated_at: "Updated",
  },
  mandatory: ["name"],
  defaultVisible: ["name", "bucket", "version", "format", "size_bytes", "num_files", "updated_at"],
  defaultOrder: ["name", "bucket", "version", "format", "size_bytes", "num_files", "labels", "updated_at"],
  sizeConfig: [
    {
      id: "name",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE * 1.5,
    },
    {
      id: "bucket",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
    },
    {
      id: "version",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
    },
    {
      id: "format",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
    },
    {
      id: "size_bytes",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
    },
    {
      id: "num_files",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
    },
    {
      id: "labels",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE,
    },
    {
      id: "updated_at",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TIMESTAMP,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TIMESTAMP,
    },
  ],
  // No default sort for datasets (no server-side sorting yet)
});

// =============================================================================
// Exports (backward compatible)
// =============================================================================

/** Type guard to check if a string is a valid DatasetColumnId */
export const isDatasetColumnId = datasetColumnConfig.isColumnId;

/** Filter and type an array of strings to DatasetColumnId[] (filters out invalid IDs) */
export const asDatasetColumnIds = datasetColumnConfig.asColumnIds;

/** Column labels for header display */
export const COLUMN_LABELS = datasetColumnConfig.COLUMN_LABELS;

/** Columns that can be toggled in the column visibility menu */
export const OPTIONAL_COLUMNS = datasetColumnConfig.OPTIONAL_COLUMNS;

/** Default visible columns */
export const DEFAULT_VISIBLE_COLUMNS = datasetColumnConfig.DEFAULT_VISIBLE_COLUMNS;

/** Default column order */
export const DEFAULT_COLUMN_ORDER = datasetColumnConfig.DEFAULT_COLUMN_ORDER;

/** Columns that cannot be hidden */
export const MANDATORY_COLUMN_IDS = datasetColumnConfig.MANDATORY_COLUMN_IDS;

/** Column sizing configuration */
export const DATASET_COLUMN_SIZE_CONFIG = datasetColumnConfig.COLUMN_SIZE_CONFIG;
