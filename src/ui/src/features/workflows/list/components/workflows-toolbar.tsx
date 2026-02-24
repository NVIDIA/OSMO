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
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchChip } from "@/stores/types";
import type { SearchPreset, PresetRenderProps, ResultsCount, SearchField } from "@/components/filter-bar/lib/types";
import { TableToolbar } from "@/components/data-table/table-toolbar";
import type { RefreshControlProps } from "@/components/refresh/refresh-control";
import { useWorkflowsTableStore } from "@/features/workflows/list/stores/workflows-table-store";
import { OPTIONAL_COLUMNS } from "@/features/workflows/list/lib/workflow-columns";
import type { WorkflowListEntry } from "@/lib/api/adapter/types";
import {
  WORKFLOW_STATIC_FIELDS,
  createPresetChips,
  type StatusPresetId,
} from "@/features/workflows/list/lib/workflow-search-fields";
import { STATUS_STYLES } from "@/lib/workflows/workflow-constants";
import { WORKFLOW_STATUS_ICONS } from "@/lib/workflows/workflow-status-icons";
import { useWorkflowAsyncFields } from "@/features/workflows/list/hooks/use-workflow-async-fields";

const STATUS_PRESET_CONFIG: { id: StatusPresetId; label: string }[] = [
  { id: "running", label: "Running" },
  { id: "waiting", label: "Waiting" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

function presetPillClasses(bgClass: string, active: boolean): string {
  return cn(
    "inline-flex items-center gap-1.5 rounded px-2 py-0.5 transition-all",
    bgClass,
    active && "ring-2 ring-black/15 ring-inset dark:ring-white/20",
    "group-data-[selected=true]:scale-105 group-data-[selected=true]:shadow-lg",
    !active && "opacity-70 group-data-[selected=true]:opacity-100 hover:opacity-100",
  );
}

export interface WorkflowsToolbarProps {
  workflows: WorkflowListEntry[];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
  resultsCount?: ResultsCount;
  currentUsername?: string | null;
  autoRefreshProps?: RefreshControlProps;
}

export const WorkflowsToolbar = memo(function WorkflowsToolbar({
  workflows,
  searchChips,
  onSearchChipsChange,
  resultsCount,
  currentUsername,
  autoRefreshProps,
}: WorkflowsToolbarProps) {
  const visibleColumnIds = useWorkflowsTableStore((s) => s.visibleColumnIds);
  const toggleColumn = useWorkflowsTableStore((s) => s.toggleColumn);

  const { userField, poolField } = useWorkflowAsyncFields();

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

  // "My Workflows" preset: replaces all user chips with the current user chip.
  // Uses onSelect to override the default additive toggle with replace semantics.
  const myWorkflowsPreset = useMemo((): SearchPreset | null => {
    if (!currentUsername) return null;

    const userChips = searchChips.filter((c) => c.field === "user");
    const isActive = userChips.length === 1 && userChips[0].value === currentUsername;

    return {
      id: "my-workflows",
      chips: [{ field: "user", value: currentUsername, label: `user: ${currentUsername}` }],
      onSelect: (currentChips) => {
        const nonUserChips = currentChips.filter((c) => c.field !== "user");
        const currentUserChips = currentChips.filter((c) => c.field === "user");
        const isMine = currentUserChips.length === 1 && currentUserChips[0].value === currentUsername;
        if (isMine) return nonUserChips;
        return [...nonUserChips, { field: "user", value: currentUsername, label: `user: ${currentUsername}` }];
      },
      render: () => (
        <span className={presetPillClasses("bg-amber-50 dark:bg-amber-500/20", isActive)}>
          <User className="size-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">My Workflows</span>
        </span>
      ),
    };
  }, [currentUsername, searchChips]);

  const statusPresets = useMemo(
    (): SearchPreset[] =>
      STATUS_PRESET_CONFIG.map(({ id, label }) => {
        const styles = STATUS_STYLES[id];
        const Icon = WORKFLOW_STATUS_ICONS[id];

        return {
          id,
          chips: createPresetChips(id),
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

  const searchPresets = useMemo(() => {
    const groups: { label: string; items: SearchPreset[] }[] = [];
    if (myWorkflowsPreset) {
      groups.push({ label: "User:", items: [myWorkflowsPreset] });
    }
    groups.push({ label: "Status:", items: statusPresets });
    return groups;
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
      defaultField="name"
      placeholder="Search workflows... (try 'name:', 'status:', 'user:', 'pool:')"
      searchPresets={searchPresets}
      resultsCount={resultsCount}
      autoRefreshProps={autoRefreshProps}
    />
  );
});
