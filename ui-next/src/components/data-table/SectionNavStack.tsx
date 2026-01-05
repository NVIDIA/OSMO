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
 * Section Navigation Stack
 *
 * Generic component for displaying navigation buttons for sections
 * that have scrolled past the viewport. Enables quick jumping to
 * any section in a sectioned table.
 *
 * This is a generic utility - domain-specific styling should be
 * applied via className props and CSS.
 */

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

/**
 * Section info for the navigation stack.
 * Extends SectionNavItem with optional metadata for custom styling.
 */
export interface SectionNavStackItem<TMeta = unknown> {
  /** Unique section identifier */
  id: string;
  /** Display label for the section */
  label: string;
  /** Number of items in this section */
  itemCount: number;
  /** Optional metadata for custom styling/rendering */
  meta?: TMeta;
}

export interface SectionNavStackProps<TMeta = unknown> {
  /** All sections (needed to look up section by index) */
  sections: SectionNavStackItem<TMeta>[];
  /** Indices of hidden sections to show in stack */
  hiddenSectionIndices: number[];
  /** Callback when a section is clicked */
  onNavigate: (sectionIndex: number) => void;
  /** Custom render function for each section item */
  renderItem?: (
    section: SectionNavStackItem<TMeta>,
    sectionIndex: number,
  ) => React.ReactNode;
  /** Container className */
  className?: string;
  /** Item className or function for dynamic styling based on section */
  itemClassName?: string | ((section: SectionNavStackItem<TMeta>) => string);
  /** Height of each item in pixels (for positioning) */
  itemHeight?: number;
}

// =============================================================================
// Component
// =============================================================================

function SectionNavStackInner<TMeta = unknown>({
  sections,
  hiddenSectionIndices,
  onNavigate,
  renderItem,
  className,
  itemClassName,
  itemHeight = 36,
}: SectionNavStackProps<TMeta>) {
  if (hiddenSectionIndices.length === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-0 left-0 right-0 z-20",
        className,
      )}
      aria-label="Section navigation"
    >
      {hiddenSectionIndices.map((sectionIndex, stackIndex) => {
        const section = sections[sectionIndex];
        if (!section) return null;

        const resolvedItemClassName =
          typeof itemClassName === "function"
            ? itemClassName(section)
            : itemClassName;

        // Calculate position from bottom
        const bottomOffset = (hiddenSectionIndices.length - 1 - stackIndex) * itemHeight;

        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onNavigate(sectionIndex)}
            className={cn(
              "pointer-events-auto absolute left-0 right-0",
              "flex w-full items-center gap-2 px-3",
              "text-left text-xs font-semibold uppercase tracking-wider",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset",
              "transition-colors duration-75",
              resolvedItemClassName,
            )}
            style={{
              height: itemHeight,
              bottom: bottomOffset,
            }}
            aria-label={`Jump to ${section.label} section`}
          >
            {renderItem ? (
              renderItem(section, sectionIndex)
            ) : (
              <>
                <span className="section-nav-label">{section.label}</span>
                <span className="section-nav-count text-zinc-500 dark:text-zinc-400">
                  {section.itemCount}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Memo with generic support
export const SectionNavStack = memo(SectionNavStackInner) as typeof SectionNavStackInner;
