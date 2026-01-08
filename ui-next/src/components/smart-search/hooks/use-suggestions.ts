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
import type { SearchField, SearchPreset, Suggestion, ParsedInput } from "../lib";

export interface UseSuggestionsOptions<T> {
  /** Current input value */
  inputValue: string;
  /** Field definitions */
  fields: readonly SearchField<T>[];
  /** Data for generating autocomplete values */
  data: T[];
  /** Preset groups (for flattening for navigation) */
  presets?: {
    label: string;
    items: SearchPreset<T>[];
  }[];
}

export interface UseSuggestionsReturn<T> {
  /** Parsed input with field and query */
  parsedInput: ParsedInput<T>;
  /** All suggestions for the dropdown */
  suggestions: Suggestion<T>[];
  /** Suggestions that can be selected (excludes hints) */
  selectableSuggestions: Suggestion<T>[];
  /** Flattened preset items for navigation */
  flatPresets: SearchPreset<T>[];
  /** Total navigable items (presets + selectable suggestions) */
  totalNavigableCount: number;
}

/**
 * Parse input to find the longest matching field prefix.
 * Supports hierarchical prefixes like "quota:free:" - finds longest match.
 */
function parseInput<T>(inputValue: string, fields: readonly SearchField<T>[]): ParsedInput<T> {
  let bestMatch: { field: SearchField<T>; prefix: string } | null = null;

  for (const field of fields) {
    if (field.prefix && inputValue.toLowerCase().startsWith(field.prefix.toLowerCase())) {
      if (!bestMatch || field.prefix.length > bestMatch.prefix.length) {
        bestMatch = { field, prefix: field.prefix };
      }
    }
  }

  if (bestMatch) {
    return {
      field: bestMatch.field,
      query: inputValue.slice(bestMatch.prefix.length),
      hasPrefix: true,
    };
  }

  return { field: null, query: inputValue, hasPrefix: false };
}

/**
 * Get hint text for a field.
 */
function getFieldHint<T>(field: SearchField<T>): string {
  if (field.hint) return field.hint;
  if (field.freeTextOnly) return `${field.label} (free text)`;
  return field.label;
}

/**
 * Generate suggestions based on current input.
 */
function generateSuggestions<T>(
  inputValue: string,
  parsedInput: ParsedInput<T>,
  fields: readonly SearchField<T>[],
  data: T[],
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

    // For freeTextOnly fields, show hint and sub-fields
    if (field.freeTextOnly) {
      const subQuery = parsedInput.query.toLowerCase();

      // Find sub-fields that extend this prefix and match the query
      const matchingSubFields = fields.filter((f) => {
        if (!f.prefix || f.prefix === currentPrefix || !f.prefix.startsWith(currentPrefix)) {
          return false;
        }
        // Get the part after the current prefix (e.g., "free:" from "quota:free:")
        const suffix = f.prefix.slice(currentPrefix.length).toLowerCase();
        // Match if user's query starts with or is contained in the suffix
        return subQuery === "" || suffix.startsWith(subQuery);
      });

      // Show free-form hint if available (only when no specific sub-field is matched)
      if (field.freeFormHint && (matchingSubFields.length !== 1 || subQuery === "")) {
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

    const values = field.getValues(data);
    const prefixQuery = parsedInput.query.toLowerCase();

    const filtered = values.filter((v) => v.toLowerCase().includes(prefixQuery));
    for (const v of filtered.slice(0, 10)) {
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
 * - Generating value suggestions when prefix is active
 * - Handling hierarchical prefixes (quota:free:)
 * - Supporting freeTextOnly fields with sub-fields
 *
 * This hook is UI-agnostic and can work with any dropdown implementation.
 */
export function useSuggestions<T>({
  inputValue,
  fields,
  data,
  presets,
}: UseSuggestionsOptions<T>): UseSuggestionsReturn<T> {
  // Parse input for field prefix
  const parsedInput = useMemo(() => parseInput(inputValue, fields), [inputValue, fields]);

  // Generate suggestions
  const suggestions = useMemo(
    () => generateSuggestions(inputValue, parsedInput, fields, data),
    [inputValue, parsedInput, fields, data],
  );

  // Filter to selectable suggestions (exclude hints)
  const selectableSuggestions = useMemo(() => suggestions.filter((s) => s.type !== "hint"), [suggestions]);

  // Flatten presets for navigation
  const flatPresets = useMemo(() => {
    if (!presets || inputValue !== "") return [];
    return presets.flatMap((group) => group.items);
  }, [presets, inputValue]);

  // Total navigable items
  const totalNavigableCount = flatPresets.length + selectableSuggestions.length;

  return {
    parsedInput,
    suggestions,
    selectableSuggestions,
    flatPresets,
    totalNavigableCount,
  };
}
