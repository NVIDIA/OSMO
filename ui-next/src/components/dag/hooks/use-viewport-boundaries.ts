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
 * PERFORMANCE:
 * - Uses `useSyncedRef` for stable callback references
 * - Memoizes all derived values
 * - Debounces window resize to avoid layout thrashing
 * - Animation generation tracking prevents stale callbacks
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useReactFlow, type CoordinateExtent, type Node, type Viewport } from "@xyflow/react";
import { useSyncedRef } from "@react-hookz/web";
import { useResizeObserver, useDebounceCallback } from "usehooks-ts";
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
}

export interface ViewportBoundariesResult {
  translateExtent: CoordinateExtent | undefined;
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
}: UseViewportBoundariesOptions): ViewportBoundariesResult {
  const reactFlowInstance = useReactFlow();

  // ---------------------------------------------------------------------------
  // O(1) Node Lookup Map
  // ---------------------------------------------------------------------------

  /** Map for O(1) node lookup by ID. Rebuilt when nodes array changes. */
  const nodeMap = useMemo(() => {
    const map = new Map<string, Node>();
    for (const node of nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [nodes]);

  // ---------------------------------------------------------------------------
  // Container Dimensions (from DOM, updates gradually during CSS transitions)
  // Used for translateExtent to follow the actual container size
  // ---------------------------------------------------------------------------

  const { width: containerWidth = VIEWPORT.ESTIMATED_WIDTH, height: containerHeight = VIEWPORT.ESTIMATED_HEIGHT } =
    useResizeObserver({ ref: containerRef as React.RefObject<HTMLElement>, box: "border-box" });

  // ---------------------------------------------------------------------------
  // Synced Refs (stable references for callbacks)
  // ---------------------------------------------------------------------------

  const nodeBoundsRef = useSyncedRef(nodeBounds);
  const nodeMapRef = useSyncedRef(nodeMap);
  const selectedNodeIdRef = useSyncedRef(selectedNodeId);

  // ---------------------------------------------------------------------------
  // Dimensions: Two sources with freeze mechanism
  // ---------------------------------------------------------------------------
  // Container dims: from useResizeObserver, updates gradually during CSS transitions
  // Target dims: from getTargetDimensions, updates immediately to expected final size
  //
  // translateExtent uses:
  //   - frozenDims (when animating) → stable, matches animation target
  //   - containerDims (when not animating) → stable, follows CSS gradually
  //
  // Animation targeting uses: targetDims (always expected final position)

  const containerDims: Dimensions = useMemo(
    () => ({ width: containerWidth, height: containerHeight }),
    [containerWidth, containerHeight],
  );

  const targetDims: Dimensions = useMemo(
    () => getTargetDimensions?.() ?? containerDims,
    [getTargetDimensions, containerDims],
  );
  const targetDimsRef = useSyncedRef(targetDims);

  // Frozen dims: set to targetDims when animation starts, null otherwise
  const [frozenDims, setFrozenDims] = useState<Dimensions | null>(null);

  // translateExtent uses: frozen (during animation) OR container (stable default)
  const extentDims: Dimensions = frozenDims ?? containerDims;

  // ---------------------------------------------------------------------------
  // Tracking Refs
  // ---------------------------------------------------------------------------

  const hasInitializedRef = useRef(false);
  const prevLayoutDirectionRef = useRef(layoutDirection);
  const hasHandledInitialSelectionRef = useRef(false);
  const prevReCenterTriggerRef = useRef(reCenterTrigger);
  const isAnimatingRef = useRef(false);
  const animationGenerationRef = useRef(0);
  const prevIsLayoutingRef = useRef(isLayouting);

  // ---------------------------------------------------------------------------
  // Core Functions: Extent Calculation
  // ---------------------------------------------------------------------------

  /** Calculate translateExtent bounds from dimensions and node bounds (pure function). */
  const calcExtentPure = useCallback((d: Dimensions, b: NodeBounds): CoordinateExtent | undefined => {
    if (!b || !d.width || !d.height) return undefined;

    // Use zoom=1.0 as reference (most common user zoom level).
    // At zoom=1: perfect centering, minimal whitespace.
    // At low zoom: edge nodes may not fully center (acceptable - whole DAG visible anyway).
    // At high zoom: slight extra panning room (acceptable trade-off).
    const px = d.width / 2;
    const py = d.height / 2;

    return [
      [b.minX - px, b.minY - py],
      [b.maxX + px, b.maxY + py],
    ];
  }, []);

  /** Calculate extent using current nodeBounds ref (for use in callbacks). */
  const calcExtent = useCallback(
    (d: Dimensions): CoordinateExtent | undefined => calcExtentPure(d, nodeBoundsRef.current),
    [calcExtentPure, nodeBoundsRef],
  );

  // ---------------------------------------------------------------------------
  // translateExtent: Pan boundaries for d3-zoom
  // ---------------------------------------------------------------------------
  // Uses extentDims which is:
  //   - frozenDims during animation (stable, matches animation target)
  //   - containerDims otherwise (stable, no jump when targetDims changes)

  const translateExtent = useMemo(
    (): CoordinateExtent | undefined => calcExtentPure(extentDims, nodeBounds),
    [calcExtentPure, extentDims, nodeBounds],
  );

  // ---------------------------------------------------------------------------
  // Core Functions: Viewport Operations
  // ---------------------------------------------------------------------------

  /**
   * Clamp viewport to match d3-zoom's translateExtent constraint.
   * d3-zoom formula (from source): ensures viewport doesn't show area outside translateExtent.
   * Valid range: [width - extent.maxX × zoom, -extent.minX × zoom]
   */
  const clampToTranslateExtent = useCallback((vp: Viewport, d: Dimensions, extent: CoordinateExtent): Viewport => {
    // d3-zoom constrains so visible area stays within translateExtent
    // Formula: viewport.x must be in [width - maxX × zoom, -minX × zoom]
    const validMinX = d.width - extent[1][0] * vp.zoom;
    const validMaxX = -extent[0][0] * vp.zoom;
    const validMinY = d.height - extent[1][1] * vp.zoom;
    const validMaxY = -extent[0][1] * vp.zoom;

    // When container is larger than content (validMin > validMax), d3-zoom centers
    // the content instead of clamping. This matches d3-zoom's constrain behavior:
    // `dx1 > dx0 ? (dx0 + dx1) / 2 : Math.min(0, dx0) || Math.max(0, dx1)`
    const clampedX = validMinX > validMaxX ? (validMinX + validMaxX) / 2 : clamp(vp.x, validMinX, validMaxX);
    const clampedY = validMinY > validMaxY ? (validMinY + validMaxY) / 2 : clamp(vp.y, validMinY, validMaxY);

    return {
      x: clampedX,
      y: clampedY,
      zoom: vp.zoom,
    };
  }, []);

  /**
   * Clamp viewport for node centering (zoom-aware).
   * Uses the same inverted-bounds handling as clampToTranslateExtent for consistency.
   * When container > content at current zoom, centers the content.
   */
  const clampViewportForCentering = useCallback(
    (vp: Viewport, d: Dimensions): Viewport => {
      const b = nodeBoundsRef.current;
      const hw = d.width / 2;
      const hh = d.height / 2;

      // Centering bounds: where any node can be centered
      const minX = hw - b.maxX * vp.zoom;
      const maxX = hw - b.minX * vp.zoom;
      const minY = hh - b.maxY * vp.zoom;
      const maxY = hh - b.minY * vp.zoom;

      // Handle inverted bounds (container > content at current zoom) by centering
      const clampedX = minX > maxX ? (minX + maxX) / 2 : clamp(vp.x, minX, maxX);
      const clampedY = minY > maxY ? (minY + maxY) / 2 : clamp(vp.y, minY, maxY);

      return { x: clampedX, y: clampedY, zoom: vp.zoom };
    },
    [nodeBoundsRef],
  );

  /** Animate viewport, freezing dims so translateExtent stays stable during animation. */
  const animateViewport = useCallback(
    (viewport: Viewport, duration: number) => {
      // Freeze dims to TARGET values - this freezes BOTH:
      // 1. translateExtent (prevents d3-zoom per-frame fighting)
      // 2. Animation target (prevents re-targeting mid-flight)
      setFrozenDims(targetDimsRef.current);
      isAnimatingRef.current = true;
      const gen = ++animationGenerationRef.current;

      reactFlowInstance.setViewport(viewport, { duration }).then(() => {
        if (animationGenerationRef.current === gen) {
          isAnimatingRef.current = false;
          // Unfreeze - translateExtent will now use targetDims (which should match container)
          setFrozenDims(null);
        }
      });
    },
    [reactFlowInstance, targetDimsRef],
  );

  /** Center viewport on a node (uses zoom-aware clamping for precise centering). */
  const centerOnNode = useCallback(
    (nodeId: string, zoom: number, duration: number, d: Dimensions): boolean => {
      const node = nodeMapRef.current.get(nodeId);
      if (!node) return false;

      const data = node.data as Record<string, unknown> | undefined;
      const nw = (data?.nodeWidth as number) || NODE_DEFAULTS.width;
      const nh = (data?.nodeHeight as number) || NODE_DEFAULTS.height;
      const cx = node.position.x + nw / 2;
      const cy = node.position.y + nh / 2;

      const target = clampViewportForCentering({ x: d.width / 2 - cx * zoom, y: d.height / 2 - cy * zoom, zoom }, d);
      animateViewport(target, duration);
      return true;
    },
    [nodeMapRef, clampViewportForCentering, animateViewport],
  );

  /**
   * Clamp current viewport to valid bounds using d3-zoom's exact formula.
   * Uses target dimensions for calculating the clamp position (expected final state).
   * ALWAYS animates to ensure ReactFlow's internal state is synchronized.
   */
  const clampCurrentViewport = useCallback(
    (duration: number) => {
      const d = targetDimsRef.current;
      const extent = calcExtent(d);
      if (!extent) return;

      const currentVp = reactFlowInstance.getViewport();
      // Use d3-zoom's exact translateExtent clamping formula with target dims
      const clampedVp = clampToTranslateExtent(currentVp, d, extent);

      // ALWAYS animate to clamped position.
      // This syncs ReactFlow's internal viewport state with our calculated bounds,
      // preventing d3-zoom from "correcting" the viewport later during user interaction.
      animateViewport(clampedVp, duration);
    },
    [reactFlowInstance, targetDimsRef, calcExtent, clampToTranslateExtent, animateViewport],
  );

  /** Get target dimensions for animation (reads from ref for callbacks). */
  const getTargetDimsForAnimation = useCallback((): Dimensions => targetDimsRef.current, [targetDimsRef]);

  // ---------------------------------------------------------------------------
  // Effects: Re-center/Clamp Triggers
  // ---------------------------------------------------------------------------

  // On reCenterTrigger change (panel/sidebar toggle)
  useEffect(() => {
    const prev = prevReCenterTriggerRef.current;
    if (prev === reCenterTrigger) return;
    prevReCenterTriggerRef.current = reCenterTrigger;

    // Don't recenter before initial layout is complete
    if (!hasInitializedRef.current) return;
    if (isAnimatingRef.current) return;

    if (selectedNodeId) {
      const d = getTargetDimsForAnimation();
      centerOnNode(selectedNodeId, reactFlowInstance.getViewport().zoom, ANIMATION.PANEL_TRANSITION, d);
    } else {
      clampCurrentViewport(ANIMATION.PANEL_TRANSITION);
    }
  }, [
    reCenterTrigger,
    selectedNodeId,
    getTargetDimsForAnimation,
    centerOnNode,
    clampCurrentViewport,
    reactFlowInstance,
  ]);

  // On layout complete (isLayouting: true → false)
  useEffect(() => {
    const wasLayouting = prevIsLayoutingRef.current;
    prevIsLayoutingRef.current = isLayouting;

    if (!(wasLayouting && !isLayouting)) return; // Only on completion
    if (nodes.length === 0 || rootNodeIds.length === 0) return;

    const d = getTargetDimsForAnimation();

    // Initial load
    if (!hasInitializedRef.current) {
      if (initialSelectedNodeId && !hasHandledInitialSelectionRef.current) {
        hasHandledInitialSelectionRef.current = true;
        if (centerOnNode(initialSelectedNodeId, VIEWPORT.INITIAL_ZOOM, ANIMATION.INITIAL_DURATION, d)) {
          hasInitializedRef.current = true;
          prevLayoutDirectionRef.current = layoutDirection;
          return;
        }
      }
      centerOnNode(rootNodeIds[0], VIEWPORT.INITIAL_ZOOM, ANIMATION.INITIAL_DURATION, d);
      hasInitializedRef.current = true;
      prevLayoutDirectionRef.current = layoutDirection;
      return;
    }

    // Direction change
    if (prevLayoutDirectionRef.current !== layoutDirection) {
      prevLayoutDirectionRef.current = layoutDirection;
      centerOnNode(rootNodeIds[0], VIEWPORT.INITIAL_ZOOM, ANIMATION.VIEWPORT_DURATION, d);
    }
  }, [
    isLayouting,
    nodes.length,
    rootNodeIds,
    layoutDirection,
    initialSelectedNodeId,
    centerOnNode,
    getTargetDimsForAnimation,
  ]);

  // NOTE: Selection change centering is handled by the page via reCenterTrigger,
  // NOT here. This ensures centering happens AFTER panel state settles,
  // using correct dimensions. See page.tsx for the selection change effect.

  // ---------------------------------------------------------------------------
  // Window Resize Handler (debounced for performance)
  // ---------------------------------------------------------------------------
  // Uses debounce (not throttle) because we only need to recenter AFTER resize
  // completes. During resize, translateExtent handles bounds naturally.

  const handleWindowResize = useDebounceCallback(() => {
    if (isAnimatingRef.current) return;

    const sel = selectedNodeIdRef.current;

    if (sel) {
      centerOnNode(sel, reactFlowInstance.getViewport().zoom, ANIMATION.BOUNDARY_ENFORCE, getTargetDimsForAnimation());
    } else {
      clampCurrentViewport(ANIMATION.BOUNDARY_ENFORCE);
    }
  }, ANIMATION.RESIZE_THROTTLE_MS);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", handleWindowResize, { passive: true });
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [handleWindowResize]);

  return { translateExtent };
}
