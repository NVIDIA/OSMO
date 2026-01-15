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
 * Optimistic Action Hook (React 19)
 *
 * Provides optimistic UI updates for server actions.
 * Uses React 19's useOptimistic for instant feedback while
 * the server action is in flight.
 *
 * @example
 * ```tsx
 * const { execute, isPending, error } = useOptimisticAction(cancelWorkflow, {
 *   onSuccess: () => toast.success("Workflow cancelled"),
 *   onError: (error) => toast.error(error),
 * });
 *
 * <Button onClick={() => execute(workflowName)} disabled={isPending}>
 *   {isPending ? "Cancelling..." : "Cancel"}
 * </Button>
 * ```
 */

"use client";

import { useState, useCallback, useTransition } from "react";
import { useServices } from "@/contexts";
import type { ActionResult } from "@/app/(dashboard)/workflows/actions";

// =============================================================================
// Types
// =============================================================================

interface UseOptimisticActionOptions {
  /** Called on successful action */
  onSuccess?: () => void;
  /** Called on action error */
  onError?: (error: string) => void;
  /** Success message for screen reader announcement */
  successMessage?: string;
  /** Error message prefix for screen reader announcement */
  errorMessagePrefix?: string;
}

interface UseOptimisticActionReturn<TArgs extends unknown[]> {
  /** Execute the action */
  execute: (...args: TArgs) => Promise<void>;
  /** Whether the action is currently in flight */
  isPending: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Reset the error state */
  resetError: () => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for executing server actions with optimistic updates and loading states.
 *
 * @param action - The server action to execute
 * @param options - Callbacks and configuration
 * @returns Object with execute function, pending state, and error
 */
export function useOptimisticAction<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<ActionResult>,
  options: UseOptimisticActionOptions = {},
): UseOptimisticActionReturn<TArgs> {
  const { onSuccess, onError, successMessage, errorMessagePrefix = "Action failed" } = options;

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

// =============================================================================
// Specialized Hooks for Common Actions
// =============================================================================

export { useOptimisticAction as useServerAction };
