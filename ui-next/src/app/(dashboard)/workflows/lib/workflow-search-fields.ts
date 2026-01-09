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
import {
  STATUS_CATEGORY_MAP,
  STATUS_LABELS,
  matchStatus,
  getStatusSuggestions,
} from "./workflow-constants";

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
    hint: "status or category (e.g., failed, FAILED_IMAGE_PULL)",
    prefix: "status:",
    getValues: (workflows) => {
      const dataStatuses = [...new Set(workflows.map((w) => w.status))];
      return dataStatuses.sort();
    },
    match: (workflow, value) => {
      const valueLower = value.toLowerCase();

      // 1. Category match (running, waiting, completed, failed)
      const category = STATUS_CATEGORY_MAP[workflow.status];
      if (category === valueLower) {
        return true;
      }

      // 2. Fuzzy status match using pre-computed index
      const result = matchStatus(value);
      if (result.status) {
        return workflow.status === result.status;
      }

      // 3. Partial match - check if any candidate matches
      return result.candidates.includes(workflow.status);
    },
    // Custom validation that normalizes input to canonical form
    validate: (value) => {
      const valueLower = value.toLowerCase();

      // Allow category values directly
      if (["running", "waiting", "completed", "failed"].includes(valueLower)) {
        return true;
      }

      // Try fuzzy match
      const result = matchStatus(value);

      // Accept if we have any candidates (will filter to matching workflows)
      if (result.candidates.length > 0) {
        return true;
      }

      // Suggest similar statuses
      const suggestions = getStatusSuggestions(value.slice(0, 3), 3);
      if (suggestions.length > 0) {
        return `Unknown status. Did you mean: ${suggestions.join(", ")}?`;
      }

      return `Unknown status "${value}"`;
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
