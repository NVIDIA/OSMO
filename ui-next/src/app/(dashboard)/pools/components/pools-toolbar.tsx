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
import { CheckCircle2, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Pool } from "@/lib/api/adapter";
import type { SearchChip } from "@/stores";
import type { SearchPreset, PresetRenderProps } from "@/components/smart-search";
import { TableToolbar } from "@/components/data-table";
import { usePoolsTableStore } from "../stores/pools-table-store";
import { OPTIONAL_COLUMNS } from "../lib/pool-columns";
import { createPoolSearchFields } from "../lib/pool-search-fields";
import { getStatusDisplay, STATUS_STYLES, type StatusCategory } from "../lib/constants";

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
}

/** Status preset configurations */
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
}: PoolsToolbarProps) {
  const visibleColumnIds = usePoolsTableStore((s) => s.visibleColumnIds);
  const toggleColumn = usePoolsTableStore((s) => s.toggleColumn);

  // Create search fields with sharing context
  const searchFields = useMemo(() => createPoolSearchFields(sharingGroups), [sharingGroups]);

  // Create status presets for quick filtering with custom badge rendering
  const statusPresets = useMemo(
    (): SearchPreset<Pool>[] =>
      STATUS_PRESET_CONFIG.map(({ id, label }) => {
        const styles = STATUS_STYLES[id].badge;
        const Icon = STATUS_ICONS[id];

        return {
          id,
          label,
          count: (data: Pool[]) => data.filter((p) => getStatusDisplay(p.status).category === id).length,
          chip: { field: "status", value: id, label: `Status: ${label}` },
          // Custom render matching the table's status badge exactly
          render: ({ active, focused, count }: PresetRenderProps) => (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2 py-0.5 transition-all",
                styles.bg,
                // Active state (has chip): white inner ring
                active && "ring-2 ring-white/40 ring-inset dark:ring-white/20",
                // Focused state (keyboard nav): scale up + shadow
                focused && "scale-105 shadow-lg",
                // Inactive + unfocused: slightly muted
                !active && !focused && "opacity-70 hover:opacity-100",
              )}
            >
              <Icon className={cn("size-3.5", styles.icon)} />
              <span className={cn("text-xs font-semibold", styles.text)}>{label}</span>
              <span className={cn("text-xs tabular-nums", styles.text, "opacity-60")}>{count}</span>
            </span>
          ),
        };
      }),
    [],
  );

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
      searchPresets={[{ label: "Status", items: statusPresets }]}
    />
  );
});
