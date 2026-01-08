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
 * Workflow SmartSearch field definitions.
 *
 * Defines searchable fields for the workflow list page.
 * Used by SmartSearch component for autocomplete and filtering.
 */

import type { SearchField } from "@/components/smart-search";
import type { SrcServiceCoreWorkflowObjectsListEntry } from "@/lib/api/generated";
import { STATUS_CATEGORY_MAP } from "./workflow-constants";

export type WorkflowListEntry = SrcServiceCoreWorkflowObjectsListEntry;

// =============================================================================
// Search Fields
// =============================================================================

/**
 * Pre-built workflow search fields (frozen to prevent accidental mutation).
 */
export const WORKFLOW_SEARCH_FIELDS: readonly SearchField<WorkflowListEntry>[] = Object.freeze([
  {
    id: "name",
    label: "Name",
    hint: "workflow name",
    prefix: "name:",
    getValues: (workflows) => workflows.map((w) => w.name).slice(0, 20),
    match: (workflow, value) => workflow.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "status",
    label: "Status",
    hint: "workflow status category",
    prefix: "status:",
    // Show category values for simpler filtering (maps to multiple statuses)
    getValues: () => ["running", "waiting", "completed", "failed"],
    match: (workflow, value) => {
      const category = STATUS_CATEGORY_MAP[workflow.status];
      return category === value.toLowerCase();
    },
  },
  {
    id: "user",
    label: "User",
    hint: "submitted by",
    prefix: "user:",
    getValues: (workflows) => [...new Set(workflows.map((w) => w.user))].sort().slice(0, 20),
    match: (workflow, value) => workflow.user.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "pool",
    label: "Pool",
    hint: "pool name",
    prefix: "pool:",
    getValues: (workflows) => [...new Set(workflows.map((w) => w.pool).filter((p): p is string => !!p))].sort(),
    match: (workflow, value) => workflow.pool?.toLowerCase().includes(value.toLowerCase()) ?? false,
  },
  {
    id: "priority",
    label: "Priority",
    hint: "HIGH, NORMAL, LOW",
    prefix: "priority:",
    getValues: () => ["HIGH", "NORMAL", "LOW"],
    match: (workflow, value) => workflow.priority.toUpperCase() === value.toUpperCase(),
    requiresValidValue: true,
  },
  {
    id: "app",
    label: "App",
    hint: "app name",
    prefix: "app:",
    getValues: (workflows) => [...new Set(workflows.map((w) => w.app_name).filter((a): a is string => !!a))].sort(),
    match: (workflow, value) => workflow.app_name?.toLowerCase().includes(value.toLowerCase()) ?? false,
  },
]);
