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
 * Workflows Toolbar
 *
 * Contains SmartSearch with filter chips and status presets.
 * Wraps the generic TableToolbar component.
 */

"use client";

import { memo, useMemo } from "react";
import { Clock, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchChip } from "@/stores";
import type { SearchPreset, PresetRenderProps } from "@/components/smart-search";
import { TableToolbar } from "@/components/data-table";
import { useWorkflowsTableStore } from "../stores/workflows-table-store";
import { OPTIONAL_COLUMNS } from "../lib/workflow-columns";
import { WORKFLOW_SEARCH_FIELDS, type WorkflowListEntry } from "../lib/workflow-search-fields";
import { STATUS_STYLES, STATUS_CATEGORY_MAP, type StatusCategory } from "../lib/workflow-constants";

// =============================================================================
// Status Icons
// =============================================================================

const STATUS_ICONS: Record<StatusCategory, React.ComponentType<{ className?: string }>> = {
  waiting: Clock,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  unknown: AlertTriangle,
};

// =============================================================================
// Types
// =============================================================================

export interface WorkflowsToolbarProps {
  workflows: WorkflowListEntry[];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
}

// =============================================================================
// Status Preset Configuration
// =============================================================================

const STATUS_PRESET_CONFIG: { id: StatusCategory; label: string }[] = [
  { id: "running", label: "Running" },
  { id: "waiting", label: "Waiting" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

// =============================================================================
// Component
// =============================================================================

export const WorkflowsToolbar = memo(function WorkflowsToolbar({
  workflows,
  searchChips,
  onSearchChipsChange,
}: WorkflowsToolbarProps) {
  const visibleColumnIds = useWorkflowsTableStore((s) => s.visibleColumnIds);
  const toggleColumn = useWorkflowsTableStore((s) => s.toggleColumn);

  // Create status presets for quick filtering
  const statusPresets = useMemo(
    (): SearchPreset<WorkflowListEntry>[] =>
      STATUS_PRESET_CONFIG.map(({ id, label }) => {
        const styles = STATUS_STYLES[id];
        const Icon = STATUS_ICONS[id];

        return {
          id,
          label,
          count: (data: WorkflowListEntry[]) => data.filter((w) => STATUS_CATEGORY_MAP[w.status] === id).length,
          chip: { field: "status", value: id, label: `Status: ${label}` },
          // Custom render matching the table's status badge
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
      data={workflows}
      searchFields={WORKFLOW_SEARCH_FIELDS}
      columns={OPTIONAL_COLUMNS}
      visibleColumnIds={visibleColumnIds}
      onToggleColumn={toggleColumn}
      searchChips={searchChips}
      onSearchChipsChange={onSearchChipsChange}
      placeholder="Search workflows... (try 'name:', 'status:', 'user:', 'pool:')"
      searchPresets={[{ label: "Presets:", items: statusPresets }]}
      showDisplayModeToggle={false}
    />
  );
});
