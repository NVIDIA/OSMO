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
import type { LogEntry, LogLevel, LogIOType } from "@/lib/api/log-adapter";
import { LOG_LEVELS, LOG_IO_TYPES, LOG_LEVEL_LABELS, LOG_IO_TYPE_LABELS } from "@/lib/api/log-adapter";
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
 */
function createLogFields(showTaskFilter: boolean): SearchField<LogEntry>[] {
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
      id: "io_type",
      label: "Source",
      prefix: "source:",
      getValues: () => [...LOG_IO_TYPES],
      exhaustive: true,
      match: (entry, value) => entry.labels.io_type === value,
      hint: "stdout, stderr, etc.",
    },
    {
      id: "text",
      label: "Contains",
      prefix: "text:",
      getValues: () => [], // Free text, no autocomplete
      freeFormHint: "Search in log message",
      match: (entry, value) => entry.line.toLowerCase().includes(value.toLowerCase()),
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
// Level Preset Renderer
// =============================================================================

interface LevelPresetContentProps {
  level: LogLevel;
  active: boolean;
}

function LevelPresetContent({ level, active }: LevelPresetContentProps) {
  return (
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
  );
}

// =============================================================================
// IO Type Preset Renderer
// =============================================================================

interface IOTypePresetContentProps {
  ioType: LogIOType;
  active: boolean;
}

function IOTypePresetContent({ ioType, active }: IOTypePresetContentProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
      )}
    >
      {LOG_IO_TYPE_LABELS[ioType]}
    </span>
  );
}

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

  // Memoize presets
  const presets = useMemo(() => {
    const levelPresets: SearchPreset[] = LOG_LEVELS.map((level) => ({
      id: `level-${level}`,
      chip: {
        field: "level",
        value: level,
        label: `Level: ${LOG_LEVEL_LABELS[level]}`,
      },
      render: ({ active }) => (
        <LevelPresetContent
          level={level}
          active={active}
        />
      ),
    }));

    const ioTypePresets: SearchPreset[] = (["stdout", "stderr"] as const).map((ioType) => ({
      id: `io-${ioType}`,
      chip: {
        field: "io_type",
        value: ioType,
        label: `Source: ${LOG_IO_TYPE_LABELS[ioType]}`,
      },
      render: ({ active }) => (
        <IOTypePresetContent
          ioType={ioType}
          active={active}
        />
      ),
    }));

    return [
      { label: "Levels", items: levelPresets },
      { label: "Source", items: ioTypePresets },
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
