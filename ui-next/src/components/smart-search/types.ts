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
 * Generic smart search types.
 *
 * These types define the interface for the omni search component
 * that converts user input into filter chips.
 */

/**
 * Chip variant for styling (e.g., free/used filters)
 */
export type ChipVariant = "free" | "used";

/**
 * Definition of a searchable field.
 * @template T - The data item type being searched
 */
export interface SearchField<T> {
  /** Unique identifier for the field */
  id: string;
  /** Display label (e.g., "Status", "Platform") */
  label: string;
  /** Prefix for typed queries (e.g., "status:", "platform:") */
  prefix: string;
  /** Extract autocomplete values from data */
  getValues: (data: T[]) => string[];
  /** Check if an item matches this field's value */
  match: (item: T, value: string) => boolean;
  /** If true, field only supports free-text search (no dropdown suggestions) */
  freeTextOnly?: boolean;
  /** If true, only values from getValues are valid - free text not allowed */
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
 */
export interface PresetRenderProps {
  /** Whether the preset is currently active (has matching chip) */
  active: boolean;
  /** Whether the preset is focused via keyboard navigation */
  focused: boolean;
  /** Count of matching items */
  count: number;
  /** The preset label */
  label: string;
}

/**
 * A preset filter button shown at the top of the dropdown.
 * Used for quick-access filters like status categories.
 * @template T - The data item type being filtered
 */
export interface SearchPreset<T> {
  /** Unique identifier */
  id: string;
  /** Display label (e.g., "Online") */
  label: string;
  /** Function to count matching items */
  count: (data: T[]) => number;
  /** The chip to add when this preset is clicked */
  chip: SearchChip;
  /**
   * Custom render function for preset content.
   * If provided, replaces the default dot + label + count rendering.
   * The button wrapper and click handling are still managed by SmartSearch.
   */
  render?: (props: PresetRenderProps) => React.ReactNode;
  // ---- Default rendering props (used when render is not provided) ----
  /** Tailwind class for the status dot color (e.g., "bg-emerald-500") */
  dotColor?: string;
  /** Tailwind classes for badge styling when active */
  badgeColors?: {
    /** Background color class (e.g., "bg-emerald-100 dark:bg-emerald-900/50") */
    bg: string;
    /** Text color class (e.g., "text-emerald-700 dark:text-emerald-300") */
    text: string;
  };
}

/**
 * Props for the SmartSearch component.
 * @template T - The data item type being searched
 */
export interface SmartSearchProps<T> {
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
    items: SearchPreset<T>[];
  }[];
}

/**
 * Filter items by chips.
 * Same-field chips are OR'd, different-field chips are AND'd.
 *
 * @param items - Items to filter
 * @param chips - Active filter chips
 * @param fields - Field definitions with match functions
 * @returns Filtered items
 */
export function filterByChips<T>(items: T[], chips: SearchChip[], fields: readonly SearchField<T>[]): T[] {
  if (chips.length === 0) return items;

  // Group chips by field
  const chipGroups = new Map<string, string[]>();
  for (const chip of chips) {
    const values = chipGroups.get(chip.field) ?? [];
    values.push(chip.value);
    chipGroups.set(chip.field, values);
  }

  return items.filter((item) => {
    // AND across different fields
    for (const [fieldId, values] of chipGroups) {
      const field = fields.find((f) => f.id === fieldId);
      if (!field) continue;
      // OR within same field
      if (!values.some((v) => field.match(item, v))) return false;
    }
    return true;
  });
}
