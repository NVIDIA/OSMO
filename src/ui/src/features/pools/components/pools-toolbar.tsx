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
import { CheckCircle2, User, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Pool } from "@/lib/api/adapter/types";
import type { SearchChip } from "@/stores/types";
import type { SearchPreset, PresetRenderProps, ResultsCount } from "@/components/filter-bar/lib/types";
import { presetPillClasses } from "@/components/filter-bar/lib/preset-pill";
import { TableToolbar } from "@/components/data-table/table-toolbar";
import type { RefreshControlProps } from "@/components/refresh/refresh-control";
import { usePoolsTableStore } from "@/features/pools/stores/pools-table-store";
import { OPTIONAL_COLUMNS } from "@/features/pools/lib/pool-columns";
import { createPoolSearchFields } from "@/features/pools/lib/pool-search-fields";
import { STATUS_STYLES, type StatusCategory } from "@/lib/pool-status";

const STATUS_ICONS = {
  online: CheckCircle2,
  maintenance: Wrench,
  offline: XCircle,
} as const;

export interface PoolsToolbarProps {
  pools: Pool[];
  sharingGroups?: string[][];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
  resultsCount?: ResultsCount;
  autoRefreshProps?: RefreshControlProps;
}

const STATUS_PRESET_CONFIG: { id: StatusCategory; label: string }[] = [
  { id: "online", label: "Online" },
  { id: "maintenance", label: "Maintenance" },
  { id: "offline", label: "Offline" },
];

export const PoolsToolbar = memo(function PoolsToolbar({
  pools,
  sharingGroups = [],
  searchChips,
  onSearchChipsChange,
  resultsCount,
  autoRefreshProps,
}: PoolsToolbarProps) {
  const visibleColumnIds = usePoolsTableStore((s) => s.visibleColumnIds);
  const toggleColumn = usePoolsTableStore((s) => s.toggleColumn);

  const searchFields = useMemo(() => createPoolSearchFields(sharingGroups), [sharingGroups]);

  const statusPresets = useMemo(
    (): SearchPreset[] =>
      STATUS_PRESET_CONFIG.map(({ id, label }) => {
        const styles = STATUS_STYLES[id].badge;
        const Icon = STATUS_ICONS[id];

        return {
          id,
          chips: [{ field: "status", value: id, label: `status: ${label}` }],
          render: ({ active }: PresetRenderProps) => (
            <span className={presetPillClasses(styles.bg, active, "ring-white/40 ring-inset dark:ring-white/20")}>
              <Icon className={cn("size-3.5", styles.icon)} />
              <span className={cn("text-xs font-semibold", styles.text)}>{label}</span>
            </span>
          ),
        };
      }),
    [],
  );

  // "My Pools" preset — replaces any existing scope chip (exclusive toggle)
  const myPoolsPreset = useMemo((): SearchPreset => {
    const scopeChips = searchChips.filter((c) => c.field === "scope");
    const isActive = scopeChips.length === 1 && scopeChips[0].value === "user";

    return {
      id: "my-pools",
      chips: [{ field: "scope", value: "user", label: "My Pools" }],
      onSelect: (currentChips) => {
        const nonScopeChips = currentChips.filter((c) => c.field !== "scope");
        if (isActive) return nonScopeChips;
        return [...nonScopeChips, { field: "scope", value: "user", label: "My Pools" }];
      },
      render: ({ active }: PresetRenderProps) => (
        <span
          className={presetPillClasses(
            "bg-amber-50 dark:bg-amber-500/20",
            active,
            "ring-white/40 ring-inset dark:ring-white/20",
          )}
        >
          <User className="size-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">My Pools</span>
        </span>
      ),
    };
  }, [searchChips]);

  return (
    <TableToolbar
      data={pools}
      searchFields={searchFields}
      columns={OPTIONAL_COLUMNS}
      visibleColumnIds={visibleColumnIds}
      onToggleColumn={toggleColumn}
      searchChips={searchChips}
      onSearchChipsChange={onSearchChipsChange}
      defaultField="pool"
      placeholder="Search pools... (try 'pool:', 'platform:', 'status:')"
      searchPresets={[
        { label: "User", items: [myPoolsPreset] },
        { label: "Status", items: statusPresets },
      ]}
      resultsCount={resultsCount}
      autoRefreshProps={autoRefreshProps}
    />
  );
});
