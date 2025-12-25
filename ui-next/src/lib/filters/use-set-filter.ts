/**
 * SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

"use client";

import { useState, useCallback, useMemo } from "react";
import type { SetFilterOptions, SetFilterResult } from "./types";

/**
 * Generic hook for managing a Set-based filter selection.
 *
 * Provides a reusable pattern for multi-select or single-select filtering
 * that can be used across any entity type (resources, pools, workflows, etc.).
 *
 * @template T - The type of values in the filter set
 * @param options - Configuration options
 * @returns Filter state and handlers
 *
 * @example Multi-select filter (default)
 * ```tsx
 * const poolFilter = useSetFilter<string>();
 * poolFilter.toggle("pool-1"); // Adds pool-1
 * poolFilter.toggle("pool-2"); // Adds pool-2
 * poolFilter.toggle("pool-1"); // Removes pool-1
 * ```
 *
 * @example Single-select filter
 * ```tsx
 * const statusFilter = useSetFilter<Status>({ singleSelect: true });
 * statusFilter.toggle("active");   // Selects active
 * statusFilter.toggle("pending");  // Replaces with pending
 * statusFilter.toggle("pending");  // Deselects pending
 * ```
 */
export function useSetFilter<T>(options?: SetFilterOptions): SetFilterResult<T> {
  const [selected, setSelected] = useState<Set<T>>(new Set());
  const singleSelect = options?.singleSelect ?? false;

  const toggle = useCallback(
    (value: T) => {
      setSelected((prev) => {
        if (prev.has(value)) {
          // Always remove if already selected
          const next = new Set(prev);
          next.delete(value);
          return next;
        }

        if (singleSelect) {
          // Single select: replace entire set
          return new Set([value]);
        }

        // Multi select: add to set
        const next = new Set(prev);
        next.add(value);
        return next;
      });
    },
    [singleSelect],
  );

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const isSelected = useCallback((value: T) => selected.has(value), [selected]);

  const result = useMemo(
    () => ({
      selected,
      toggle,
      clear,
      isSelected,
      count: selected.size,
      hasSelection: selected.size > 0,
    }),
    [selected, toggle, clear, isSelected],
  );

  return result;
}
