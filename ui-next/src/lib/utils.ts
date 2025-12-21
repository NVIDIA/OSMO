import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a number with commas for thousands separator.
 * Example: 1234567 → "1,234,567"
 */
export function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Format a number in compact form with K/M/G suffixes.
 * Example: 1234567 → "1.2M", 24221 → "24.2K"
 */
export function formatCompact(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}G`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toString();
}
