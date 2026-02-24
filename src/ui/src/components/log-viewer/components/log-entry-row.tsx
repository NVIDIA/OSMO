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

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/api/log-adapter/types";
import { formatTime24UTC } from "@/lib/format-date";

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
  /** Whether this row is part of the active selection */
  isSelected?: boolean;
  /** Style for virtual list positioning */
  style?: React.CSSProperties;
}

// =============================================================================
// Component
// =============================================================================

function LogEntryRowInner({ entry, wrapLines, showTask, isSelected = false, style }: LogEntryRowProps) {
  const timestamp = formatTime24UTC(entry.timestamp);

  return (
    <div
      role="row"
      data-entry-id={entry.id}
      className={cn(
        "group relative px-3 py-1",
        isSelected ? "bg-primary/10 hover:bg-primary/20" : "hover:bg-muted/50",
        "transition-colors duration-75",
        "select-none",
        "focus-visible:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-inset",
      )}
      style={style}
    >
      <div className="flex items-center gap-3">
        {/* Timestamp */}
        <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">{timestamp}</span>

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
