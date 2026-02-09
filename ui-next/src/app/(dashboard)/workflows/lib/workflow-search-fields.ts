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
 * Workflow FilterBar field definitions.
 *
 * Defines searchable fields for the workflow list page.
 * Used by FilterBar component for autocomplete and filtering.
 *
 * NOTE: Filtering is done server-side. The `match` functions are stubs
 * since we pass filters directly to the backend API.
 */

import type { SearchField, SearchChip } from "@/components/filter-bar/lib/types";
import { WorkflowStatus, WorkflowPriority } from "@/lib/api/generated";
import type { WorkflowListEntry as WorkflowListEntryType } from "@/lib/api/adapter/types";
import { WORKFLOW_STATUS_METADATA } from "@/lib/api/status-metadata.generated";
import { ALL_WORKFLOW_STATUSES, STATUS_LABELS } from "@/app/(dashboard)/workflows/lib/workflow-constants";
import { naturalCompare } from "@/lib/utils";

export type WorkflowListEntry = WorkflowListEntryType;

// =============================================================================
// Status Presets - DERIVED FROM GENERATED METADATA
// =============================================================================

/**
 * Status preset IDs (matches StatusCategory from generated metadata).
 * Using explicit type ensures type safety while still deriving from metadata.
 */
export type StatusPresetId = "running" | "waiting" | "completed" | "failed";

/**
 * Build status presets from generated metadata.
 * This ensures presets stay in sync with backend status definitions.
 */
function buildStatusPresets(): Record<StatusPresetId, WorkflowStatus[]> {
  const presets: Record<StatusPresetId, WorkflowStatus[]> = {
    running: [],
    waiting: [],
    completed: [],
    failed: [],
  };

  for (const [status, meta] of Object.entries(WORKFLOW_STATUS_METADATA)) {
    const workflowStatus = status as WorkflowStatus;
    const category = meta.category as StatusPresetId;
    if (category in presets) {
      presets[category].push(workflowStatus);
    }
  }

  return presets;
}

/**
 * Status category presets.
 * Each preset expands to multiple status chips when selected.
 * DERIVED FROM WORKFLOW_STATUS_METADATA - stays in sync with backend automatically.
 */
export const STATUS_PRESETS: Record<StatusPresetId, WorkflowStatus[]> = buildStatusPresets();

/**
 * Create chips for a status preset.
 */
export function createPresetChips(presetId: StatusPresetId): SearchChip[] {
  const statuses = STATUS_PRESETS[presetId];
  return statuses.map((status) => ({
    field: "status",
    value: status,
    label: `Status: ${STATUS_LABELS[status] ?? status}`,
  }));
}

/**
 * Check if a preset is fully satisfied by the current chips.
 * A preset is active only if ALL its statuses are present.
 */
export function isPresetActive(presetId: StatusPresetId, chips: SearchChip[]): boolean {
  const presetStatuses = STATUS_PRESETS[presetId];
  const statusChips = chips.filter((c) => c.field === "status");
  const statusValues = new Set(statusChips.map((c) => c.value));

  return presetStatuses.every((status) => statusValues.has(status));
}

/**
 * Toggle a preset on/off.
 * - If active (all statuses present): remove all preset statuses
 * - If inactive: add all preset statuses
 */
export function togglePreset(presetId: StatusPresetId, chips: SearchChip[]): SearchChip[] {
  const isActive = isPresetActive(presetId, chips);
  const presetStatusArray = STATUS_PRESETS[presetId];
  const presetStatusSet = new Set<string>(presetStatusArray);

  if (isActive) {
    // Remove all preset statuses
    return chips.filter((c) => !(c.field === "status" && presetStatusSet.has(c.value)));
  } else {
    // Add missing preset statuses
    const existingStatuses = new Set(chips.filter((c) => c.field === "status").map((c) => c.value));
    const newChips = [...chips];

    for (const status of presetStatusArray) {
      if (!existingStatuses.has(status)) {
        newChips.push({
          field: "status",
          value: status,
          label: `Status: ${STATUS_LABELS[status] ?? status}`,
        });
      }
    }

    return newChips;
  }
}

// =============================================================================
// Search Fields
// =============================================================================

/**
 * Static workflow search fields (frozen to prevent accidental mutation).
 *
 * These fields derive their suggestions from the loaded workflow data.
 * For async fields (user, pool) that fetch from dedicated endpoints,
 * use useWorkflowAsyncFields() hook.
 *
 * NOTE: Filtering is done server-side. No `match` functions needed.
 * Chips are converted to API params in workflows-shim.ts.
 */
export const WORKFLOW_STATIC_FIELDS: readonly SearchField<WorkflowListEntry>[] = Object.freeze([
  {
    id: "name",
    label: "Name",
    hint: "workflow name (substring match)",
    prefix: "name:",
    freeFormHint: "Type any name, press Enter",
    getValues: (workflows) => workflows.map((w) => w.name).slice(0, 20),
  },
  {
    id: "status",
    label: "Status",
    hint: "workflow status",
    prefix: "status:",
    // Only real status values are valid - use presets for categories
    getValues: () => [...ALL_WORKFLOW_STATUSES],
    exhaustive: true,
    requiresValidValue: true,
  },
  {
    id: "priority",
    label: "Priority",
    hint: "HIGH, NORMAL, LOW",
    prefix: "priority:",
    getValues: () => Object.values(WorkflowPriority),
    exhaustive: true,
    requiresValidValue: true,
  },
  {
    id: "app",
    label: "App",
    hint: "app name",
    prefix: "app:",
    freeFormHint: "Type any app, press Enter",
    getValues: (workflows) =>
      [...new Set(workflows.map((w) => w.app_name).filter((a): a is string => !!a))].sort(naturalCompare),
  },
  {
    id: "tag",
    label: "Tag",
    hint: "workflow tag",
    prefix: "tag:",
    freeFormHint: "Type any tag, press Enter",
    // Tags aren't in the list response, so no suggestions from data
    getValues: () => [],
  },
]);

/**
 * @deprecated Use WORKFLOW_STATIC_FIELDS + useWorkflowAsyncFields() instead.
 * This constant is kept for backward compatibility but limits suggestions to loaded data.
 *
 * Migration:
 * ```typescript
 * const { userField, poolField } = useWorkflowAsyncFields();
 * const fields = useMemo(
 *   () => [
 *     WORKFLOW_STATIC_FIELDS[0], // name
 *     WORKFLOW_STATIC_FIELDS[1], // status
 *     userField,                  // async
 *     poolField,                  // async
 *     WORKFLOW_STATIC_FIELDS[2], // priority
 *     WORKFLOW_STATIC_FIELDS[3], // app
 *     WORKFLOW_STATIC_FIELDS[4], // tag
 *   ],
 *   [userField, poolField],
 * );
 * ```
 */
export const WORKFLOW_SEARCH_FIELDS: readonly SearchField<WorkflowListEntry>[] = Object.freeze([
  {
    id: "name",
    label: "Name",
    hint: "workflow name (substring match)",
    prefix: "name:",
    freeFormHint: "Type any name, press Enter",
    getValues: (workflows) => workflows.map((w) => w.name).slice(0, 20),
  },
  {
    id: "status",
    label: "Status",
    hint: "workflow status",
    prefix: "status:",
    getValues: () => [...ALL_WORKFLOW_STATUSES],
    exhaustive: true,
    requiresValidValue: true,
  },
  {
    id: "user",
    label: "User",
    hint: "submitted by",
    prefix: "user:",
    freeFormHint: "Type any username, press Enter",
    getValues: (workflows) => [...new Set(workflows.map((w) => w.user))].sort(naturalCompare).slice(0, 20),
  },
  {
    id: "pool",
    label: "Pool",
    hint: "pool name",
    prefix: "pool:",
    freeFormHint: "Type any pool, press Enter",
    getValues: (workflows) =>
      [...new Set(workflows.map((w) => w.pool).filter((p): p is string => !!p))].sort(naturalCompare),
  },
  {
    id: "priority",
    label: "Priority",
    hint: "HIGH, NORMAL, LOW",
    prefix: "priority:",
    getValues: () => Object.values(WorkflowPriority),
    exhaustive: true,
    requiresValidValue: true,
  },
  {
    id: "app",
    label: "App",
    hint: "app name",
    prefix: "app:",
    freeFormHint: "Type any app, press Enter",
    getValues: (workflows) =>
      [...new Set(workflows.map((w) => w.app_name).filter((a): a is string => !!a))].sort(naturalCompare),
  },
  {
    id: "tag",
    label: "Tag",
    hint: "workflow tag",
    prefix: "tag:",
    freeFormHint: "Type any tag, press Enter",
    getValues: () => [],
  },
]);
