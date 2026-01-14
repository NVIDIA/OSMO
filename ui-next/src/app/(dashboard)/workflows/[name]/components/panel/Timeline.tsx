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

/**
 * Timeline Component
 *
 * A reusable, responsive timeline visualization for workflow, group, and task lifecycles.
 *
 * Responsive behavior:
 * 1. Wide container: segments sized proportionally based on duration
 * 2. Shrinking: all segments shrink proportionally together
 * 3. Segment hits minimum: that segment stops at text width, others continue shrinking
 * 4. All segments at minimum: if still doesn't fit, switch to vertical layout
 *
 * Features:
 * - CSS Grid with minmax(max-content, Xfr) for proportional + minimum sizing
 * - Square root scaling for durations to prevent extreme visual disparities
 * - Tooltips on markers with timestamps
 * - Visual states: completed, active, pending, failed
 * - Accessible screen reader descriptions
 */

"use client";

import { memo, useRef, useState, useLayoutEffect } from "react";
import { useResizeObserver } from "usehooks-ts";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/shadcn/tooltip";
import { calculateLiveDuration } from "@/hooks";
import { formatDuration } from "../../lib/workflow-types";

// ============================================================================
// Shared Utilities
// ============================================================================

/**
 * Parse timestamp string to Date.
 * Timestamps are normalized in the adapter layer (useWorkflow hook),
 * so we can safely use new Date() directly.
 */
export function parseTime(timeStr?: string | null): Date | null {
  if (!timeStr) return null;
  return new Date(timeStr);
}

/**
 * Create a phase duration calculator using the synchronized tick.
 * Returns a function that calculates duration between start and end times,
 * using the current time (now) for running phases.
 */
export function createPhaseDurationCalculator(now: number) {
  return (start: Date | null, end: Date | null): number | null => {
    return calculateLiveDuration(now, start, end);
  };
}

// ============================================================================
// Types
// ============================================================================

export interface TimelinePhase {
  /** Unique identifier for this phase */
  id: string;
  /** Label for the phase */
  label: string;
  /** Start time of this phase */
  time: Date | null;
  /** Duration in seconds (used for proportional width and display) */
  duration: number | null;
  /** Additional annotation text (e.g., "queued 5m", "ran 2h") */
  annotation?: string;
  /** Current status of this phase */
  status: "completed" | "active" | "pending" | "failed";
}

export interface TimelineProps {
  /** Array of timeline phases to display */
  phases: TimelinePhase[];
  /** Message to show when there are no phases (e.g., "Waiting to be scheduled") */
  emptyMessage?: string;
  /** Additional class name for the container */
  className?: string;
  /** Whether to show the section header (default: false) */
  showHeader?: boolean;
  /** Custom header text (default: "Timeline") */
  headerText?: string;
}

// ============================================================================
// Styling Constants
// ============================================================================

const STYLES = {
  sectionHeader: "text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase",
  timelineVertical: "px-2 pt-1",
  smallLabel: "text-xs",
  mutedText: "text-muted-foreground",
  subtleText: "text-xs text-muted-foreground/70",
  timelinePending: "border-dashed border-border",
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimeFull(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatTimeShort(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ============================================================================
// Component
// ============================================================================

/**
 * Calculate scaled fr value for proportional grid sizing.
 * Uses square root scaling to prevent extreme visual disparities
 * (e.g., 3600s vs 5s would be 60:1 instead of 720:1)
 */
function getScaledFr(duration: number | null): number {
  const d = Math.max(1, duration ?? 1);
  return Math.max(1, Math.sqrt(d));
}

export const Timeline = memo(function Timeline({
  phases,
  emptyMessage,
  className,
  showHeader = false,
  headerText = "Timeline",
}: TimelineProps) {
  // Content-aware layout: measure container and detect overflow
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Track if horizontal layout overflows (all segments at min-content but still don't fit)
  const [hasOverflow, setHasOverflow] = useState(false);

  // Use useResizeObserver for efficient container dimension tracking
  const { width: containerWidth = 0 } = useResizeObserver({
    ref: containerRef as React.RefObject<HTMLElement>,
    box: "border-box",
  });

  // Detect overflow: switch to vertical when even min-content widths don't fit
  // Using RAF to defer state update and avoid cascading renders flagged by React Compiler
  useLayoutEffect(() => {
    if (!gridRef.current || containerWidth <= 0) return;

    // Measure overflow after layout
    const checkOverflow = () => {
      if (!gridRef.current) return;
      const overflow = gridRef.current.scrollWidth > gridRef.current.clientWidth + 1;
      setHasOverflow(overflow);
    };

    // Use RAF to batch the state update after browser paint
    const rafId = requestAnimationFrame(checkOverflow);
    return () => cancelAnimationFrame(rafId);
  }, [containerWidth, phases.length]);

  // Use horizontal if container has width and content fits
  const useHorizontal = containerWidth > 0 && !hasOverflow;

  // No timeline data - show empty message or nothing
  if (phases.length === 0) {
    if (emptyMessage) {
      return (
        <div className={cn("flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-500", className)}>
          <span className="inline-block size-2 rounded-full border border-dashed border-gray-400 dark:border-zinc-600" />
          <span>{emptyMessage}</span>
        </div>
      );
    }
    return null;
  }

  // Build accessible description
  const accessibleDescription = phases
    .map((phase) => {
      const time = phase.time ? formatTimeFull(phase.time) : "";
      const dur = phase.duration !== null ? formatDuration(phase.duration) : "";
      return `${phase.label}: ${phase.status}${dur ? `, ${dur}` : ""}${time ? ` (${time})` : ""}`;
    })
    .join(". ");

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={containerRef}
        className={cn("relative flex flex-col", className)}
      >
        {/* Screen reader description */}
        <div
          className="sr-only"
          role="img"
          aria-label={`Timeline: ${accessibleDescription}`}
        >
          {accessibleDescription}
        </div>

        {showHeader && <h3 className={STYLES.sectionHeader}>{headerText}</h3>}

        {/* Vertical layout (for narrow containers or many phases) */}
        {!useHorizontal && (
          <div className={STYLES.timelineVertical}>
            {phases.map((phase, index) => {
              const isLast = index === phases.length - 1;
              const nextPhase = phases[index + 1];
              return (
                <div
                  key={phase.id}
                  className="flex gap-3"
                >
                  <div className="flex flex-col items-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${phase.label}${phase.time ? `: ${formatTimeFull(phase.time)}` : ""}`}
                          className={cn(
                            "size-2 shrink-0 cursor-help rounded-full border-2 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-white focus:outline-none dark:focus:ring-offset-zinc-900",
                            phase.status === "completed" && "timeline-marker-completed",
                            phase.status === "failed" && "timeline-marker-failed",
                            phase.status === "active" && "timeline-marker-running animate-pulse",
                            phase.status === "pending" && "timeline-marker-pending border-dashed",
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        className="text-xs"
                      >
                        <div className="font-medium">{phase.label}</div>
                        {phase.time && (
                          <div className="text-gray-500 dark:text-zinc-400">{formatTimeFull(phase.time)}</div>
                        )}
                      </TooltipContent>
                    </Tooltip>
                    {/* Segment styled based on NEXT phase (destination) */}
                    {!isLast && nextPhase && (
                      <div
                        className={cn(
                          "min-h-6 w-0.5 flex-1",
                          nextPhase.status === "completed" && "timeline-segment-completed",
                          nextPhase.status === "failed" && "timeline-segment-failed",
                          nextPhase.status === "active" && "timeline-active-segment",
                          nextPhase.status === "pending" && cn("border-l", STYLES.timelinePending),
                        )}
                      />
                    )}
                  </div>
                  <div className={cn("flex flex-col pb-4", isLast && "pb-0")}>
                    <span
                      className={cn(
                        "text-xs font-medium",
                        phase.status === "completed" && "timeline-text-completed",
                        phase.status === "failed" && "timeline-text-failed",
                        phase.status === "active" && "timeline-text-running",
                        phase.status === "pending" && "timeline-text-pending",
                      )}
                    >
                      {phase.label}
                    </span>
                    {phase.time && <span className={STYLES.subtleText}>{formatTimeShort(phase.time)}</span>}
                    {phase.duration !== null && (
                      <span
                        className={cn(
                          STYLES.smallLabel,
                          phase.status === "active" ? "timeline-text-running" : STYLES.mutedText,
                        )}
                      >
                        {formatDuration(phase.duration)}
                      </span>
                    )}
                    {phase.annotation && (
                      <span
                        className={cn(
                          STYLES.smallLabel,
                          phase.status === "active" ? "timeline-text-running" : STYLES.mutedText,
                        )}
                      >
                        {phase.annotation}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Horizontal layout - always render for measurement, hide when overflowing */}
        {/* Uses CSS Grid with minmax(max-content, Xfr) for proportional sizing with minimum text width */}
        {/* Behavior: segments shrink proportionally, stop at text width, then switch to vertical */}
        {containerWidth > 0 && (
          <div
            ref={gridRef}
            className={cn(
              "grid",
              // Hide when overflow detected, but keep in DOM for measurement
              hasOverflow && "pointer-events-none invisible absolute",
            )}
            aria-hidden={hasOverflow}
            style={{
              // minmax(max-content, Xfr): columns shrink proportionally, stop at text content width
              // Uses sqrt scaling to prevent extreme visual disparities (3600s vs 5s = 60:1 not 720:1)
              gridTemplateColumns: phases.map((p) => `minmax(max-content, ${getScaledFr(p.duration)}fr)`).join(" "),
            }}
          >
            {/* Row 1: Timeline bar with markers and segments */}
            {phases.map((phase, index) => {
              const isLast = index === phases.length - 1;
              const nextPhase = phases[index + 1];
              const markerLabel = `${phase.label}${phase.time ? `: ${formatTimeFull(phase.time)}` : ""}`;
              return (
                <div
                  key={phase.id}
                  className="flex h-6 items-center"
                >
                  {/* Connecting segment for last phase (styled based on current/destination phase) */}
                  {isLast && index > 0 && (
                    <div
                      className={cn(
                        "h-1 flex-1",
                        phase.status === "completed" && "timeline-segment-completed",
                        phase.status === "failed" && "timeline-segment-failed",
                        phase.status === "active" && "timeline-active-segment",
                        phase.status === "pending" && cn("border-t", STYLES.timelinePending),
                      )}
                    />
                  )}
                  {/* Phase marker with tooltip */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={markerLabel}
                        className={cn(
                          "relative z-10 size-2.5 shrink-0 cursor-help rounded-full border-2 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-white focus:outline-none dark:focus:ring-offset-zinc-900",
                          phase.status === "completed" && "timeline-marker-completed",
                          phase.status === "failed" && "timeline-marker-failed",
                          phase.status === "active" && "timeline-marker-running animate-pulse",
                          phase.status === "pending" && "timeline-marker-pending border-dashed",
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="text-xs"
                    >
                      <div className="font-medium">{phase.label}</div>
                      {phase.time && (
                        <div className="text-gray-500 dark:text-zinc-400">{formatTimeFull(phase.time)}</div>
                      )}
                    </TooltipContent>
                  </Tooltip>
                  {/* Segment to next marker (styled based on next/destination phase) */}
                  {!isLast && nextPhase && (
                    <div
                      className={cn(
                        "h-1 flex-1",
                        nextPhase.status === "completed" && "timeline-segment-completed",
                        nextPhase.status === "failed" && "timeline-segment-failed",
                        nextPhase.status === "active" && "timeline-active-segment",
                        nextPhase.status === "pending" && cn("border-t", STYLES.timelinePending),
                      )}
                    />
                  )}
                </div>
              );
            })}

            {/* Row 2: Phase labels (same grid ensures alignment with markers) */}
            {phases.map((phase, index) => {
              const isLast = index === phases.length - 1;
              return (
                <div
                  key={`${phase.id}-label`}
                  className={cn(
                    "mt-1 flex flex-col whitespace-nowrap",
                    // Add padding between phases; last phase is right-aligned
                    isLast ? "items-end text-right" : "pr-8",
                  )}
                >
                  <span
                    className={cn(
                      STYLES.smallLabel,
                      "font-medium",
                      phase.status === "completed" && "timeline-text-completed",
                      phase.status === "failed" && "timeline-text-failed",
                      phase.status === "active" && "timeline-text-running",
                      phase.status === "pending" && "timeline-text-pending",
                    )}
                  >
                    {phase.label}
                  </span>
                  {phase.time && <span className={STYLES.subtleText}>{formatTimeShort(phase.time)}</span>}
                  {phase.duration !== null && (
                    <span
                      className={cn(
                        STYLES.smallLabel,
                        phase.status === "active" ? "timeline-text-running" : STYLES.mutedText,
                      )}
                    >
                      {formatDuration(phase.duration)}
                    </span>
                  )}
                  {phase.annotation && (
                    <span
                      className={cn(
                        STYLES.smallLabel,
                        phase.status === "active" ? "timeline-text-running" : STYLES.mutedText,
                      )}
                    >
                      {phase.annotation}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
});
