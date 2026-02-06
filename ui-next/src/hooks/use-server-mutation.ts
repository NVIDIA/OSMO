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
 * Server Mutation Hook
 *
 * Executes Next.js Server Actions with loading states, error handling,
 * and accessibility features.
 *
 * Server Actions run on the server and automatically revalidate caches
 * using Next.js primitives (revalidatePath, updateTag, refresh).
 *
 * @example
 * ```tsx
 * import { cancelWorkflow } from '@/app/(dashboard)/workflows/actions';
 * import { useServerMutation } from '@/hooks';
 *
 * const { execute, isPending, error } = useServerMutation(cancelWorkflow, {
 *   onSuccess: () => toast.success("Workflow cancelled"),
 *   onError: (error) => toast.error(error),
 *   successMessage: "Workflow cancelled",
 * });
 *
 * <Button onClick={() => execute(workflowName)} disabled={isPending}>
 *   {isPending ? "Cancelling..." : "Cancel"}
 * </Button>
 * ```
 *
 * ## Architecture
 *
 * This hook is for WRITE operations (mutations). Use TanStack Query for READ operations:
 *
 * ```typescript
 * // READ operations (queries)
 * const { workflows } = useWorkflows();         // TanStack Query
 * const { workflow } = useWorkflowDetail();     // TanStack Query
 *
 * // WRITE operations (mutations)
 * const { execute } = useServerMutation(cancelWorkflow);     // This hook
 * const { execute } = useServerMutation(retryWorkflow);      // This hook
 * ```
 */

"use client";

import { useState, useCallback, useTransition } from "react";
import { useServices } from "@/contexts/service-context";
import type { ActionResult } from "@/app/(dashboard)/workflows/actions";

export interface UseServerMutationOptions {
  /** Called on successful mutation */
  onSuccess?: () => void;
  /** Called on mutation error */
  onError?: (error: string) => void;
  /** Success message for screen reader announcement */
  successMessage?: string;
  /** Error message prefix for screen reader announcement */
  errorMessagePrefix?: string;
}

export interface UseServerMutationReturn<TArgs extends unknown[]> {
  /** Execute the server mutation */
  execute: (...args: TArgs) => Promise<void>;
  /** Whether the mutation is currently in flight */
  isPending: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Reset the error state */
  resetError: () => void;
}

/**
 * Hook for executing Next.js Server Actions with loading states and error handling.
 *
 * Uses React 19's useTransition for non-blocking updates during the mutation.
 * Provides automatic screen reader announcements for accessibility.
 *
 * @param action - The server action to execute
 * @param options - Callbacks and configuration
 * @returns Object with execute function, pending state, and error
 */
export function useServerMutation<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<ActionResult>,
  options: UseServerMutationOptions = {},
): UseServerMutationReturn<TArgs> {
  const { onSuccess, onError, successMessage, errorMessagePrefix = "Mutation failed" } = options;

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { announcer } = useServices();

  const execute = useCallback(
    async (...args: TArgs) => {
      setError(null);

      startTransition(async () => {
        try {
          const result = await action(...args);

          if (result.success) {
            onSuccess?.();
            if (successMessage) {
              announcer.announce(successMessage, "polite");
            }
          } else {
            const errorMsg = result.error ?? "Unknown error";
            setError(errorMsg);
            onError?.(errorMsg);
            announcer.announce(`${errorMessagePrefix}: ${errorMsg}`, "assertive");
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unexpected error";
          setError(errorMsg);
          onError?.(errorMsg);
          announcer.announce(`${errorMessagePrefix}: ${errorMsg}`, "assertive");
        }
      });
    },
    [action, onSuccess, onError, successMessage, errorMessagePrefix, announcer],
  );

  const resetError = useCallback(() => setError(null), []);

  return {
    execute,
    isPending,
    error,
    resetError,
  };
}
