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

import { useEffect, useRef, useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEventCallback } from "usehooks-ts";
import { usePrevious } from "@react-hookz/web";
import { ResizeHandle } from "@/components/panel/resize-handle";
import { PANEL } from "@/components/panel/panel-header-controls";
import { useResizeDrag } from "@/components/panel/hooks/useResizeDrag";
import { usePanelEscape } from "@/components/panel/hooks/usePanelEscape";
import { useFocusReturn } from "@/components/panel/hooks/useFocusReturn";
import { usePanelAnimation } from "@/components/panel/hooks/usePanelAnimation";
import { PanelAnimationProvider } from "@/components/panel/panel-animation-context";
import "@/components/panel/resizable-panel.css";

// =============================================================================
// Types
// =============================================================================

export interface ResizablePanelProps {
  /** Whether the panel is open */
  open: boolean;
  /** Callback when panel should close (backdrop click, escape key) */
  onClose: () => void;
  /** Callback after panel slide-out animation completes (for cleanup) */
  onClosed?: () => void;
  /** Current width as percentage (0-100) */
  width: number;
  /** Callback when width changes during resize */
  onWidthChange: (width: number) => void;
  /** Minimum width percentage */
  minWidth?: number;
  /** Maximum width percentage */
  maxWidth?: number;
  /** Minimum width in pixels (prevents too-narrow panels) */
  minWidthPx?: number;
  /** Maximum width in pixels (prevents too-wide panels) */
  maxWidthPx?: number;
  /** Panel content */
  children: React.ReactNode;
  /** Main content to render behind the panel */
  mainContent: React.ReactNode;
  /** Whether to show a backdrop overlay (default: true) */
  backdrop?: boolean;
  /** Accessible label for the panel */
  "aria-label"?: string;
  /** Additional class for the panel */
  className?: string;

  // Collapsible mode
  /** Enable collapsible mode (panel can collapse to edge strip) */
  collapsible?: boolean;
  /** Whether the panel is currently collapsed (controlled) */
  isCollapsed?: boolean;
  /** Callback to toggle collapsed state */
  onToggleCollapsed?: () => void;
  /** Content to render when collapsed (slot for domain-specific content) */
  collapsedContent?: React.ReactNode;
  /** Width when collapsed (default: 40px) */
  collapsedWidth?: number | string;

  // Custom escape handling
  /** Custom escape key handler (overrides default close behavior for multi-layer navigation) */
  onEscapeKey?: () => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ResizablePanel - Container-scoped overlay panel with drag-to-resize.
 *
 * Features:
 * - Resizable width via drag handle (percentage of container)
 * - Optional backdrop with click-to-close
 * - Escape key to close (respects open dropdowns)
 * - Optional collapsible mode with edge strip
 * - Custom escape key handling for multi-layer navigation
 * - Deterministic, symmetric slide-in/out animation (CSS-driven sequencing)
 * - Accessible with proper ARIA attributes
 * - Respects prefers-reduced-motion
 *
 * Animation architecture (4-phase state machine):
 *   closed -> opening -> open -> closing -> closed
 *
 * On open, the panel slides in first, then content fades/slides in after an
 * 80ms CSS animation-delay. This stagger prevents the "transform storm" where
 * child layout calculations compete with the parent's GPU-accelerated slide.
 *
 * On close, content stays mounted and visible inside the panel. The panel
 * slides out as one visual unit (synchronized exit). Content unmounts only
 * after the panel's transitionend event fires.
 *
 * The content wrapper uses `contain: layout paint` to isolate rasterization
 * during the open stagger, so mounting complex children does not force the
 * panel's compositor layer to re-rasterize.
 *
 * @example
 * ```tsx
 * // With backdrop (default) - good for tables/lists
 * <ResizablePanel
 *   open={!!selectedItem}
 *   onClose={() => setSelectedItem(null)}
 *   width={panelWidth}
 *   onWidthChange={setPanelWidth}
 *   mainContent={<MainList />}
 *   aria-label={`Details for ${selectedItem?.name}`}
 * >
 *   <PanelContent item={selectedItem} />
 * </ResizablePanel>
 *
 * // Collapsible mode - panel collapses to edge strip instead of closing
 * <ResizablePanel
 *   open={true}
 *   onClose={handleClose}
 *   width={panelWidth}
 *   onWidthChange={setPanelWidth}
 *   mainContent={<DAGCanvas />}
 *   backdrop={false}
 *   collapsible
 *   isCollapsed={isCollapsed}
 *   onToggleCollapsed={toggleCollapsed}
 *   collapsedContent={<CollapsedStrip onExpand={toggleCollapsed} />}
 *   onEscapeKey={handleMultiLayerEscape}
 * >
 *   <DetailsPanel />
 * </ResizablePanel>
 * ```
 */
export function ResizablePanel({
  open,
  onClose,
  onClosed,
  width,
  onWidthChange,
  minWidth = PANEL.MIN_WIDTH_PCT,
  maxWidth = PANEL.MAX_WIDTH_PCT,
  minWidthPx = 320,
  maxWidthPx = 0,
  children,
  mainContent,
  backdrop = true,
  "aria-label": ariaLabel,
  className,
  // Collapsible mode
  collapsible = false,
  isCollapsed = false,
  onToggleCollapsed,
  collapsedContent,
  collapsedWidth = PANEL.COLLAPSED_WIDTH_PX,
  // Custom escape handling
  onEscapeKey,
}: ResizablePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Stable callbacks to prevent stale closures in effects and event handlers
  const stableOnClose = useEventCallback(onClose);
  const stableOnClosed = useEventCallback(onClosed ?? (() => {}));
  const stableOnEscapeKey = useEventCallback(onEscapeKey ?? onClose);

  const { isDragging, bindResizeHandle, dragStyles } = useResizeDrag({
    width,
    onWidthChange,
    minWidth,
    maxWidth,
    minWidthPx,
    maxWidthPx,
    containerRef,
    panelRef,
  });

  usePanelEscape({
    panelRef,
    onEscape: stableOnEscapeKey,
    enabled: open,
  });

  useFocusReturn({ open });

  // ---------------------------------------------------------------------------
  // Animation state machine (extracted to hook for React Compiler compatibility)
  // ---------------------------------------------------------------------------

  const {
    phase,
    shellMounted,
    contentMounted,
    panelSlideIn,
    contentState,
    contentRef,
    handleContentAnimationEnd,
    handlePanelTransitionEnd,
  } = usePanelAnimation(open, stableOnClosed);

  // ---------------------------------------------------------------------------
  // Focus management
  // ---------------------------------------------------------------------------

  const prevPhase = usePrevious(phase);
  useEffect(() => {
    const justOpened = prevPhase !== "open" && phase === "open";
    if (!justOpened || !panelRef.current) return;

    const panel = panelRef.current;
    if (panel.contains(document.activeElement)) return;

    // preventScroll: true avoids the browser auto-scrolling the overflow:hidden
    // container to reveal the focused element, which causes a visible content shift
    panel.focus({ preventScroll: true });
  }, [phase, prevPhase]);

  // ---------------------------------------------------------------------------
  // Panel width calculation
  // ---------------------------------------------------------------------------

  const effectiveCollapsed = collapsible && isCollapsed;

  let panelWidth: string;
  if (effectiveCollapsed) {
    panelWidth = typeof collapsedWidth === "number" ? `${collapsedWidth}px` : collapsedWidth;
  } else {
    panelWidth = `${width}%`;
  }

  const defaultCollapsedContent = useMemo(
    () =>
      onToggleCollapsed ? (
        <button
          onClick={onToggleCollapsed}
          className="flex h-full w-full items-center justify-center text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="Expand panel"
        >
          <ChevronLeft className="size-5" />
        </button>
      ) : null,
    [onToggleCollapsed],
  );

  const effectiveCollapsedContent = collapsedContent ?? defaultCollapsedContent;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden contain-strict"
    >
      {/* Main content - always full width */}
      <div className="h-full w-full contain-strict">{mainContent}</div>

      {/* Optional backdrop - absolute within container */}
      {backdrop && shellMounted && !effectiveCollapsed && (
        <div
          className={cn(
            "absolute inset-0 z-40 bg-white/80 transition-opacity duration-200 dark:bg-black/60",
            !panelSlideIn && "opacity-0",
          )}
          onClick={() => {
            // Don't close if we're in the middle of a resize drag
            if (!isDragging) {
              stableOnClose();
            }
          }}
          aria-hidden="true"
        />
      )}

      {/* Panel - absolute within container */}
      <aside
        ref={panelRef}
        className={cn(
          // Note: NO overflow-hidden here - allows resize handle to extend past left edge
          "contain-layout-style absolute inset-y-0 right-0 z-50 flex flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900",
          // Disable ALL transitions during drag for buttery smooth 60fps resizing
          isDragging
            ? "transition-none"
            : "transition-[transform,width] duration-200 ease-out motion-reduce:transition-none",
          className,
        )}
        style={{
          width: panelWidth,
          // Panel is at translateX(0) during opening and open phases.
          // On close (sliding-out), panelSlideIn becomes false, which sets
          // translateX(100%) and the CSS transition slides the panel off-screen.
          // Content stays mounted inside during the slide, creating a synchronized exit.
          transform: panelSlideIn ? "translateX(0)" : "translateX(100%)",
          // Force GPU compositing layer only when actively animating to prevent layout thrashing.
          // Reset to "auto" when closed to release the GPU memory.
          willChange: shellMounted ? "transform" : "auto",
          ...dragStyles,
          ...(effectiveCollapsed
            ? {}
            : {
                maxWidth: maxWidthPx > 0 ? `${maxWidthPx}px` : `${maxWidth}%`,
                minWidth: `${minWidthPx}px`,
              }),
        }}
        onTransitionEnd={handlePanelTransitionEnd}
        role="complementary"
        aria-label={ariaLabel}
        aria-hidden={shellMounted ? undefined : true}
        tabIndex={shellMounted ? -1 : undefined}
      >
        {/* Resize Handle - positioned at panel's left edge, inside panel for perfect sync during transitions */}
        {/* z-20 ensures handle appears above sticky header (z-10) for consistent edge visibility */}
        {shellMounted && !effectiveCollapsed && (
          <ResizeHandle
            bindResizeHandle={bindResizeHandle}
            isDragging={isDragging}
            className="absolute top-0 left-0 z-20 h-full -translate-x-1/2"
            aria-valuenow={width}
            aria-valuemin={minWidth}
            aria-valuemax={maxWidth}
          />
        )}

        {/* Collapsed content - visible when collapsed */}
        {collapsible && effectiveCollapsedContent && (
          <div
            className={cn(
              "absolute inset-0 overflow-hidden transition-opacity duration-200 ease-out",
              effectiveCollapsed ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            {effectiveCollapsedContent}
          </div>
        )}

        {/* Panel content wrapper
            - Content mounts ONE FRAME after shell via RAF (prevents transform storm).
            - Uses contain: strict during entering, then contain: layout paint.
              This isolates layout/paint from the panel's GPU layer during slide-in.
            - The data-content-state attribute drives CSS animations declaratively.
            - Content is mounted during opening (after RAF), open, AND closing phases
              so it visually exits with the panel as one unit.
            - Content unmounts only in the "closed" phase (after transitionend).
        */}
        {contentMounted && (
          <div
            ref={contentRef}
            className={cn(
              "resizable-panel-content contain-layout-paint flex h-full w-full flex-col overflow-hidden",
              // Always use contain: layout paint - no mode switching to prevent forced layout.
              // The wrapper has explicit dimensions (h-full w-full) so intrinsic sizing cannot leak.
              effectiveCollapsed && "pointer-events-none opacity-0",
            )}
            data-content-state={effectiveCollapsed ? "visible" : contentState}
            onAnimationEnd={handleContentAnimationEnd}
          >
            <PanelAnimationProvider value={{ phase }}>{children}</PanelAnimationProvider>
          </div>
        )}
      </aside>
    </div>
  );
}
