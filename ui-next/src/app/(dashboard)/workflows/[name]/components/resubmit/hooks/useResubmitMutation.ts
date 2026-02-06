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
 * useResubmitMutation - Wraps the resubmitWorkflow server action with
 * useTransition, error/success state, and screen reader announcements.
 *
 * Unlike useServerMutation, passes result data (new workflow name) to onSuccess.
 */

"use client";

import { useState, useCallback, useTransition, useMemo } from "react";
import { useServices } from "@/contexts/service-context";
import { resubmitWorkflow, type ResubmitParams, type ResubmitResult } from "@/app/(dashboard)/workflows/actions";

export interface UseResubmitMutationOptions {
  /** Called on successful resubmission with the new workflow name */
  onSuccess?: (newWorkflowName: string | undefined) => void;
  /** Called on mutation error */
  onError?: (error: string) => void;
}

export interface UseResubmitMutationReturn {
  /** Execute the resubmit server action */
  execute: (params: ResubmitParams) => void;
  /** Whether the mutation is in flight */
  isPending: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Last successful result, if any */
  result: ResubmitResult | null;
  /** Reset error state */
  resetError: () => void;
}

export function useResubmitMutation(options: UseResubmitMutationOptions = {}): UseResubmitMutationReturn {
  const { onSuccess, onError } = options;

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResubmitResult | null>(null);
  const { announcer } = useServices();

  const execute = useCallback(
    (params: ResubmitParams) => {
      setError(null);
      setResult(null);

      startTransition(async () => {
        try {
          const actionResult = await resubmitWorkflow(params);

          if (actionResult.success) {
            setResult(actionResult);
            announcer.announce("Workflow submitted successfully", "polite");
            onSuccess?.(actionResult.newWorkflowName);
          } else {
            const errorMsg = actionResult.error ?? "Unknown error";
            setError(errorMsg);
            onError?.(errorMsg);
            announcer.announce(`Failed to resubmit workflow: ${errorMsg}`, "assertive");
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unexpected error";
          setError(errorMsg);
          onError?.(errorMsg);
          announcer.announce(`Failed to resubmit workflow: ${errorMsg}`, "assertive");
        }
      });
    },
    [onSuccess, onError, announcer],
  );

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  return useMemo(
    () => ({
      execute,
      isPending,
      error,
      result,
      resetError,
    }),
    [execute, isPending, error, result, resetError],
  );
}
