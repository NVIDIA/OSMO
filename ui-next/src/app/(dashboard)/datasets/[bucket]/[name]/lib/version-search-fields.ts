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
 * Version Search Fields Configuration
 *
 * Defines searchable fields and presets for dataset versions.
 */

import type { SearchField } from "@/components/filter-bar/lib/types";
import type { DatasetVersion } from "@/lib/api/adapter/datasets";

/**
 * Search field configurations for dataset versions.
 */
export const VERSION_SEARCH_FIELDS: SearchField<DatasetVersion>[] = [
  {
    id: "version",
    label: "Version",
    hint: "version number",
    prefix: "version:",
    freeFormHint: "Type any version, press Enter",
    getValues: (versions) => versions.map((v) => v.version).slice(0, 20),
    match: (version, value) => version.version.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "status",
    label: "Status",
    hint: "version status",
    prefix: "status:",
    freeFormHint: "Type status (READY, PENDING), press Enter",
    getValues: (versions) => [...new Set(versions.map((v) => v.status))].sort(),
    match: (version, value) => version.status.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "user",
    label: "Created By",
    hint: "user email",
    prefix: "user:",
    freeFormHint: "Type any user email, press Enter",
    getValues: (versions) => [...new Set(versions.map((v) => v.created_by))].slice(0, 20),
    match: (version, value) => version.created_by.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "tags",
    label: "Tags",
    hint: "tag name",
    prefix: "tags:",
    freeFormHint: "Type any tag, press Enter",
    getValues: (versions) => [...new Set(versions.flatMap((v) => v.tags || []))].sort(),
    match: (version, value) => (version.tags || []).some((tag) => tag.toLowerCase().includes(value.toLowerCase())),
  },
];

/**
 * Predefined search presets for common version queries.
 */
export const VERSION_PRESETS = [
  {
    label: "Status",
    items: [
      {
        label: "Ready",
        chips: [{ field: "status", value: "READY", label: "status: READY" }],
      },
      {
        label: "Pending",
        chips: [{ field: "status", value: "PENDING", label: "status: PENDING" }],
      },
    ],
  },
];
