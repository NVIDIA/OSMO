//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Async search fields for the datasets FilterBar.
 *
 * Provides a lazily-loaded user field backed by /api/users.
 * Query is disabled until the user types "user:" in the FilterBar,
 * then results are cached for 5 minutes (shared with other pages).
 */

"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import type { AsyncSearchField } from "@/components/filter-bar/lib/types";
import type { Dataset } from "@/lib/api/adapter/datasets";
import { useUsers } from "@/lib/api/adapter/hooks";

interface UseDatasetsAsyncFieldsReturn {
  /** Async field definition for "user:" filter */
  userField: AsyncSearchField<Dataset>;
}

export function useDatasetsAsyncFields(): UseDatasetsAsyncFieldsReturn {
  const [usersEnabled, setUsersEnabled] = useState(false);
  const usersAccessedRef = useRef(false);

  const enableUsersQuery = useCallback(() => {
    if (!usersAccessedRef.current) {
      usersAccessedRef.current = true;
      queueMicrotask(() => {
        setUsersEnabled(true);
      });
    }
  }, []);

  const { users, isLoading: usersLoading } = useUsers(usersEnabled);

  const getUserValues = useMemo(() => {
    const values = users;
    return () => {
      enableUsersQuery();
      return values;
    };
  }, [users, enableUsersQuery]);

  const userField = useMemo(
    (): AsyncSearchField<Dataset> => ({
      type: "async",
      id: "user",
      label: "User",
      hint: "created by",
      prefix: "user:",
      freeFormHint: "Type any username, press Enter",
      getValues: getUserValues,
      isLoading: usersLoading,
      exhaustive: false,
    }),
    [getUserValues, usersLoading],
  );

  return { userField };
}
