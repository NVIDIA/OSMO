/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useViewportBoundaries - Viewport management for ReactFlow DAGs.
 *
 * ARCHITECTURE:
 * - translateExtent uses CONTAINER dims by default (stable, follows CSS gradually)
 * - When animating: translateExtent uses FROZEN TARGET dims (stable, matches animation)
 * - Animation targeting always uses TARGET dims (expected final position)
 *
 * WHY THIS PREVENTS STUTTER:
 * - State change → targetDims updates immediately
 * - BUT translateExtent uses containerDims (unchanged yet) → NO JUMP
 * - Effect runs → freeze dims to targetDims
 * - Now translateExtent uses frozen targetDims (same as animation target)
 * - d3-zoom's per-frame constraining is stable → SMOOTH
 * - Animation completes → unfreeze
 * - translateExtent uses containerDims again (now at final size)
 *
 * DETERMINISTIC COORDINATION via Barrier Pattern (like WaitGroup/Semaphore):
 *
 * Explicit state machine with readiness signals:
 *   Signal 1: dimensionsReady (container measured via useResizeObserver)
 *   Signal 2: layoutReady (ELK calculation complete)
 *
 * Coordination Effect (Barrier):
 *   useEffect(() => {
 *     if (dimensionsReady && layoutReady) {
 *       executeCentering();  // Only when ALL signals true
 *     }
 *   }, [readinessState]);
 *
 * Flow (order-independent):
 *   ┌─────────────────┐     ┌─────────────────┐
 *   │ Signal 1 fires  │     │ Signal 2 fires  │
 *   │ (any order)     │     │ (any order)     │
 *   └────────┬────────┘     └────────┬────────┘
 *            │                       │
 *            └───────┬───────────────┘
 *                    ▼
 *           ┌─────────────────┐
 *           │ Barrier Effect  │
 *           │ Checks: both?   │
 *           └────────┬────────┘
 *                    │
 *              Both Ready? ──Yes──> executeCentering()
 *                    │
 *                   No
 *                    │
 *                  Wait
 *
 * Benefits:
 * - Pure state machine (no callback chains)
 * - React batches state updates automatically
 * - Order-independent (true barrier semantics)
 * - Easy to reason about (declarative)
 * - Same behavior dev/prod/slow/fast
 *
 * PERFORMANCE:
 * - Uses `useSyncedRef` for stable callback references
 * - Memoizes all derived values
 * - Debounces window resize to avoid layout thrashing
 * - Animation generation tracking prevents stale callbacks
 */

"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useReactFlow, type CoordinateExtent, type Node, type Viewport } from "@xyflow/react";
import { useResizeObserver, useEventCallback } from "usehooks-ts";
import { useIsomorphicLayoutEffect } from "@react-hookz/web";
import { clamp } from "@/lib/utils";
import { VIEWPORT, ANIMATION, NODE_DEFAULTS } from "../constants";
import type { LayoutDirection } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface Dimensions {
  width: number;
  height: number;
}

export interface NodeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  fitAllZoom: number;
}

export interface UseViewportBoundariesOptions {
  nodeBounds: NodeBounds;
  containerRef: RefObject<HTMLDivElement | null>;
  selectedNodeId?: string | null;
  nodes: Node[];
  layoutDirection: LayoutDirection;
  rootNodeIds: string[];
  initialSelectedNodeId?: string | null;
  /**
   * Optional: Returns expected final dimensions after CSS transitions complete.
   * Enables smooth single-animation transitions (visual polish).
   * If not provided, uses container dimensions from useResizeObserver.
   */
  getTargetDimensions?: () => Dimensions;
  reCenterTrigger?: number;
  /** When true→false, layout is complete and centering can occur. */
  isLayouting?: boolean;
  /** When true, centering on dimension changes is suppressed (prevents jitter). */
  isDragging?: boolean;
}

export interface ViewportBoundariesResult {
  translateExtent: CoordinateExtent | undefined;
}

// ============================================================================
// Pure Logic (Library Exports for Testing)
// ============================================================================

/**
 * Calculate the viewport coordinate required to center a specific node.
 */
export function calculateCenteringViewport(
  node: Node,
  nodeBounds: NodeBounds,
  containerDims: Dimensions,
  zoom: number,
): Viewport {
  const data = node.data as Record<string, unknown> | undefined;
  const nw = (data?.nodeWidth as number) || NODE_DEFAULTS.width;
  const nh = (data?.nodeHeight as number) || NODE_DEFAULTS.height;
  const cx = node.position.x + nw / 2;
  const cy = node.position.y + nh / 2;

  const hw = containerDims.width / 2;
  const hh = containerDims.height / 2;

  // Raw centering
  const targetVp = {
    x: hw - cx * zoom,
    y: hh - cy * zoom,
    zoom,
  };

  // Clamp using node bounds to ensure we don't center "too far" out
  const minX = hw - nodeBounds.maxX * zoom;
  const maxX = hw - nodeBounds.minX * zoom;
  const minY = hh - nodeBounds.maxY * zoom;
  const maxY = hh - nodeBounds.minY * zoom;

  return {
    x: minX > maxX ? (minX + maxX) / 2 : clamp(targetVp.x, minX, maxX),
    y: minY > maxY ? (minY + maxY) / 2 : clamp(targetVp.y, minY, maxY),
    zoom,
  };
}

/**
 * Clamp a viewport to ensure it doesn't show areas outside the translateExtent.
 * Matches d3-zoom's internal constraint formula.
 */
export function clampToTranslateExtent(vp: Viewport, containerDims: Dimensions, nodeBounds: NodeBounds): Viewport {
  const { width: dW, height: dH } = containerDims;
  const px = dW / 2;
  const py = dH / 2;

  // Calculate extent: [ [minX - px, minY - py], [maxX + px, maxY + py] ]
  const minEx = nodeBounds.minX - px;
  const maxEx = nodeBounds.maxX + px;
  const minEy = nodeBounds.minY - py;
  const maxEy = nodeBounds.maxY + py;

  // d3-zoom formula: viewport.x must be in [width - maxX × zoom, -minX × zoom]
  const validMinX = dW - maxEx * vp.zoom;
  const validMaxX = -minEx * vp.zoom;
  const validMinY = dH - maxEy * vp.zoom;
  const validMaxY = -minEy * vp.zoom;

  return {
    x: validMinX > validMaxX ? (validMinX + validMaxX) / 2 : clamp(vp.x, validMinX, validMaxX),
    y: validMinY > validMaxY ? (validMinY + validMaxY) / 2 : clamp(vp.y, validMinY, validMaxY),
    zoom: vp.zoom,
  };
}

/**
 * Hysteresis decision: should we update the effective boundaries immediately?
 */
export function shouldUpdateBoundariesImmediately(currentTarget: Dimensions, effective: Dimensions): boolean {
  // Grow immediately to avoid clipping
  return currentTarget.width > effective.width || currentTarget.height > effective.height;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useViewportBoundaries({
  nodeBounds,
  containerRef,
  selectedNodeId = null,
  nodes,
  layoutDirection,
  rootNodeIds,
  initialSelectedNodeId,
  getTargetDimensions,
  reCenterTrigger = 0,
  isLayouting = false,
  isDragging = false,
}: UseViewportBoundariesOptions): ViewportBoundariesResult {
  const reactFlowInstance = useReactFlow();

  // ---------------------------------------------------------------------------
  // Dimensions & Resize Observation
  // ---------------------------------------------------------------------------

  const { width: containerWidth = VIEWPORT.ESTIMATED_WIDTH, height: containerHeight = VIEWPORT.ESTIMATED_HEIGHT } =
    useResizeObserver({ ref: containerRef as React.RefObject<HTMLElement>, box: "border-box" });

  const containerDims: Dimensions = useMemo(
    () => ({ width: containerWidth, height: containerHeight }),
    [containerWidth, containerHeight],
  );

  const targetDims: Dimensions = useMemo(
    () => getTargetDimensions?.() ?? containerDims,
    [getTargetDimensions, containerDims],
  );

  // ---------------------------------------------------------------------------
  // Boundary Hysteresis Pattern
  // ---------------------------------------------------------------------------

  const [effectiveDims, setEffectiveDims] = useState<Dimensions>(targetDims);

  // We use useIsomorphicLayoutEffect here because we are synchronizing
  // state (effectiveDims) with other state/props (targetDims).
  // React 19 rules (and standard linting) prefer separating the synchronous
  // "grow immediately" path from the asynchronous "shrink later" path.
  useIsomorphicLayoutEffect(() => {
    if (shouldUpdateBoundariesImmediately(targetDims, effectiveDims)) {
      setEffectiveDims(targetDims);
    }
  }, [targetDims, effectiveDims]);

  useEffect(() => {
    if (
      !shouldUpdateBoundariesImmediately(targetDims, effectiveDims) &&
      (targetDims.width !== effectiveDims.width || targetDims.height !== effectiveDims.height)
    ) {
      const timer = setTimeout(() => {
        setEffectiveDims(targetDims);
      }, ANIMATION.PANEL_TRANSITION + 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [targetDims, effectiveDims]);

  const translateExtent = useMemo((): CoordinateExtent | undefined => {
    if (!effectiveDims.width || !effectiveDims.height) return undefined;
    const px = effectiveDims.width / 2;
    const py = effectiveDims.height / 2;
    return [
      [nodeBounds.minX - px, nodeBounds.minY - py],
      [nodeBounds.maxX + px, nodeBounds.maxY + py],
    ];
  }, [effectiveDims, nodeBounds]);

  // ---------------------------------------------------------------------------
  // Refs & Initialization State
  // ---------------------------------------------------------------------------

  const hasInitializedRef = useRef(false);
  const hasHandledInitialSelectionRef = useRef(false);
  const prevLayoutDirectionRef = useRef(layoutDirection);
  const prevReCenterTriggerRef = useRef(reCenterTrigger);

  // ---------------------------------------------------------------------------
  // Viewport Actions (Stable Callbacks)
  // ---------------------------------------------------------------------------

  const performCentering = useEventCallback((nodeId: string, zoom: number, duration: number) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const targetVp = calculateCenteringViewport(node, nodeBounds, targetDims, zoom);

    reactFlowInstance.setViewport(targetVp, { duration }).then(() => {
      // Safety sync to ensure alignment with d3-zoom constraints
      requestAnimationFrame(() => {
        const currentVp = reactFlowInstance.getViewport();
        const finalVp = clampToTranslateExtent(currentVp, targetDims, nodeBounds);

        if (Math.abs(currentVp.x - finalVp.x) > 0.5 || Math.abs(currentVp.y - finalVp.y) > 0.5) {
          reactFlowInstance.setViewport(finalVp, { duration: 0 });
        }
      });
    });
  });

  const performClamping = useEventCallback((duration: number) => {
    const vp = reactFlowInstance.getViewport();
    const clampedVp = clampToTranslateExtent(vp, targetDims, nodeBounds);
    reactFlowInstance.setViewport(clampedVp, { duration });
  });

  // ---------------------------------------------------------------------------
  // Readiness Barrier (Deterministic Convergence)
  // ---------------------------------------------------------------------------

  const isReady = !isLayouting && nodes.length > 0 && containerWidth > 100 && containerHeight > 100;

  useEffect(() => {
    if (!isReady) return;

    // CASE 1: Initial load centering
    if (!hasInitializedRef.current) {
      const targetId =
        initialSelectedNodeId && !hasHandledInitialSelectionRef.current
          ? initialSelectedNodeId
          : rootNodeIds.length > 0
            ? rootNodeIds[0]
            : null;

      if (targetId) {
        performCentering(targetId, VIEWPORT.INITIAL_ZOOM, ANIMATION.INITIAL_DURATION);
        if (targetId === initialSelectedNodeId) hasHandledInitialSelectionRef.current = true;
        hasInitializedRef.current = true;
        prevLayoutDirectionRef.current = layoutDirection;
      }
      return;
    }

    // CASE 2: Layout Direction Change
    if (prevLayoutDirectionRef.current !== layoutDirection) {
      prevLayoutDirectionRef.current = layoutDirection;
      if (rootNodeIds.length > 0) {
        performCentering(rootNodeIds[0], VIEWPORT.INITIAL_ZOOM, ANIMATION.VIEWPORT_DURATION);
      }
      return;
    }

    // CASE 3: Explicit re-center trigger (Panel changes, etc.)
    if (prevReCenterTriggerRef.current !== reCenterTrigger) {
      prevReCenterTriggerRef.current = reCenterTrigger;
      if (selectedNodeId) {
        performCentering(selectedNodeId, reactFlowInstance.getViewport().zoom, ANIMATION.PANEL_TRANSITION);
      } else {
        performClamping(ANIMATION.PANEL_TRANSITION);
      }
      return;
    }

    // CASE 4: Dimensions change (Window resize / Panel resize)
    if (!isDragging) {
      performClamping(ANIMATION.BOUNDARY_ENFORCE);
    }
  }, [
    isReady,
    layoutDirection,
    reCenterTrigger,
    containerDims.width,
    containerDims.height,
    isDragging,
    initialSelectedNodeId,
    performCentering,
    performClamping,
    reactFlowInstance,
    rootNodeIds,
    selectedNodeId,
  ]);

  return { translateExtent };
}
