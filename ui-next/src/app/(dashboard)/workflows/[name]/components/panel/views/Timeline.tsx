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
 * Responsive timeline visualization for workflow/group/task lifecycles.
 * Uses CSS Grid with sqrt scaling and automatic vertical fallback for narrow containers.
 *
 * Layout decision strategy:
 * - A dedicated hidden measurement grid (same width constraints as container, zero height)
 *   is always rendered to test horizontal fit without affecting visible layout.
 * - The measurement grid uses visibility:hidden + height:0 + overflow:hidden so it
 *   occupies no visual space but lays out at the real container width.
 * - Layout decisions use hysteresis on both width thresholds and overflow detection
 *   to prevent flip-flopping when content width oscillates near the boundary.
 * - The decision is computed from a ResizeObserver callback (external system subscription)
 *   and a RAF-scheduled effect, never re-triggered by its own output.
 */

"use client";

import { memo, useRef, useState, useCallback, useMemo, useEffect } from "react";
import { useResizeObserver, useEventCallback } from "usehooks-ts";
import { useSyncedRef } from "@react-hookz/web";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/shadcn/tooltip";
import { useIsHydrated } from "@/hooks/use-hydrated-store";
import { calculateLiveDuration, useTick } from "@/hooks/use-tick";
import { formatDateTimeFull, formatDateTimeRelative } from "@/lib/format-date";
import { formatDuration } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";

export function parseTime(timeStr?: string | null): Date | null {
  if (!timeStr) return null;
  return new Date(timeStr);
}

export function createPhaseDurationCalculator(now: number) {
  return (start: Date | null, end: Date | null): number | null => {
    return calculateLiveDuration(now, start, end);
  };
}

export interface TimelineFinalizeContext {
  calculatePhaseDuration: (start: Date | null, end: Date | null) => number | null;
  endTime: Date | null;
  isRunning: boolean;
  isCompleted: boolean;
  isFailed: boolean;
}

/**
 * Sort phases chronologically and recalculate durations/statuses to ensure contiguous segments.
 */
export function finalizeTimelinePhases(phases: TimelinePhase[], ctx: TimelineFinalizeContext): TimelinePhase[] {
  const { calculatePhaseDuration, endTime, isRunning, isCompleted, isFailed } = ctx;

  phases.sort((a, b) => {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time.getTime() - b.time.getTime();
  });

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const nextPhase = phases[i + 1];
    const prevPhase = phases[i - 1];
    const isLastPhase = i === phases.length - 1;
    const nextIsTerminal = nextPhase && !nextPhase.time;

    if (nextPhase?.time) {
      const rawDuration = calculatePhaseDuration(phase.time, nextPhase.time);
      phase.duration = rawDuration !== null ? Math.max(1, rawDuration) : null;
      phase.status = "completed";
    } else if (nextIsTerminal) {
      phase.duration = null;
      phase.status = "completed";
    } else if (isLastPhase) {
      const isTerminalPhase = phase.id === "done" || phase.id === "failed" || phase.id === "running";
      if (isTerminalPhase) {
        if (phase.id === "running" && prevPhase?.time) {
          phase.duration = calculatePhaseDuration(prevPhase.time, null);
        } else {
          phase.duration = null;
        }
      } else {
        const rawDuration = calculatePhaseDuration(phase.time, endTime);
        phase.duration = rawDuration !== null ? Math.max(1, rawDuration) : null;
      }
      if (isRunning && !endTime) {
        phase.status = "active";
      } else if (endTime) {
        phase.status = isCompleted ? "completed" : isFailed ? "failed" : "completed";
      }
    }
  }

  return phases;
}

export interface TimelinePhase {
  id: string;
  label: string;
  time: Date | null;
  duration: number | null;
  annotation?: string;
  status: "completed" | "active" | "pending" | "failed";
}

export interface TimelineProps {
  phases: TimelinePhase[];
  emptyMessage?: string;
  className?: string;
  showHeader?: boolean;
  headerText?: string;
}

const STYLES = {
  sectionHeader: "text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase",
  timelineVertical: "px-2 pt-1",
  smallLabel: "text-xs",
  mutedText: "text-muted-foreground",
  subtleText: "text-xs text-muted-foreground/70",
  timelinePending: "border-dashed border-[color:var(--timeline-pending-marker)]",
} as const;

// Using SSR-safe formatters from @/lib/format-date
// formatTimeFull → formatDateTimeFull (SSR-safe, no locale dependency)
// formatTimeShort → formatDateTimeRelative (client-only with relative "today" check)

// Sqrt scaling prevents extreme visual disparities (3600s vs 5s = 60:1 not 720:1)
function getScaledFr(duration: number | null): number {
  const d = Math.max(1, duration ?? 1);
  return Math.max(1, Math.sqrt(d));
}

const MIN_HORIZONTAL_WIDTH = 280;
const HORIZONTAL_RESTORE_WIDTH = 300; // Hysteresis: 280-300px zone prevents flip-flopping

/**
 * Determines whether the timeline should use vertical layout.
 *
 * Key design decisions to break the feedback loop:
 * 1. Measurement always happens on a dedicated hidden grid (measureRef) that is
 *    ALWAYS rendered at the container's actual width. This grid never changes its
 *    layout context based on the isVertical state, breaking the circular dependency.
 * 2. The visible grid is conditionally rendered based on the decision, but the
 *    measurement grid is independent -- its layout is stable across state changes.
 * 3. Hysteresis is applied on two axes:
 *    - Width: switch to vertical at 280px, restore horizontal only above 300px
 *    - Overflow: need 10px of overflow to trigger vertical, need 10px of underflow to restore
 *
 * Implementation notes (React Compiler compliance):
 * - setState is called from the ResizeObserver onResize callback (external system
 *   subscription), not from a useLayoutEffect body, satisfying react-hooks/set-state-in-effect.
 * - Re-measurement on phasesLength changes is triggered via a useEffect that schedules
 *   a single measurement pass through requestAnimationFrame.
 */
function useTimelineLayout(
  containerRef: React.RefObject<HTMLDivElement | null>,
  measureRef: React.RefObject<HTMLDivElement | null>,
  phasesLength: number,
): { isVertical: boolean; containerWidth: number } {
  const [isVertical, setIsVertical] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  // Ref for overflow hysteresis state -- must not trigger re-renders
  const wasOverflowingRef = useRef(false);

  /**
   * Core measurement function. Called from ResizeObserver callback (external system)
   * and from a RAF-scheduled effect when phases change or measurement grid mounts.
   * Safe to call setState here because this runs from an external callback, not an effect body.
   *
   * The stabilization counter from the original code has been removed because the
   * dedicated measurement grid (always laid out at container width, never repositioned)
   * provides stable measurements. The old oscillation was caused by measuring a grid
   * whose layout context changed based on isVertical -- that feedback loop no longer exists.
   */
  const evaluateLayout = useEventCallback((width: number) => {
    if (width <= 0) return;

    setContainerWidth(width);

    // Width-based decision: below minimum always vertical
    if (width < MIN_HORIZONTAL_WIDTH) {
      setIsVertical(true);
      wasOverflowingRef.current = false;
      return;
    }

    // Measure overflow from the dedicated measurement grid.
    // This grid is always rendered with visibility:hidden + height:0 at the
    // container's actual width, so its scrollWidth/clientWidth are stable
    // regardless of whether the visible grid is shown or hidden.
    const measureEl = measureRef.current;
    if (!measureEl) {
      // No measurement element yet -- will re-evaluate when containerWidth
      // changes (which causes the measurement div to mount, triggering the
      // useEffect below via the containerWidth dependency).
      return;
    }

    const scrollWidth = measureEl.scrollWidth;
    const clientWidth = measureEl.clientWidth;
    const overflowAmount = scrollWidth - clientWidth;

    // Overflow hysteresis: require 10px overflow to trigger, but only 0px to clear.
    // This asymmetric approach prevents false positives while allowing escape from vertical mode.
    // CSS Grid with minmax(max-content, fr) won't create underflow, so we can't require negative values to clear.
    const OVERFLOW_HYSTERESIS_PX = 10;
    const isCurrentlyOverflowing = wasOverflowingRef.current
      ? overflowAmount > 0 // Was overflowing: just need no overflow to clear
      : overflowAmount > OVERFLOW_HYSTERESIS_PX; // Was not overflowing: need 10px overflow to trigger

    wasOverflowingRef.current = isCurrentlyOverflowing;

    setIsVertical((prev) => {
      if (isCurrentlyOverflowing) {
        // Content overflows -- must use vertical
        return true;
      }

      if (prev && width < HORIZONTAL_RESTORE_WIDTH) {
        // Currently vertical, width in hysteresis zone -- stay vertical
        return true;
      }

      // No overflow and width sufficient -- use horizontal
      return false;
    });
  });

  // ResizeObserver callback: external system subscription, setState is allowed here.
  useResizeObserver({
    ref: containerRef as React.RefObject<HTMLElement>,
    box: "border-box",
    onResize: ({ width }) => {
      evaluateLayout(width ?? 0);
    },
  });

  // Re-evaluate layout when:
  // - phasesLength changes (different number of grid columns to measure)
  // - containerWidth changes (measurement grid may have just mounted)
  // Uses RAF to ensure the DOM has committed the new measurement grid before reading.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rafId = requestAnimationFrame(() => {
      const rect = container.getBoundingClientRect();
      evaluateLayout(rect.width);
    });
    return () => cancelAnimationFrame(rafId);
  }, [phasesLength, containerWidth, containerRef, evaluateLayout]);

  return useMemo(() => ({ isVertical, containerWidth }), [isVertical, containerWidth]);
}

/**
 * Helper to format time for display - uses relative formatting only after hydration.
 * During SSR/hydration, falls back to the full date format to avoid mismatch.
 */
function useTimeFormatter(isHydrated: boolean) {
  const tickNow = useTick();

  return {
    // SSR-safe full date format (for tooltips, aria labels)
    formatFull: (date: Date | null): string => formatDateTimeFull(date),

    // Relative format (only after hydration to avoid "today" mismatch)
    formatShort: (date: Date | null): string => {
      if (!date) return "";
      // During SSR/hydration, use full format to avoid mismatch
      if (!isHydrated) {
        return formatDateTimeFull(date);
      }
      // After hydration, use relative format with synchronized tick
      return formatDateTimeRelative(date, new Date(tickNow));
    },
  };
}

/**
 * Builds the CSS grid-template-columns value for the horizontal timeline.
 * Extracted to allow reuse between the visible grid and the measurement grid.
 */
function useGridColumns(phases: TimelinePhase[]): string {
  return useMemo(() => phases.map((p) => `minmax(max-content, ${getScaledFr(p.duration)}fr)`).join(" "), [phases]);
}

// ---------------------------------------------------------------------------
// Vertical layout sub-component (extracted for clarity and memoization)
// ---------------------------------------------------------------------------

interface VerticalTimelineProps {
  phases: TimelinePhase[];
  formatFull: (date: Date | null) => string;
  formatShort: (date: Date | null) => string;
}

const VerticalTimeline = memo(function VerticalTimeline({ phases, formatFull, formatShort }: VerticalTimelineProps) {
  return (
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
                    aria-label={`${phase.label}${phase.time ? `: ${formatFull(phase.time)}` : ""}`}
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
                  {phase.time && <div className="text-gray-500 dark:text-zinc-400">{formatFull(phase.time)}</div>}
                </TooltipContent>
              </Tooltip>
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
              {phase.time && <span className={STYLES.subtleText}>{formatShort(phase.time)}</span>}
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
  );
});

// ---------------------------------------------------------------------------
// Horizontal layout sub-component (extracted for clarity and memoization)
// ---------------------------------------------------------------------------

interface HorizontalTimelineProps {
  phases: TimelinePhase[];
  gridColumns: string;
  formatFull: (date: Date | null) => string;
  formatShort: (date: Date | null) => string;
}

const HorizontalTimeline = memo(function HorizontalTimeline({
  phases,
  gridColumns,
  formatFull,
  formatShort,
}: HorizontalTimelineProps) {
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: gridColumns }}
    >
      {phases.map((phase, index) => {
        const isLast = index === phases.length - 1;
        const nextPhase = phases[index + 1];
        const markerLabel = `${phase.label}${phase.time ? `: ${formatFull(phase.time)}` : ""}`;
        return (
          <div
            key={phase.id}
            className="flex h-6 items-center"
          >
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
                {phase.time && <div className="text-gray-500 dark:text-zinc-400">{formatFull(phase.time)}</div>}
              </TooltipContent>
            </Tooltip>
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

      {phases.map((phase, index) => {
        const isLast = index === phases.length - 1;
        return (
          <div
            key={`${phase.id}-label`}
            className={cn("mt-1 flex flex-col whitespace-nowrap", isLast ? "items-end text-right" : "pr-8")}
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
            {phase.time && <span className={STYLES.subtleText}>{formatShort(phase.time)}</span>}
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
  );
});

// ---------------------------------------------------------------------------
// Main Timeline component
// ---------------------------------------------------------------------------

export const Timeline = memo(function Timeline({
  phases,
  emptyMessage,
  className,
  showHeader = false,
  headerText = "Timeline",
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  // Hydration safety for relative date formatting
  const isHydrated = useIsHydrated();
  const { formatFull, formatShort } = useTimeFormatter(isHydrated);

  // Stable formatter references for sub-component props.
  // formatFull is pure (no tick dependency), so a single useCallback is safe.
  // formatShort captures tickNow which changes every second, so we use useSyncedRef
  // to always dispatch through the latest closure without breaking memoization.
  const stableFormatFull = useCallback((date: Date | null) => formatDateTimeFull(date), []);
  const formatShortRef = useSyncedRef(formatShort);
  const stableFormatShort = useCallback((date: Date | null) => formatShortRef.current(date), [formatShortRef]);

  const gridColumns = useGridColumns(phases);

  // Layout decision: uses a hidden measurement grid to avoid the feedback loop.
  // The measurement grid is always rendered in-flow at the container's actual width.
  const { isVertical, containerWidth } = useTimelineLayout(containerRef, measureRef, phases.length);

  const useHorizontal = !isVertical && containerWidth >= MIN_HORIZONTAL_WIDTH;

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

  const accessibleDescription = phases
    .map((phase) => {
      const time = phase.time ? formatFull(phase.time) : "";
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
        <div
          className="sr-only"
          role="img"
          aria-label={`Timeline: ${accessibleDescription}`}
        >
          {accessibleDescription}
        </div>

        {showHeader && <h3 className={STYLES.sectionHeader}>{headerText}</h3>}

        {/* Hidden measurement grid: always rendered in normal flow at container width.
            Uses visibility:hidden + h-0 + overflow-hidden so it takes up no visual space
            but participates in the container's layout context for accurate measurement.
            This is the key to breaking the feedback loop: its scrollWidth/clientWidth
            are independent of the isVertical state. */}
        {containerWidth >= MIN_HORIZONTAL_WIDTH && (
          <div
            ref={measureRef}
            className="invisible grid h-0 overflow-hidden"
            aria-hidden
            style={{ gridTemplateColumns: gridColumns }}
          >
            {phases.map((phase, index) => {
              const isLast = index === phases.length - 1;
              return (
                <div
                  key={`${phase.id}-measure`}
                  className={cn("flex flex-col whitespace-nowrap", isLast ? "items-end text-right" : "pr-8")}
                >
                  <span className={cn(STYLES.smallLabel, "font-medium")}>{phase.label}</span>
                  {phase.time && <span className={STYLES.subtleText}>{formatShort(phase.time)}</span>}
                  {phase.duration !== null && (
                    <span className={STYLES.smallLabel}>{formatDuration(phase.duration)}</span>
                  )}
                  {phase.annotation && <span className={STYLES.smallLabel}>{phase.annotation}</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* Render the chosen layout */}
        {useHorizontal ? (
          <HorizontalTimeline
            phases={phases}
            gridColumns={gridColumns}
            formatFull={stableFormatFull}
            formatShort={stableFormatShort}
          />
        ) : (
          <VerticalTimeline
            phases={phases}
            formatFull={stableFormatFull}
            formatShort={stableFormatShort}
          />
        )}
      </div>
    </TooltipProvider>
  );
});
