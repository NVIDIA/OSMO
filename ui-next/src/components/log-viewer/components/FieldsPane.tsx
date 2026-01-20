// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { FieldFacet, LogLevel } from "@/lib/api/log-adapter";
import { LOG_LEVEL_LABELS, LOG_SOURCE_TYPE_LABELS } from "@/lib/api/log-adapter";
import { getLevelDotClasses } from "../lib/level-utils";
import { Button } from "@/components/shadcn/button";

// =============================================================================
// Types
// =============================================================================

export interface FieldsPaneProps {
  /** Facets to display */
  facets: FieldFacet[];
  /** Currently active filters (field -> values) */
  activeFilters: Map<string, Set<string>>;
  /** Callback when a facet value is clicked */
  onFacetClick: (field: string, value: string) => void;
  /** Additional CSS classes */
  className?: string;
  /** Whether the pane is collapsed */
  collapsed?: boolean;
  /** Callback when collapse/expand is toggled */
  onToggleCollapse?: () => void;
}

// =============================================================================
// Facet Value Item
// =============================================================================

interface FacetValueItemProps {
  field: string;
  value: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

function FacetValueItem({ field, value, count, isActive, onClick }: FacetValueItemProps) {
  // Get display label for known fields
  const displayLabel = getDisplayLabel(field, value);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm transition-colors",
        "hover:bg-muted/50 focus-visible:ring-ring focus:outline-none focus-visible:ring-2",
        isActive && "bg-primary/10 text-primary",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {/* Level indicator dot */}
        {field === "level" && (
          <span className={cn("size-2 shrink-0 rounded-full", getLevelDotClasses(value as LogLevel))} />
        )}

        {/* Active indicator */}
        {isActive ? (
          <span className="bg-primary size-2 shrink-0 rounded-full" />
        ) : (
          field !== "level" && <span className="border-muted-foreground/30 size-2 shrink-0 rounded-full border" />
        )}

        <span className="truncate">{displayLabel}</span>
      </span>
      <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">{count.toLocaleString()}</span>
    </button>
  );
}

/**
 * Get display label for a facet value.
 * Uses LOG_LEVEL_LABELS and LOG_SOURCE_TYPE_LABELS for known fields.
 */
function getDisplayLabel(field: string, value: string): string {
  if (field === "level" && value in LOG_LEVEL_LABELS) {
    return LOG_LEVEL_LABELS[value as LogLevel];
  }
  if (field === "source" && value in LOG_SOURCE_TYPE_LABELS) {
    return LOG_SOURCE_TYPE_LABELS[value as keyof typeof LOG_SOURCE_TYPE_LABELS];
  }
  return value;
}

// =============================================================================
// Facet Group
// =============================================================================

interface FacetGroupProps {
  facet: FieldFacet;
  activeValues: Set<string>;
  onFacetClick: (value: string) => void;
}

function FacetGroup({ facet, activeValues, onFacetClick }: FacetGroupProps) {
  // Get display label for field
  const fieldLabel = getFieldLabel(facet.field);

  return (
    <div className="space-y-1">
      <div className="text-muted-foreground px-2 text-xs font-medium tracking-wide uppercase">{fieldLabel}</div>
      <div className="space-y-0.5">
        {facet.values.map((item) => (
          <FacetValueItem
            key={item.value}
            field={facet.field}
            value={item.value}
            count={item.count}
            isActive={activeValues.has(item.value)}
            onClick={() => onFacetClick(item.value)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Get display label for a field name.
 */
function getFieldLabel(field: string): string {
  switch (field) {
    case "level":
      return "Level";
    case "task":
      return "Task";
    case "source":
      return "Source";
    case "retry":
      return "Retry";
    default:
      return field;
  }
}

// =============================================================================
// Collapsed State
// =============================================================================

interface CollapsedPaneProps {
  facets: FieldFacet[];
  onExpand: () => void;
}

function CollapsedPane({ facets, onExpand }: CollapsedPaneProps) {
  // Count total entries and check for errors
  const totalEntries =
    facets.reduce((sum, f) => sum + f.values.reduce((s, v) => s + v.count, 0), 0) / facets.length || 0;

  const hasErrors = facets.some(
    (f) => f.field === "level" && f.values.some((v) => (v.value === "error" || v.value === "fatal") && v.count > 0),
  );

  return (
    <Button
      variant="ghost"
      size="sm"
      className="flex h-full w-8 flex-col items-center justify-center gap-2 rounded-none border-r"
      onClick={onExpand}
    >
      <span className="rotate-180 font-mono text-xs tabular-nums [writing-mode:vertical-lr]">
        {Math.round(totalEntries).toLocaleString()}
      </span>
      {hasErrors && <span className="size-2 rounded-full bg-red-500" />}
    </Button>
  );
}

// =============================================================================
// Main Component
// =============================================================================

function FieldsPaneInner({
  facets,
  activeFilters,
  onFacetClick,
  className,
  collapsed = false,
  onToggleCollapse,
}: FieldsPaneProps) {
  // Collapsed state
  if (collapsed) {
    return (
      <CollapsedPane
        facets={facets}
        onExpand={() => onToggleCollapse?.()}
      />
    );
  }

  // Empty state
  if (facets.length === 0) {
    return (
      <div className={cn("text-muted-foreground flex items-center justify-center p-4 text-sm", className)}>
        No facets available
      </div>
    );
  }

  return (
    <div className={cn("h-full overflow-y-auto overscroll-contain", className)}>
      <div className="space-y-4 p-3">
        {facets.map((facet) => (
          <FacetGroup
            key={facet.field}
            facet={facet}
            activeValues={activeFilters.get(facet.field) ?? new Set()}
            onFacetClick={(value) => onFacetClick(facet.field, value)}
          />
        ))}
      </div>
    </div>
  );
}

export const FieldsPane = memo(FieldsPaneInner);
