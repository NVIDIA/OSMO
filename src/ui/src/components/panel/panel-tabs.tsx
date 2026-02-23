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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventCallback, useResizeObserver } from "usehooks-ts";
import { cn } from "@/lib/utils";

import { useViewTransition } from "@/hooks/use-view-transition";

import "@/components/panel/panel-tabs.css";

export interface PanelTab {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  statusContent?: React.ReactNode;
}

export interface PanelTabsProps {
  tabs: PanelTab[];
  value: string;
  onValueChange: (value: string) => void;
  iconOnly?: boolean;
  className?: string;
}

// Panel tabs styles are now in src/styles/components/panel-tabs.css
// Imported via globals.css - no dynamic injection needed

/**
 * Determines whether tabs should display in compact (icon-only) mode.
 *
 * Anti-feedback-loop strategy (mirrors Timeline.tsx pattern):
 *
 * Problem: Measuring truncation on the VISIBLE tabs creates a circular dependency.
 * When isCompact=true, text labels are removed, which eliminates truncation, which
 * triggers isCompact=false, which adds labels back, which causes truncation again.
 *
 * Solution:
 * 1. A dedicated hidden measurement row always renders ALL tabs in full icon+text
 *    mode with the same layout constraints (flex-1, same padding, same gap) as the
 *    visible tabs. This measurement row uses visibility:hidden + height:0 +
 *    overflow:hidden, so it occupies no visual space but lays out at the real
 *    container width.
 * 2. Truncation is detected on the HIDDEN measurement labels, not the visible ones.
 *    Since the hidden row never changes between compact/full mode, its measurements
 *    are stable and independent of the isCompact state.
 * 3. Hysteresis is applied: once we switch to compact mode, we record the container
 *    width at the switch point. We only restore full mode when the container is
 *    significantly wider (RESTORE_HYSTERESIS_PX) than the switch point, preventing
 *    oscillation near the boundary.
 * 4. The ResizeObserver callback is stabilized with useEventCallback so it never
 *    appears in effect dependency arrays, and isCompact is NOT in the effect deps
 *    that create the observer.
 */

/** Extra pixels beyond the switch-point width required to restore full mode */
const RESTORE_HYSTERESIS_PX = 30;

function useCompactMode(
  containerRef: React.RefObject<HTMLDivElement | null>,
  measureRef: React.RefObject<HTMLDivElement | null>,
  tabsLength: number,
  iconOnlyProp: boolean | undefined,
): boolean {
  const [isCompact, setIsCompact] = useState(false);

  // Width at which we last switched to compact mode.
  // Only used for hysteresis: we require width > switchWidth + RESTORE_HYSTERESIS_PX to restore.
  const switchWidthRef = useRef(0);

  // Track whether truncation was detected on the previous pass, for hysteresis.
  const wasTruncatedRef = useRef(false);

  /**
   * Core measurement function. Reads truncation from the hidden measurement row
   * and applies hysteresis to decide whether compact mode should be active.
   *
   * Safe to call setState here because this runs from ResizeObserver (external system
   * subscription) or from a RAF-scheduled effect, not from a render or layout effect body.
   */
  const evaluateLayout = useEventCallback((containerWidth: number) => {
    if (containerWidth <= 0) return;
    if (iconOnlyProp !== undefined) return;

    const measureEl = measureRef.current;
    if (!measureEl) return;

    // Check if any label in the hidden measurement row is truncated.
    // These labels always render in full icon+text mode regardless of isCompact.
    const labels = measureEl.querySelectorAll(".tab-label-measure");

    // Truncation detection with hysteresis:
    // - To ENTER truncated state: require >1px overflow (tolerates sub-pixel rounding)
    // - To CLEAR truncated state: require zero overflow (scrollWidth <= offsetWidth)
    // This 1px asymmetry prevents rapid toggling at the exact boundary.
    // The main anti-flicker protection comes from the width-based
    // RESTORE_HYSTERESIS_PX check below.
    //
    // Note: scrollWidth >= offsetWidth always holds in the DOM, so approaches
    // like `scrollWidth > offsetWidth - N` (checking for "headroom") are
    // always true and can never clear -- that was the previous bug.
    const overflowThreshold = wasTruncatedRef.current ? 0 : 1;
    let isTruncated = false;
    for (const label of Array.from(labels) as HTMLElement[]) {
      if (label.scrollWidth > label.offsetWidth + overflowThreshold) {
        isTruncated = true;
        break;
      }
    }

    wasTruncatedRef.current = isTruncated;

    setIsCompact((prev) => {
      if (isTruncated && !prev) {
        // Switch to compact: record the width for hysteresis
        switchWidthRef.current = containerWidth;
        return true;
      }

      if (prev && !isTruncated) {
        // Candidate for restoring full mode.
        // Width hysteresis: only restore if we have significantly more space
        // than when we switched to compact. This prevents oscillation when the
        // user drags the panel near the boundary width.
        if (containerWidth > switchWidthRef.current + RESTORE_HYSTERESIS_PX) {
          return false;
        }
        // In the hysteresis zone: stay compact
        return true;
      }

      return prev;
    });
  });

  // ResizeObserver: external system subscription. setState is safe here.
  useResizeObserver({
    ref: containerRef as React.RefObject<HTMLElement>,
    box: "border-box",
    onResize: ({ width }) => {
      evaluateLayout(width ?? 0);
    },
  });

  // Re-evaluate when tabs change (different labels = different truncation).
  // Uses RAF to ensure the DOM has committed the new measurement labels before reading.
  useEffect(() => {
    if (iconOnlyProp !== undefined) return;
    const container = containerRef.current;
    if (!container) return;

    // Reset hysteresis state when tabs change so we get a fresh evaluation
    wasTruncatedRef.current = false;
    switchWidthRef.current = 0;

    const rafId = requestAnimationFrame(() => {
      const rect = container.getBoundingClientRect();
      evaluateLayout(rect.width);
    });
    return () => cancelAnimationFrame(rafId);
  }, [tabsLength, containerRef, evaluateLayout, iconOnlyProp]);

  return iconOnlyProp ?? isCompact;
}

/**
 * PanelTabs - Chrome-style tabs with content-driven responsive behavior.
 *
 * Automatically switches to icon-only mode when the container is too narrow
 * to fit the full labels. Uses a hidden measurement row and hysteresis to
 * prevent flickering during resize (see useCompactMode documentation above).
 */
export function PanelTabs({ tabs, value, onValueChange, iconOnly: iconOnlyProp, className }: PanelTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const { startTransition } = useViewTransition();

  const iconOnly = useCompactMode(containerRef, measureRef, tabs.length, iconOnlyProp);

  const handleTabChange = useCallback(
    (tabId: string) => {
      startTransition(() => onValueChange(tabId));
    },
    [onValueChange, startTransition],
  );

  // Keyboard navigation (scoped to tab list)
  // Shortcuts defined in: ./hotkeys.ts (PANEL_HOTKEYS)
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, currentIndex: number) => {
      let nextIndex: number | null = null;
      switch (event.key) {
        case "ArrowLeft":
          // PANEL_HOTKEYS.shortcuts.PREVIOUS_TAB
          nextIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
          break;
        case "ArrowRight":
          // PANEL_HOTKEYS.shortcuts.NEXT_TAB
          nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
          break;
        case "Home":
          // PANEL_HOTKEYS.shortcuts.FIRST_TAB
          nextIndex = 0;
          break;
        case "End":
          // PANEL_HOTKEYS.shortcuts.LAST_TAB
          nextIndex = tabs.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      const nextTab = tabs[nextIndex];
      if (nextTab) {
        handleTabChange(nextTab.id);
        const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
        buttons?.[nextIndex]?.focus();
      }
    },
    [tabs, handleTabChange],
  );

  // Memoize the measurement row content to avoid unnecessary re-renders.
  // This row is the key to breaking the feedback loop: it always renders in
  // full icon+text mode regardless of the isCompact decision.
  const measurementRow = useMemo(
    () => (
      <div
        ref={measureRef}
        className="invisible flex h-0 w-full gap-0 overflow-hidden"
        aria-hidden="true"
      >
        {tabs.map((tab) => (
          <div
            key={`${tab.id}-measure`}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-4 py-1.5"
          >
            {tab.icon && <tab.icon className="size-4 shrink-0" />}
            <span className="tab-label-measure truncate text-sm leading-4">{tab.label}</span>
            {tab.statusContent}
          </div>
        ))}
      </div>
    ),
    [tabs],
  );

  return (
    <div
      ref={containerRef}
      className={cn("panel-tabs relative shrink-0 bg-gray-100 py-1.5 dark:bg-zinc-800", className)}
    >
      {/* Hidden measurement row: always renders ALL tabs in full icon+text mode.
          Uses visibility:hidden + h-0 + overflow-hidden so it occupies no visual space
          but lays out at the container's actual width. Truncation is measured here,
          not on the visible tabs, breaking the feedback loop. */}
      {measurementRow}

      <div
        ref={tabListRef}
        className="relative flex h-auto w-full gap-0"
        role="tablist"
        aria-label="Panel tabs"
      >
        {tabs.map((tab, index) => {
          const isActive = value === tab.id;
          const isFirst = index === 0;
          const isLast = index === tabs.length - 1;

          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              data-active={isActive}
              data-first={isFirst}
              data-last={isLast}
              title={iconOnly ? tab.label : undefined}
              aria-label={iconOnly ? tab.label : undefined}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              role="tab"
              className={cn(
                // Layout: padding-driven height (no fixed h-*) so active tab can extend
                // into the container's bottom padding for flush alignment with content.
                // Inactive: pt-1.5 + 16px content + pb-1.5 = 28px
                // Active:   pt-1.5 + 16px content + pb-3   = 34px, with -mb-1.5 to keep row height at 28px
                "panel-tab relative z-10 flex flex-1 items-center justify-center gap-1.5 pt-1.5 text-sm font-medium transition-colors outline-none",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1",
                "min-w-0",
                iconOnly ? "px-2" : "px-4",
                isActive
                  ? "-mb-1.5 rounded-t-md bg-white pb-3 text-gray-900 dark:bg-zinc-900 dark:text-zinc-100"
                  : "pb-1.5 text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-300",
                isActive &&
                  !isFirst &&
                  "before:absolute before:bottom-0 before:-left-[6px] before:size-[6px] before:bg-[radial-gradient(circle_at_0%_0%,transparent_6px,white_6px)] dark:before:bg-[radial-gradient(circle_at_0%_0%,transparent_6px,rgb(24,24,27)_6px)]",
                isActive &&
                  !isLast &&
                  "after:absolute after:-right-[6px] after:bottom-0 after:size-[6px] after:bg-[radial-gradient(circle_at_100%_0%,transparent_6px,white_6px)] dark:after:bg-[radial-gradient(circle_at_100%_0%,transparent_6px,rgb(24,24,27)_6px)]",
              )}
            >
              {tab.icon && <tab.icon className="size-4 shrink-0" />}
              {!iconOnly && <span className="tab-label truncate leading-4">{tab.label}</span>}
              {tab.statusContent}
            </button>
          );
        })}
      </div>
    </div>
  );
}
