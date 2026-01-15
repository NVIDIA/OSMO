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
 * useViewportBoundaries - High-performance viewport management for ReactFlow DAGs.
 *
 * Performance optimizations:
 * - O(1) node lookups via Map (not O(n) array.find)
 * - useSyncedRef for stable callbacks without stale closures
 * - RAF-based resize handling (smoother than setTimeout)
 * - Minimal effect dependencies
 * - Early bailouts to skip unnecessary work
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useReactFlow, type CoordinateExtent, type Node, type Viewport } from "@xyflow/react";
import { useSyncedRef } from "@react-hookz/web";
import { useResizeObserver } from "usehooks-ts";
import { clamp } from "@/lib/utils";
import { VIEWPORT, ANIMATION, VIEWPORT_THRESHOLDS, NODE_DEFAULTS } from "../constants";
import type { LayoutDirection } from "../types";

// ============================================================================
// Types
// ============================================================================

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
  getExpectedVisibleArea?: () => { width: number; height: number };
  reCenterTrigger?: number;
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
  getExpectedVisibleArea,
  reCenterTrigger = 0,
}: UseViewportBoundariesOptions): ViewportBoundariesResult {
  const reactFlowInstance = useReactFlow();

  // ---------------------------------------------------------------------------
  // O(1) Node Lookup Map - rebuilt only when nodes array changes
  // ---------------------------------------------------------------------------

  const nodeMap = useMemo(() => {
    const map = new Map<string, Node>();
    for (let i = 0; i < nodes.length; i++) {
      map.set(nodes[i].id, nodes[i]);
    }
    return map;
  }, [nodes]);

  // ---------------------------------------------------------------------------
  // Container Dimensions
  // ---------------------------------------------------------------------------

  const { width: containerWidth = VIEWPORT.ESTIMATED_WIDTH, height: containerHeight = VIEWPORT.ESTIMATED_HEIGHT } =
    useResizeObserver({ ref: containerRef as React.RefObject<HTMLElement>, box: "border-box" });

  // ---------------------------------------------------------------------------
  // Synced Refs - stable references, no stale closures
  // useSyncedRef uses useLayoutEffect internally (React-compliant)
  // ---------------------------------------------------------------------------

  const nodeBoundsRef = useSyncedRef(nodeBounds);
  const nodeMapRef = useSyncedRef(nodeMap);
  const selectedNodeIdRef = useSyncedRef(selectedNodeId);
  const getExpectedVisibleAreaRef = useSyncedRef(getExpectedVisibleArea);
  const containerDimsRef = useSyncedRef({ width: containerWidth, height: containerHeight });

  // ---------------------------------------------------------------------------
  // Mutable Tracking Refs (not synced - just internal state)
  // ---------------------------------------------------------------------------

  const hasInitializedRef = useRef(false);
  const prevLayoutDirectionRef = useRef(layoutDirection);
  const hasHandledInitialSelectionRef = useRef(false);
  const prevSelectionRef = useRef<string | null>(null);
  const prevReCenterTriggerRef = useRef(reCenterTrigger);
  const isAnimatingRef = useRef(false);
  const animationGenerationRef = useRef(0);

  // ---------------------------------------------------------------------------
  // translateExtent: Static Boundaries (memoized)
  // ---------------------------------------------------------------------------

  const translateExtent = useMemo((): CoordinateExtent | undefined => {
    if (!nodeBounds || !containerWidth || !containerHeight) return undefined;

    // MAX_ZOOM padding = tightest bounds allowing edge nodes to be centered
    const px = containerWidth / (2 * VIEWPORT.MAX_ZOOM);
    const py = containerHeight / (2 * VIEWPORT.MAX_ZOOM);

    return [
      [nodeBounds.minX - px, nodeBounds.minY - py],
      [nodeBounds.maxX + px, nodeBounds.maxY + py],
    ];
  }, [nodeBounds, containerWidth, containerHeight]);

  // ---------------------------------------------------------------------------
  // Core Functions - read from refs, zero stale closures
  // ---------------------------------------------------------------------------

  const getVisibleArea = useCallback((): { width: number; height: number } => {
    return getExpectedVisibleAreaRef.current?.() ?? containerDimsRef.current;
  }, [getExpectedVisibleAreaRef, containerDimsRef]);

  const clampViewport = useCallback(
    (vp: Viewport, area: { width: number; height: number }): Viewport => {
      const bounds = nodeBoundsRef.current;
      const hw = area.width / 2;
      const hh = area.height / 2;

      return {
        x: clamp(vp.x, hw - bounds.maxX * vp.zoom, hw - bounds.minX * vp.zoom),
        y: clamp(vp.y, hh - bounds.maxY * vp.zoom, hh - bounds.minY * vp.zoom),
        zoom: vp.zoom,
      };
    },
    [nodeBoundsRef],
  );

  const animateViewport = useCallback(
    (viewport: Viewport, duration: number) => {
      isAnimatingRef.current = true;
      const gen = ++animationGenerationRef.current;

      reactFlowInstance.setViewport(viewport, { duration }).then(() => {
        if (animationGenerationRef.current === gen) {
          isAnimatingRef.current = false;
        }
      });
    },
    [reactFlowInstance],
  );

  const centerOnNode = useCallback(
    (nodeId: string, zoom: number, duration: number, area: { width: number; height: number }): boolean => {
      const node = nodeMapRef.current.get(nodeId); // O(1) lookup
      if (!node) return false;

      const data = node.data as Record<string, unknown> | undefined;
      const nw = (data?.nodeWidth as number) || NODE_DEFAULTS.width;
      const nh = (data?.nodeHeight as number) || NODE_DEFAULTS.height;
      const cx = node.position.x + nw / 2;
      const cy = node.position.y + nh / 2;

      const target = clampViewport({ x: area.width / 2 - cx * zoom, y: area.height / 2 - cy * zoom, zoom }, area);
      animateViewport(target, duration);
      return true;
    },
    [nodeMapRef, clampViewport, animateViewport],
  );

  const clampCurrentViewport = useCallback(
    (duration: number, area: { width: number; height: number }) => {
      const current = reactFlowInstance.getViewport();
      const clamped = clampViewport(current, area);

      // Squared distance check (faster than two Math.abs calls)
      const dx = current.x - clamped.x;
      const dy = current.y - clamped.y;
      if (dx * dx + dy * dy > VIEWPORT_THRESHOLDS.MIN_ADJUSTMENT_DISTANCE_SQ) {
        animateViewport(clamped, duration);
      }
    },
    [reactFlowInstance, clampViewport, animateViewport],
  );

  // ---------------------------------------------------------------------------
  // Re-center/Clamp on trigger change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (prevReCenterTriggerRef.current === reCenterTrigger) return;
    prevReCenterTriggerRef.current = reCenterTrigger;
    if (isAnimatingRef.current) return;

    const area = getVisibleArea();
    const zoom = reactFlowInstance.getViewport().zoom;

    if (selectedNodeId) {
      centerOnNode(selectedNodeId, zoom, ANIMATION.PANEL_TRANSITION, area);
    } else {
      clampCurrentViewport(ANIMATION.PANEL_TRANSITION, area);
    }
  }, [reCenterTrigger, selectedNodeId, getVisibleArea, centerOnNode, clampCurrentViewport, reactFlowInstance]);

  // ---------------------------------------------------------------------------
  // Initial Load Centering
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (hasInitializedRef.current || nodes.length === 0 || rootNodeIds.length === 0) return;

    const timer = setTimeout(() => {
      const area = getVisibleArea();

      if (initialSelectedNodeId && !hasHandledInitialSelectionRef.current) {
        hasHandledInitialSelectionRef.current = true;
        if (centerOnNode(initialSelectedNodeId, VIEWPORT.INITIAL_ZOOM, ANIMATION.INITIAL_DURATION, area)) {
          hasInitializedRef.current = true;
          prevLayoutDirectionRef.current = layoutDirection;
          prevSelectionRef.current = initialSelectedNodeId;
          return;
        }
      }

      centerOnNode(rootNodeIds[0], VIEWPORT.INITIAL_ZOOM, ANIMATION.INITIAL_DURATION, area);
      hasInitializedRef.current = true;
      prevLayoutDirectionRef.current = layoutDirection;
    }, ANIMATION.DELAY);

    return () => clearTimeout(timer);
  }, [nodes.length, rootNodeIds, layoutDirection, initialSelectedNodeId, centerOnNode, getVisibleArea]);

  // ---------------------------------------------------------------------------
  // Layout Direction Change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!hasInitializedRef.current || prevLayoutDirectionRef.current === layoutDirection) return;

    const timer = setTimeout(() => {
      if (rootNodeIds.length > 0) {
        centerOnNode(rootNodeIds[0], VIEWPORT.INITIAL_ZOOM, ANIMATION.VIEWPORT_DURATION, getVisibleArea());
      }
      prevLayoutDirectionRef.current = layoutDirection;
    }, ANIMATION.DELAY);

    return () => clearTimeout(timer);
  }, [layoutDirection, rootNodeIds, centerOnNode, getVisibleArea]);

  // ---------------------------------------------------------------------------
  // Auto-pan on Selection Change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedNodeId) {
      prevSelectionRef.current = null;
      return;
    }
    if (prevSelectionRef.current === selectedNodeId) return;
    if (!nodeMap.has(selectedNodeId)) return; // O(1) existence check

    prevSelectionRef.current = selectedNodeId;
    centerOnNode(selectedNodeId, reactFlowInstance.getViewport().zoom, ANIMATION.PANEL_TRANSITION, getVisibleArea());
  }, [selectedNodeId, nodeMap, centerOnNode, reactFlowInstance, getVisibleArea]);

  // ---------------------------------------------------------------------------
  // Window Resize - RAF-throttled for smooth 60fps handling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (typeof window === "undefined") return;

    let rafId: number;
    let pending = false;
    let lastTime = 0;

    const handleResize = () => {
      const now = performance.now();

      // Throttle: skip if called too recently, schedule next frame
      if (now - lastTime < ANIMATION.RESIZE_THROTTLE_MS) {
        if (!pending) {
          pending = true;
          rafId = requestAnimationFrame(() => {
            pending = false;
            handleResize();
          });
        }
        return;
      }

      lastTime = now;
      if (isAnimatingRef.current) return;

      const area = getVisibleArea();
      const currentSelection = selectedNodeIdRef.current;

      if (currentSelection) {
        centerOnNode(currentSelection, reactFlowInstance.getViewport().zoom, ANIMATION.BOUNDARY_ENFORCE, area);
      } else {
        clampCurrentViewport(ANIMATION.BOUNDARY_ENFORCE, area);
      }
    };

    window.addEventListener("resize", handleResize, { passive: true });
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(rafId);
    };
  }, [reactFlowInstance, getVisibleArea, centerOnNode, clampCurrentViewport, selectedNodeIdRef]);

  return { translateExtent };
}
