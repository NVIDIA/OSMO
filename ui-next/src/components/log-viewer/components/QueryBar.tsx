// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo, useMemo } from "react";
import { FilterBar, type SearchField, type SearchChip, type SearchPreset } from "@/components/filter-bar";
import type { LogEntry } from "@/lib/api/log-adapter";
import { LOG_LEVELS, LOG_LEVEL_LABELS, LOG_SOURCE_TYPES, LOG_SOURCE_TYPE_LABELS } from "@/lib/api/log-adapter";
import { getLevelDotClasses } from "../lib/level-utils";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface QueryBarProps {
  /** Log entries for autocomplete suggestions */
  entries: LogEntry[];
  /** Current filter chips */
  chips: SearchChip[];
  /** Callback when chips change */
  onChipsChange: (chips: SearchChip[]) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Results count to display */
  resultsCount?: { total: number; filtered?: number };
  /** Additional CSS classes */
  className?: string;
  /** Whether to show task filter (hidden at task scope) */
  showTaskFilter?: boolean;
}

// =============================================================================
// Field Definitions
// =============================================================================

/**
 * Create log-specific search fields.
 * Uses LogEntry data for autocomplete suggestions.
 *
 * Exported for reuse in LogViewer filtering via `filterByChips`.
 *
 * @param showTaskFilter - Whether to include the task filter (hidden at task scope)
 * @returns Array of SearchField definitions for log entries
 */
export function createLogFields(showTaskFilter: boolean): SearchField<LogEntry>[] {
  const fields: SearchField<LogEntry>[] = [
    {
      id: "level",
      label: "Level",
      prefix: "level:",
      getValues: () => [...LOG_LEVELS],
      exhaustive: true, // Complete list, no "Seen in your data" hint
      match: (entry, value) => entry.labels.level === value,
      hint: "Filter by severity",
    },
    {
      id: "source",
      label: "Source",
      prefix: "source:",
      getValues: () => [...LOG_SOURCE_TYPES],
      exhaustive: true,
      match: (entry, value) => entry.labels.source === value,
      hint: "User or OSMO logs",
    },
    {
      id: "text",
      label: "Contains",
      prefix: "text:",
      getValues: () => [], // Free text, no autocomplete
      freeFormHint: "Search in log message",
      match: (entry, value) => entry.message.toLowerCase().includes(value.toLowerCase()),
    },
  ];

  // Task filter only shown at workflow/group scope
  if (showTaskFilter) {
    fields.splice(1, 0, {
      id: "task",
      label: "Task",
      prefix: "task:",
      getValues: (entries) => {
        const tasks = new Set<string>();
        for (const entry of entries) {
          if (entry.labels.task) {
            tasks.add(entry.labels.task);
          }
        }
        return [...tasks].sort();
      },
      match: (entry, value) => entry.labels.task === value,
      hint: "Filter by task name",
    });
  }

  return fields;
}

// =============================================================================
// Preset Render Functions (Hoisted to Module Level for Performance)
// =============================================================================

// Pre-computed render functions for each log level
// Hoisting these avoids creating new function references on each render
const LEVEL_PRESET_RENDERERS = new Map(
  LOG_LEVELS.map((level) => [
    level,
    ({ active }: { active: boolean }) => (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium transition-colors",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
        )}
      >
        <span className={cn("size-2 rounded-full", getLevelDotClasses(level))} />
        {LOG_LEVEL_LABELS[level]}
      </span>
    ),
  ]),
);

// Pre-computed render functions for each source type
const SOURCE_PRESET_RENDERERS = new Map(
  LOG_SOURCE_TYPES.map((source) => [
    source,
    ({ active }: { active: boolean }) => (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium transition-colors",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
        )}
      >
        {LOG_SOURCE_TYPE_LABELS[source]}
      </span>
    ),
  ]),
);

// =============================================================================
// Component
// =============================================================================

function QueryBarInner({
  entries,
  chips,
  onChipsChange,
  placeholder = "Filter logs... (try 'level:', 'task:', or 'text:')",
  resultsCount,
  className,
  showTaskFilter = true,
}: QueryBarProps) {
  // Memoize fields to prevent recreation on every render
  const fields = useMemo(() => createLogFields(showTaskFilter), [showTaskFilter]);

  // Memoize presets - uses hoisted render functions from module level
  const presets = useMemo(() => {
    const levelPresets: SearchPreset[] = LOG_LEVELS.map((level) => ({
      id: `level-${level}`,
      chip: {
        field: "level",
        value: level,
        label: `Level: ${LOG_LEVEL_LABELS[level]}`,
      },
      // Use pre-computed render function from module level
      render: LEVEL_PRESET_RENDERERS.get(level)!,
    }));

    const sourcePresets: SearchPreset[] = LOG_SOURCE_TYPES.map((source) => ({
      id: `source-${source}`,
      chip: {
        field: "source",
        value: source,
        label: `Source: ${LOG_SOURCE_TYPE_LABELS[source]}`,
      },
      // Use pre-computed render function from module level
      render: SOURCE_PRESET_RENDERERS.get(source)!,
    }));

    return [
      { label: "Levels", items: levelPresets },
      { label: "Source", items: sourcePresets },
    ];
  }, []);

  return (
    <FilterBar
      data={entries}
      fields={fields}
      chips={chips}
      onChipsChange={onChipsChange}
      placeholder={placeholder}
      presets={presets}
      resultsCount={resultsCount}
      className={className}
    />
  );
}

export const QueryBar = memo(QueryBarInner);
