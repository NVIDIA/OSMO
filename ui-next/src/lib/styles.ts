/**
 * Reusable Tailwind CSS patterns
 *
 * This module provides consistent style patterns across components.
 * Use these with cn() for conditional styling.
 *
 * Following Tailwind's philosophy, we use string constants rather than
 * @apply so that classes remain visible and composable.
 */

// =============================================================================
// Layout Patterns
// =============================================================================

/** Standard card container with border */
export const card = {
  base: "rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
  hover: "transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900",
} as const;

// =============================================================================
// Typography Patterns
// =============================================================================

/** Section heading style (uppercase label) */
export const heading = {
  section: "text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400",
  /** Section heading with count */
  sectionWithMeta: "text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400",
  meta: "text-xs text-zinc-400 dark:text-zinc-500 font-normal",
} as const;

/** Muted helper text */
export const text = {
  muted: "text-sm text-zinc-500 dark:text-zinc-400",
  mutedSmall: "text-xs text-zinc-500 dark:text-zinc-400",
  hint: "text-xs text-zinc-400 dark:text-zinc-500",
} as const;

// =============================================================================
// State Patterns
// =============================================================================

/** Loading skeleton animation */
export const skeleton = {
  base: "animate-pulse rounded bg-zinc-200 dark:bg-zinc-800",
  /** Different sizes */
  sm: "h-3",
  md: "h-4",
  lg: "h-5",
} as const;

// =============================================================================
// Progress/Status Patterns
// =============================================================================

/** Progress bar track */
export const progressTrack = "overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800";

/** Progress bar fill colors based on percentage thresholds */
export function getProgressColor(percent: number): string {
  if (percent > 90) return "bg-red-500";
  if (percent > 70) return "bg-amber-500";
  return "bg-emerald-500";
}

// =============================================================================
// Brand Colors
// =============================================================================

/** NVIDIA green chip - selected state */
export const chip = {
  selected:
    "border-[var(--nvidia-green)] bg-[var(--nvidia-green)]/10 text-[var(--nvidia-green)] dark:bg-[var(--nvidia-green)]/20 dark:text-[var(--nvidia-green-light)]",
  selectedHover: "hover:bg-[var(--nvidia-green)]/20 dark:hover:bg-[var(--nvidia-green)]/30",
  unselected: "border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500",
  unselectedHover: "hover:border-zinc-300 hover:text-zinc-500 dark:hover:border-zinc-700 dark:hover:text-zinc-400",
  /** Dashed "action" chip (e.g., show more) */
  action:
    "border-dashed border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300",
} as const;
