// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo, useCallback } from "react";
import { ChevronRight, Copy, Link, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/api/log-adapter";
import { Button } from "@/components/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { getLevelBadgeClasses, getLevelAbbrev, getLogRowClasses } from "../lib/level-utils";
import { useLogViewerStore } from "../store/log-viewer-store";

// =============================================================================
// Types
// =============================================================================

export interface LogEntryRowProps {
  /** The log entry to render */
  entry: LogEntry;
  /** Whether the row is currently expanded */
  isExpanded: boolean;
  /** Whether line wrapping is enabled */
  wrapLines: boolean;
  /** Callback when row is clicked to toggle expansion */
  onToggleExpand: (id: string) => void;
  /** Callback when copy is clicked */
  onCopy?: (entry: LogEntry) => void;
  /** Callback when link is clicked */
  onCopyLink?: (entry: LogEntry) => void;
  /** Whether this row is focused (keyboard navigation) */
  isFocused?: boolean;
  /** Style for virtual list positioning */
  style?: React.CSSProperties;
}

// =============================================================================
// Time Formatter
// =============================================================================

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", TIME_FORMAT);
}

// =============================================================================
// Component
// =============================================================================

function LogEntryRowInner({
  entry,
  isExpanded,
  wrapLines,
  onToggleExpand,
  onCopy,
  onCopyLink,
  isFocused,
  style,
}: LogEntryRowProps) {
  const handleRowClick = useCallback(() => {
    onToggleExpand(entry.id);
  }, [entry.id, onToggleExpand]);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onCopy?.(entry);
    },
    [entry, onCopy],
  );

  const handleCopyLink = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onCopyLink?.(entry);
    },
    [entry, onCopyLink],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggleExpand(entry.id);
      }
    },
    [entry.id, onToggleExpand],
  );

  const level = entry.labels.level;
  const timestamp = formatTime(entry.timestamp);

  return (
    <div
      role="row"
      tabIndex={0}
      aria-expanded={isExpanded}
      data-entry-id={entry.id}
      className={cn(
        getLogRowClasses(level, { expanded: isExpanded }),
        "cursor-pointer select-none",
        "focus-visible:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-inset",
        isFocused && "ring-ring ring-2 ring-inset",
      )}
      style={style}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-start gap-2">
        {/* Expand/collapse indicator */}
        <ChevronRight
          className={cn(
            "text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform duration-150",
            isExpanded && "rotate-90",
          )}
        />

        {/* Timestamp */}
        <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">{timestamp}</span>

        {/* Level badge */}
        <span className={cn("shrink-0", getLevelBadgeClasses(level))}>{getLevelAbbrev(level)}</span>

        {/* Task name (if present) */}
        {entry.labels.task && (
          <span className="text-muted-foreground max-w-[120px] shrink-0 truncate text-xs">[{entry.labels.task}]</span>
        )}

        {/* Log message */}
        <span
          className={cn("min-w-0 flex-1 font-mono text-sm", wrapLines ? "break-words whitespace-pre-wrap" : "truncate")}
        >
          {entry.line}
        </span>

        {/* Actions (visible on hover/focus) */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6"
                onClick={handleCopy}
              >
                <Copy className="size-3" />
                <span className="sr-only">Copy log line</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Copy</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-3" />
                <span className="sr-only">More actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopy}>
                <Copy className="mr-2 size-4" />
                Copy log line
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyLink}>
                <Link className="mr-2 size-4" />
                Copy link to entry
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-muted mt-2 ml-6 border-l-2 pl-4">
          <pre className="text-muted-foreground font-mono text-sm break-words whitespace-pre-wrap">{entry.line}</pre>
          <div className="text-muted-foreground mt-2 flex flex-wrap gap-2 text-xs">
            <span>
              <strong>Time:</strong> {entry.timestamp.toISOString()}
            </span>
            {entry.labels.task && (
              <span>
                <strong>Task:</strong> {entry.labels.task}
              </span>
            )}
            {entry.labels.retry && (
              <span>
                <strong>Retry:</strong> {entry.labels.retry}
              </span>
            )}
            {entry.labels.io_type && (
              <span>
                <strong>Source:</strong> {entry.labels.io_type}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Connected Component
// =============================================================================

/**
 * Log entry row connected to the store.
 * Use this when you want automatic store integration.
 */
export function LogEntryRowConnected({
  entry,
  onCopy,
  onCopyLink,
  style,
}: {
  entry: LogEntry;
  onCopy?: (entry: LogEntry) => void;
  onCopyLink?: (entry: LogEntry) => void;
  style?: React.CSSProperties;
}) {
  const isExpanded = useLogViewerStore((s) => s.expandedEntryIds.has(entry.id));
  const wrapLines = useLogViewerStore((s) => s.wrapLines);
  const toggleExpand = useLogViewerStore((s) => s.toggleExpand);
  const focusedEntryId = useLogViewerStore((s) => s.focusedEntryId);

  return (
    <LogEntryRowInner
      entry={entry}
      isExpanded={isExpanded}
      wrapLines={wrapLines}
      onToggleExpand={toggleExpand}
      onCopy={onCopy}
      onCopyLink={onCopyLink}
      isFocused={focusedEntryId === entry.id}
      style={style}
    />
  );
}

// Memoized export for virtual list
export const LogEntryRow = memo(LogEntryRowInner);
