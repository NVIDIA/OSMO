/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import type { SearchField, ChipVariant } from "@/components/ui/smart-search";
import type { Pool } from "@/lib/api/adapter";

// ============================================================================
// Numeric Filter Parsing
// ============================================================================

type CompareOp = ">=" | ">" | "<=" | "<" | "=";

interface ParsedNumericFilter {
  operator: CompareOp;
  value: number;
  isPercent: boolean;
}

const VALID_OPERATORS: CompareOp[] = [">=", "<=", ">", "<", "="];

/**
 * Parse a numeric filter string like ">=10" or ">=90%"
 */
function parseNumericFilter(input: string): ParsedNumericFilter | null {
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
 * Validate a numeric filter string
 * @param opts.allowPercent - If true, accepts percentage values (default: true)
 * @param opts.allowDiscrete - If true, accepts discrete values (default: true)
 */
function validateNumericFilter(
  input: string,
  opts: { allowPercent?: boolean; allowDiscrete?: boolean } = {}
): true | string {
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
 * Compare a numeric value against a parsed filter
 * For percentages, rounds to nearest integer before comparing
 */
function compareNumeric(
  actual: number,
  op: CompareOp,
  target: number,
  isPercent: boolean
): boolean {
  // Round percentages to nearest integer for comparison
  const value = isPercent ? Math.round(actual) : actual;

  switch (op) {
    case ">=": return value >= target;
    case ">":  return value > target;
    case "<=": return value <= target;
    case "<":  return value < target;
    case "=":  return value === target;
  }
}

/**
 * Create a match function for numeric filters
 */
function createNumericMatch(
  getValue: (pool: Pool) => number,
  getMax?: (pool: Pool) => number
) {
  return (pool: Pool, value: string): boolean => {
    const parsed = parseNumericFilter(value);
    if (!parsed) return false;

    let actual = getValue(pool);
    if (parsed.isPercent && getMax) {
      const max = getMax(pool);
      actual = max > 0 ? (actual / max) * 100 : 0;
    }

    return compareNumeric(actual, parsed.operator, parsed.value, parsed.isPercent);
  };
}

// ============================================================================
// Base Search Fields
// ============================================================================

/** Base search fields that don't require additional context */
const BASE_POOL_SEARCH_FIELDS: SearchField<Pool>[] = [
  {
    id: "pool",
    label: "Pool",
    hint: "pool name",
    prefix: "pool:",
    getValues: (pools) => pools.map((p) => p.name).slice(0, 20),
    match: (pool, value) => pool.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "platform",
    label: "Platform",
    hint: "platform name",
    prefix: "platform:",
    getValues: (pools) => [...new Set(pools.flatMap((p) => p.platforms))].sort(),
    match: (pool, value) => pool.platforms.some((p) => p.toLowerCase().includes(value.toLowerCase())),
  },
  {
    id: "backend",
    label: "Backend",
    hint: "backend name",
    prefix: "backend:",
    getValues: (pools) => [...new Set(pools.map((p) => p.backend))].sort(),
    match: (pool, value) => pool.backend.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "description",
    label: "Description",
    hint: "description text",
    prefix: "description:",
    // Description field: no autocomplete values, only free-text substring search
    getValues: () => [],
    match: (pool, value) => pool.description.toLowerCase().includes(value.toLowerCase()),
    // Mark as free-text only - no dropdown suggestions
    freeTextOnly: true,
  },
];

// ============================================================================
// Numeric Search Fields (Quota & Capacity)
// ============================================================================

/** Explicit quota/capacity fields with variant styling */
const NUMERIC_POOL_SEARCH_FIELDS: SearchField<Pool>[] = [
  // === Quota Fields ===
  {
    id: "quota-free",
    label: "Quota Free",
    prefix: "quota:free:",
    hint: "available guaranteed GPUs",
    freeFormHint: "<, <=, =, >, >=, N (count) or N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v),  // Accepts both
    match: createNumericMatch(
      (p) => p.quota.free,
      (p) => p.quota.limit
    ),
    variant: "free" as ChipVariant,
  },
  {
    id: "quota-used",
    label: "Quota Used",
    prefix: "quota:used:",
    hint: "quota consumption",
    freeFormHint: "<, <=, =, >, >=, N (count) or N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v),  // Accepts both
    match: createNumericMatch(
      (p) => p.quota.used,
      (p) => p.quota.limit
    ),
    variant: "used" as ChipVariant,
  },

  // === Capacity Fields ===
  {
    id: "capacity-free",
    label: "Capacity Free",
    prefix: "capacity:free:",
    hint: "total GPUs available",
    freeFormHint: "<, <=, =, >, >=, N (count) or N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v),  // Accepts both
    match: createNumericMatch(
      (p) => p.quota.totalFree,
      (p) => p.quota.totalCapacity
    ),
    variant: "free" as ChipVariant,
  },
  {
    id: "capacity-used",
    label: "Capacity Used",
    prefix: "capacity:used:",
    hint: "pool consumption",
    freeFormHint: "<, <=, =, >, >=, >=, N (count) or N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v),  // Accepts both
    match: createNumericMatch(
      (p) => p.quota.totalUsage,
      (p) => p.quota.totalCapacity
    ),
    variant: "used" as ChipVariant,
  },
];

// ============================================================================
// Shorthand Fields (Resolve Based on Display Mode)
// ============================================================================

/**
 * Shorthand quota/capacity fields that resolve based on display mode.
 * These accept values directly and resolve to the explicit field.
 */
const SHORTHAND_POOL_SEARCH_FIELDS: SearchField<Pool>[] = [
  {
    id: "quota",
    label: "Quota",
    prefix: "quota:",
    hint: "guaranteed GPUs (based on display mode - free or used)",
    freeFormHint: "<, <=, =, >, >=, >=, N (count) or N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v),  // Accepts both
    match: (pool, value) => {
      // Fallback behavior - defaults to "free"
      const parsed = parseNumericFilter(value);
      if (!parsed) return false;
      const actual = parsed.isPercent
        ? (pool.quota.limit > 0 ? (pool.quota.free / pool.quota.limit) * 100 : 0)
        : pool.quota.free;
      return compareNumeric(actual, parsed.operator, parsed.value, parsed.isPercent);
    },
    resolveTo: ({ displayMode }) => displayMode === "used" ? "quota-used" : "quota-free",
  },
  {
    id: "capacity",
    label: "Capacity",
    prefix: "capacity:",
    hint: "pool GPUs (based on display mode - free or used)",
    freeFormHint: "<, <=, =, >, >=, >=, N (count) or N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v),
    match: (pool, value) => {
      // Fallback behavior - defaults to "free"
      const parsed = parseNumericFilter(value);
      if (!parsed) return false;
      const actual = parsed.isPercent
        ? (pool.quota.totalCapacity > 0 ? (pool.quota.totalFree / pool.quota.totalCapacity) * 100 : 0)
        : pool.quota.totalFree;
      return compareNumeric(actual, parsed.operator, parsed.value, parsed.isPercent);
    },
    resolveTo: ({ displayMode }) => displayMode === "used" ? "capacity-used" : "capacity-free",
  },
];

// ============================================================================
// Exports
// ============================================================================

/**
 * Create pool search fields with the shared filter.
 * The shared filter requires sharingGroups context to work.
 */
export function createPoolSearchFields(sharingGroups: string[][]): SearchField<Pool>[] {
  // Build a map of pool name -> sharing group for fast lookup
  const poolToGroup = new Map<string, string[]>();
  for (const group of sharingGroups) {
    if (group.length > 1) {
      for (const poolName of group) {
        poolToGroup.set(poolName, group);
      }
    }
  }

  // Get all shared pool names (pools that are part of a sharing group)
  const sharedPoolNames = [...poolToGroup.keys()].sort();

  const sharedField: SearchField<Pool> = {
    id: "shared",
    label: "Shared",
    hint: "all pools sharing capacity",
    prefix: "shared:",
    // Only show pools that are actually shared
    getValues: () => sharedPoolNames,
    // Match if pool is in the same sharing group as the filter value
    match: (pool, value) => {
      const group = poolToGroup.get(value);
      if (!group) return false;
      return group.includes(pool.name);
    },
    // Requires valid value - no free text allowed
    requiresValidValue: true,
  };

  return [
    ...BASE_POOL_SEARCH_FIELDS,
    ...SHORTHAND_POOL_SEARCH_FIELDS,
    ...NUMERIC_POOL_SEARCH_FIELDS,
    sharedField,
  ];
}

/** Default search fields without sharing context (for backwards compatibility) */
export const POOL_SEARCH_FIELDS: SearchField<Pool>[] = [
  ...BASE_POOL_SEARCH_FIELDS,
  ...SHORTHAND_POOL_SEARCH_FIELDS,
  ...NUMERIC_POOL_SEARCH_FIELDS,
];

/** Export numeric filter utilities for testing */
export { parseNumericFilter, validateNumericFilter, compareNumeric };
