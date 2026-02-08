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
 * Data hook for fetching a single workflow by name.
 *
 * Fetches workflow detail with verbose=true to include full group and task data.
 * Used by the workflow detail page to render the DAG and details panel.
 *
 * Uses the adapter layer's useWorkflow hook which handles:
 * - Parsing the API response
 * - Normalizing timestamps to have explicit UTC timezone
 *
 * This hook adds UI-specific logic (DAG layout computation).
 */

"use client";

import { useMemo } from "react";
import { useWorkflow } from "@/lib/api/adapter/hooks";
import {
  transformGroups,
  type GroupWithLayout,
  type WorkflowQueryResponse,
} from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";

// =============================================================================
// Types
// =============================================================================

interface UseWorkflowDetailParams {
  /** Workflow name (unique identifier) */
  name: string;
  /** Whether to fetch full task details (default: true) */
  verbose?: boolean;
}

interface UseWorkflowDetailReturn {
  /** The workflow data (with normalized timestamps from adapter) */
  workflow: WorkflowQueryResponse | null;
  /** Groups with computed layout information */
  groupsWithLayout: GroupWithLayout[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
  /** Whether the workflow was found */
  isNotFound: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useWorkflowDetail({ name, verbose = true }: UseWorkflowDetailParams): UseWorkflowDetailReturn {
  // Use adapter hook - handles parsing and timestamp normalization
  const { workflow, isLoading, error, refetch, isNotFound } = useWorkflow({ name, verbose });

  // Transform groups for DAG visualization (UI-specific logic)
  const groups = workflow?.groups;
  const groupsWithLayout = useMemo(() => {
    if (!groups) return [];
    return transformGroups(groups);
  }, [groups]);

  return {
    workflow,
    groupsWithLayout,
    isLoading,
    error,
    refetch,
    isNotFound,
  };
}
