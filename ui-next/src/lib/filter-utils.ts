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

export type CompareOp = ">=" | ">" | "<=" | "<" | "=";

export interface ParsedNumericFilter {
  operator: CompareOp;
  value: number;
  isPercent: boolean;
}

export interface ValidateNumericFilterOptions {
  allowPercent?: boolean;
  allowDiscrete?: boolean;
}

const VALID_OPERATORS: CompareOp[] = [">=", "<=", ">", "<", "="];

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

export interface NumericSearchFieldInput<T> {
  category: string;
  variant: "free" | "used";
  label: string;
  hint: string;
  getValue: (item: T) => number;
  getMax: (item: T) => number;
  validateOptions?: ValidateNumericFilterOptions;
}

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
