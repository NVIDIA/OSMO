// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useIsomorphicLayoutEffect } from "@react-hookz/web";

import { useViewTransition } from "@/hooks/use-view-transition";

import "./panel-tabs.css";

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
 * PanelTabs - Chrome-style tabs with content-driven responsive behavior.
 *
 * Automatically switches to icon-only mode when the container is too narrow
 * to fit the full labels. Uses ResizeObserver to detect label truncation.
 */
export function PanelTabs({ tabs, value, onValueChange, iconOnly: iconOnlyProp, className }: PanelTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);
  const { startTransition } = useViewTransition();

  // Store the width where we switched to compact mode
  const switchWidthRef = useRef<number>(0);

  // Content-driven compact mode detection
  useIsomorphicLayoutEffect(() => {
    if (iconOnlyProp !== undefined) return;

    const container = containerRef.current;
    const tabList = tabListRef.current;
    if (!container || !tabList) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const currentWidth = entry.contentRect.width;

      if (!isCompact) {
        // Check if any tab label is currently truncating
        const labels = tabList.querySelectorAll(".tab-label");
        let hasTruncation = false;

        for (const label of Array.from(labels) as HTMLElement[]) {
          // If scrollWidth > offsetWidth, the text is being clipped
          if (label.scrollWidth > label.offsetWidth) {
            hasTruncation = true;
            break;
          }
        }

        if (hasTruncation) {
          switchWidthRef.current = currentWidth;
          setIsCompact(true);
        }
      } else {
        // If we are compact, switch back if we have significantly more space
        // than when we switched to compact.
        if (currentWidth > (switchWidthRef.current || 0) + 20) {
          setIsCompact(false);
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [iconOnlyProp, isCompact, tabs]);

  // Reset when tabs change
  useIsomorphicLayoutEffect(() => {
    setIsCompact(false);
    switchWidthRef.current = 0;
  }, [tabs]);

  const iconOnly = iconOnlyProp ?? isCompact;

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

  return (
    <div
      ref={containerRef}
      className={cn("panel-tabs relative shrink-0 bg-gray-100 pt-1.5 dark:bg-zinc-800", className)}
    >
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
                // Fixed height ensures no layout shift when switching between icon-only and icon+text modes.
                // Height = 28px: 16px content (icon/text) + 6px top padding + 6px bottom padding
                "panel-tab relative z-10 flex h-7 flex-1 items-center justify-center gap-1.5 py-1.5 text-sm font-medium transition-colors outline-none",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1",
                "min-w-0",
                iconOnly ? "px-2" : "px-4",
                isActive
                  ? "rounded-t-md bg-white text-gray-900 dark:bg-zinc-900 dark:text-zinc-100"
                  : "text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-300",
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
