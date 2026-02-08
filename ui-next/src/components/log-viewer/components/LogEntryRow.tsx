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
import type { LogEntry } from "@/lib/api/log-adapter/types";
import { formatTime24UTC } from "@/lib/format-date";
import { getLevelBadgeClasses, getLevelLabel, getLogRowClasses } from "@/components/log-viewer/lib/level-utils";

// =============================================================================
// Types
// =============================================================================

export interface LogEntryRowProps {
  /** The log entry to render */
  entry: LogEntry;
  /** Whether line wrapping is enabled */
  wrapLines: boolean;
  /** Whether to show task suffix */
  showTask: boolean;
  /** Style for virtual list positioning */
  style?: React.CSSProperties;
}

// =============================================================================
// Component
// =============================================================================

function LogEntryRowInner({ entry, wrapLines, showTask, style }: LogEntryRowProps) {
  const level = entry.labels.level;
  const timestamp = formatTime24UTC(entry.timestamp);

  return (
    <div
      role="row"
      data-entry-id={entry.id}
      className={cn(
        getLogRowClasses(level),
        "select-none",
        "focus-visible:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-inset",
      )}
      style={style}
    >
      <div className="flex items-center gap-3">
        {/* Timestamp */}
        <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">{timestamp}</span>

        {/* Level badge - fixed width for alignment */}
        <span className={cn("w-[52px] shrink-0 text-center", getLevelBadgeClasses(level))}>{getLevelLabel(level)}</span>

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
    </div>
  );
}

// Memoized export for virtual list
export const LogEntryRow = memo(LogEntryRowInner);
