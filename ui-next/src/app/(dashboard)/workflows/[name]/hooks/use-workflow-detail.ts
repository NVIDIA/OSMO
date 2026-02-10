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

import { useMemo } from "react";
import { useWorkflow } from "@/lib/api/adapter/hooks";
import { transformGroups, type WorkflowQueryResponse } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";
import { isWorkflowTerminal } from "@/lib/api/status-metadata.generated";

interface UseWorkflowDetailParams {
  name: string;
  verbose?: boolean;
  /** Auto-refresh interval in ms (0 = disabled) */
  refetchInterval?: number;
}

/**
 * Fetches a single workflow with DAG layout computation and smart polling.
 *
 * Automatically stops polling when workflow reaches a terminal state.
 * Returns `isTerminal` as SSOT for both polling logic and display layer.
 */
export function useWorkflowDetail({ name, verbose = true, refetchInterval = 0 }: UseWorkflowDetailParams) {
  // Function-based refetchInterval stops polling for terminal workflows.
  // MUST NOT be wrapped in useCallback - TanStack Query needs a fresh function
  // each render to access current query.state.data for terminal detection.
  const refetchIntervalFn =
    refetchInterval > 0
      ? (query: unknown) => {
          const queryState = query as { state: { data: unknown } };
          const currentWorkflow = queryState.state.data as WorkflowQueryResponse | null;
          if (currentWorkflow && isWorkflowTerminal(currentWorkflow.status)) {
            return 0;
          }
          return refetchInterval;
        }
      : 0;

  const { workflow, isLoading, error, refetch, isNotFound } = useWorkflow({
    name,
    verbose,
    refetchInterval: refetchIntervalFn,
  });

  const groups = workflow?.groups;
  const groupsWithLayout = useMemo(() => {
    if (!groups) return [];
    return transformGroups(groups);
  }, [groups]);

  const workflowStatus = workflow?.status;
  const isTerminal = useMemo(() => {
    return workflowStatus ? isWorkflowTerminal(workflowStatus) : false;
  }, [workflowStatus]);

  return {
    workflow,
    groupsWithLayout,
    isLoading,
    error,
    refetch,
    isNotFound,
    isTerminal,
  };
}
