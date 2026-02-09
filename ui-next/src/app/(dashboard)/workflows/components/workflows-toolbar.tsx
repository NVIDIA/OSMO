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
import { Clock, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchChip } from "@/stores/types";
import type { SearchPreset, PresetRenderProps, ResultsCount, SearchField } from "@/components/filter-bar/lib/types";
import { TableToolbar } from "@/components/data-table/TableToolbar";
import { useWorkflowsTableStore } from "@/app/(dashboard)/workflows/stores/workflows-table-store";
import { OPTIONAL_COLUMNS } from "@/app/(dashboard)/workflows/lib/workflow-columns";
import {
  WORKFLOW_STATIC_FIELDS,
  createPresetChips,
  type WorkflowListEntry,
  type StatusPresetId,
} from "@/app/(dashboard)/workflows/lib/workflow-search-fields";
import { STATUS_STYLES, type StatusCategory } from "@/app/(dashboard)/workflows/lib/workflow-constants";
import { useWorkflowAsyncFields } from "@/app/(dashboard)/workflows/hooks/use-workflow-async-fields";

const STATUS_ICONS: Record<StatusCategory, React.ComponentType<{ className?: string }>> = {
  waiting: Clock,
  pending: Loader2,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  unknown: AlertTriangle,
};

export interface WorkflowsToolbarProps {
  workflows: WorkflowListEntry[];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
  /** Results count for displaying "N results" or "M of N results" */
  resultsCount?: ResultsCount;
  /** Current username for "My Workflows" preset (matches backend x-osmo-user header) */
  currentUsername?: string;
}

const STATUS_PRESET_CONFIG: { id: StatusPresetId; label: string }[] = [
  { id: "running", label: "Running" },
  { id: "waiting", label: "Waiting" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

export const WorkflowsToolbar = memo(function WorkflowsToolbar({
  workflows,
  searchChips,
  onSearchChipsChange,
  resultsCount,
  currentUsername,
}: WorkflowsToolbarProps) {
  const visibleColumnIds = useWorkflowsTableStore((s) => s.visibleColumnIds);
  const toggleColumn = useWorkflowsTableStore((s) => s.toggleColumn);

  // Async fields for user and pool filters
  // These fetch from dedicated endpoints with complete suggestion lists
  const { userField, poolField } = useWorkflowAsyncFields();

  // Compose all search fields: static + async
  // Memoized to prevent FilterBar re-renders
  const searchFields = useMemo(
    (): readonly SearchField<WorkflowListEntry>[] => [
      WORKFLOW_STATIC_FIELDS[0], // name
      WORKFLOW_STATIC_FIELDS[1], // status
      userField, // async - complete user list
      poolField, // async - complete pool list
      WORKFLOW_STATIC_FIELDS[2], // priority
      WORKFLOW_STATIC_FIELDS[3], // app
      WORKFLOW_STATIC_FIELDS[4], // tag
    ],
    [userField, poolField],
  );

  // Create "My Workflows" preset (only if current user is available)
  const myWorkflowsPreset = useMemo((): SearchPreset | null => {
    if (!currentUsername) return null;

    return {
      id: "my-workflows",
      // Single-chip preset: clicking toggles user:<current-username>
      chips: [{ field: "user", value: currentUsername, label: `User: ${currentUsername}` }],
      render: ({ active }: PresetRenderProps) => (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded bg-blue-500/10 px-2 py-0.5 transition-all",
            "text-blue-700 dark:text-blue-300",
            // Active state: white inner ring
            active && "ring-2 ring-white/40 ring-inset dark:ring-white/20",
            // Focused state (keyboard nav via CSS): scale up + shadow
            "group-data-[selected=true]:scale-105 group-data-[selected=true]:shadow-lg",
            // Inactive: slightly muted, full opacity on hover or keyboard focus
            !active && "opacity-70 group-data-[selected=true]:opacity-100 hover:opacity-100",
          )}
        >
          <span className="text-xs font-semibold">My Workflows</span>
        </span>
      ),
    };
  }, [currentUsername]);

  // Create status presets that expand to multiple chips
  const statusPresets = useMemo(
    (): SearchPreset[] =>
      STATUS_PRESET_CONFIG.map(({ id, label }) => {
        const styles = STATUS_STYLES[id];
        const Icon = STATUS_ICONS[id];

        return {
          id,
          // Multi-chip preset: clicking adds/removes all statuses in the category
          chips: createPresetChips(id),
          // Custom render matching the table's status badge
          render: ({ active }: PresetRenderProps) => (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2 py-0.5 transition-all",
                styles.bg,
                // Active state (all chips present): white inner ring
                active && "ring-2 ring-white/40 ring-inset dark:ring-white/20",
                // Focused state (keyboard nav via CSS): scale up + shadow
                "group-data-[selected=true]:scale-105 group-data-[selected=true]:shadow-lg",
                // Inactive: slightly muted, full opacity on hover or keyboard focus
                !active && "opacity-70 group-data-[selected=true]:opacity-100 hover:opacity-100",
              )}
            >
              <Icon className={cn("size-3.5", styles.icon)} />
              <span className={cn("text-xs font-semibold", styles.text)}>{label}</span>
            </span>
          ),
        };
      }),
    [],
  );

  // Combine all preset groups
  const searchPresets = useMemo(() => {
    const presetGroups = [];

    // Add "My Workflows" preset if available
    if (myWorkflowsPreset) {
      presetGroups.push({ label: "Quick Filters:", items: [myWorkflowsPreset] });
    }

    // Add status presets
    presetGroups.push({ label: "Status:", items: statusPresets });

    return presetGroups;
  }, [myWorkflowsPreset, statusPresets]);

  return (
    <TableToolbar
      data={workflows}
      searchFields={searchFields}
      columns={OPTIONAL_COLUMNS}
      visibleColumnIds={visibleColumnIds}
      onToggleColumn={toggleColumn}
      searchChips={searchChips}
      onSearchChipsChange={onSearchChipsChange}
      placeholder="Search workflows... (try 'name:', 'status:', 'user:', 'pool:')"
      searchPresets={searchPresets}
      resultsCount={resultsCount}
    />
  );
});
