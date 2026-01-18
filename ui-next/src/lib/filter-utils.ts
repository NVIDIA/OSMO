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
 * Numeric Filter Utilities
 *
 * Shared utilities for parsing, validating, and comparing numeric filter expressions.
 * Used across pools, resources, and other features that support numeric filtering.
 *
 * @example
 * ```ts
 * // Parse a filter expression
 * const parsed = parseNumericFilter(">=90%");
 * // { operator: ">=", value: 90, isPercent: true }
 *
 * // Validate user input
 * const result = validateNumericFilter(">=10", { allowPercent: true });
 * // true (valid) or string (error message)
 *
 * // Compare values
 * compareNumeric(85, ">=", 90, true); // false
 * ```
 */

// =============================================================================
// Types
// =============================================================================

export type CompareOp = ">=" | ">" | "<=" | "<" | "=";

export interface ParsedNumericFilter {
  operator: CompareOp;
  value: number;
  isPercent: boolean;
}

export interface ValidateNumericFilterOptions {
  /** If true, accepts percentage values (default: true) */
  allowPercent?: boolean;
  /** If true, accepts discrete values (default: true) */
  allowDiscrete?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const VALID_OPERATORS: CompareOp[] = [">=", "<=", ">", "<", "="];

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Parse a numeric filter string like ">=10" or ">=90%".
 *
 * @param input - The filter string to parse
 * @returns Parsed filter or null if invalid
 *
 * @example
 * ```ts
 * parseNumericFilter(">=90%")  // { operator: ">=", value: 90, isPercent: true }
 * parseNumericFilter(">10")    // { operator: ">", value: 10, isPercent: false }
 * parseNumericFilter("invalid") // null
 * ```
 */
export function parseNumericFilter(input: string): ParsedNumericFilter | null {
  const trimmed = input.trim();
  // Order matters: check >= and <= before > and < to avoid partial matches
  const match = trimmed.match(/^(>=|<=|>|<|=)(\d+(?:\.\d+)?)(%)?\s*$/);
  if (!match) return null;

  const value = parseFloat(match[2]);
  if (!Number.isFinite(value) || value < 0) return null;

  return {
    operator: match[1] as CompareOp,
    value,
    isPercent: match[3] === "%",
  };
}

/**
 * Validate a numeric filter string.
 *
 * @param input - The filter string to validate
 * @param opts - Validation options
 * @returns `true` if valid, error message string if invalid
 *
 * @example
 * ```ts
 * validateNumericFilter(">=90%") // true
 * validateNumericFilter("foo")   // "Start with >=, >, <=, <, or ="
 * validateNumericFilter(">=120%") // "Max 100%"
 * ```
 */
export function validateNumericFilter(input: string, opts: ValidateNumericFilterOptions = {}): true | string {
  const { allowPercent = true, allowDiscrete = true } = opts;
  const trimmed = input.trim();
  if (!trimmed) return "Enter a value (e.g. >=10)";

  const hasOp = VALID_OPERATORS.some((op) => trimmed.startsWith(op));
  if (!hasOp) return "Start with >=, >, <=, <, or =";

  const parsed = parseNumericFilter(trimmed);
  if (!parsed) return "Invalid format";

  if (parsed.isPercent && !allowPercent) return "Don't use % for this field";
  if (!parsed.isPercent && !allowDiscrete) return "Use % (e.g. >=90%)";
  if (parsed.isPercent && parsed.value > 100) return "Max 100%";

  return true;
}

/**
 * Compare a numeric value against a parsed filter.
 * For percentages, rounds to nearest integer before comparing.
 *
 * @param actual - The actual value to compare
 * @param op - The comparison operator
 * @param target - The target value from the filter
 * @param isPercent - Whether the comparison is percentage-based
 * @returns Whether the comparison succeeds
 *
 * @example
 * ```ts
 * compareNumeric(85, ">=", 80, true)  // true
 * compareNumeric(79, ">=", 80, false) // false
 * ```
 */
export function compareNumeric(actual: number, op: CompareOp, target: number, isPercent: boolean): boolean {
  // Round percentages to nearest integer for comparison
  const value = isPercent ? Math.round(actual) : actual;

  switch (op) {
    case ">=":
      return value >= target;
    case ">":
      return value > target;
    case "<=":
      return value <= target;
    case "<":
      return value < target;
    case "=":
      return value === target;
  }
}

/**
 * Create a match function for numeric filters on a generic item type.
 *
 * @param getValue - Function to get the value from an item
 * @param getMax - Optional function to get the max value (for percentage calculations)
 * @returns A match function for use in search fields
 *
 * @example
 * ```ts
 * // For Pool quota matching
 * const matchQuotaFree = createNumericMatch<Pool>(
 *   (pool) => pool.quota.free,
 *   (pool) => pool.quota.limit
 * );
 *
 * // Use in a search field
 * matchQuotaFree(pool, ">=50%") // true if >=50% free
 * ```
 */
export function createNumericMatch<T>(getValue: (item: T) => number, getMax?: (item: T) => number) {
  return (item: T, value: string): boolean => {
    const parsed = parseNumericFilter(value);
    if (!parsed) return false;

    let actual = getValue(item);
    if (parsed.isPercent && getMax) {
      const max = getMax(item);
      actual = max > 0 ? (actual / max) * 100 : 0;
    }

    return compareNumeric(actual, parsed.operator, parsed.value, parsed.isPercent);
  };
}

// =============================================================================
// Search Field Factory
// =============================================================================

/**
 * Options for creating a numeric search field
 */
export interface NumericSearchFieldInput<T> {
  /** Category identifier (e.g., "gpu", "quota", "memory") */
  category: string;
  /** Variant: "free" or "used" */
  variant: "free" | "used";
  /** Human-readable category label (e.g., "GPU", "Quota") */
  label: string;
  /** Hint describing what this field filters */
  hint: string;
  /** Function to get the numeric value from an item */
  getValue: (item: T) => number;
  /** Function to get the max/total value for percentage calculations */
  getMax: (item: T) => number;
  /** Validation options (default: allow both discrete and percent) */
  validateOptions?: ValidateNumericFilterOptions;
}

/**
 * Create a numeric search field configuration.
 * Reduces boilerplate for creating search fields that filter by numeric values.
 *
 * @param input - Numeric search field configuration
 * @returns A search field configuration object
 *
 * @example
 * ```ts
 * // GPU Free field
 * createNumericSearchField<Resource>({
 *   category: "gpu",
 *   variant: "free",
 *   label: "GPU",
 *   hint: "available GPUs",
 *   getValue: (r) => r.gpu.total - r.gpu.used,
 *   getMax: (r) => r.gpu.total,
 * });
 *
 * // Quota Used field
 * createNumericSearchField<Pool>({
 *   category: "quota",
 *   variant: "used",
 *   label: "Quota",
 *   hint: "quota consumption",
 *   getValue: (p) => p.quota.used,
 *   getMax: (p) => p.quota.limit,
 * });
 * ```
 */
export function createNumericSearchField<T>(input: NumericSearchFieldInput<T>) {
  const { category, variant, label, hint, getValue, getMax, validateOptions } = input;

  // Determine hint based on whether discrete values are allowed
  const allowDiscrete = validateOptions?.allowDiscrete !== false;
  const freeFormHint = allowDiscrete
    ? "<, <=, =, >, >=, N (count) or N% (percentage)"
    : "<, <=, =, >, >=, N% (percentage)";

  return {
    id: `${category}-${variant}`,
    label: `${label} ${variant === "free" ? "Free" : "Used"}`,
    prefix: `${category}:${variant}:`,
    hint,
    freeFormHint,
    getValues: () => [] as string[],
    validate: (v: string) => validateNumericFilter(v, validateOptions),
    match: createNumericMatch<T>(getValue, getMax),
    variant: variant as "free" | "used",
  };
}

/**
 * Create a pair of numeric search fields (free and used variants).
 * Convenience wrapper for creating both variants of a numeric filter.
 *
 * @param config - Base configuration for the numeric field pair
 * @returns An array of two search fields: [free, used]
 *
 * @example
 * ```ts
 * // Create GPU free and used fields
 * const [gpuFree, gpuUsed] = createNumericSearchFieldPair<Resource>({
 *   category: "gpu",
 *   label: "GPU",
 *   hintFree: "available GPUs",
 *   hintUsed: "GPU utilization",
 *   getFree: (r) => r.gpu.total - r.gpu.used,
 *   getUsed: (r) => r.gpu.used,
 *   getMax: (r) => r.gpu.total,
 * });
 * ```
 */
export function createNumericSearchFieldPair<T>(config: {
  category: string;
  label: string;
  hintFree: string;
  hintUsed: string;
  getFree: (item: T) => number;
  getUsed: (item: T) => number;
  getMax: (item: T) => number;
  validateOptions?: ValidateNumericFilterOptions;
}) {
  const { category, label, hintFree, hintUsed, getFree, getUsed, getMax, validateOptions } = config;

  return [
    createNumericSearchField<T>({
      category,
      variant: "free",
      label,
      hint: hintFree,
      getValue: getFree,
      getMax,
      validateOptions,
    }),
    createNumericSearchField<T>({
      category,
      variant: "used",
      label,
      hint: hintUsed,
      getValue: getUsed,
      getMax,
      validateOptions,
    }),
  ] as const;
}
