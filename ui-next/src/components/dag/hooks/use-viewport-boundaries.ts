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
 * - Padding is dynamic (containerWidth/2, containerHeight/2) to ensure any node can be centered
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

import { useEffect, useMemo, useRef, useState, useEffectEvent, type RefObject } from "react";
import { useReactFlow, type CoordinateExtent, type Node, type Viewport } from "@xyflow/react";
import { useResizeObserver } from "usehooks-ts";
import { useIsomorphicLayoutEffect } from "@react-hookz/web";
import { clamp } from "@/lib/utils";
import { VIEWPORT, ANIMATION, NODE_DEFAULTS } from "../constants";
import type { LayoutDirection } from "../types";
import { dagDebug } from "../lib/dag-debug";

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
  const nw = (data?.nodeWidth as number) ?? NODE_DEFAULTS.width;
  const nh = (data?.nodeHeight as number) ?? NODE_DEFAULTS.height;
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

  // Dynamic padding: half the container size allows any node to be centered
  const padX = containerDims.width / 2;
  const padY = containerDims.height / 2;
  const validMinX = containerDims.width - (nodeBounds.maxX + padX) * zoom;
  const validMaxX = -(nodeBounds.minX - padX) * zoom;
  const validMinY = containerDims.height - (nodeBounds.maxY + padY) * zoom;
  const validMaxY = -(nodeBounds.minY - padY) * zoom;

  return {
    x: validMinX > validMaxX ? (validMinX + validMaxX) / 2 : clamp(targetVp.x, validMinX, validMaxX),
    y: validMinY > validMaxY ? (validMinY + validMaxY) / 2 : clamp(targetVp.y, validMinY, validMaxY),
    zoom,
  };
}

/**
 * Clamp a viewport to ensure it doesn't show areas outside the translateExtent.
 * Matches d3-zoom's internal constraint formula.
 */
export function clampToTranslateExtent(vp: Viewport, containerDims: Dimensions, nodeBounds: NodeBounds): Viewport {
  const { width: dW, height: dH } = containerDims;

  // Calculate extent: [ [minX, minY], [maxX, maxY] ]
  // Dynamic padding: half the container size allows any node to be centered
  const padX = dW / 2;
  const padY = dH / 2;
  const minEx = nodeBounds.minX - padX;
  const maxEx = nodeBounds.maxX + padX;
  const minEy = nodeBounds.minY - padY;
  const maxEy = nodeBounds.maxY + padY;

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

  // Single hook handles both grow (sync) and shrink (delayed)
  // Using useIsomorphicLayoutEffect ensures synchronous grow before paint to prevent visual flash/clipping
  useIsomorphicLayoutEffect(() => {
    // CASE 1: GROW - Update immediately (synchronous, before paint)
    // Prevents visual flash/clipping when panel expands
    if (shouldUpdateBoundariesImmediately(targetDims, effectiveDims)) {
      dagDebug.log("DOM_RESIZE", { targetDims, effectiveDims, reason: "grow" });
      setEffectiveDims(targetDims);
      return; // No cleanup needed
    }

    // CASE 2: SHRINK - Schedule delayed update
    // Delays boundary tightening until AFTER animation completes (200ms)
    // This prevents viewport clamping mid-animation (the "settling" bug fix)
    if (targetDims.width !== effectiveDims.width || targetDims.height !== effectiveDims.height) {
      dagDebug.log("DOM_RESIZE", { targetDims, effectiveDims, reason: "shrink_scheduled" });
      const timer = setTimeout(() => {
        setEffectiveDims(targetDims);
      }, ANIMATION.PANEL_TRANSITION + 50); // 250ms = 200ms animation + 50ms buffer

      return () => clearTimeout(timer);
    }

    // CASE 3: No change - no-op
    return undefined;
  }, [targetDims, effectiveDims]);

  const translateExtent = useMemo((): CoordinateExtent | undefined => {
    if (!effectiveDims.width || !effectiveDims.height) return undefined;
    // Dynamic padding: half the container size allows any node to be centered
    const padX = effectiveDims.width / 2;
    const padY = effectiveDims.height / 2;
    return [
      [nodeBounds.minX - padX, nodeBounds.minY - padY],
      [nodeBounds.maxX + padX, nodeBounds.maxY + padY],
    ];
  }, [effectiveDims, nodeBounds]);

  // ---------------------------------------------------------------------------
  // Refs & Initialization State
  // ---------------------------------------------------------------------------

  const hasInitializedRef = useRef(false);
  const hasHandledInitialSelectionRef = useRef(false);
  const prevLayoutDirectionRef = useRef(layoutDirection);
  const prevReCenterTriggerRef = useRef(reCenterTrigger);
  const lastCenteringTimestampRef = useRef(0);
  const isCenteringRef = useRef(false);
  const targetZoomRef = useRef<number>(VIEWPORT.INITIAL_ZOOM);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Viewport Actions (Stable Callbacks)
  // ---------------------------------------------------------------------------

  const performCentering = useEffectEvent((nodeId: string, zoom: number, duration: number) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // Cancel any in-flight animation's cleanup callbacks
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    // Store the target zoom to avoid drift from interrupted animations
    targetZoomRef.current = zoom;
    isCenteringRef.current = true;

    dagDebug.log("VIEWPORT_ANIMATION_START", { nodeId, zoom, duration, reason: "centering", targetDims });
    const targetVp = calculateCenteringViewport(node, nodeBounds, targetDims, zoom);

    reactFlowInstance.setViewport(targetVp, { duration }).then(() => {
      // Skip cleanup if animation was cancelled
      if (signal.aborted) {
        dagDebug.log("VIEWPORT_ANIMATION_CANCELLED", { nodeId });
        return;
      }

      // Safety sync to ensure alignment with d3-zoom constraints
      requestAnimationFrame(() => {
        // Double-check abort status after RAF
        if (signal.aborted) return;

        const currentVp = reactFlowInstance.getViewport();
        const finalVp = clampToTranslateExtent(currentVp, targetDims, nodeBounds);

        if (Math.abs(currentVp.x - finalVp.x) > 0.5 || Math.abs(currentVp.y - finalVp.y) > 0.5) {
          reactFlowInstance.setViewport(finalVp, { duration: 0 });
        }

        isCenteringRef.current = false;
        dagDebug.log("VIEWPORT_ANIMATION_END", { nodeId });
      });
    });
  });

  const performClamping = useEffectEvent((duration: number, useTargetDimensions = false) => {
    const vp = reactFlowInstance.getViewport();
    // Use targetDims for re-center triggers (responsive to immediate changes)
    // Use effectiveDims for passive dimension changes (stable during transitions)
    const dimsForClamping = useTargetDimensions ? targetDims : effectiveDims;
    const clampedVp = clampToTranslateExtent(vp, dimsForClamping, nodeBounds);

    // FORCE ZOOM STABILITY: Explicitly set zoom to its current integer/target value
    // if it's drifting by a tiny amount, or just ensure we pass the current zoom
    // back in to prevent RF from "guessing" a new one during the transition.
    const targetZoom = Math.abs(vp.zoom - 1.0) < 0.01 ? 1.0 : vp.zoom;

    // Check if there's a meaningful position change
    const positionChanged = Math.abs(vp.x - clampedVp.x) > 0.5 || Math.abs(vp.y - clampedVp.y) > 0.5;

    if (positionChanged) {
      dagDebug.log("VIEWPORT_ANIMATION_START", {
        duration,
        reason: "clamping",
        zoom: targetZoom,
        drift: vp.zoom - targetZoom,
        dims: dimsForClamping,
        useTargetDimensions,
      });

      reactFlowInstance.setViewport({ ...clampedVp, zoom: targetZoom }, { duration }).then(() => {
        dagDebug.log("VIEWPORT_ANIMATION_END");
      });
    } else {
      // No position change needed, but log why
      dagDebug.log("CLAMPING_SKIPPED", {
        reason: "already_within_bounds",
        currentVp: vp,
        clampedVp,
        delta: { x: Math.abs(vp.x - clampedVp.x), y: Math.abs(vp.y - clampedVp.y) },
        dims: dimsForClamping,
        useTargetDimensions,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Readiness Barrier (Deterministic Convergence)
  // ---------------------------------------------------------------------------

  const isReady = !isLayouting && nodes.length > 0 && containerWidth > 100 && containerHeight > 100;

  useEffect(() => {
    if (isReady) {
      dagDebug.log("READINESS_SIGNAL", {
        message: "Viewport ready barrier met",
        isLayouting,
        nodeCount: nodes.length,
        containerWidth,
        containerHeight,
      });
    }
  }, [isReady, isLayouting, nodes.length, containerWidth, containerHeight]);

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
        dagDebug.log("CENTERING_START", { targetId, reason: "initial_load" });
        performCentering(targetId, VIEWPORT.INITIAL_ZOOM, ANIMATION.INITIAL_DURATION);
        lastCenteringTimestampRef.current = Date.now();
        if (targetId === initialSelectedNodeId) hasHandledInitialSelectionRef.current = true;
        hasInitializedRef.current = true;
        prevLayoutDirectionRef.current = layoutDirection;
        dagDebug.log("CENTERING_END", { targetId });
      }
      return;
    }

    // CASE 2: Layout Direction Change
    if (prevLayoutDirectionRef.current !== layoutDirection) {
      prevLayoutDirectionRef.current = layoutDirection;
      if (rootNodeIds.length > 0) {
        dagDebug.log("CENTERING_START", { targetId: rootNodeIds[0], reason: "layout_change" });
        performCentering(rootNodeIds[0], VIEWPORT.INITIAL_ZOOM, ANIMATION.VIEWPORT_DURATION);
        lastCenteringTimestampRef.current = Date.now();
        dagDebug.log("CENTERING_END", { targetId: rootNodeIds[0] });
      }
      return;
    }

    // CASE 3: Explicit re-center trigger (Panel changes, etc.)
    if (prevReCenterTriggerRef.current !== reCenterTrigger) {
      prevReCenterTriggerRef.current = reCenterTrigger;

      // Clear any pending debounced centering
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      if (selectedNodeId) {
        // Debounce centering operations to prevent zoom drift during rapid panel toggling
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null;
          dagDebug.log("AUTOPAN_START", { selectedNodeId, reason: "recenter_trigger" });
          // Use current viewport zoom to preserve user's zoom level when clicking nodes
          const currentZoom = reactFlowInstance.getViewport().zoom;
          performCentering(selectedNodeId, currentZoom, ANIMATION.PANEL_TRANSITION);
          lastCenteringTimestampRef.current = Date.now();
          dagDebug.log("AUTOPAN_END", { selectedNodeId });
        }, 100); // 100ms debounce window
      } else {
        // No debounce for clamping - we want immediate response to keep viewport in bounds
        // Use targetDims for responsive clamping during CSS transitions
        dagDebug.log("AUTOPAN_START", { reason: "clamping_trigger" });
        performClamping(ANIMATION.PANEL_TRANSITION, true);
        dagDebug.log("AUTOPAN_END");
      }

      return;
    }

    // CASE 4: Dimensions change (Window resize / Panel resize)
    // Skip if we're within the animation window after a centering operation
    const timeSinceLastCentering = Date.now() - lastCenteringTimestampRef.current;
    const isWithinCenteringAnimationWindow = timeSinceLastCentering < ANIMATION.PANEL_TRANSITION + 50;

    if (!isDragging && !isWithinCenteringAnimationWindow) {
      if (selectedNodeId) {
        // If a node is selected, center on it (consistent with CASE 3)
        // Use current viewport zoom to preserve user's zoom level
        dagDebug.log("AUTOPAN_START", { selectedNodeId, reason: "dimension_change" });
        const currentZoom = reactFlowInstance.getViewport().zoom;
        performCentering(selectedNodeId, currentZoom, ANIMATION.BOUNDARY_ENFORCE);
        lastCenteringTimestampRef.current = Date.now();
        dagDebug.log("AUTOPAN_END", { selectedNodeId });
      } else {
        // No node selected, just clamp viewport to keep it in bounds
        performClamping(ANIMATION.BOUNDARY_ENFORCE);
      }
    } else if (isWithinCenteringAnimationWindow) {
      dagDebug.log("DIMENSION_CHANGE_SKIPPED", {
        reason: "within_centering_animation_window",
        timeSinceLastCentering,
        threshold: ANIMATION.PANEL_TRANSITION + 50,
      });
    }
  }, [
    isReady,
    layoutDirection,
    reCenterTrigger,
    effectiveDims.width,
    effectiveDims.height,
    isDragging,
    initialSelectedNodeId,
    reactFlowInstance,
    rootNodeIds,
    selectedNodeId,
  ]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      // Cleanup any in-flight animation abort controller
      abortControllerRef.current?.abort();
    };
  }, []);

  return { translateExtent };
}
