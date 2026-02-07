/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
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

/**
 * Core types for FilterBar.
 *
 * These types define the data model for filter bar - fields, chips, and presets.
 * This is pure business logic, completely independent of any UI library.
 */

/**
 * Chip variant for styling (e.g., free/used filters)
 */
export type ChipVariant = "free" | "used";

// =============================================================================
// Search Field: Discriminated Union (sync vs async)
// =============================================================================

/**
 * Properties shared by both sync and async search fields.
 *
 * Sync fields derive their values from parent data (e.g., extracting pool names
 * from a list of pools already fetched by the page). Async fields load their own
 * data independently (e.g., fetching all users from a dedicated API endpoint).
 *
 * @template T - The data item type being searched (only relevant for sync fields)
 */
interface BaseSearchField<T> {
  /** Unique identifier for the field */
  id: string;
  /** Display label (e.g., "Status", "Platform") */
  label: string;
  /** Prefix for typed queries (e.g., "status:", "platform:") */
  prefix: string;
  /**
   * Check if an item matches this field's value (for client-side filtering).
   * Optional - omit when using server-side filtering.
   */
  match?: (item: T, value: string) => boolean;
  /**
   * If true, only values from getValues are valid - free text not allowed.
   * User must select from suggestions; typed values that don't match are rejected.
   */
  requiresValidValue?: boolean;
  /** Custom hint text shown in dropdown (defaults to label) */
  hint?: string;
  /**
   * Custom validation for the input value.
   * Returns `true` if valid, or an error message string if invalid.
   * Called before creating a chip.
   */
  validate?: (value: string) => true | string;
  /**
   * Hint text for free-form input fields.
   * Shown in dropdown when no autocomplete suggestions available.
   */
  freeFormHint?: string;
  /**
   * Whether the field's suggestions are exhaustive (complete list).
   *
   * - `true`: Suggestions represent all valid options (e.g., enums like status, priority).
   *   No "Seen in your data" hint is shown.
   * - `false` (default): Suggestions are samples from loaded data.
   *   Shows "Seen in your data:" heading to indicate non-exhaustive list.
   *
   * This affects UX treatment but not validation - use `requiresValidValue`
   * to enforce selection from suggestions.
   */
  exhaustive?: boolean;
  /**
   * Variant for chip styling (e.g., "free" or "used").
   * Applied to chips created from this field.
   */
  variant?: ChipVariant;
  /**
   * For shorthand fields: function to resolve to an explicit field ID.
   * Receives current context (like display mode) and returns the target field ID.
   */
  resolveTo?: (context: { displayMode?: "free" | "used" }) => string;
}

/**
 * Sync search field: receives parent data to extract autocomplete values.
 *
 * This is the default field type. Values come from the same data that the
 * page already has (e.g., extracting unique pool names from a list of workflows).
 *
 * @template T - The data item type being searched
 */
export interface SyncSearchField<T> extends BaseSearchField<T> {
  /** Discriminant: sync fields receive data from parent (default if omitted) */
  type?: "sync";
  /** Extract autocomplete values from parent data */
  getValues: (data: T[]) => string[];
}

/**
 * Async search field: loads its own data independently.
 *
 * Used when a field needs data from a different API endpoint than the page's
 * primary data source (e.g., a "user:" field that fetches from /api/users
 * while the page fetches workflows).
 *
 * The consuming component/hook is responsible for calling the appropriate API
 * and passing the results via getValues + isLoading.
 *
 * @template T - The data item type (kept for union compatibility, not used by getValues)
 */
export interface AsyncSearchField<T> extends BaseSearchField<T> {
  /** Discriminant: async fields load their own data */
  type: "async";
  /** Returns pre-loaded autocomplete values (no data param - loaded internally) */
  getValues: () => string[];
  /** Whether the field's data is currently loading */
  isLoading: boolean;
}

/**
 * A search field that is either sync (derives values from parent data)
 * or async (loads its own data from an API).
 *
 * Use the `type` discriminant to narrow:
 * - `type: undefined | 'sync'` -> SyncSearchField (default, backward compatible)
 * - `type: 'async'` -> AsyncSearchField (self-loading, has isLoading)
 *
 * @template T - The data item type being searched
 */
export type SearchField<T> = SyncSearchField<T> | AsyncSearchField<T>;

/**
 * Type guard: check if a field is async.
 * Async fields load their own data and have an isLoading property.
 */
export function isAsyncField<T>(field: SearchField<T>): field is AsyncSearchField<T> {
  return field.type === "async";
}

/**
 * Get values from a field, handling both sync and async variants.
 * For sync fields, passes the data array. For async fields, calls with no args.
 */
export function getFieldValues<T>(field: SearchField<T>, data: T[]): string[] {
  if (isAsyncField(field)) {
    return field.getValues();
  }
  return field.getValues(data);
}

/**
 * A search filter chip displayed in the search bar.
 */
export interface SearchChip {
  /** Field ID this chip filters on (e.g., "status", "platform") */
  field: string;
  /** The filter value (e.g., "ONLINE", "dgx") */
  value: string;
  /** Display label (e.g., "Status: ONLINE") */
  label: string;
  /** Optional variant for styling (e.g., "free" or "used") */
  variant?: ChipVariant;
}

/**
 * Props passed to the custom preset render function.
 *
 * FilterBar is agnostic about preset content - the caller provides
 * the render function and decides what to display (labels, counts, icons, etc.).
 */
export interface PresetRenderProps {
  /** Whether the preset is currently active (has matching chip) */
  active: boolean;
  /** Whether the preset is focused via keyboard navigation */
  focused: boolean;
}

/**
 * A preset filter button shown at the top of the dropdown.
 * Used for quick-access filters like status categories.
 *
 * FilterBar practices dependency injection - the caller provides the render
 * function and is responsible for all visual content (labels, counts, icons, etc.).
 * This keeps the component agnostic about what presets display.
 *
 * Supports both single-chip and multi-chip presets:
 * - Single: use `chip` field (backwards compatible)
 * - Multi: use `chips` field (for category presets like "Failed" → 12 status chips)
 *
 * Multi-chip preset behavior:
 * - Click: Add ALL chips if not all present, remove ALL if all present
 * - Active: Only when ALL chips are present
 * - Partial: If some chips are removed, preset becomes inactive
 */
export interface SearchPreset {
  /** Unique identifier */
  id: string;
  /**
   * Chips to add when this preset is clicked.
   * All chips are added/removed together. Preset is active only when ALL are present.
   */
  chips: SearchChip[];
  /**
   * Render function for preset content.
   * The caller is responsible for all visual content (labels, icons, counts, etc.).
   * FilterBar only handles the button wrapper and click/keyboard interaction.
   */
  render: (props: PresetRenderProps) => React.ReactNode;
}

/**
 * Results count configuration for FilterBar.
 * Backend-driven counts for displaying "N results" or "M of N results".
 */
export interface ResultsCount {
  /**
   * Total count of all items (unfiltered).
   * Shown as "N results" when no filters are active.
   */
  total: number;
  /**
   * Filtered count (when filters are active).
   * When provided, shows "M of N results" format.
   * Undefined means no filters are active.
   */
  filtered?: number;
}

/**
 * Props for the FilterBar component.
 * @template T - The data item type being searched
 */
export interface FilterBarProps<T> {
  /** Data to search through (for autocomplete values) */
  data: T[];
  /** Field definitions for this search */
  fields: readonly SearchField<T>[];
  /** Current chips */
  chips: SearchChip[];
  /** Callback when chips change */
  onChipsChange: (chips: SearchChip[]) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS class */
  className?: string;
  /** Display mode context for resolving shorthand fields */
  displayMode?: "free" | "used";
  /** Preset filter buttons shown at top of dropdown (grouped by label) */
  presets?: {
    /** Group label (e.g., "Status") */
    label: string;
    /** Preset buttons in this group */
    items: SearchPreset[];
  }[];
  /**
   * Results count for displaying "N results" or "M of N results".
   * Backend-driven: total is the unfiltered count, filtered is the count after filters.
   * This is independent of pagination/virtualization - it's the true total.
   */
  resultsCount?: ResultsCount;
}

/**
 * A suggestion item for the dropdown.
 */
export interface Suggestion<T> {
  /** Type of suggestion */
  type: "field" | "value" | "hint";
  /** The field this suggestion is for */
  field: SearchField<T>;
  /** The value to use when selected */
  value: string;
  /** Display label */
  label: string;
  /** Optional hint text */
  hint?: string;
}

/**
 * Parsed input result.
 */
export interface ParsedInput<T> {
  /** The matched field (null if no prefix matched) */
  field: SearchField<T> | null;
  /** The query after the prefix */
  query: string;
  /** Whether a prefix was matched */
  hasPrefix: boolean;
}
