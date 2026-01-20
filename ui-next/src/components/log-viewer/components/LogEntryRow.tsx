// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo, useCallback } from "react";
import { ChevronRight, Copy, Link } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/api/log-adapter";
import { Button } from "@/components/shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatTime24 } from "@/lib/format-date";
import { getLevelBadgeClasses, getLevelAbbrev, getLogRowClasses } from "../lib/level-utils";

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
  /** Whether to show task suffix */
  showTask: boolean;
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
// Component
// =============================================================================

function LogEntryRowInner({
  entry,
  isExpanded,
  wrapLines,
  showTask,
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
  const timestamp = formatTime24(entry.timestamp);

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
      <div className="flex items-start gap-3">
        {/* Expand/collapse indicator */}
        <ChevronRight
          className={cn(
            "text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform duration-150",
            isExpanded && "rotate-90",
          )}
        />

        {/* Timestamp */}
        <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">{timestamp}</span>

        {/* Level badge - fixed width for alignment */}
        <span className={cn("w-[52px] shrink-0 text-center", getLevelBadgeClasses(level))}>
          {getLevelAbbrev(level)}
        </span>

        {/* Log message - flexible, truncates to make room for task */}
        <code
          className={cn(
            "min-w-0 flex-1 font-mono text-sm",
            wrapLines ? "break-words" : "overflow-hidden text-ellipsis",
          )}
          style={{ whiteSpace: wrapLines ? "pre-wrap" : "pre" }}
        >
          {entry.message}
        </code>

        {/* Task suffix - right-aligned, hides on narrow containers */}
        {showTask && entry.labels.task && (
          <span
            className={cn(
              // Base styles
              "text-muted-foreground/70 shrink-0 truncate text-xs",
              // Fluid width: 0 → 15% of container → 140px max
              "w-[clamp(0px,15cqw,140px)]",
              // Hide when container is too narrow - prioritize message space
              "hidden @[550px]:inline",
              // Right-align text within the allocated space
              "text-right",
            )}
            title={entry.labels.task}
          >
            [{entry.labels.task}]
          </span>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-muted mt-2 ml-6 border-l-2 pl-4">
          <pre className="text-muted-foreground font-mono text-sm break-words whitespace-pre-wrap">{entry.message}</pre>
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

          {/* Actions */}
          <div className="mt-3 flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={handleCopy}
                >
                  <Copy className="size-3" />
                  Copy
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Copy log line</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={handleCopyLink}
                >
                  <Link className="size-3" />
                  Copy link
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Copy link to this entry</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}

// Memoized export for virtual list
export const LogEntryRow = memo(LogEntryRowInner);
