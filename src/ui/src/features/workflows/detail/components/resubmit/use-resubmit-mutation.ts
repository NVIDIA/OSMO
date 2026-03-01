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

import { useState, useCallback, useMemo } from "react";
import { useServices } from "@/contexts/service-context";
import { resubmitWorkflow, type ResubmitParams } from "@/features/workflows/list/lib/actions";

export interface UseResubmitMutationOptions {
  /** Called on successful resubmission with the new workflow name */
  onSuccess?: (newWorkflowName: string | undefined) => void;
}

export interface UseResubmitMutationReturn {
  execute: (params: ResubmitParams) => Promise<void>;
  isPending: boolean;
  error: string | null;
}

export function useResubmitMutation(options: UseResubmitMutationOptions = {}): UseResubmitMutationReturn {
  const { onSuccess } = options;

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { announcer } = useServices();

  const execute = useCallback(
    async (params: ResubmitParams) => {
      setError(null);
      setIsPending(true);

      try {
        const actionResult = await resubmitWorkflow(params);

        if (actionResult.success) {
          announcer.announce("Workflow submitted successfully", "polite");
          onSuccess?.(actionResult.newWorkflowName);
        } else {
          const errorMsg = actionResult.error ?? "Unknown error";
          setError(errorMsg);
          announcer.announce(`Failed to resubmit workflow: ${errorMsg}`, "assertive");
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unexpected error";
        setError(errorMsg);
        announcer.announce(`Failed to resubmit workflow: ${errorMsg}`, "assertive");
      } finally {
        setIsPending(false);
      }
    },
    [onSuccess, announcer],
  );

  return useMemo(() => ({ execute, isPending, error }), [execute, isPending, error]);
}
