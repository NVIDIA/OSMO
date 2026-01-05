/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo } from "react";
import type { Resource } from "@/lib/api/adapter";
import type { SearchChip } from "@/stores";
import { TableToolbar } from "@/components/data-table";
import { useResourcesTableStore } from "../stores/resources-table-store";
import { OPTIONAL_COLUMNS } from "../lib/resource-columns";
import { RESOURCE_SEARCH_FIELDS } from "../lib/resource-search-fields";

export interface ResourcesToolbarProps {
  resources: Resource[];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
}

export const ResourcesToolbar = memo(function ResourcesToolbar({
  resources,
  searchChips,
  onSearchChipsChange,
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
    />
  );
});
