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
 * Hook for generating search suggestions based on input and field definitions.
 *
 * This is core business logic for suggestion generation, independent of how
 * the UI is rendered. Handles prefix parsing, field matching, and value extraction.
 */

import { useMemo } from "react";
import type { SearchField, SearchChip, SearchPreset, Suggestion, ParsedInput } from "../lib/types";
import { getFieldValues } from "../lib/types";
import { parseInput, getFieldHint } from "../lib/parse-input";

export interface UseSuggestionsOptions<T> {
  /** Current input value */
  inputValue: string;
  /** Field definitions */
  fields: readonly SearchField<T>[];
  /** Data for generating autocomplete values */
  data: T[];
  /** Current chips (to filter out already-selected values) */
  chips: SearchChip[];
  /** Preset groups (for flattening for navigation) */
  presets?: {
    label: string;
    items: SearchPreset[];
  }[];
}

export interface UseSuggestionsReturn<T> {
  /** Parsed input with field and query */
  parsedInput: ParsedInput<T>;
  /** All suggestions for the dropdown */
  suggestions: Suggestion<T>[];
  /** Flattened preset items for navigation */
  flatPresets: SearchPreset[];
}

/**
 * Check if a chip already exists for the given field and value.
 */
function isAlreadySelected(chips: SearchChip[], fieldId: string, value: string): boolean {
  return chips.some((c) => c.field === fieldId && c.value.toLowerCase() === value.toLowerCase());
}

/**
 * Generate suggestions based on current input.
 * Filters out values that already have corresponding chips.
 */
function generateSuggestions<T>(
  inputValue: string,
  parsedInput: ParsedInput<T>,
  fields: readonly SearchField<T>[],
  data: T[],
  chips: SearchChip[],
): Suggestion<T>[] {
  const items: Suggestion<T>[] = [];
  const query = inputValue.toLowerCase().trim();

  if (!query) {
    // Show all field prefixes when input is empty
    for (const field of fields) {
      if (field.prefix) {
        items.push({
          type: "field",
          field,
          value: field.prefix,
          label: field.prefix,
          hint: getFieldHint(field),
        });
      }
    }
    return items;
  }

  if (parsedInput.hasPrefix && parsedInput.field) {
    // Show values for the selected field
    const field = parsedInput.field;
    const currentPrefix = field.prefix;
    const prefixQuery = parsedInput.query.toLowerCase();

    // Get available values (sync: from data, async: pre-loaded)
    const values = getFieldValues(field, data);

    // Find sub-fields that extend this prefix (e.g., "quota:" has sub-fields "quota:free:", "quota:used:")
    const matchingSubFields = fields.filter((f) => {
      if (!f.prefix || f.prefix === currentPrefix || !f.prefix.startsWith(currentPrefix)) {
        return false;
      }
      // Get the part after the current prefix (e.g., "free:" from "quota:free:")
      const suffix = f.prefix.slice(currentPrefix.length).toLowerCase();
      // Match if user's query starts with or is contained in the suffix
      return prefixQuery === "" || suffix.startsWith(prefixQuery);
    });

    // If no values available, show freeFormHint (if any) and sub-fields
    if (values.length === 0) {
      // Show free-form hint if available
      if (field.freeFormHint && (matchingSubFields.length !== 1 || prefixQuery === "")) {
        items.push({
          type: "hint",
          field,
          value: "",
          label: field.freeFormHint,
          hint: field.freeFormHint,
        });
      }

      // Show matching sub-fields
      for (const f of matchingSubFields) {
        items.push({
          type: "field",
          field: f,
          value: f.prefix,
          label: f.prefix,
          hint: getFieldHint(f),
        });
      }

      return items;
    }

    // Filter to matching values, excluding already-selected
    const filtered = values.filter(
      (v) => v.toLowerCase().includes(prefixQuery) && !isAlreadySelected(chips, field.id, v),
    );

    // For non-exhaustive fields: limit to 8 suggestions max
    // As user types, we show up to 8 matches; count only decreases when running out of matches
    const maxSuggestions = field.exhaustive ? filtered.length : 8;
    const limited = filtered.slice(0, maxSuggestions);

    // For non-exhaustive fields, show freeFormHint to indicate free text is allowed
    if (!field.exhaustive && field.freeFormHint) {
      items.push({
        type: "hint",
        field,
        value: "",
        label: field.freeFormHint,
      });
    }

    for (const v of limited) {
      items.push({
        type: "value",
        field,
        value: v,
        label: `${field.prefix}${v}`,
      });
    }
    return items;
  }

  // Show matching field prefixes only (no value suggestions until after colon)
  for (const field of fields) {
    if (field.prefix) {
      const prefixMatch = field.prefix.toLowerCase().startsWith(query) || field.label.toLowerCase().startsWith(query);
      if (prefixMatch) {
        items.push({
          type: "field",
          field,
          value: field.prefix,
          label: field.prefix,
          hint: getFieldHint(field),
        });
      }
    }
  }

  return items;
}

/**
 * Hook for generating search suggestions based on input.
 *
 * Core responsibilities:
 * - Parsing input to detect field prefixes
 * - Generating field suggestions when no prefix
 * - Generating value suggestions when prefix is active (based on getValues)
 * - Handling hierarchical prefixes (quota:free:)
 * - Showing freeFormHint when no suggestions available
 *
 * Suggestion logic:
 * - getValues() returns values → show suggestions (limited to 8 for non-exhaustive)
 * - getValues() returns empty → show freeFormHint (if any) and sub-fields
 * - exhaustive: true → no "Suggestions:" hint, no limit
 *
 * This hook is UI-agnostic and can work with any dropdown implementation.
 */
export function useSuggestions<T>({
  inputValue,
  fields,
  data,
  chips,
  presets,
}: UseSuggestionsOptions<T>): UseSuggestionsReturn<T> {
  // Parse input for field prefix
  const parsedInput = useMemo(() => parseInput(inputValue, fields), [inputValue, fields]);

  // Generate suggestions (excludes already-selected values)
  const suggestions = useMemo(
    () => generateSuggestions(inputValue, parsedInput, fields, data, chips),
    [inputValue, parsedInput, fields, data, chips],
  );

  // Flatten presets for navigation
  const flatPresets = useMemo(() => {
    if (!presets || inputValue !== "") return [];
    return presets.flatMap((group) => group.items);
  }, [presets, inputValue]);

  return {
    parsedInput,
    suggestions,
    flatPresets,
  };
}
