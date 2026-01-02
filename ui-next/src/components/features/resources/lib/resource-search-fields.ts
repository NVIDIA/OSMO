/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import type { SearchField, ChipVariant } from "@/components/ui/smart-search";
import type { Resource } from "@/lib/api/adapter";
import { BackendResourceType } from "@/lib/api/generated";
import { getResourceAllocationTypeDisplay } from "@/lib/constants/ui";

// ============================================================================
// Numeric Filter Parsing (copied from pools pattern)
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
 */
function validateNumericFilter(
  input: string,
  opts: { allowPercent?: boolean; allowDiscrete?: boolean } = {},
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
 */
function compareNumeric(
  actual: number,
  op: CompareOp,
  target: number,
  isPercent: boolean,
): boolean {
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
 * Create a match function for numeric resource filters
 */
function createNumericMatch(
  getValue: (resource: Resource) => number,
  getMax?: (resource: Resource) => number,
) {
  return (resource: Resource, value: string): boolean => {
    const parsed = parseNumericFilter(value);
    if (!parsed) return false;

    let actual = getValue(resource);
    if (parsed.isPercent && getMax) {
      const max = getMax(resource);
      actual = max > 0 ? (actual / max) * 100 : 0;
    }

    return compareNumeric(actual, parsed.operator, parsed.value, parsed.isPercent);
  };
}

// ============================================================================
// Base Search Fields
// ============================================================================

const BASE_RESOURCE_SEARCH_FIELDS: SearchField<Resource>[] = [
  {
    id: "name",
    label: "Name",
    hint: "resource name",
    prefix: "name:",
    getValues: () => [],
    freeTextOnly: true,
    match: (resource, value) => resource.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "type",
    label: "Type",
    hint: "allocation type",
    prefix: "type:",
    getValues: () => Object.values(BackendResourceType),
    validate: (value) => {
      const validTypes = Object.values(BackendResourceType).map((t) => t.toLowerCase());
      if (!validTypes.includes(value.toLowerCase())) {
        return `Must be one of: ${Object.values(BackendResourceType).join(", ")}`;
      }
      return true;
    },
    match: (resource, value) => resource.resourceType.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "platform",
    label: "Platform",
    hint: "platform name",
    prefix: "platform:",
    getValues: (resources) => [...new Set(resources.map((r) => r.platform))].sort(),
    match: (resource, value) => resource.platform.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "pool",
    label: "Pool",
    hint: "pool membership",
    prefix: "pool:",
    getValues: (resources) => [
      ...new Set(resources.flatMap((r) => r.poolMemberships.map((m) => m.pool))),
    ].sort(),
    // Case-sensitive exact match for cross-linking from pools page
    match: (resource, value) =>
      resource.poolMemberships.some((m) => m.pool === value),
  },
  {
    id: "backend",
    label: "Backend",
    hint: "backend cluster",
    prefix: "backend:",
    getValues: (resources) => [...new Set(resources.map((r) => r.backend))].sort(),
    match: (resource, value) => resource.backend.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "hostname",
    label: "Hostname",
    hint: "hostname",
    prefix: "hostname:",
    getValues: () => [],
    freeTextOnly: true,
    match: (resource, value) => resource.hostname.toLowerCase().includes(value.toLowerCase()),
  },
];

// ============================================================================
// Numeric Search Fields
// ============================================================================

const NUMERIC_RESOURCE_SEARCH_FIELDS: SearchField<Resource>[] = [
  // GPU fields
  {
    id: "gpu-free",
    label: "GPU Free",
    prefix: "gpu:free:",
    hint: "available GPUs",
    freeFormHint: "<, <=, =, >, >=, N (count) or N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v),
    match: createNumericMatch(
      (r) => r.gpu.total - r.gpu.used,
      (r) => r.gpu.total,
    ),
    variant: "free" as ChipVariant,
  },
  {
    id: "gpu-used",
    label: "GPU Used",
    prefix: "gpu:used:",
    hint: "GPU utilization",
    freeFormHint: "<, <=, =, >, >=, N (count) or N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v),
    match: createNumericMatch(
      (r) => r.gpu.used,
      (r) => r.gpu.total,
    ),
    variant: "used" as ChipVariant,
  },
  // CPU fields
  {
    id: "cpu-free",
    label: "CPU Free",
    prefix: "cpu:free:",
    hint: "available CPUs",
    freeFormHint: "<, <=, =, >, >=, N (count) or N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v),
    match: createNumericMatch(
      (r) => r.cpu.total - r.cpu.used,
      (r) => r.cpu.total,
    ),
    variant: "free" as ChipVariant,
  },
  {
    id: "cpu-used",
    label: "CPU Used",
    prefix: "cpu:used:",
    hint: "CPU utilization",
    freeFormHint: "<, <=, =, >, >=, N (count) or N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v),
    match: createNumericMatch(
      (r) => r.cpu.used,
      (r) => r.cpu.total,
    ),
    variant: "used" as ChipVariant,
  },
  // Memory fields
  {
    id: "memory-free",
    label: "Memory Free",
    prefix: "memory:free:",
    hint: "available memory",
    freeFormHint: "<, <=, =, >, >=, N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v, { allowDiscrete: false }),
    match: createNumericMatch(
      (r) => r.memory.total - r.memory.used,
      (r) => r.memory.total,
    ),
    variant: "free" as ChipVariant,
  },
  {
    id: "memory-used",
    label: "Memory Used",
    prefix: "memory:used:",
    hint: "memory utilization",
    freeFormHint: "<, <=, =, >, >=, N% (percentage)",
    getValues: () => [],
    freeTextOnly: true,
    validate: (v) => validateNumericFilter(v, { allowDiscrete: false }),
    match: createNumericMatch(
      (r) => r.memory.used,
      (r) => r.memory.total,
    ),
    variant: "used" as ChipVariant,
  },
];

// ============================================================================
// Exports
// ============================================================================

/**
 * Create resource search fields.
 */
export function createResourceSearchFields(): SearchField<Resource>[] {
  return [...BASE_RESOURCE_SEARCH_FIELDS, ...NUMERIC_RESOURCE_SEARCH_FIELDS];
}

/** Export numeric filter utilities for testing */
export { parseNumericFilter, validateNumericFilter, compareNumeric };
