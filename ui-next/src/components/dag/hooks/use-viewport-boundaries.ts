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
 * - Single source of truth for dimensions (used by translateExtent, clampViewport, centerOnNode)
 * - Dimensions frozen during animations to prevent stuttering
 * - Optional dependency injection for visual polish during CSS transitions
 *
 * DEPENDENCY INJECTION:
 * - `getTargetDimensions`: Optional function returning expected final dimensions
 *   → Enables smooth single-animation transitions during CSS transitions
 *   → If not provided, uses container dimensions (simpler, but may need correction after resize)
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useReactFlow, type CoordinateExtent, type Node, type Viewport } from "@xyflow/react";
import { useSyncedRef } from "@react-hookz/web";
import { useResizeObserver, useDebounceCallback } from "usehooks-ts";
import { clamp } from "@/lib/utils";
import { VIEWPORT, ANIMATION, VIEWPORT_THRESHOLDS, NODE_DEFAULTS } from "../constants";
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

  const nodeMap = useMemo(() => {
    const map = new Map<string, Node>();
    for (const node of nodes) map.set(node.id, node);
    return map;
  }, [nodes]);

  // ---------------------------------------------------------------------------
  // Container Dimensions (default source, used when getTargetDimensions not provided)
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
  // Dimensions: Single Source of Truth
  // ---------------------------------------------------------------------------
  // Priority: getTargetDimensions (injected) → container dimensions (default)
  // During animations: frozen to prevent stuttering

  const currentDims: Dimensions = useMemo(
    () => getTargetDimensions?.() ?? { width: containerWidth, height: containerHeight },
    [getTargetDimensions, containerWidth, containerHeight],
  );
  const currentDimsRef = useSyncedRef(currentDims);

  const [frozenDims, setFrozenDims] = useState<Dimensions | null>(null);
  const dims: Dimensions = frozenDims ?? currentDims;

  // ---------------------------------------------------------------------------
  // Tracking Refs
  // ---------------------------------------------------------------------------

  const hasInitializedRef = useRef(false);
  const prevLayoutDirectionRef = useRef(layoutDirection);
  const hasHandledInitialSelectionRef = useRef(false);
  const prevSelectionRef = useRef<string | null>(null);
  const prevReCenterTriggerRef = useRef(reCenterTrigger);
  const isAnimatingRef = useRef(false);
  const animationGenerationRef = useRef(0);
  const prevIsLayoutingRef = useRef(isLayouting);

  // ---------------------------------------------------------------------------
  // translateExtent: Pan boundaries for d3-zoom
  // ---------------------------------------------------------------------------

  const translateExtent = useMemo((): CoordinateExtent | undefined => {
    if (!nodeBounds || !dims.width || !dims.height) return undefined;

    // MAX_ZOOM padding = tightest bounds allowing edge nodes to be centered
    const px = dims.width / (2 * VIEWPORT.MAX_ZOOM);
    const py = dims.height / (2 * VIEWPORT.MAX_ZOOM);

    return [
      [nodeBounds.minX - px, nodeBounds.minY - py],
      [nodeBounds.maxX + px, nodeBounds.maxY + py],
    ];
  }, [nodeBounds, dims.width, dims.height]);

  // ---------------------------------------------------------------------------
  // Core Functions
  // ---------------------------------------------------------------------------

  /** Clamp viewport to valid bounds for given dimensions. */
  const clampViewport = useCallback(
    (vp: Viewport, d: Dimensions): Viewport => {
      const b = nodeBoundsRef.current;
      const hw = d.width / 2;
      const hh = d.height / 2;
      return {
        x: clamp(vp.x, hw - b.maxX * vp.zoom, hw - b.minX * vp.zoom),
        y: clamp(vp.y, hh - b.maxY * vp.zoom, hh - b.minY * vp.zoom),
        zoom: vp.zoom,
      };
    },
    [nodeBoundsRef],
  );

  /** Animate viewport, freezing dims during animation to prevent stuttering. */
  const animateViewport = useCallback(
    (viewport: Viewport, duration: number) => {
      // Freeze current target dims - translateExtent stays stable during animation
      setFrozenDims(currentDimsRef.current);
      isAnimatingRef.current = true;
      const gen = ++animationGenerationRef.current;

      reactFlowInstance.setViewport(viewport, { duration }).then(() => {
        if (animationGenerationRef.current === gen) {
          isAnimatingRef.current = false;
          setFrozenDims(null); // Unfreeze
        }
      });
    },
    [reactFlowInstance, currentDimsRef],
  );

  /** Center viewport on a node. */
  const centerOnNode = useCallback(
    (nodeId: string, zoom: number, duration: number, d: Dimensions): boolean => {
      const node = nodeMapRef.current.get(nodeId);
      if (!node) return false;

      const data = node.data as Record<string, unknown> | undefined;
      const nw = (data?.nodeWidth as number) || NODE_DEFAULTS.width;
      const nh = (data?.nodeHeight as number) || NODE_DEFAULTS.height;
      const cx = node.position.x + nw / 2;
      const cy = node.position.y + nh / 2;

      const target = clampViewport({ x: d.width / 2 - cx * zoom, y: d.height / 2 - cy * zoom, zoom }, d);
      animateViewport(target, duration);
      return true;
    },
    [nodeMapRef, clampViewport, animateViewport],
  );

  /** Clamp current viewport to bounds. forceAnimate freezes dims even if no movement needed. */
  const clampCurrentViewport = useCallback(
    (duration: number, d: Dimensions, forceAnimate = false) => {
      const current = reactFlowInstance.getViewport();
      const clamped = clampViewport(current, d);

      const dx = current.x - clamped.x;
      const dy = current.y - clamped.y;
      const needsMove = dx * dx + dy * dy > VIEWPORT_THRESHOLDS.MIN_ADJUSTMENT_DISTANCE_SQ;

      if (needsMove || forceAnimate) {
        animateViewport(clamped, duration);
      }
    },
    [reactFlowInstance, clampViewport, animateViewport],
  );

  /** Get current dimensions (reads from ref for callbacks). */
  const getDims = useCallback((): Dimensions => currentDimsRef.current, [currentDimsRef]);

  // ---------------------------------------------------------------------------
  // Effects: Re-center/Clamp Triggers
  // ---------------------------------------------------------------------------

  // On reCenterTrigger change (panel/sidebar toggle)
  useEffect(() => {
    if (prevReCenterTriggerRef.current === reCenterTrigger) return;
    prevReCenterTriggerRef.current = reCenterTrigger;
    if (isAnimatingRef.current) return;

    const d = getDims();
    const zoom = reactFlowInstance.getViewport().zoom;

    if (selectedNodeId) {
      centerOnNode(selectedNodeId, zoom, ANIMATION.PANEL_TRANSITION, d);
    } else {
      clampCurrentViewport(ANIMATION.PANEL_TRANSITION, d, true); // forceAnimate to freeze dims
    }
  }, [reCenterTrigger, selectedNodeId, getDims, centerOnNode, clampCurrentViewport, reactFlowInstance]);

  // On layout complete (isLayouting: true → false)
  useEffect(() => {
    const wasLayouting = prevIsLayoutingRef.current;
    prevIsLayoutingRef.current = isLayouting;

    if (!(wasLayouting && !isLayouting)) return; // Only on completion
    if (nodes.length === 0 || rootNodeIds.length === 0) return;

    const d = getDims();

    // Initial load
    if (!hasInitializedRef.current) {
      if (initialSelectedNodeId && !hasHandledInitialSelectionRef.current) {
        hasHandledInitialSelectionRef.current = true;
        if (centerOnNode(initialSelectedNodeId, VIEWPORT.INITIAL_ZOOM, ANIMATION.INITIAL_DURATION, d)) {
          hasInitializedRef.current = true;
          prevLayoutDirectionRef.current = layoutDirection;
          prevSelectionRef.current = initialSelectedNodeId;
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
  }, [isLayouting, nodes.length, rootNodeIds, layoutDirection, initialSelectedNodeId, centerOnNode, getDims]);

  // On selection change
  useEffect(() => {
    if (!selectedNodeId) {
      prevSelectionRef.current = null;
      return;
    }
    if (prevSelectionRef.current === selectedNodeId) return;
    if (!nodeMap.has(selectedNodeId)) return;

    prevSelectionRef.current = selectedNodeId;
    centerOnNode(selectedNodeId, reactFlowInstance.getViewport().zoom, ANIMATION.PANEL_TRANSITION, getDims());
  }, [selectedNodeId, nodeMap, centerOnNode, reactFlowInstance, getDims]);

  // On window resize (debounced)
  const handleWindowResize = useDebounceCallback(() => {
    if (isAnimatingRef.current) return;

    const d = getDims();
    const sel = selectedNodeIdRef.current;

    if (sel) {
      centerOnNode(sel, reactFlowInstance.getViewport().zoom, ANIMATION.BOUNDARY_ENFORCE, d);
    } else {
      clampCurrentViewport(ANIMATION.BOUNDARY_ENFORCE, d);
    }
  }, ANIMATION.RESIZE_THROTTLE_MS);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", handleWindowResize, { passive: true });
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [handleWindowResize]);

  return { translateExtent };
}
