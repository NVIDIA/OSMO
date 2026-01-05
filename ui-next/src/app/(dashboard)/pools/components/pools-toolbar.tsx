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

import { memo, useMemo } from "react";
import type { Pool } from "@/lib/api/adapter";
import type { SearchChip } from "@/stores";
import { TableToolbar } from "@/components/data-table";
import { usePoolsTableStore } from "../stores/pools-table-store";
import { OPTIONAL_COLUMNS } from "../lib/pool-columns";
import { createPoolSearchFields } from "../lib/pool-search-fields";

export interface PoolsToolbarProps {
  pools: Pool[];
  sharingGroups?: string[][];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
}

export const PoolsToolbar = memo(function PoolsToolbar({
  pools,
  sharingGroups = [],
  searchChips,
  onSearchChipsChange,
}: PoolsToolbarProps) {
  const visibleColumnIds = usePoolsTableStore((s) => s.visibleColumnIds);
  const toggleColumn = usePoolsTableStore((s) => s.toggleColumn);

  // Create search fields with sharing context
  const searchFields = useMemo(() => createPoolSearchFields(sharingGroups), [sharingGroups]);

  return (
    <TableToolbar
      data={pools}
      searchFields={searchFields}
      columns={OPTIONAL_COLUMNS}
      visibleColumnIds={visibleColumnIds}
      onToggleColumn={toggleColumn}
      searchChips={searchChips}
      onSearchChipsChange={onSearchChipsChange}
      placeholder="Search pools... (try 'pool:', 'platform:', 'shared:')"
    />
  );
});
