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

"use client";

import { memo } from "react";
import type { Resource } from "@/lib/api/adapter/types";
import type { SearchChip } from "@/stores/types";
import type { ResultsCount } from "@/components/filter-bar/lib/types";
import { DisplayModeToggle } from "@/components/data-table/DisplayModeToggle";
import { TableToolbar } from "@/components/data-table/TableToolbar";
import { useResourcesTableStore } from "@/app/(dashboard)/resources/stores/resources-table-store";
import { OPTIONAL_COLUMNS } from "@/app/(dashboard)/resources/lib/resource-columns";
import { RESOURCE_SEARCH_FIELDS } from "@/app/(dashboard)/resources/lib/resource-search-fields";

export interface ResourcesToolbarProps {
  resources: Resource[];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
  /** Results count for displaying "N results" or "M of N results" */
  resultsCount?: ResultsCount;
}

export const ResourcesToolbar = memo(function ResourcesToolbar({
  resources,
  searchChips,
  onSearchChipsChange,
  resultsCount,
}: ResourcesToolbarProps) {
  const visibleColumnIds = useResourcesTableStore((s) => s.visibleColumnIds);
  const toggleColumn = useResourcesTableStore((s) => s.toggleColumn);

  return (
    <TableToolbar
      data={resources}
      searchFields={RESOURCE_SEARCH_FIELDS}
      columns={OPTIONAL_COLUMNS}
      visibleColumnIds={visibleColumnIds}
      onToggleColumn={toggleColumn}
      searchChips={searchChips}
      onSearchChipsChange={onSearchChipsChange}
      placeholder="Search resources... (try 'name:', 'platform:', 'pool:')"
      resultsCount={resultsCount}
    >
      <DisplayModeToggle />
    </TableToolbar>
  );
});
