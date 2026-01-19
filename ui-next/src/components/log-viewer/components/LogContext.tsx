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
import type { LogEntry } from "@/lib/api/log-adapter";
import { LOG_QUERY_DEFAULTS } from "@/lib/api/log-adapter";
import { getLevelBadgeClasses, getLevelAbbrev } from "../lib/level-utils";

// =============================================================================
// Types
// =============================================================================

export interface LogContextProps {
  /** All log entries (for context lookup) */
  entries: LogEntry[];
  /** The target entry to show context for */
  targetEntry: LogEntry;
  /** Number of lines before/after to show */
  contextLines?: number;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Time Formatter
// =============================================================================

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hour12: false,
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", TIME_FORMAT);
}

// =============================================================================
// Context Entry Row
// =============================================================================

interface ContextEntryProps {
  entry: LogEntry;
  isTarget: boolean;
}

function ContextEntry({ entry, isTarget }: ContextEntryProps) {
  const level = entry.labels.level;

  return (
    <div
      className={cn(
        "flex items-start gap-2 px-2 py-0.5 font-mono text-xs",
        isTarget && "bg-primary/10 ring-primary/20 ring-1",
      )}
    >
      <span className="text-muted-foreground shrink-0 tabular-nums">{formatTime(entry.timestamp)}</span>
      <span className={cn("shrink-0", getLevelBadgeClasses(level))}>{getLevelAbbrev(level)}</span>
      {entry.labels.task && (
        <span className="text-muted-foreground max-w-[80px] shrink-0 truncate">[{entry.labels.task}]</span>
      )}
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{entry.line}</span>
      {isTarget && <span className="text-primary shrink-0">← selected</span>}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

function LogContextInner({
  entries,
  targetEntry,
  contextLines = LOG_QUERY_DEFAULTS.CONTEXT_LINES,
  className,
}: LogContextProps) {
  // Find the target entry index and get surrounding context
  const contextEntries = useMemo(() => {
    const targetIndex = entries.findIndex((e) => e.id === targetEntry.id);
    if (targetIndex === -1) {
      // Target not in entries, just show the target itself
      return [{ entry: targetEntry, isTarget: true }];
    }

    const startIndex = Math.max(0, targetIndex - contextLines);
    const endIndex = Math.min(entries.length - 1, targetIndex + contextLines);

    const result: { entry: LogEntry; isTarget: boolean }[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      const entry = entries[i];
      if (entry) {
        result.push({
          entry,
          isTarget: i === targetIndex,
        });
      }
    }

    return result;
  }, [entries, targetEntry, contextLines]);

  if (contextEntries.length === 0) {
    return <div className={cn("text-muted-foreground p-4 text-center text-sm", className)}>No context available</div>;
  }

  return (
    <div className={cn("bg-muted/30 rounded border", className)}>
      <div className="text-muted-foreground border-b px-3 py-2 text-xs font-medium">
        Context ({contextLines} lines before/after)
      </div>
      <div className="max-h-64 overflow-y-auto">
        {contextEntries.map(({ entry, isTarget }) => (
          <ContextEntry
            key={entry.id}
            entry={entry}
            isTarget={isTarget}
          />
        ))}
      </div>
    </div>
  );
}

export const LogContext = memo(LogContextInner);
