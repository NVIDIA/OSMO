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
import { CheckCircle2, User, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Pool } from "@/lib/api/adapter/types";
import type { SearchChip } from "@/stores/types";
import type { SearchPreset, PresetRenderProps, ResultsCount } from "@/components/filter-bar/lib/types";
import { DisplayModeToggle } from "@/components/data-table/display-mode-toggle";
import { TableToolbar } from "@/components/data-table/table-toolbar";
import type { RefreshControlProps } from "@/components/refresh/RefreshControl";
import { usePoolsTableStore } from "@/app/(dashboard)/pools/stores/pools-table-store";
import { OPTIONAL_COLUMNS } from "@/app/(dashboard)/pools/lib/pool-columns";
import { createPoolSearchFields } from "@/app/(dashboard)/pools/lib/pool-search-fields";
import { STATUS_STYLES, type StatusCategory } from "@/app/(dashboard)/pools/lib/constants";

/** Status icons matching the table column badges */
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
  /** Results count for displaying "N results" or "M of N results" */
  resultsCount?: ResultsCount;
  /** Optional auto-refresh controls (if not provided, no refresh button shown) */
  autoRefreshProps?: RefreshControlProps;
}

/** Status preset configurations */
const STATUS_PRESET_CONFIG: { id: StatusCategory; label: string }[] = [
  { id: "online", label: "Online" },
  { id: "maintenance", label: "Maintenance" },
  { id: "offline", label: "Offline" },
];

function presetPillClasses(colorClasses: string, active: boolean): string {
  return cn(
    "inline-flex items-center gap-1.5 rounded px-2 py-0.5 transition-all",
    colorClasses,
    active && "ring-2 ring-white/40 ring-inset dark:ring-white/20",
    "group-data-[selected=true]:scale-105 group-data-[selected=true]:shadow-lg",
    !active && "opacity-70 group-data-[selected=true]:opacity-100 hover:opacity-100",
  );
}

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

  // Create search fields with sharing context
  const searchFields = useMemo(() => createPoolSearchFields(sharingGroups), [sharingGroups]);

  // Create status presets for quick filtering with custom badge rendering
  const statusPresets = useMemo(
    (): SearchPreset[] =>
      STATUS_PRESET_CONFIG.map(({ id, label }) => {
        const styles = STATUS_STYLES[id].badge;
        const Icon = STATUS_ICONS[id];

        return {
          id,
          chips: [{ field: "status", value: id, label: `Status: ${label}` }],
          // Custom render matching the table's status badge exactly
          render: ({ active }: PresetRenderProps) => (
            <span className={presetPillClasses(styles.bg, active)}>
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
        <span className={presetPillClasses("bg-amber-50 dark:bg-amber-500/20", active)}>
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
      placeholder="Search pools... (try 'pool:', 'platform:', 'status:')"
      searchPresets={[
        { label: "User", items: [myPoolsPreset] },
        { label: "Status", items: statusPresets },
      ]}
      resultsCount={resultsCount}
      autoRefreshProps={autoRefreshProps}
    >
      <DisplayModeToggle />
    </TableToolbar>
  );
});
