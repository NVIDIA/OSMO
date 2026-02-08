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
 */

"use client";

import { memo, useRef, useState, useLayoutEffect } from "react";
import { useResizeObserver } from "usehooks-ts";
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
const LAYOUT_HYSTERESIS = 20;

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

export const Timeline = memo(function Timeline({
  phases,
  emptyMessage,
  className,
  showHeader = false,
  headerText = "Timeline",
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [isVertical, setIsVertical] = useState(false);
  const lastWidthRef = useRef<number>(0);

  // Hydration safety for relative date formatting
  const isHydrated = useIsHydrated();
  const { formatFull, formatShort } = useTimeFormatter(isHydrated);

  const { width: containerWidth = 0 } = useResizeObserver({
    ref: containerRef as React.RefObject<HTMLElement>,
    box: "border-box",
  });

  // Hysteresis prevents layout flip-flopping; RAF batches after paint
  useLayoutEffect(() => {
    if (containerWidth <= 0) return;

    const checkLayout = () => {
      if (containerWidth < MIN_HORIZONTAL_WIDTH) {
        setIsVertical((prev) => {
          if (!prev) lastWidthRef.current = containerWidth;
          return true;
        });
        return;
      }

      if (!gridRef.current) {
        if (containerWidth >= MIN_HORIZONTAL_WIDTH) {
          lastWidthRef.current = containerWidth;
        }
        return;
      }

      const scrollWidth = gridRef.current.scrollWidth;
      const clientWidth = gridRef.current.clientWidth;
      const hasOverflow = scrollWidth > clientWidth + 1;
      const widthDelta = Math.abs(containerWidth - lastWidthRef.current);

      setIsVertical((prev) => {
        if (hasOverflow && !prev) {
          lastWidthRef.current = containerWidth;
          return true;
        } else if (!hasOverflow && prev && widthDelta > LAYOUT_HYSTERESIS) {
          if (containerWidth > lastWidthRef.current + LAYOUT_HYSTERESIS) {
            lastWidthRef.current = containerWidth;
            return false;
          }
        }
        return prev;
      });
    };

    const rafId = requestAnimationFrame(checkLayout);
    return () => cancelAnimationFrame(rafId);
  }, [containerWidth, phases.length]);

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
        )}

        {containerWidth >= MIN_HORIZONTAL_WIDTH && (
          <div
            ref={gridRef}
            className={cn("grid", isVertical && "pointer-events-none invisible fixed -left-[9999px]")}
            aria-hidden={isVertical}
            style={{
              gridTemplateColumns: phases.map((p) => `minmax(max-content, ${getScaledFr(p.duration)}fr)`).join(" "),
            }}
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
        )}
      </div>
    </TooltipProvider>
  );
});
