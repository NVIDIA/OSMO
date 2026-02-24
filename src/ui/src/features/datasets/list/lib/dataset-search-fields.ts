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

/**
 * Dataset Search Field Definitions
 *
 * Defines searchable fields for the FilterBar component.
 * These fields drive the smart search autocomplete and filtering.
 */

import type { SearchField } from "@/components/filter-bar/lib/types";
import type { Dataset } from "@/lib/api/adapter/datasets";
import { getDateRangePresetSuggestions } from "@/features/datasets/list/lib/date-filter-utils";

// Re-export Dataset type for convenience
export type { Dataset } from "@/lib/api/adapter/datasets";

// =============================================================================
// Static Search Fields
// =============================================================================

export const DATASET_STATIC_FIELDS: readonly SearchField<Dataset>[] = [
  {
    id: "name",
    label: "Name",
    prefix: "name:",
    singular: true,
    getValues: (datasets: Dataset[]) => {
      const names = datasets.map((d) => d.name);
      return [...new Set(names)].sort();
    },
  },
  {
    id: "bucket",
    label: "Bucket",
    prefix: "bucket:",
    getValues: (datasets: Dataset[]) => {
      const buckets = datasets.map((d) => d.bucket).filter(Boolean);
      return [...new Set(buckets)].sort();
    },
    exhaustive: false,
  },
  {
    id: "created_at",
    label: "Created",
    prefix: "created_at:",
    hint: "creation date",
    freeFormHint: "e.g. 'last 7 days' or '2024-01-01..2024-12-31'",
    singular: true,
    getValues: (_datasets: Dataset[]) => getDateRangePresetSuggestions(),
    exhaustive: false,
  },
  {
    id: "updated_at",
    label: "Updated",
    prefix: "updated_at:",
    hint: "last updated",
    freeFormHint: "e.g. 'last 7 days' or '2024-01-01..2024-12-31'",
    singular: true,
    getValues: (_datasets: Dataset[]) => getDateRangePresetSuggestions(),
    exhaustive: false,
  },
] as const;
