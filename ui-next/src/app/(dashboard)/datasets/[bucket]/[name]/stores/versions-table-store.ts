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

/**
 * Versions Table Store
 *
 * Manages column visibility, order, and sort state for the versions table.
 * Persisted to localStorage.
 */

import { createTableStore } from "@/stores/create-table-store";

// Column IDs
export type VersionColumnId =
  | "version"
  | "status"
  | "created_by"
  | "created_date"
  | "last_used"
  | "size"
  | "retention"
  | "tags";

// Mandatory columns (always visible)
export const MANDATORY_VERSION_COLUMNS: VersionColumnId[] = ["version", "status"];

// Optional columns (can be toggled)
export const OPTIONAL_VERSION_COLUMNS: VersionColumnId[] = [
  "created_by",
  "created_date",
  "last_used",
  "size",
  "retention",
  "tags",
];

// Default visible columns
const DEFAULT_VISIBLE_COLUMNS: VersionColumnId[] = [
  "version",
  "status",
  "created_by",
  "created_date",
  "last_used",
  "size",
  "retention",
  "tags",
];

// Default column order
const DEFAULT_COLUMN_ORDER: VersionColumnId[] = [
  "version",
  "status",
  "created_by",
  "created_date",
  "last_used",
  "size",
  "retention",
  "tags",
];

export const useVersionsTableStore = createTableStore({
  storageKey: "dataset-versions-table",
  defaultVisibleColumns: DEFAULT_VISIBLE_COLUMNS,
  defaultColumnOrder: DEFAULT_COLUMN_ORDER,
  defaultSort: { column: "version", direction: "desc" },
});
