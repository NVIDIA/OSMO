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
import { useStableCallback, useStableValue, useRafCallback } from "@/hooks";
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

  // Stable refs to avoid stale closures
  const minPctRef = useStableValue(minPct);
  const maxPctRef = useStableValue(maxPct);

  // Combined setter that also calls onResize
  const setPanelPct = useStableCallback((pct: number) => {
    setPanelPctState(pct);
    onResize?.(pct);
  });

  // RAF-throttled panel resize for 60fps smooth dragging
  const [schedulePanelResize] = useRafCallback(setPanelPct, { throttle: true });

  // Drag gesture handler
  // Performance optimizations:
  // - Container rect cached at drag start (avoids getBoundingClientRect during drag)
  // - Width updates RAF-throttled (buttery 60fps)
  const bindResizeHandle = useDrag(
    ({ active, xy: [x], first, last }) => {
      if (first) {
        setIsDragging(true);
        // Cache container rect to avoid repeated getBoundingClientRect calls (layout reflows)
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          containerRectRef.current = { left: rect.left, width: rect.width };
        }
      }

      if (active) {
        // Use cached container rect - no DOM read during drag
        const { left, width } = containerRectRef.current;
        const relativeX = x - left;
        // Panel is on the right side, so width = total - x position
        const pct = 100 - (relativeX / width) * 100;
        const clampedPct = Math.min(maxPctRef.current, Math.max(minPctRef.current, pct));
        schedulePanelResize(clampedPct);
      }

      if (last) {
        setIsDragging(false);
      }
    },
    {
      pointer: { touch: true },
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
