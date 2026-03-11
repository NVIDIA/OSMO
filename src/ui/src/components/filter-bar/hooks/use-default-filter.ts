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

import { useCallback, useEffect, useMemo } from "react";
import { useQueryState, parseAsBoolean } from "nuqs";
import type { SearchChip } from "@/stores/types";
import { useUrlChips } from "@/components/filter-bar/hooks/use-url-chips";

/**
 * Adds default filter chip(s) when no chip for `field` is present in the URL,
 * unless the user has explicitly opted out via `?{optOutParam}=true`.
 *
 * Accepts a single `defaultValue` string or an array of strings (for multi-chip defaults
 * like defaulting to all running-category statuses).
 *
 * - effectiveChips is computed synchronously so the first render uses correct params (no double-fetch).
 * - The chip is NOT written to the URL on mount — only when the user interacts with the filter bar.
 *   Writing it on mount caused a race with nuqs: the effect fired before nuqs had fully parsed all
 *   repeated `f=` URL params, so it overwrote the URL with a partial chip set (losing all but the first).
 * - Removing all chips for `field` sets ?{optOutParam}=true; adding one clears it.
 * - After nuqs has parsed the URL (post-paint), an effect writes the default chip(s) to the URL
 *   using history:"replace" so that refresh/share reflects the active filter.
 */
export function useDefaultFilter({
  field,
  defaultValue,
  label,
  optOutParam = "all",
}: {
  field: string;
  defaultValue: string | string[] | null | undefined;
  label?: string;
  optOutParam?: string;
}): {
  effectiveChips: SearchChip[];
  handleChipsChange: (chips: SearchChip[]) => void;
  optOut: boolean;
} {
  const { searchChips, setSearchChips } = useUrlChips();

  const normalizedDefaults = useMemo(
    () => (defaultValue == null ? [] : Array.isArray(defaultValue) ? defaultValue : [defaultValue]),
    [defaultValue],
  );

  const [optOut, setOptOut] = useQueryState(
    optOutParam,
    parseAsBoolean.withDefault(false).withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  const hasDefaultInUrl = useMemo(() => searchChips.some((c) => c.field === field), [searchChips, field]);

  // When both optOut and explicit chips are present, explicit chips win.
  // Compute this synchronously so callers never see a transient contradictory state.
  const effectiveOptOut = optOut && !hasDefaultInUrl;

  const shouldPrePopulate = !optOut && !hasDefaultInUrl && normalizedDefaults.length > 0;

  const effectiveChips = useMemo((): SearchChip[] => {
    if (!shouldPrePopulate) return searchChips;
    const prefix = label ?? field;
    const defaults: SearchChip[] = normalizedDefaults.map((v) => ({
      field,
      value: v,
      label: normalizedDefaults.length > 1 ? `${prefix}: ${v}` : (label ?? `${field}: ${v}`),
    }));
    return [...searchChips, ...defaults];
  }, [searchChips, shouldPrePopulate, field, normalizedDefaults, label]);

  // If the URL has the opt-out flag set but also has explicit chips for this field,
  // the two are contradictory. The explicit chips win — clear the opt-out so downstream
  // consumers (e.g. showAllUsers) don't ignore the manual filter.
  useEffect(() => {
    if (optOut && hasDefaultInUrl) void setOptOut(false);
  }, [optOut, hasDefaultInUrl, setOptOut]);

  useEffect(() => {
    if (!shouldPrePopulate) return;
    const prefix = label ?? field;
    const defaults: SearchChip[] = normalizedDefaults.map((v) => ({
      field,
      value: v,
      label: normalizedDefaults.length > 1 ? `${prefix}: ${v}` : (label ?? `${field}: ${v}`),
    }));
    void setSearchChips([...searchChips, ...defaults], { history: "replace" });
  }, [shouldPrePopulate, searchChips, field, normalizedDefaults, label, setSearchChips]);

  const handleChipsChange = useCallback(
    (newChips: SearchChip[]) => {
      const prevFieldChips = effectiveChips.filter((c) => c.field === field);
      const newFieldChips = newChips.filter((c) => c.field === field);

      if (newFieldChips.length === 0 && prevFieldChips.length > 0) {
        void setOptOut(true);
      } else if (newFieldChips.length > 0 && optOut) {
        void setOptOut(false);
      }
      void setSearchChips(newChips);
    },
    [effectiveChips, field, optOut, setOptOut, setSearchChips],
  );

  return { effectiveChips, handleChipsChange, optOut: effectiveOptOut };
}
