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
 * usePoolSelection - Pool state with pre-validation of the default pool.
 *
 * Validates the default pool name exists before using it. When the user
 * overrides the selection, the override takes precedence. Shared between
 * resubmit and submit-workflow forms.
 */

"use client";

import { useState, useCallback, useMemo } from "react";
import { usePool } from "@/lib/api/adapter/hooks";

export interface UsePoolSelectionReturn {
  pool: string;
  setPool: (pool: string) => void;
  resetPool: () => void;
}

export function usePoolSelection(defaultPoolName: string): UsePoolSelectionReturn {
  const { pool: validatedPool, isLoading: isValidatingPool } = usePool(defaultPoolName, !!defaultPoolName);

  // null = use default (validated); string = user override
  const [poolOverride, setPoolOverride] = useState<string | null>(null);

  const pool = useMemo(() => {
    if (poolOverride !== null) return poolOverride;
    if (!defaultPoolName || isValidatingPool) return "";
    return validatedPool?.name ?? "";
  }, [poolOverride, defaultPoolName, validatedPool, isValidatingPool]);

  const setPool = useCallback((value: string) => setPoolOverride(value), []);
  const resetPool = useCallback(() => setPoolOverride(null), []);

  return useMemo(() => ({ pool, setPool, resetPool }), [pool, setPool, resetPool]);
}
