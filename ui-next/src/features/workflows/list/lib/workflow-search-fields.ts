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

import type { SearchField } from "@/components/filter-bar/lib/types";
import { WorkflowPriority } from "@/lib/api/generated";
import type { WorkflowListEntry } from "@/lib/api/adapter/types";
import { ALL_WORKFLOW_STATUSES } from "@/lib/workflows/workflow-constants";
import { STATUS_PRESETS, createPresetChips, type StatusPresetId } from "@/lib/workflows/workflow-status-presets";
import { naturalCompare } from "@/lib/utils";
export { STATUS_PRESETS, createPresetChips };
export type { StatusPresetId };

/**
 * Static workflow search fields. Async fields (user, pool) are provided
 * separately by useWorkflowAsyncFields(). Filtering is server-side;
 * no `match` functions are needed.
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
    getValues: () => [],
  },
]);
