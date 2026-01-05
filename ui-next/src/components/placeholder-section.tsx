/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Placeholder Section Component
 *
 * A "coming soon" placeholder for features that are planned but not yet implemented.
 * Uses dashed border and reduced opacity to indicate it's not yet functional.
 */

import { cn } from "@/lib/utils";
import { heading, text } from "@/lib/styles";

// =============================================================================
// Types
// =============================================================================

export interface PlaceholderSectionProps {
  /** Section title */
  title: string;
  /** Description of what will appear here */
  description: string;
  /** Optional note about when it's coming */
  note?: string;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * PlaceholderSection - "Coming soon" placeholder for future features.
 *
 * @example
 * ```tsx
 * <PlaceholderSection
 *   title="Active Resources"
 *   description="Jobs and resources running on this pool will appear here"
 *   note="Coming soon: Cross-reference with Resources page"
 * />
 * ```
 */
export function PlaceholderSection({
  title,
  description,
  note,
  className,
}: PlaceholderSectionProps) {
  return (
    <section className={cn("opacity-50", className)}>
      <h3 className={cn(heading.section, "mb-2")}>{title}</h3>
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
        <p className={cn(text.muted, "text-center")}>{description}</p>
        {note && <p className={cn(text.hint, "mt-1 text-center")}>{note}</p>}
      </div>
    </section>
  );
}
