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

import { memo, useCallback, useRef, useState, useLayoutEffect } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
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
  /** Whether this row is individually expanded (only relevant when wrapLines is off) */
  isExpanded?: boolean;
  /** Callback to toggle expansion for this row */
  onToggleExpand?: (entryId: string) => void;
  /** Style for virtual list positioning */
  style?: React.CSSProperties;
}

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

// =============================================================================
// Component
// =============================================================================

function LogEntryRowInner({
  entry,
  wrapLines,
  showTask,
  isSelected = false,
  isExpanded = false,
  onToggleExpand,
  style,
}: LogEntryRowProps) {
  const timestamp = formatTime24UTC(entry.timestamp);
  const effectiveWrap = wrapLines || isExpanded;

  const codeRef = useRef<HTMLElement>(null);
  const [wouldOverflow, setWouldOverflow] = useState(false);

  useLayoutEffect(() => {
    const el = codeRef.current;
    if (!el) return;

    const measure = () => {
      // Always measure in collapsed (pre) mode to determine if text
      // *would* truncate, regardless of current expand state
      const prevWS = el.style.whiteSpace;
      el.style.whiteSpace = "pre";
      const overflows = el.scrollWidth > el.clientWidth;
      el.style.whiteSpace = prevWS;
      setWouldOverflow(overflows);
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [entry.message]);

  const showExpandToggle = !wrapLines && onToggleExpand && wouldOverflow;

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleExpand?.(entry.id);
    },
    [onToggleExpand, entry.id],
  );

  return (
    <div
      role="row"
      data-entry-id={entry.id}
      className={cn(
        "group relative px-3 py-0.5",
        isSelected ? "bg-primary/10 hover:bg-primary/20" : "hover:bg-muted/50",
        "transition-colors duration-75",
        "select-none",
        "focus-visible:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-inset",
      )}
      style={style}
    >
      <div className="flex items-center gap-4">
        {/* Timestamp */}
        <span className="text-muted-foreground/70 shrink-0 font-mono text-[11px] tabular-nums">{timestamp}</span>

        {/* Log message - flexible, truncates to make room for task */}
        <code
          ref={codeRef}
          className={cn(
            "min-w-0 flex-1 font-mono text-sm",
            effectiveWrap ? "break-words" : "overflow-hidden text-ellipsis",
          )}
          style={{ whiteSpace: effectiveWrap ? "pre-wrap" : "pre" }}
        >
          {entry.message}
        </code>

        {/* Right-aligned group: expand/collapse toggle + task tag */}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {/* Per-row expand/collapse toggle — visible on hover when autowrap is off */}
          {showExpandToggle && (
            <button
              type="button"
              onPointerDown={stopPropagation}
              onClick={handleToggle}
              aria-label={isExpanded ? "Collapse log line" : "Expand log line"}
              className={cn(
                "text-muted-foreground/60 hover:text-muted-foreground p-0.5",
                "transition-opacity duration-75",
                isExpanded ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          )}

          {/* Task suffix - hides on narrow containers */}
          {showTask && entry.labels.task && (
            <span
              className={cn(
                "text-muted-foreground/70 truncate text-xs",
                "max-w-[clamp(0px,15cqw,140px)]",
                "hidden @[550px]:inline",
              )}
              title={entry.labels.task}
            >
              [{entry.labels.task}]
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

// Memoized export for virtual list
export const LogEntryRow = memo(LogEntryRowInner);
