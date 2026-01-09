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
 */

"use client";

import { useMemo } from "react";
import { useGetWorkflowApiWorkflowNameGet, type WorkflowQueryResponse } from "@/lib/api/generated";
import { transformGroups, type GroupWithLayout } from "../lib/dag/workflow-types";

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
  /** The workflow data */
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
  // Fetch workflow with groups and tasks
  const { data, isLoading, error, refetch } = useGetWorkflowApiWorkflowNameGet(name, { verbose });

  // Parse the workflow response (API returns string that needs parsing)
  const workflow = useMemo(() => {
    if (!data) return null;
    try {
      // The API returns a string, so we need to parse it
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      return parsed as WorkflowQueryResponse;
    } catch {
      console.error("Failed to parse workflow response:", data);
      return null;
    }
  }, [data]);

  // Transform groups for DAG visualization
  const groupsWithLayout = useMemo(() => {
    if (!workflow?.groups) return [];
    return transformGroups(workflow.groups);
  }, [workflow?.groups]);

  // Check if workflow was not found (404 error)
  const isNotFound = useMemo(() => {
    if (!error) return false;
    // Check for 404 status in error
    const status = (error as { status?: number })?.status;
    return status === 404;
  }, [error]);

  return {
    workflow,
    groupsWithLayout,
    isLoading,
    error: error as Error | null,
    refetch,
    isNotFound,
  };
}
