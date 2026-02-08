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
 * Pure functions for parsing filter bar input.
 *
 * These are stateless, testable functions with zero React dependencies.
 * Used by useSuggestions and useFilterKeyboard for input interpretation.
 */

import type { SearchField, ParsedInput } from "@/components/filter-bar/lib/types";

/**
 * Parse input to find the longest matching field prefix.
 * Supports hierarchical prefixes like "quota:free:" - finds longest match.
 *
 * @example
 * parseInput("pool:mypool", fields) => { field: poolField, query: "mypool", hasPrefix: true }
 * parseInput("some text", fields) => { field: null, query: "some text", hasPrefix: false }
 */
export function parseInput<T>(inputValue: string, fields: readonly SearchField<T>[]): ParsedInput<T> {
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
 * Falls back to the field's label if no explicit hint is provided.
 */
export function getFieldHint<T>(field: SearchField<T>): string {
  if (field.hint) return field.hint;
  return field.label;
}
