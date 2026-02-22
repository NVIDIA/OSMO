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

import { useMemo, useState, useCallback, useRef } from "react";
import type { AsyncSearchField } from "@/components/filter-bar/lib/types";
import type { WorkflowListEntry } from "@/lib/api/adapter/types";
import { usePoolNames, useUsers } from "@/lib/api/adapter/hooks";

/**
 * Lazy-enable gate: starts disabled, flips to enabled on first call to `trigger()`.
 * Uses queueMicrotask to defer the state update out of React's render phase.
 */
function useLazyEnable(): { enabled: boolean; trigger: () => void } {
  const [enabled, setEnabled] = useState(false);
  const accessedRef = useRef(false);

  const trigger = useCallback(() => {
    if (!accessedRef.current) {
      accessedRef.current = true;
      queueMicrotask(() => setEnabled(true));
    }
  }, []);

  return { enabled, trigger };
}

/**
 * Wraps values + a lazy trigger into a stable getValues callback.
 * When called, triggers the lazy-enable gate then returns the current values.
 */
function useLazyGetValues(values: string[], trigger: () => void): () => string[] {
  return useMemo(() => {
    const snapshot = values;
    return () => {
      trigger();
      return snapshot;
    };
  }, [values, trigger]);
}

interface UseWorkflowAsyncFieldsReturn {
  userField: AsyncSearchField<WorkflowListEntry>;
  poolField: AsyncSearchField<WorkflowListEntry>;
}

export function useWorkflowAsyncFields(): UseWorkflowAsyncFieldsReturn {
  const userGate = useLazyEnable();
  const poolGate = useLazyEnable();

  const { names: poolNames, isLoading: poolsLoading } = usePoolNames(poolGate.enabled);
  const { users, isLoading: usersLoading } = useUsers(userGate.enabled);

  const getUserValues = useLazyGetValues(users, userGate.trigger);
  const getPoolValues = useLazyGetValues(poolNames, poolGate.trigger);

  const userField = useMemo(
    (): AsyncSearchField<WorkflowListEntry> => ({
      type: "async",
      id: "user",
      label: "User",
      hint: "submitted by",
      prefix: "user:",
      getValues: getUserValues,
      isLoading: usersLoading,
      exhaustive: true,
      requiresValidValue: true,
    }),
    [getUserValues, usersLoading],
  );

  const poolField = useMemo(
    (): AsyncSearchField<WorkflowListEntry> => ({
      type: "async",
      id: "pool",
      label: "Pool",
      hint: "pool name",
      prefix: "pool:",
      getValues: getPoolValues,
      isLoading: poolsLoading,
      exhaustive: true,
      requiresValidValue: true,
    }),
    [getPoolValues, poolsLoading],
  );

  return { userField, poolField };
}
