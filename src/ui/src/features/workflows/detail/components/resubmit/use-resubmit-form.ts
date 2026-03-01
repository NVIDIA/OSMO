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
import { usePool } from "@/lib/api/adapter/hooks";
import {
  useResubmitMutation,
  type UseResubmitMutationReturn,
} from "@/features/workflows/detail/components/resubmit/use-resubmit-mutation";

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
  /**
   * Custom spec (if edited AND changed, otherwise undefined = use original via workflow_id)
   * - undefined: User hasn't edited OR edited but content is identical → backend uses workflow_id
   * - string: User edited and changed the content → backend uses template_spec
   */
  spec: string | undefined;
  /** Update custom spec */
  setSpec: (spec: string | undefined) => void;
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
  const router = useNavigationRouter();

  // Validate the workflow's original pool exists before using it as the default.
  // usePool returns null if the pool no longer exists or is inaccessible.
  // TanStack Query deduplicates this fetch with PoolPicker's own usePool call.
  const workflowPool = workflow.pool ?? "";
  const { pool: validatedPool, isLoading: isValidatingPool } = usePool(workflowPool, !!workflowPool);

  // null = use default (workflow's original pool, validated); string = user override
  const [poolOverride, setPoolOverride] = useState<string | null>(null);

  const pool = useMemo(() => {
    if (poolOverride !== null) return poolOverride;
    if (!workflowPool || isValidatingPool) return "";
    return validatedPool?.name ?? "";
  }, [poolOverride, workflowPool, validatedPool, isValidatingPool]);

  const setPool = useCallback((value: string) => setPoolOverride(value), []);

  const [priority, setPriority] = useState<WorkflowPriority>(() => deriveInitialPriority(workflow));
  const [spec, setSpec] = useState<string | undefined>(undefined);

  const isValid = pool.length > 0;

  const { execute, isPending, error, resetError } = useResubmitMutation({
    onSuccess: (newWorkflowName) => {
      const message = newWorkflowName
        ? `Workflow resubmitted as ${newWorkflowName}`
        : "Workflow resubmitted successfully";

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

  const canSubmit = isValid && !isPending;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;

    execute({
      workflowId: workflow.name,
      poolName: pool,
      priority,
      spec,
    });
  }, [canSubmit, execute, workflow.name, pool, priority, spec]);

  const reset = useCallback(() => {
    setPoolOverride(null);
    setPriority(deriveInitialPriority(workflow));
    setSpec(undefined);
    resetError();
  }, [workflow, resetError]);

  return useMemo(
    () => ({
      pool,
      setPool,
      priority,
      setPriority,
      spec,
      setSpec,
      isValid,
      canSubmit,
      handleSubmit,
      isPending,
      error,
      reset,
      resetError,
    }),
    [pool, setPool, priority, spec, isValid, canSubmit, handleSubmit, isPending, error, reset, resetError],
  );
}
