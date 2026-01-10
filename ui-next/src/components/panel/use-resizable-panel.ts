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
 * useResizablePanel Hook
 *
 * Provides drag-to-resize functionality for right-side panels using @use-gesture/react.
 *
 * Features:
 * - Smooth dragging with RAF-throttled updates
 * - Percentage-based sizing
 * - Min/max constraints
 * - Optional persistence callback
 * - Touch support
 */

"use client";

import { useState, useRef } from "react";
import { useDrag } from "@use-gesture/react";
import { useStableCallback, useIsomorphicLayoutEffect } from "@/hooks";
import { PANEL } from "./panel-header-controls";

// ============================================================================
// Types
// ============================================================================

export interface UseResizablePanelOptions {
  /** Initial panel width as percentage (default: 50) */
  initialPct?: number;
  /** Minimum panel width as percentage (default: 20) */
  minPct?: number;
  /** Maximum panel width as percentage (default: 80) */
  maxPct?: number;
  /** Callback when panel is resized (for persistence) */
  onResize?: (pct: number) => void;
}

export interface UseResizablePanelReturn {
  /** Current panel width as percentage */
  panelPct: number;
  /** Set panel width (for programmatic resize / snap-to) */
  setPanelPct: (pct: number) => void;
  /** Whether the panel is currently being dragged */
  isDragging: boolean;
  /** Bind props for the resize handle element */
  bindResizeHandle: ReturnType<typeof useDrag>;
  /** Ref to attach to the container element */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for creating resizable right-side panels.
 *
 * @example
 * ```tsx
 * const { panelPct, isDragging, bindResizeHandle, containerRef } = useResizablePanel({
 *   initialPct: 50,
 *   onResize: (pct) => saveToLocalStorage(pct),
 * });
 *
 * return (
 *   <div ref={containerRef} className="relative flex">
 *     <div className="flex-1">Main content</div>
 *     <div {...bindResizeHandle()} className="resize-handle" />
 *     <div style={{ width: `${panelPct}%` }}>Panel</div>
 *   </div>
 * );
 * ```
 */
export function useResizablePanel({
  initialPct = PANEL.DEFAULT_WIDTH_PCT,
  minPct = PANEL.MIN_WIDTH_PCT,
  maxPct = PANEL.MAX_WIDTH_PCT,
  onResize,
}: UseResizablePanelOptions = {}): UseResizablePanelReturn {
  const [panelPct, setPanelPctState] = useState(initialPct);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Cache container rect at drag start to avoid layout reflows during drag
  const containerRectRef = useRef<{ left: number; width: number }>({ left: 0, width: 0 });

  // Refs synced via useLayoutEffect to ensure handlers have current values.
  // useLayoutEffect runs synchronously after render, before paint, ensuring
  // these are up-to-date before any gesture handlers execute.
  const minPctRef = useRef(minPct);
  const maxPctRef = useRef(maxPct);
  const panelPctRef = useRef(panelPct);

  // Sync refs in useIsomorphicLayoutEffect - runs synchronously after render, before paint
  // SSR-safe: falls back to useEffect on server to avoid hydration warnings
  useIsomorphicLayoutEffect(() => {
    minPctRef.current = minPct;
    maxPctRef.current = maxPct;
    panelPctRef.current = panelPct;
  }, [minPct, maxPct, panelPct]);

  // Combined setter that also calls onResize - direct update for immediate response
  const setPanelPct = useStableCallback((pct: number) => {
    setPanelPctState(pct);
    onResize?.(pct);
  });

  // Drag gesture handler
  //
  // CRITICAL DESIGN DECISIONS:
  // 1. NO bounds option - @use-gesture's bounds can cause unexpected behavior
  //    when pointer positions are constrained before our handler sees them
  // 2. Clamping happens in handler - we control the math, no library magic
  // 3. Skip redundant updates - don't call setPanelPct if value hasn't changed
  // 4. All refs synced synchronously during render phase (above)
  //
  const bindResizeHandle = useDrag(
    ({ active, xy: [x], first, last }) => {
      if (first) {
        setIsDragging(true);
        // Cache container rect to avoid repeated getBoundingClientRect calls
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          containerRectRef.current = { left: rect.left, width: rect.width };
        }
      }

      if (active) {
        const { left, width } = containerRectRef.current;
        if (width === 0) return; // Safety check

        const relativeX = x - left;
        // Panel is on the right side, so width = total - x position
        const rawPct = 100 - (relativeX / width) * 100;
        const clampedPct = Math.min(maxPctRef.current, Math.max(minPctRef.current, rawPct));

        // Only update if there's an actual change (avoids redundant updates on click)
        if (Math.abs(clampedPct - panelPctRef.current) > 0.01) {
          setPanelPct(clampedPct);
        }
      }

      if (last) {
        setIsDragging(false);
      }
    },
    {
      pointer: { touch: true },
      // NO bounds - we handle clamping ourselves for predictable behavior
    },
  );

  return {
    panelPct,
    setPanelPct,
    isDragging,
    bindResizeHandle,
    containerRef,
  };
}
