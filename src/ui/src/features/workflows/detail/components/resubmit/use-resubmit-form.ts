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
 * useResubmitForm - Form state for the resubmit drawer.
 *
 * Owns pool + priority state, derives validation, delegates submission
 * to useResubmitMutation. All returned objects are memoized.
 */

"use client";

import { useState, useCallback, useMemo } from "react";
import { useNavigationRouter } from "@/hooks/use-navigation-router";
import { toast } from "sonner";
import type { WorkflowQueryResponse } from "@/lib/api/adapter/types";
import { WorkflowPriority } from "@/lib/api/generated";
import { usePoolSelection } from "@/components/workflow/use-pool-selection";
import { useResubmitMutation } from "@/features/workflows/detail/components/resubmit/use-resubmit-mutation";
import {
  getChangedWorkflowLabelAssignments,
  sortedWorkflowLabelEntries,
  validateWorkflowLabelDrafts,
  type WorkflowLabelDraft,
} from "@/lib/workflow-labels";

export interface UseResubmitFormOptions {
  workflow: WorkflowQueryResponse;
  onSuccess?: () => void;
}

export interface UseResubmitFormReturn {
  pool: string;
  setPool: (pool: string) => void;
  priority: WorkflowPriority;
  setPriority: (priority: WorkflowPriority) => void;
  labels: WorkflowLabelDraft[];
  setLabels: (labels: WorkflowLabelDraft[]) => void;
  labelError: string | null;
  /** Count of leading drafts seeded from the workflow's own labels; their keys are locked. */
  lockedLabelCount: number;
  /**
   * Custom spec (if edited AND changed, otherwise undefined = use original via workflow_id).
   * - undefined: User hasn't edited OR content is identical to original
   * - string: User edited and changed the content
   */
  spec: string | undefined;
  setSpec: (spec: string | undefined) => void;
  canSubmit: boolean;
  handleSubmit: () => void;
  isPending: boolean;
  error: string | null;
}

function deriveInitialPriority(workflow: WorkflowQueryResponse): WorkflowPriority {
  const validPriorities = new Set<string>(Object.values(WorkflowPriority));
  if (validPriorities.has(workflow.priority)) {
    return workflow.priority as WorkflowPriority;
  }
  return WorkflowPriority.NORMAL;
}

export function useResubmitForm({ workflow, onSuccess }: UseResubmitFormOptions): UseResubmitFormReturn {
  const router = useNavigationRouter();

  const { pool, setPool } = usePoolSelection(workflow.pool ?? "");
  const [priority, setPriority] = useState<WorkflowPriority>(() => deriveInitialPriority(workflow));
  const [spec, setSpec] = useState<string | undefined>(undefined);
  const [labels, setLabels] = useState<WorkflowLabelDraft[]>(() =>
    sortedWorkflowLabelEntries(workflow.labels).map(([key, value]) => ({ key, value })),
  );
  const lockedLabelCount = Object.keys(workflow.labels ?? {}).length;
  const labelError = useMemo(() => validateWorkflowLabelDrafts(labels), [labels]);
  const labelAssignments = useMemo(
    () => getChangedWorkflowLabelAssignments(labels, workflow.labels ?? {}),
    [labels, workflow.labels],
  );

  const { execute, isPending, error } = useResubmitMutation({
    onSuccess: (newWorkflowName, warnings) => {
      const message = newWorkflowName
        ? `Workflow resubmitted as ${newWorkflowName}`
        : "Workflow resubmitted successfully";

      for (const warning of warnings) {
        toast.warning(warning);
      }
      toast.success(message, {
        action: newWorkflowName
          ? {
              label: "View Workflow",
              onClick: () => router.push(`/workflows/${newWorkflowName}`),
            }
          : undefined,
      });

      onSuccess?.();
    },
  });

  const canSubmit = pool.length > 0 && !isPending && !labelError;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;

    execute({
      workflowId: workflow.name,
      poolName: pool,
      priority,
      spec,
      labels: labelAssignments,
    });
  }, [canSubmit, execute, workflow.name, pool, priority, spec, labelAssignments]);

  return useMemo(
    () => ({
      pool,
      setPool,
      priority,
      setPriority,
      labels,
      setLabels,
      labelError,
      lockedLabelCount,
      spec,
      setSpec,
      canSubmit,
      handleSubmit,
      isPending,
      error,
    }),
    [pool, setPool, priority, labels, labelError, lockedLabelCount, spec, canSubmit, handleSubmit, isPending, error],
  );
}
