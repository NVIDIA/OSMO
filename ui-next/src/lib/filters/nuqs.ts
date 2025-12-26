/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * nuqs-based URL state management for filters.
 *
 * This module provides URL-synced alternatives to our in-memory filter hooks.
 * The key benefits:
 * - Filter state persists on page refresh
 * - Shareable URLs with filter state
 * - Browser back/forward navigation respects filter state
 * - Type-safe with parsers
 *
 * @see https://nuqs.47ng.com/
 */

import { useMemo, useCallback, useDeferredValue, useTransition } from "react";
import { useQueryState, parseAsString, parseAsArrayOf, parseAsStringLiteral, type Options } from "nuqs";
import type { SetFilterResult, DeferredSearchResult } from "./types";
import { ALL_RESOURCE_TYPES } from "@/lib/constants/ui";
import type { BackendResourceType } from "@/lib/api/generated";

// =============================================================================
// Common Options
// =============================================================================

/**
 * Default options for URL state:
 * - shallow: false - triggers server component re-render (important for data fetching)
 * - history: "push" - enables back/forward navigation through filter states
 * - throttleMs: 300 - debounce URL updates for performance
 */
const DEFAULT_URL_OPTIONS: Options = {
  shallow: true, // Don't trigger full page reload
  history: "push", // Enable back/forward navigation
  throttleMs: 300, // Debounce URL updates
  clearOnDefault: true, // Remove param from URL when set to default value
};

/**
 * Options for search input - uses replace to avoid polluting history
 */
const SEARCH_URL_OPTIONS: Options = {
  ...DEFAULT_URL_OPTIONS,
  history: "replace", // Don't create history entry for each keystroke
  throttleMs: 500, // Higher debounce for search
};

// =============================================================================
// Custom Parsers
// =============================================================================

/**
 * Parser for BackendResourceType that validates against known types.
 */
export const parseAsResourceType = parseAsStringLiteral(ALL_RESOURCE_TYPES);

// =============================================================================
// URL-Synced Search Hook
// =============================================================================

/**
 * URL-synced search input with deferred value for non-blocking updates.
 *
 * Similar to `useDeferredSearch()` but persists search in URL query string.
 *
 * @param key - The URL query parameter key (default: "q")
 * @returns Search state and handlers compatible with DeferredSearchResult
 *
 * @example
 * ```tsx
 * const search = useUrlSearch("search");
 *
 * // URL: /resources?search=gpu
 * <input value={search.value} onChange={(e) => search.setValue(e.target.value)} />
 *
 * // Filter with deferred value (non-blocking)
 * const filtered = items.filter(item =>
 *   item.name.toLowerCase().includes(search.deferredValue.toLowerCase())
 * );
 * ```
 */
export function useUrlSearch(key: string = "q"): DeferredSearchResult {
  const [value, setValueState] = useQueryState(key, parseAsString.withDefault("").withOptions(SEARCH_URL_OPTIONS));
  const deferredValue = useDeferredValue(value);
  const [, startTransition] = useTransition();

  const setValue = useCallback(
    (newValue: string) => {
      startTransition(() => {
        setValueState(newValue);
      });
    },
    [setValueState],
  );

  const clear = useCallback(() => {
    setValueState("");
  }, [setValueState]);

  return useMemo(
    () => ({
      value,
      deferredValue,
      setValue,
      clear,
      hasValue: value.length > 0,
    }),
    [value, deferredValue, setValue, clear],
  );
}

// =============================================================================
// URL-Synced Set Filter Hook
// =============================================================================

/**
 * Options for URL set filter.
 */
interface UrlSetFilterOptions {
  /** If true, only one value can be selected at a time */
  singleSelect?: boolean;
}

/**
 * URL-synced set-based filter.
 *
 * Similar to `useSetFilter<string>()` but persists selection in URL query string.
 *
 * @param key - The URL query parameter key
 * @param options - Configuration options
 * @returns Filter state and handlers compatible with SetFilterResult
 *
 * @example Multi-select
 * ```tsx
 * const poolFilter = useUrlSetFilter("pools");
 * // URL: /resources?pools=pool-1&pools=pool-2
 *
 * poolFilter.toggle("pool-1"); // Adds to URL
 * poolFilter.toggle("pool-1"); // Removes from URL
 * ```
 *
 * @example Single-select
 * ```tsx
 * const typeFilter = useUrlSetFilter("type", { singleSelect: true });
 * // URL: /resources?type=gpu
 *
 * typeFilter.toggle("gpu");  // Sets type=gpu
 * typeFilter.toggle("cpu");  // Replaces with type=cpu
 * typeFilter.toggle("cpu");  // Removes type param
 * ```
 */
export function useUrlSetFilter(key: string, options?: UrlSetFilterOptions): SetFilterResult<string> {
  const singleSelect = options?.singleSelect ?? false;

  // For single select, use string parser; for multi-select, use array parser
  const [arrayValue, setArrayValue] = useQueryState(
    key,
    parseAsArrayOf(parseAsString).withDefault([]).withOptions(DEFAULT_URL_OPTIONS),
  );

  // Convert array to Set for consistent interface
  const selected = useMemo(() => new Set(arrayValue), [arrayValue]);

  const toggle = useCallback(
    (value: string) => {
      if (selected.has(value)) {
        // Remove value
        setArrayValue(arrayValue.filter((v) => v !== value));
      } else if (singleSelect) {
        // Single select: replace entire array
        setArrayValue([value]);
      } else {
        // Multi select: add to array
        setArrayValue([...arrayValue, value]);
      }
    },
    [selected, arrayValue, setArrayValue, singleSelect],
  );

  const clear = useCallback(() => {
    setArrayValue([]);
  }, [setArrayValue]);

  const isSelected = useCallback((value: string) => selected.has(value), [selected]);

  return useMemo(
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
}

// =============================================================================
// URL-Synced Resource Type Filter Hook
// =============================================================================

/**
 * URL-synced filter specifically for BackendResourceType.
 *
 * Single-select with type-safe validation against known resource types.
 *
 * @param key - The URL query parameter key (default: "type")
 * @returns Filter state and handlers compatible with SetFilterResult
 *
 * @example
 * ```tsx
 * const typeFilter = useUrlResourceTypeFilter();
 * // URL: /resources?type=gpu
 *
 * typeFilter.toggle("gpu");  // Type-safe: only accepts BackendResourceType
 * ```
 */
export function useUrlResourceTypeFilter(key: string = "type"): SetFilterResult<BackendResourceType> {
  const [value, setValue] = useQueryState(key, parseAsResourceType.withOptions(DEFAULT_URL_OPTIONS));

  const selected = useMemo(() => (value ? new Set([value]) : new Set<BackendResourceType>()), [value]);

  const toggle = useCallback(
    (type: BackendResourceType) => {
      if (value === type) {
        // Deselect
        setValue(null);
      } else {
        // Select
        setValue(type);
      }
    },
    [value, setValue],
  );

  const clear = useCallback(() => {
    setValue(null);
  }, [setValue]);

  const isSelected = useCallback((type: BackendResourceType) => value === type, [value]);

  return useMemo(
    () => ({
      selected,
      toggle,
      clear,
      isSelected,
      count: selected.size,
      hasSelection: value !== null,
    }),
    [selected, toggle, clear, isSelected, value],
  );
}
