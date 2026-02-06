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
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { WorkflowQueryResponse } from "@/lib/api/adapter/types";
import { WorkflowPriority } from "@/lib/api/generated";
import { useResubmitMutation, type UseResubmitMutationReturn } from "./useResubmitMutation";

export interface UseResubmitFormOptions {
  /** Workflow being resubmitted */
  workflow: WorkflowQueryResponse;
  /** Called after successful submission (e.g., to close drawer) */
  onSuccess?: () => void;
}

export interface UseResubmitFormReturn {
  /** Selected pool name */
  pool: string;
  /** Update selected pool */
  setPool: (pool: string) => void;
  /** Selected priority */
  priority: WorkflowPriority;
  /** Update selected priority */
  setPriority: (priority: WorkflowPriority) => void;
  /** Whether the form is valid for submission */
  isValid: boolean;
  /** Whether submission is possible (valid + not pending) */
  canSubmit: boolean;
  /** Submit the form */
  handleSubmit: () => void;
  /** Whether the mutation is in flight */
  isPending: boolean;
  /** Last error message from mutation */
  error: string | null;
  /** Reset form to initial workflow values */
  reset: () => void;
  /** Reset just the error state */
  resetError: UseResubmitMutationReturn["resetError"];
}

/**
 * Derive a WorkflowPriority from the workflow's priority string.
 * Falls back to NORMAL if the value is not recognized.
 */
function deriveInitialPriority(workflow: WorkflowQueryResponse): WorkflowPriority {
  const validPriorities = new Set<string>(Object.values(WorkflowPriority));
  if (validPriorities.has(workflow.priority)) {
    return workflow.priority as WorkflowPriority;
  }
  return WorkflowPriority.NORMAL;
}

export function useResubmitForm({ workflow, onSuccess }: UseResubmitFormOptions): UseResubmitFormReturn {
  const router = useRouter();

  const [pool, setPool] = useState(() => workflow.pool ?? "");
  const [priority, setPriority] = useState<WorkflowPriority>(() => deriveInitialPriority(workflow));

  const isValid = pool.length > 0;

  const { execute, isPending, error, resetError } = useResubmitMutation({
    onSuccess: (newWorkflowName) => {
      const message = newWorkflowName
        ? `Workflow ${newWorkflowName} submitted successfully`
        : "Workflow submitted successfully";

      toast.success(message, {
        action: newWorkflowName
          ? {
              label: "View Workflow",
              onClick: () => router.push(`/workflows/${newWorkflowName}`),
            }
          : undefined,
      });

      onSuccess?.();

      if (newWorkflowName) {
        router.push(`/workflows/${newWorkflowName}`);
      }
    },
  });

  const canSubmit = isValid && !isPending;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;

    execute({
      workflowId: workflow.name,
      poolName: pool,
      priority,
    });
  }, [canSubmit, execute, workflow.name, pool, priority]);

  const reset = useCallback(() => {
    setPool(workflow.pool ?? "");
    setPriority(deriveInitialPriority(workflow));
    resetError();
  }, [workflow, resetError]);

  return useMemo(
    () => ({
      pool,
      setPool,
      priority,
      setPriority,
      isValid,
      canSubmit,
      handleSubmit,
      isPending,
      error,
      reset,
      resetError,
    }),
    [pool, priority, isValid, canSubmit, handleSubmit, isPending, error, reset, resetError],
  );
}
