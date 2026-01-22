// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useIsomorphicLayoutEffect } from "@react-hookz/web";

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

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.id = "panel-tabs-styles";
  style.textContent = `
    /* Hover pill for inactive tabs */
    .panel-tabs .panel-tab[data-active="false"] {
      isolation: isolate;
    }
    .panel-tabs .panel-tab[data-active="false"]::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: calc(100% - 12px);
      height: calc(100% - 8px);
      border-radius: 6px;
      background: transparent;
      transition: background-color 150ms ease-out;
      z-index: -1;
    }
    .panel-tabs .panel-tab[data-active="false"]:hover::before {
      background: rgba(0, 0, 0, 0.08);
    }
    .dark .panel-tabs .panel-tab[data-active="false"]:hover::before {
      background: rgba(255, 255, 255, 0.08);
    }
    
    /* Curve pseudo-elements on active tab */
    .panel-tabs .panel-tab[data-active="true"]::before,
    .panel-tabs .panel-tab[data-active="true"]::after {
      content: '';
      position: absolute;
      bottom: 0;
      width: 6px;
      height: 6px;
      pointer-events: none;
      transform: translateZ(0);
      backface-visibility: hidden;
      will-change: opacity;
      opacity: 0;
    }
    
    .panel-tabs .panel-tab[data-active="true"]::before {
      left: -6px;
      background: radial-gradient(circle at 0% 0%, transparent 6px, var(--panel-tabs-bg) 6px);
    }
    
    .panel-tabs .panel-tab[data-active="true"]::after {
      right: -6px;
      background: radial-gradient(circle at 100% 0%, transparent 6px, var(--panel-tabs-bg) 6px);
    }
    
    .panel-tabs .panel-tab[data-active="true"]:not([data-first="true"])::before,
    .panel-tabs .panel-tab[data-active="true"]:not([data-last="true"])::after {
      opacity: 1;
    }
    
    .panel-tabs {
      --panel-tabs-bg: white;
    }
    .dark .panel-tabs {
      --panel-tabs-bg: rgb(24, 24, 27);
    }
    
    /* View Transitions */
    ::view-transition-old(root),
    ::view-transition-new(root) {
      animation-duration: 100ms;
      animation-timing-function: ease-out;
    }
    
    @media (prefers-reduced-motion: reduce) {
      ::view-transition-old(root),
      ::view-transition-new(root) {
        animation: none;
      }
    }
  `;
  document.head.appendChild(style);
}

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

  // Store the width where we switched to compact mode
  const switchWidthRef = useRef<number>(0);

  // Inject styles once on mount
  useEffect(() => {
    injectStyles();
  }, []);

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
      if (typeof document !== "undefined" && "startViewTransition" in document) {
        document.startViewTransition(() => onValueChange(tabId));
      } else {
        onValueChange(tabId);
      }
    },
    [onValueChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, currentIndex: number) => {
      let nextIndex: number | null = null;
      switch (event.key) {
        case "ArrowLeft":
          nextIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
          break;
        case "ArrowRight":
          nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
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
                "panel-tab relative z-10 flex h-auto flex-1 items-center justify-center gap-1.5 py-[6px] text-sm font-medium transition-colors outline-none",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1",
                "min-w-0",
                iconOnly ? "px-2" : "px-4",
                isActive
                  ? "rounded-t-md bg-white text-gray-900 dark:bg-zinc-900 dark:text-zinc-100"
                  : [
                      "text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-300",
                      "isolation-auto before:absolute before:inset-x-1.5 before:inset-y-1 before:z-[-1] before:rounded-md before:bg-transparent before:transition-colors hover:before:bg-black/5 dark:hover:before:bg-white/5",
                    ],
                isActive &&
                  !isFirst &&
                  "before:absolute before:bottom-0 before:-left-[6px] before:size-[6px] before:bg-[radial-gradient(circle_at_0%_0%,transparent_6px,white_6px)] dark:before:bg-[radial-gradient(circle_at_0%_0%,transparent_6px,rgb(24,24,27)_6px)]",
                isActive &&
                  !isLast &&
                  "after:absolute after:-right-[6px] after:bottom-0 after:size-[6px] after:bg-[radial-gradient(circle_at_100%_0%,transparent_6px,white_6px)] dark:after:bg-[radial-gradient(circle_at_100%_0%,transparent_6px,rgb(24,24,27)_6px)]",
              )}
            >
              {tab.icon && <tab.icon className={iconOnly ? "size-4 shrink-0" : "size-3.5 shrink-0"} />}
              {!iconOnly && <span className="tab-label truncate">{tab.label}</span>}
              {tab.statusContent}
            </button>
          );
        })}
      </div>
    </div>
  );
}
