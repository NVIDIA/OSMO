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
 * Version Columns Configuration
 *
 * Column size configuration for the versions table.
 */

import type { ColumnSizeConfig } from "@/components/data-table/types";
import type { VersionColumnId } from "@/app/(dashboard)/datasets/[bucket]/[name]/stores/versions-table-store";

/**
 * Column size configuration for version table columns (in rem units).
 */
export const VERSION_COLUMN_SIZE_CONFIG: readonly ColumnSizeConfig[] = [
  { id: "version", minWidthRem: 5, preferredWidthRem: 7.5 },
  { id: "status", minWidthRem: 5, preferredWidthRem: 6.25 },
  { id: "created_by", minWidthRem: 9.5, preferredWidthRem: 12.5 },
  { id: "created_date", minWidthRem: 9.5, preferredWidthRem: 11.25 },
  { id: "last_used", minWidthRem: 9.5, preferredWidthRem: 11.25 },
  { id: "size", minWidthRem: 6.25, preferredWidthRem: 7.5 },
  { id: "retention", minWidthRem: 5, preferredWidthRem: 6.25 },
  { id: "tags", minWidthRem: 9.5, preferredWidthRem: 12.5 },
];

/**
 * Optional columns in alphabetical order for column selector.
 */
export const OPTIONAL_VERSION_COLUMNS_ALPHABETICAL: Array<{
  id: VersionColumnId;
  label: string;
}> = [
  { id: "created_by", label: "Created By" },
  { id: "created_date", label: "Created Date" },
  { id: "last_used", label: "Last Used" },
  { id: "retention", label: "Retention" },
  { id: "size", label: "Size" },
  { id: "tags", label: "Tags" },
];
