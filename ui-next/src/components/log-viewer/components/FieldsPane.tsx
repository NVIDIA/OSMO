// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { FieldFacet, LogLevel } from "@/lib/api/log-adapter";
import { LOG_LEVEL_LABELS, LOG_SOURCE_TYPE_LABELS } from "@/lib/api/log-adapter";
import { getLevelBadgeClasses, getLevelAbbrev } from "../lib/level-utils";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/shadcn/tooltip";

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
  displayLabel: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

function FacetValueItem({ field, value, displayLabel, count, isActive, onClick }: FacetValueItemProps) {
  const isLevelField = field === "level";

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
        {/* Selection indicator (radial circles) */}
        {isActive ? (
          <span className="bg-primary size-2 shrink-0 rounded-full" />
        ) : (
          <span className="border-muted-foreground/30 size-2 shrink-0 rounded-full border" />
        )}

        {/* Level badge or text label */}
        {isLevelField ? (
          <span className={cn("w-[52px] shrink-0 text-center", getLevelBadgeClasses(value as LogLevel))}>
            {getLevelAbbrev(value as LogLevel)}
          </span>
        ) : (
          <span className="truncate">{displayLabel}</span>
        )}
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

  // Memoize display labels for all values in this group
  // This avoids recalculating labels on every render
  const displayLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const item of facet.values) {
      labels.set(item.value, getDisplayLabel(facet.field, item.value));
    }
    return labels;
  }, [facet.field, facet.values]);

  return (
    <div className="space-y-1">
      <div className="text-muted-foreground px-2 text-xs font-medium tracking-wide uppercase">{fieldLabel}</div>
      <div className="space-y-0.5">
        {facet.values.map((item) => (
          <FacetValueItem
            key={item.value}
            field={facet.field}
            value={item.value}
            displayLabel={displayLabels.get(item.value) ?? item.value}
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
  onExpand: () => void;
}

function CollapsedPane({ onExpand }: CollapsedPaneProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onExpand}
          className={cn(
            "flex h-full w-full flex-col items-center py-2",
            "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            "focus-visible:ring-ring transition-colors focus:outline-none focus-visible:ring-2",
          )}
        >
          <PanelLeftOpen className="size-4" />
          <span className="sr-only">Expand fields panel</span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
      >
        Expand fields panel
      </TooltipContent>
    </Tooltip>
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
  // Empty state
  if (facets.length === 0) {
    return (
      <div className={cn("text-muted-foreground flex items-center justify-center p-4 text-sm", className)}>
        No facets available
      </div>
    );
  }

  return (
    <div className={cn("relative h-full overflow-hidden", className)}>
      {/* Collapsed content - always rendered, opacity controlled */}
      <div
        className={cn(
          "absolute inset-0 overflow-hidden transition-opacity duration-200 ease-out",
          collapsed ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <CollapsedPane onExpand={() => onToggleCollapse?.()} />
      </div>

      {/* Expanded content - always rendered, opacity controlled */}
      <div
        className={cn(
          "flex h-full w-full flex-col overflow-hidden transition-opacity duration-200 ease-out",
          collapsed ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        {/* Header with collapse button */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Fields</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleCollapse}
                className={cn(
                  "flex size-6 items-center justify-center rounded-md",
                  "text-muted-foreground hover:bg-muted hover:text-foreground",
                  "focus-visible:ring-ring transition-colors focus:outline-none focus-visible:ring-2",
                )}
              >
                <PanelLeftClose className="size-4" />
                <span className="sr-only">Collapse fields panel</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse fields panel</TooltipContent>
          </Tooltip>
        </div>

        {/* Scrollable facets */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
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
      </div>
    </div>
  );
}

export const FieldsPane = memo(FieldsPaneInner);
