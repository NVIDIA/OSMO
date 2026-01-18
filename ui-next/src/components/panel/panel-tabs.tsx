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
  compactBreakpoint?: number;
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

export function PanelTabs({
  tabs,
  value,
  onValueChange,
  iconOnly: iconOnlyProp,
  compactBreakpoint = 280,
  className,
}: PanelTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);

  // Inject styles once on mount
  useEffect(() => {
    injectStyles();
  }, []);

  // Auto-detect compact mode based on container width
  useEffect(() => {
    if (iconOnlyProp !== undefined) return; // Skip if explicitly controlled

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsCompact(entry.contentRect.width < compactBreakpoint);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [iconOnlyProp, compactBreakpoint]);

  const iconOnly = iconOnlyProp ?? isCompact;

  const handleTabChange = useCallback(
    (tabId: string) => {
      // Use View Transitions API if available
      if (
        typeof document !== "undefined" &&
        "startViewTransition" in document &&
        typeof document.startViewTransition === "function"
      ) {
        document.startViewTransition(() => {
          onValueChange(tabId);
        });
      } else {
        onValueChange(tabId);
      }
    },
    [onValueChange],
  );

  // Keyboard navigation
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
        // Focus the new tab
        const tabList = containerRef.current?.querySelector('[role="tablist"]');
        const buttons = tabList?.querySelectorAll('button[role="tab"]');
        (buttons?.[nextIndex] as HTMLButtonElement)?.focus();
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
                iconOnly ? "px-2" : "px-4",
                isActive
                  ? "rounded-t-md bg-white text-gray-900 dark:bg-zinc-900 dark:text-zinc-100"
                  : "text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-300",
              )}
            >
              {tab.icon && <tab.icon className={iconOnly ? "size-4" : "size-3.5"} />}
              {!iconOnly && <span>{tab.label}</span>}
              {tab.statusContent}
            </button>
          );
        })}
      </div>
    </div>
  );
}
