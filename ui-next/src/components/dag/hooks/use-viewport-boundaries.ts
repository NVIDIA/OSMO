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
 * useViewportBoundaries Hook
 *
 * Manages dynamic viewport boundaries for ReactFlow using CONTROLLED MODE.
 * Ensures outermost nodes can always be centered in the visible area.
 *
 * Key insight: By controlling the viewport state ourselves, we clamp BEFORE
 * ReactFlow renders, eliminating any flicker or jitter at boundaries.
 *
 * This hook provides:
 * - Controlled viewport state (pass to ReactFlow's `viewport` prop)
 * - onViewportChange handler (pass to ReactFlow's `onViewportChange` prop)
 * - Auto-pan effect: Centers selected node after panel opens
 * - Dynamic bounds: Adjusts when panel opens/closes/resizes
 */

"use client";

import { useState, useCallback, useEffect, useRef, type RefObject } from "react";
import { useReactFlow, type Node, type Viewport } from "@xyflow/react";
import { useStableCallback, useStableValue } from "@/hooks";
import { VIEWPORT, ANIMATION, NODE_DEFAULTS } from "../constants";

// ============================================================================
// Performance Constants
// ============================================================================

/** Tolerance for viewport comparison to avoid floating-point issues */
const VIEWPORT_EPSILON = 0.001;

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
  /** Computed bounds of all nodes */
  nodeBounds: NodeBounds;
  /** Container element ref for measuring */
  containerRef: RefObject<HTMLDivElement | null>;
  /**
   * Compute visible width from container width.
   * This allows the parent to control how visible area is calculated
   * (e.g., accounting for overlays, panels, sidebars).
   *
   * @param containerWidth - The full container width in pixels
   * @returns The visible width in pixels
   *
   * @example
   * // Full width (default)
   * getVisibleWidth: (w) => w
   *
   * // Right panel taking 30%
   * getVisibleWidth: (w) => w * 0.7
   *
   * // Fixed sidebar of 300px
   * getVisibleWidth: (w) => w - 300
   */
  getVisibleWidth?: (containerWidth: number) => number;
  /**
   * Dependencies that should trigger viewport re-clamping.
   * When any value in this array changes, bounds are recalculated.
   * Use this to pass values that affect getVisibleWidth results.
   *
   * @example
   * // Re-clamp when panel state changes
   * boundsDeps: [isPanelOpen, panelPct]
   */
  boundsDeps?: unknown[];
  /** Currently selected node ID/name (for auto-pan) */
  selectedGroupName?: string | null;
  /** Current panel view state (for auto-pan trigger) */
  panelView?: string;
  /** All nodes (for finding selected node position) */
  nodes: Node[];
}

export interface ViewportBoundariesResult {
  /** Controlled viewport state - pass to ReactFlow's `viewport` prop */
  viewport: Viewport;
  /** Handler for viewport changes - pass to ReactFlow's `onViewportChange` prop */
  onViewportChange: (viewport: Viewport) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/** Default: full container width is visible */
const defaultGetVisibleWidth = (containerWidth: number) => containerWidth;

export function useViewportBoundaries({
  nodeBounds,
  containerRef,
  getVisibleWidth = defaultGetVisibleWidth,
  boundsDeps = [],
  selectedGroupName = null,
  panelView = "none",
  nodes,
}: UseViewportBoundariesOptions): ViewportBoundariesResult {
  const reactFlowInstance = useReactFlow();

  // Controlled viewport state
  const [viewport, setViewport] = useState<Viewport>({
    x: 100,
    y: 50,
    zoom: VIEWPORT.DEFAULT_ZOOM,
  });

  // Track previous selection to detect new selections
  const prevSelectionRef = useRef<string | null>(null);

  // Cache container dimensions to avoid repeated DOM reads during pan
  const containerDimsRef = useRef<{ width: number; height: number }>({
    width: VIEWPORT.ESTIMATED_WIDTH as number,
    height: VIEWPORT.ESTIMATED_HEIGHT as number,
  });

  // Reusable objects to avoid allocations in hot path
  const visibleAreaCache = useRef({ width: 0, height: 0 });
  const boundsCache = useRef({ minX: 0, maxX: 0, minY: 0, maxY: 0 });

  // Stable refs for values used in handlers to avoid stale closures
  const nodeBoundsRef = useStableValue(nodeBounds);
  const getVisibleWidthRef = useStableValue(getVisibleWidth);
  const viewportRef = useStableValue(viewport);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // Update cached container dimensions
  const updateContainerDims = useCallback(() => {
    const container = containerRef.current;
    containerDimsRef.current = {
      width: container?.clientWidth || VIEWPORT.ESTIMATED_WIDTH,
      height: container?.clientHeight || VIEWPORT.ESTIMATED_HEIGHT,
    };
  }, [containerRef]);

  // ---------------------------------------------------------------------------
  // Helpers - Optimized for Hot Path (no allocations)
  // ---------------------------------------------------------------------------

  /**
   * Get visible area using cached dimensions (no DOM read during pan).
   * MUTATES visibleAreaCache to avoid allocations in hot path.
   */
  const getVisibleArea = useCallback(() => {
    const { width: containerWidth, height: containerHeight } = containerDimsRef.current;
    const visibleWidth = getVisibleWidthRef.current(containerWidth);
    // Mutate cached object instead of creating new one
    visibleAreaCache.current.width = Math.max(100, visibleWidth);
    visibleAreaCache.current.height = containerHeight;
    return visibleAreaCache.current;
  }, [getVisibleWidthRef]);

  /**
   * Calculate viewport bounds based on visible area and zoom.
   * MUTATES boundsCache to avoid allocations in hot path.
   *
   * Goal: Allow every point within node bounds to be centered in the visible area.
   *
   * ReactFlow coordinate system:
   *   screenX = graphX * zoom + viewport.x
   *   screenY = graphY * zoom + viewport.y
   *
   * To center a point (graphX, graphY) in the visible area:
   *   viewport.x = visWidth/2 - graphX * zoom
   *   viewport.y = visHeight/2 - graphY * zoom
   */
  const getViewportBounds = useCallback(
    (zoom: number, visWidth: number, visHeight: number) => {
      const bounds = nodeBoundsRef.current;
      // Mutate cached object instead of creating new one
      boundsCache.current.minX = visWidth / 2 - bounds.maxX * zoom;
      boundsCache.current.maxX = visWidth / 2 - bounds.minX * zoom;
      boundsCache.current.minY = visHeight / 2 - bounds.maxY * zoom;
      boundsCache.current.maxY = visHeight / 2 - bounds.minY * zoom;
      return boundsCache.current;
    },
    [nodeBoundsRef],
  );

  /**
   * Clamp viewport to bounds.
   * Creates a new Viewport object only if values differ from current viewport.
   */
  const clampViewport = useCallback(
    (vp: Viewport): Viewport => {
      const area = getVisibleArea();
      const limits = getViewportBounds(vp.zoom, area.width, area.height);

      const clampedX = Math.max(limits.minX, Math.min(limits.maxX, vp.x));
      const clampedY = Math.max(limits.minY, Math.min(limits.maxY, vp.y));

      // Return same object if values are close enough (avoid floating-point churn)
      if (Math.abs(vp.x - clampedX) < VIEWPORT_EPSILON && Math.abs(vp.y - clampedY) < VIEWPORT_EPSILON) {
        return vp;
      }

      return { x: clampedX, y: clampedY, zoom: vp.zoom };
    },
    [getVisibleArea, getViewportBounds],
  );

  // ---------------------------------------------------------------------------
  // Viewport change handler (clamps before state update = no flicker)
  // ---------------------------------------------------------------------------

  /**
   * Check if two viewports are close enough to be considered equal.
   * Uses epsilon comparison to handle floating-point precision.
   */
  const viewportsEqual = useCallback(
    (a: Viewport, b: Viewport): boolean =>
      Math.abs(a.x - b.x) < VIEWPORT_EPSILON &&
      Math.abs(a.y - b.y) < VIEWPORT_EPSILON &&
      Math.abs(a.zoom - b.zoom) < VIEWPORT_EPSILON,
    [],
  );

  /**
   * Viewport change handler - synchronous for controlled mode.
   *
   * In controlled mode, we MUST update synchronously or ReactFlow will
   * render the old viewport, causing visible lag. The performance gain
   * comes from:
   * 1. Skipping redundant updates (same viewport = no re-render)
   * 2. Optimized clamp calculation (reuses cached objects)
   * 3. clampViewport returns same object if no clamping needed
   */
  const onViewportChange = useStableCallback((newViewport: Viewport) => {
    const clamped = clampViewport(newViewport);

    // Fast path: clampViewport returns same object if no clamping needed
    // AND viewport hasn't changed → skip entirely
    if (clamped === newViewport && viewportsEqual(viewportRef.current, clamped)) {
      return;
    }

    // Only update state if the viewport actually changed
    if (!viewportsEqual(viewportRef.current, clamped)) {
      setViewport(clamped);
    }
  });

  // ---------------------------------------------------------------------------
  // Update container dimensions on mount, panel changes, and window resize
  // ---------------------------------------------------------------------------

  useEffect(() => {
    updateContainerDims();

    // Throttled resize handler using RAF to avoid excessive updates
    let rafId: number | null = null;
    const handleResize = () => {
      // RAF throttle: skip if already scheduled
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateContainerDims();
      });
    };

    // Use passive: true for resize listener (better scroll perf on mobile)
    window.addEventListener("resize", handleResize, { passive: true });
    return () => {
      window.removeEventListener("resize", handleResize);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [updateContainerDims]);

  // ---------------------------------------------------------------------------
  // Re-clamp viewport when bounds change (visible area change, node layout change)
  // Update container dims FIRST to ensure clamp uses current dimensions
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Update container dimensions before clamping to avoid stale values
    updateContainerDims();
    setViewport((prev) => clampViewport(prev));
    // Re-run when nodeBounds changes or any boundsDeps value changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeBounds, clampViewport, updateContainerDims, ...boundsDeps]);

  // ---------------------------------------------------------------------------
  // Auto-pan to selected node
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedGroupName || panelView === "none") return;

    const currentSelection = `${selectedGroupName}-${panelView}`;
    if (prevSelectionRef.current === currentSelection) return;
    prevSelectionRef.current = currentSelection;

    const selectedNode = nodes.find((n) => n.id === selectedGroupName);
    if (!selectedNode) return;

    // Use double RAF to ensure layout is complete
    let innerFrameId: number;
    const outerFrameId = requestAnimationFrame(() => {
      innerFrameId = requestAnimationFrame(() => {
        updateContainerDims();

        // Get node dimensions from data if available
        const nodeData = selectedNode.data as Record<string, unknown> | undefined;
        const nodeWidth = (nodeData?.nodeWidth as number) || NODE_DEFAULTS.width;
        const nodeHeight = (nodeData?.nodeHeight as number) || NODE_DEFAULTS.height;
        const nodeCenterX = selectedNode.position.x + nodeWidth / 2;
        const nodeCenterY = selectedNode.position.y + nodeHeight / 2;

        const currentViewport = reactFlowInstance.getViewport();
        const { width, height } = getVisibleArea();

        const targetX = -(nodeCenterX * currentViewport.zoom) + width / 2;
        const targetY = -(nodeCenterY * currentViewport.zoom) + height / 2;

        // Clamp the target position
        const targetViewport = clampViewport({
          x: targetX,
          y: targetY,
          zoom: currentViewport.zoom,
        });

        // Animate to the target (ReactFlow handles the animation)
        reactFlowInstance.setViewport(targetViewport, { duration: ANIMATION.NODE_CENTER });

        // Also update our controlled state
        setViewport(targetViewport);
      });
    });

    return () => {
      cancelAnimationFrame(outerFrameId);
      cancelAnimationFrame(innerFrameId);
    };
  }, [selectedGroupName, panelView, nodes, reactFlowInstance, getVisibleArea, clampViewport, updateContainerDims]);

  // ---------------------------------------------------------------------------
  // Clear refs when panel closes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (panelView === "none") {
      prevSelectionRef.current = null;
    }
  }, [panelView]);

  return { viewport, onViewportChange };
}
