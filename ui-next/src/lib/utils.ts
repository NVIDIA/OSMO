import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number with commas for thousands separator.
 * Example: 1234567 → "1,234,567"
 */
export function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Format a number in compact form with K/M/G suffixes and comma separators.
 * Example: 1234567 → "1.2M", 24221 → "24.2K", 1500000 → "1,500K"
 */
export function formatCompact(value: number): string {
  if (value >= 1_000_000_000) {
    const n = value / 1_000_000_000;
    return n >= 10 ? `${Math.round(n).toLocaleString("en-US")}G` : `${n.toFixed(1)}G`;
  }
  if (value >= 1_000_000) {
    const n = value / 1_000_000;
    return n >= 10 ? `${Math.round(n).toLocaleString("en-US")}M` : `${n.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const n = value / 1_000;
    return n >= 10 ? `${Math.round(n).toLocaleString("en-US")}K` : `${n.toFixed(1)}K`;
  }
  return value.toString();
}

/** Binary unit hierarchy for memory/storage (index = granularity, lower = more granular) */
type ByteUnit = "Ki" | "Mi" | "Gi" | "Ti";
const UNIT_ORDER: ByteUnit[] = ["Ki", "Mi", "Gi", "Ti"];

interface FormattedBytes {
  value: string;
  unit: ByteUnit;
  display: string;
  /** Raw value in GiB for calculations */
  rawGib: number;
}

/**
 * Format a number with 1 decimal place, removing trailing .0, with comma separators.
 * Examples:
 *   1234.5 → "1,234.5"
 *   1234.0 → "1,234"
 *   5.5 → "5.5"
 */
function formatDecimal(n: number): string {
  if (n >= 10) {
    return Math.round(n).toLocaleString("en-US");
  }
  const fixed = n.toFixed(1);
  // Remove trailing .0, no comma needed for small numbers
  return fixed.replace(/\.0$/, "");
}

/**
 * Format memory/storage with appropriate binary unit (Ki, Mi, Gi, Ti).
 * Input is in GiB, output uses the most readable unit.
 *
 * Examples:
 *   0.5 GiB → "512 Mi"
 *   64 GiB → "64 Gi"
 *   2048 GiB → "2 Ti"
 */
export function formatBytes(gib: number): FormattedBytes {
  if (gib === 0) {
    return { value: "0", unit: "Gi", display: "0 Gi", rawGib: 0 };
  }

  // Convert to Ti if >= 1024 Gi
  if (gib >= 1024) {
    const ti = gib / 1024;
    const formatted = formatDecimal(ti);
    return { value: formatted, unit: "Ti", display: `${formatted} Ti`, rawGib: gib };
  }

  // Use Gi if >= 1 Gi
  if (gib >= 1) {
    const formatted = formatDecimal(gib);
    return { value: formatted, unit: "Gi", display: `${formatted} Gi`, rawGib: gib };
  }

  // Convert to Mi if >= 1 Mi (1/1024 Gi)
  const mi = gib * 1024;
  if (mi >= 1) {
    const formatted = formatDecimal(mi);
    return { value: formatted, unit: "Mi", display: `${formatted} Mi`, rawGib: gib };
  }

  // Use Ki for very small values
  const ki = mi * 1024;
  const formatted = formatDecimal(ki);
  return { value: formatted, unit: "Ki", display: `${formatted} Ki`, rawGib: gib };
}

/**
 * Convert GiB to a specific unit.
 */
function gibToUnit(gib: number, unit: ByteUnit): number {
  switch (unit) {
    case "Ti":
      return gib / 1024;
    case "Gi":
      return gib;
    case "Mi":
      return gib * 1024;
    case "Ki":
      return gib * 1024 * 1024;
  }
}

/**
 * Format a used/total pair with consistent units.
 * Uses the more granular unit so both values make sense.
 * Zero is treated as unitless - it adopts the other value's unit.
 *
 * Example: 5 Gi used, 2048 Gi total → "5/2048 Gi" (not "5 Gi/2 Ti")
 * Example: 0 used, 2048 Gi total → "0/2 Ti" (zero adopts total's unit)
 */
export function formatBytesPair(
  usedGib: number,
  totalGib: number,
): { used: string; total: string; unit: ByteUnit; freeDisplay: string } {
  // Handle zero cases - zero is unitless, so use the other value's unit
  if (usedGib === 0) {
    const totalFormatted = formatBytes(totalGib);
    return {
      used: "0",
      total: totalFormatted.value,
      unit: totalFormatted.unit,
      freeDisplay: totalFormatted.display,
    };
  }

  if (totalGib === 0) {
    const usedFormatted = formatBytes(usedGib);
    return {
      used: usedFormatted.value,
      total: "0",
      unit: usedFormatted.unit,
      freeDisplay: `0 ${usedFormatted.unit}`,
    };
  }

  const usedFormatted = formatBytes(usedGib);
  const totalFormatted = formatBytes(totalGib);

  // Use the more granular (smaller index) unit
  const usedIdx = UNIT_ORDER.indexOf(usedFormatted.unit);
  const totalIdx = UNIT_ORDER.indexOf(totalFormatted.unit);
  const unit = usedIdx <= totalIdx ? usedFormatted.unit : totalFormatted.unit;

  // Convert both to the chosen unit
  const usedInUnit = gibToUnit(usedGib, unit);
  const totalInUnit = gibToUnit(totalGib, unit);
  const freeInUnit = totalInUnit - usedInUnit;

  return {
    used: formatDecimal(usedInUnit),
    total: formatDecimal(totalInUnit),
    unit,
    freeDisplay: `${formatDecimal(freeInUnit)} ${unit}`,
  };
}
