// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * PanelHeader - Base header component for panel layouts.
 *
 * Provides a consistent 2-row structure with optional expandable section:
 * - Row 1: Title area (left) + Actions area (right)
 * - Row 2: Subtitle/status content + optional expand toggle
 * - Row 3: Expandable content (when expanded)
 *
 * Use this as the base for domain-specific panel headers.
 */

"use client";

import { memo } from "react";
import { ChevronLeft, ArrowRightToLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelHeaderContainer } from "@/components/panel/panel-header-controls";

// =============================================================================
// Types
// =============================================================================

export interface PanelHeaderExpandable {
  /** Content to show when expanded */
  content: React.ReactNode;
  /** Whether the section is currently expanded */
  isExpanded: boolean;
  /** Toggle callback */
  onToggle: () => void;
  /** Custom labels (default: "show more" / "show less") */
  labels?: { expand?: string; collapse?: string };
}

export interface PanelHeaderProps {
  /** Title area content (left side of row 1) */
  title: React.ReactNode;
  /** Actions area content (right side of row 1) */
  actions?: React.ReactNode;
  /** Subtitle/status row content (row 2) */
  subtitle?: React.ReactNode;
  /** Expandable section configuration */
  expandable?: PanelHeaderExpandable;
  /** Additional className for the container */
  className?: string;
}

// =============================================================================
// PanelHeader Component
// =============================================================================

/**
 * Base header component with slot-based layout.
 *
 * @example
 * ```tsx
 * // Simple usage
 * <PanelHeader
 *   title={<h2 className="font-semibold">Item Name</h2>}
 *   actions={<PanelCloseButton onClose={onClose} />}
 *   subtitle={<StatusIndicator status={item.status} />}
 * />
 *
 * // With expandable section
 * <PanelHeader
 *   title={<h2>Item Name</h2>}
 *   actions={<PanelHeaderActions badge="Pool" ... />}
 *   subtitle={<span>Status info</span>}
 *   expandable={{
 *     content: <DetailedInfo />,
 *     isExpanded,
 *     onToggle: () => setIsExpanded(!isExpanded),
 *   }}
 * />
 * ```
 */
export const PanelHeader = memo(function PanelHeader({
  title,
  actions,
  subtitle,
  expandable,
  className,
}: PanelHeaderProps) {
  const expandLabel = expandable?.labels?.expand ?? "show more";
  const collapseLabel = expandable?.labels?.collapse ?? "show less";

  return (
    <PanelHeaderContainer className={className}>
      {/* Row 1: Title + Actions */}
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{title}</div>
        {actions && <div className="-mr-1.5 flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>

      {/* Row 2: Subtitle + expand toggle */}
      {(subtitle || expandable) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs">
          {subtitle}
          {expandable && (
            <>
              {subtitle && <span className="text-gray-400 dark:text-zinc-600">·</span>}
              <button
                onClick={expandable.onToggle}
                className="text-gray-500 transition-colors hover:text-gray-700 dark:text-zinc-500 dark:hover:text-zinc-300"
                aria-expanded={expandable.isExpanded}
                aria-controls="panel-header-expandable"
              >
                {expandable.isExpanded ? collapseLabel : expandLabel}
              </button>
            </>
          )}
        </div>
      )}

      {/* Row 3: Expandable content */}
      {expandable?.isExpanded && expandable.content && (
        <div
          id="panel-header-expandable"
          className="mt-3 space-y-3 border-t border-gray-200 pt-3 dark:border-zinc-800"
        >
          {expandable.content}
        </div>
      )}
    </PanelHeaderContainer>
  );
});

// =============================================================================
// PanelBackButton
// =============================================================================

export interface PanelBackButtonProps {
  /** Click handler */
  onClick: () => void;
  /** Breadcrumb label (e.g., "Group Name") */
  label: string;
  /** Aria label override */
  "aria-label"?: string;
}

/**
 * Back button with breadcrumb label for hierarchical navigation.
 *
 * @example
 * ```tsx
 * <PanelBackButton
 *   onClick={handleBack}
 *   label="my-group"
 * />
 * // Renders: [<] my-group
 * ```
 */
export const PanelBackButton = memo(function PanelBackButton({
  onClick,
  label,
  "aria-label": ariaLabel,
}: PanelBackButtonProps) {
  return (
    <>
      <button
        onClick={onClick}
        className="-ml-1 flex shrink-0 items-center gap-1 rounded-md py-1 pr-2 pl-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-label={ariaLabel ?? `Back to ${label}`}
      >
        <ChevronLeft
          className="size-4"
          aria-hidden="true"
        />
        <span className="text-sm">{label}</span>
      </button>
      <span className="shrink-0 text-gray-400 dark:text-zinc-600">/</span>
    </>
  );
});

// =============================================================================
// PanelCollapseButton
// =============================================================================

export interface PanelCollapseButtonProps {
  /** Click handler */
  onCollapse: () => void;
  /** Aria label (default: "Collapse panel") */
  "aria-label"?: string;
}

/**
 * Collapse button for panels that support collapsing to an edge strip.
 * Uses ArrowRightToLine icon (vs X for close).
 */
export const PanelCollapseButton = memo(function PanelCollapseButton({
  onCollapse,
  "aria-label": ariaLabel = "Collapse panel",
}: PanelCollapseButtonProps) {
  return (
    <button
      onClick={onCollapse}
      className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
      aria-label={ariaLabel}
    >
      <ArrowRightToLine className="size-4" />
    </button>
  );
});

// =============================================================================
// PanelBadge
// =============================================================================

export type PanelBadgeVariant = "neutral" | "amber";

export interface PanelBadgeProps {
  /** Badge label text */
  label: string;
  /** Color variant */
  variant?: PanelBadgeVariant;
  /** Tooltip title */
  title?: string;
  /** Additional className */
  className?: string;
}

const BADGE_VARIANTS: Record<PanelBadgeVariant, string> = {
  neutral: "bg-transparent text-gray-500 ring-gray-300 dark:text-zinc-400 dark:ring-zinc-600",
  amber:
    "bg-amber-100 text-amber-700 ring-amber-600/20 dark:bg-amber-500/20 dark:text-amber-400 dark:ring-amber-500/30",
};

/**
 * Badge component for panel headers.
 * Used for type labels (Pool, Resource, Task) or special indicators (Lead).
 *
 * @example
 * ```tsx
 * <PanelBadge label="Task" />
 * <PanelBadge label="Lead" variant="amber" title="Leader task" />
 * ```
 */
export const PanelBadge = memo(function PanelBadge({ label, variant = "neutral", title, className }: PanelBadgeProps) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tracking-wide uppercase ring-1 ring-inset",
        BADGE_VARIANTS[variant],
        className,
      )}
      title={title}
    >
      {label}
    </span>
  );
});

// =============================================================================
// PanelTitle
// =============================================================================

export interface PanelTitleProps {
  /** Title text */
  children: React.ReactNode;
  /** Additional className */
  className?: string;
}

/**
 * Standard title styling for panel headers.
 */
export const PanelTitle = memo(function PanelTitle({ children, className }: PanelTitleProps) {
  return <h2 className={cn("truncate font-semibold text-gray-900 dark:text-zinc-100", className)}>{children}</h2>;
});

// =============================================================================
// PanelSubtitle
// =============================================================================

export interface PanelSubtitleProps {
  /** Subtitle text */
  children: React.ReactNode;
  /** Show separator before subtitle */
  separator?: boolean;
  /** Additional className */
  className?: string;
}

/**
 * Subtitle text that appears after the title with optional separator.
 */
export const PanelSubtitle = memo(function PanelSubtitle({
  children,
  separator = true,
  className,
}: PanelSubtitleProps) {
  return (
    <>
      {separator && <span className="shrink-0 text-gray-400 dark:text-zinc-600">·</span>}
      <span className={cn("shrink-0 text-sm text-gray-500 dark:text-zinc-400", className)}>{children}</span>
    </>
  );
});
