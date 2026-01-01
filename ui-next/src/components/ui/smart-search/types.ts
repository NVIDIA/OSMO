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
 * Generic smart search types.
 *
 * These types define the interface for the omni search component
 * that converts user input into filter chips.
 */

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
}

/**
 * Props for the SmartSearch component.
 * @template T - The data item type being searched
 */
export interface SmartSearchProps<T> {
  /** Data to search through (for autocomplete values) */
  data: T[];
  /** Field definitions for this search */
  fields: SearchField<T>[];
  /** Current chips */
  chips: SearchChip[];
  /** Callback when chips change */
  onChipsChange: (chips: SearchChip[]) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Enable natural language date parsing (requires chrono-node) */
  enableDateParsing?: boolean;
  /** Additional CSS class */
  className?: string;
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
export function filterByChips<T>(items: T[], chips: SearchChip[], fields: SearchField<T>[]): T[] {
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
