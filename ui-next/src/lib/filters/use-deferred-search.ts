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

import { useState, useCallback, useDeferredValue, useTransition, useMemo } from "react";
import type { DeferredSearchResult } from "./types";

/**
 * Hook for managing search input with deferred value updates.
 *
 * Uses React's useDeferredValue and useTransition to provide a non-blocking
 * search experience. The input updates immediately while filtering uses
 * the deferred value, preventing UI jank during rapid typing.
 *
 * @returns Search state and handlers
 *
 * @example
 * ```tsx
 * const search = useDeferredSearch();
 *
 * // Use value for input binding (immediate)
 * <input value={search.value} onChange={(e) => search.setValue(e.target.value)} />
 *
 * // Use deferredValue for filtering (non-blocking)
 * const filtered = items.filter(item =>
 *   item.name.toLowerCase().includes(search.deferredValue.toLowerCase())
 * );
 * ```
 */
export function useDeferredSearch(): DeferredSearchResult {
  const [value, setValueState] = useState("");
  const deferredValue = useDeferredValue(value);
  const [, startTransition] = useTransition();

  const setValue = useCallback((newValue: string) => {
    startTransition(() => {
      setValueState(newValue);
    });
  }, []);

  const clear = useCallback(() => {
    setValueState("");
  }, []);

  const result = useMemo(
    () => ({
      value,
      deferredValue,
      setValue,
      clear,
      hasValue: value.length > 0,
    }),
    [value, deferredValue, setValue, clear],
  );

  return result;
}
