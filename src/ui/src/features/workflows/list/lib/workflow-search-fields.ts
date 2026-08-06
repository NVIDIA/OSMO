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
import { naturalCompare } from "@/lib/utils";

// Static fields keyed by id. Async fields (user, pool) provided by useWorkflowAsyncFields().
export const WORKFLOW_FIELD: Readonly<Record<string, SearchField<WorkflowListEntry>>> = Object.freeze({
  name: {
    id: "name",
    label: "Name",
    hint: "workflow name (substring match)",
    prefix: "name:",
    freeFormHint: "Type any name, press Enter",
    singular: true,
    getValues: (workflows) => workflows.map((w) => w.name),
  },
  status: {
    id: "status",
    label: "Status",
    hint: "workflow status",
    prefix: "status:",
    getValues: () => [...ALL_WORKFLOW_STATUSES],
    exhaustive: true,
    requiresValidValue: true,
  },
  priority: {
    id: "priority",
    label: "Priority",
    hint: "HIGH, NORMAL, LOW",
    prefix: "priority:",
    getValues: () => Object.values(WorkflowPriority),
    exhaustive: true,
    requiresValidValue: true,
  },
  submitted: {
    id: "submitted",
    label: "Submitted",
    hint: "filter by submission date or range",
    prefix: "submitted:",
    singular: true,
    type: "date-range" as const,
  },
  app: {
    id: "app",
    label: "App",
    hint: "app name",
    prefix: "app:",
    freeFormHint: "Type any app, press Enter",
    singular: true,
    getValues: (workflows) =>
      [...new Set(workflows.map((w) => w.app_name).filter((a): a is string => !!a))].sort(naturalCompare),
  },
  tag: {
    id: "tag",
    label: "Tag",
    hint: "workflow tag",
    prefix: "tag:",
    freeFormHint: "Type any tag, press Enter",
    getValues: () => [],
  },
  label: {
    id: "label",
    label: "Label",
    hint: "workflow label selector (exact, glob, or alternatives)",
    prefix: "label:",
    freeFormHint: "Type key=value, key=(team_*|osmo_*), or key=team_(a|b), press Enter",
    getValues: () => [],
  },
  no_label: {
    // The id matches the backend query parameter; the typed prefix stays
    // kebab-case like the other chips.
    id: "no_label",
    label: "Missing Label",
    hint: "workflow missing a label key",
    prefix: "no-label:",
    freeFormHint: "Type a label key, press Enter",
    getValues: () => [],
  },
});

export const WORKFLOW_STATIC_FIELDS: readonly SearchField<WorkflowListEntry>[] = Object.freeze(
  Object.values(WORKFLOW_FIELD),
);
