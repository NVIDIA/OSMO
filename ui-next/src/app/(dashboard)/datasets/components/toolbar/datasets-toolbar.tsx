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

"use client";

import { memo, useMemo } from "react";
import type { SearchChip } from "@/stores/types";
import type { ResultsCount, SearchField } from "@/components/filter-bar/lib/types";
import { TableToolbar } from "@/components/data-table/TableToolbar";
import { useDatasetsTableStore } from "@/app/(dashboard)/datasets/stores/datasets-table-store";
import { OPTIONAL_COLUMNS } from "@/app/(dashboard)/datasets/lib/dataset-columns";
import { DATASET_STATIC_FIELDS, type Dataset } from "@/app/(dashboard)/datasets/lib/dataset-search-fields";

export interface DatasetsToolbarProps {
  datasets: Dataset[];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
  /** Results count for displaying "N results" or "M of N results" */
  resultsCount?: ResultsCount;
}

export const DatasetsToolbar = memo(function DatasetsToolbar({
  datasets,
  searchChips,
  onSearchChipsChange,
  resultsCount,
}: DatasetsToolbarProps) {
  const visibleColumnIds = useDatasetsTableStore((s) => s.visibleColumnIds);
  const toggleColumn = useDatasetsTableStore((s) => s.toggleColumn);

  // Use static search fields
  const searchFields = useMemo((): readonly SearchField<Dataset>[] => DATASET_STATIC_FIELDS, []);

  return (
    <TableToolbar
      data={datasets}
      searchFields={searchFields}
      columns={OPTIONAL_COLUMNS}
      visibleColumnIds={visibleColumnIds}
      onToggleColumn={toggleColumn}
      searchChips={searchChips}
      onSearchChipsChange={onSearchChipsChange}
      placeholder="Search datasets... (try 'name:', 'format:', 'bucket:')"
      resultsCount={resultsCount}
    />
  );
});
