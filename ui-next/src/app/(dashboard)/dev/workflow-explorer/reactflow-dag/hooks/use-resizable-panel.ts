// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * useResizablePanel Hook
 *
 * Provides drag-to-resize functionality for panels with:
 * - RAF-throttled updates for 60fps smooth dragging
 * - Percentage-based sizing
 * - Min/max constraints
 * - Optional persistence via usePersistedState
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { PANEL } from "../constants";
import { usePersistedState } from "./use-persisted-state";

// ============================================================================
// Types
// ============================================================================

export interface UseResizablePanelOptions {
  /** Initial panel width as percentage (default: 50) */
  initialPct?: number;
  /** Minimum panel width as percentage (default: 25) */
  minPct?: number;
  /** Maximum panel width as percentage (default: 80) */
  maxPct?: number;
  /** Whether to persist the panel size (default: true) */
  persist?: boolean;
}

export interface UseResizablePanelReturn {
  /** Current panel width as percentage */
  panelPct: number;
  /** Set panel width (for programmatic resize / snap-to) */
  setPanelPct: (pct: number) => void;
  /** Whether the panel is currently being dragged */
  isDragging: boolean;
  /** Event handler for the resize handle's mousedown event */
  handleMouseDown: (e: React.MouseEvent) => void;
  /** Ref to attach to the container element */
  containerRef: React.RefObject<HTMLDivElement>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for creating resizable panels.
 *
 * Features:
 * - RAF-throttled mouse tracking for butter-smooth 60fps dragging
 * - Percentage-based sizing for responsive layouts
 * - Configurable min/max constraints
 * - Optional localStorage persistence
 * - Passive event listeners for scroll performance
 *
 * @example
 * ```tsx
 * const { panelPct, isDragging, handleMouseDown, containerRef } = useResizablePanel();
 *
 * return (
 *   <div ref={containerRef} className="relative flex">
 *     <div className="flex-1">Main content</div>
 *     <div
 *       className="resize-handle"
 *       onMouseDown={handleMouseDown}
 *     />
 *     <div style={{ width: `${panelPct}%` }}>Panel</div>
 *   </div>
 * );
 * ```
 */
export function useResizablePanel({
  initialPct = PANEL.DEFAULT_WIDTH_PCT,
  minPct = PANEL.MIN_WIDTH_PCT,
  maxPct = PANEL.MAX_WIDTH_PCT,
  persist = true,
}: UseResizablePanelOptions = {}): UseResizablePanelReturn {
  // Use persisted state if persistence is enabled, otherwise regular state
  const [persistedPanelPct, setPersistedPanelPct] = usePersistedState("panelPct", initialPct);
  const [localPanelPct, setLocalPanelPct] = useState(initialPct);

  const panelPct = persist ? persistedPanelPct : localPanelPct;
  const setPanelPct = persist ? setPersistedPanelPct : setLocalPanelPct;

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // RAF reference for throttling
  const rafRef = useRef<number | null>(null);
  const pendingPctRef = useRef<number | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    // RAF-throttled resize for 60fps smooth dragging
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      // Panel is on the right side, so width = total - x position
      const pct = 100 - (x / rect.width) * 100;
      pendingPctRef.current = Math.min(maxPct, Math.max(minPct, pct));

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          if (pendingPctRef.current !== null) {
            setPanelPct(pendingPctRef.current);
          }
          rafRef.current = null;
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    // Passive event listeners for better scroll performance
    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isDragging, minPct, maxPct, setPanelPct]);

  return {
    panelPct,
    setPanelPct,
    isDragging,
    handleMouseDown,
    containerRef,
  };
}
