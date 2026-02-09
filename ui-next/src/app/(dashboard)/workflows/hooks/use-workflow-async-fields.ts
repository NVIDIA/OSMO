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
 * Hook for async workflow filter fields (user, pool) with lazy loading.
 *
 * Creates AsyncSearchField definitions backed by dedicated API endpoints,
 * replacing the previous pattern of deriving suggestions from loaded workflows.
 *
 * Benefits:
 * - Complete suggestion lists (not limited to loaded page of workflows)
 * - Lazy loading (no API calls until field is accessed)
 * - Shared TanStack Query cache (pool names reused from pools page)
 * - Loading states shown in FilterBar dropdown
 *
 * Architecture:
 * - Uses lazy fetching: queries start disabled, enable when field accessed
 * - Properly memoizes field objects and getValues functions
 * - Prevents cascading re-renders through stable references
 * - Once fetched, data cached for 5 minutes
 */

"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import type { AsyncSearchField } from "@/components/filter-bar/lib/types";
import type { WorkflowListEntry } from "@/lib/api/adapter/types";
import { usePoolNames, useUsers } from "@/lib/api/adapter/hooks";

interface UseWorkflowAsyncFieldsReturn {
  /** Async field definition for "user:" filter */
  userField: AsyncSearchField<WorkflowListEntry>;
  /** Async field definition for "pool:" filter */
  poolField: AsyncSearchField<WorkflowListEntry>;
}

export function useWorkflowAsyncFields(): UseWorkflowAsyncFieldsReturn {
  // Lazy loading state: track which fields have been accessed by the user
  const [poolEnabled, setPoolEnabled] = useState(false);
  const [userEnabled, setUserEnabled] = useState(false);

  // Refs to track whether fields have been accessed (prevents duplicate enables)
  const poolAccessedRef = useRef(false);
  const userAccessedRef = useRef(false);

  // Enable pool query on first access (deferred via queueMicrotask)
  const enablePoolQuery = useCallback(() => {
    if (!poolAccessedRef.current) {
      poolAccessedRef.current = true;
      // Use queueMicrotask to defer state update until after render completes
      // This schedules the update for the next microtask, avoiding "setState during render"
      queueMicrotask(() => {
        setPoolEnabled(true);
      });
    }
  }, []);

  // Enable user query on first access (deferred via queueMicrotask)
  const enableUserQuery = useCallback(() => {
    if (!userAccessedRef.current) {
      userAccessedRef.current = true;
      // Use queueMicrotask to defer state update until after render completes
      // This schedules the update for the next microtask, avoiding "setState during render"
      queueMicrotask(() => {
        setUserEnabled(true);
      });
    }
  }, []);

  // Fetch pool names and users with lazy loading
  // Queries are disabled until user accesses the field (types prefix)
  // Once enabled, data is cached for 5 minutes (shared across pages)
  const { names: poolNames, isLoading: poolsLoading } = usePoolNames(poolEnabled);
  const { users, isLoading: usersLoading } = useUsers(userEnabled);

  // Stable getValues callbacks with lazy loading trigger
  // When FilterBar calls getValues, enable the query (deferred via queueMicrotask)
  // queueMicrotask schedules the state update for next tick, avoiding "setState during render"
  const getPoolValues = useMemo(() => {
    const values = poolNames;
    return () => {
      enablePoolQuery(); // Trigger lazy load (deferred via queueMicrotask)
      return values;
    };
  }, [poolNames, enablePoolQuery]);

  const getUserValues = useMemo(() => {
    const values = users;
    return () => {
      enableUserQuery(); // Trigger lazy load (deferred via queueMicrotask)
      return values;
    };
  }, [users, enableUserQuery]);

  // Memoize field objects to prevent FilterBar re-renders
  const userField = useMemo(
    (): AsyncSearchField<WorkflowListEntry> => ({
      type: "async",
      id: "user",
      label: "User",
      hint: "submitted by",
      prefix: "user:",
      freeFormHint: "Type any username, press Enter",
      getValues: getUserValues,
      isLoading: usersLoading,
      // User list is filtered (only users who submitted workflows), not exhaustive
      exhaustive: false,
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
      freeFormHint: "Type any pool, press Enter",
      getValues: getPoolValues,
      isLoading: poolsLoading,
      // Pool list is complete (all pools in system), exhaustive
      exhaustive: true,
      // Allow free-form input (backend validates), don't require exact match
      requiresValidValue: false,
    }),
    [getPoolValues, poolsLoading],
  );

  return { userField, poolField };
}
