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
import { useSyncedRef } from "@react-hookz/web";
import { useStableCallback } from "@/hooks";
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

  // Flag to indicate animation is in progress - skip clamping during animation
  const isAnimatingRef = useRef(false);

  // Track if we're currently at a boundary (for sync optimization)
  const isAtBoundaryRef = useRef(false);

  // Reusable viewport object to avoid allocations in hot path
  const clampedViewportCache = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });

  // Detect pending animation during render (before effects run)
  // This allows us to skip re-clamping when we're about to animate
  const hasPendingAnimation =
    selectedGroupName !== null &&
    panelView !== "none" &&
    panelView !== "workflow" &&
    prevSelectionRef.current !== selectedGroupName;

  // Cache container dimensions to avoid repeated DOM reads during pan
  const containerDimsRef = useRef<{ width: number; height: number }>({
    width: VIEWPORT.ESTIMATED_WIDTH as number,
    height: VIEWPORT.ESTIMATED_HEIGHT as number,
  });

  // Reusable objects to avoid allocations in hot path
  const visibleAreaCache = useRef({ width: 0, height: 0 });
  const boundsCache = useRef({ minX: 0, maxX: 0, minY: 0, maxY: 0 });

  // Stable refs for values used in handlers to avoid stale closures
  const nodeBoundsRef = useSyncedRef(nodeBounds);
  const getVisibleWidthRef = useSyncedRef(getVisibleWidth);
  const viewportRef = useSyncedRef(viewport);

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
   * Viewport change handler - synchronous for controlled mode.
   *
   * PERFORMANCE OPTIMIZATIONS:
   * 1. Minimal object allocations (reuses cached viewport object)
   * 2. Early exits for common cases (no change, animation in progress)
   * 3. Inline math to avoid function call overhead
   * 4. Only sync ReactFlow when transitioning to/at boundary (not every frame)
   * 5. Container dims cached and only refreshed when at boundary
   *
   * During animation (isAnimatingRef = true), we pass through values
   * without clamping to allow smooth animated transitions.
   */
  const onViewportChange = useStableCallback((newViewport: Viewport) => {
    // Fast path: During animation, pass through without clamping
    if (isAnimatingRef.current) {
      const prev = viewportRef.current;
      // Inline equality check to avoid function call
      if (
        Math.abs(prev.x - newViewport.x) >= VIEWPORT_EPSILON ||
        Math.abs(prev.y - newViewport.y) >= VIEWPORT_EPSILON ||
        Math.abs(prev.zoom - newViewport.zoom) >= VIEWPORT_EPSILON
      ) {
        setViewport(newViewport);
      }
      return;
    }

    // Cache local references to avoid repeated property access
    const dims = containerDimsRef.current;
    const bounds = nodeBoundsRef.current;
    const getVisWidth = getVisibleWidthRef.current;

    // Calculate visible area (inline to avoid function call overhead)
    const visWidth = Math.max(100, getVisWidth(dims.width));
    const visHeight = dims.height;

    // Calculate viewport limits (inline)
    const zoom = newViewport.zoom;
    const halfVisWidth = visWidth * 0.5;
    const halfVisHeight = visHeight * 0.5;
    const minX = halfVisWidth - bounds.maxX * zoom;
    const maxX = halfVisWidth - bounds.minX * zoom;
    const minY = halfVisHeight - bounds.maxY * zoom;
    const maxY = halfVisHeight - bounds.minY * zoom;

    // Clamp values (branchless-friendly pattern)
    const rawX = newViewport.x;
    const rawY = newViewport.y;
    const clampedX = rawX < minX ? minX : rawX > maxX ? maxX : rawX;
    const clampedY = rawY < minY ? minY : rawY > maxY ? maxY : rawY;

    // Check if clamping occurred
    const deltaX = rawX - clampedX;
    const deltaY = rawY - clampedY;
    const needsClamp =
      deltaX < -VIEWPORT_EPSILON ||
      deltaX > VIEWPORT_EPSILON ||
      deltaY < -VIEWPORT_EPSILON ||
      deltaY > VIEWPORT_EPSILON;

    // Reuse cached object for clamped viewport (avoid allocation in hot path)
    let clamped: Viewport;
    if (needsClamp) {
      clampedViewportCache.current.x = clampedX;
      clampedViewportCache.current.y = clampedY;
      clampedViewportCache.current.zoom = zoom;
      clamped = clampedViewportCache.current;
    } else {
      clamped = newViewport;
    }

    // Check if state update is needed
    const prev = viewportRef.current;
    const stateChanged =
      Math.abs(prev.x - clamped.x) >= VIEWPORT_EPSILON ||
      Math.abs(prev.y - clamped.y) >= VIEWPORT_EPSILON ||
      Math.abs(prev.zoom - clamped.zoom) >= VIEWPORT_EPSILON;

    if (stateChanged) {
      // Must create new object for React state (can't reuse cache)
      setViewport({ x: clamped.x, y: clamped.y, zoom: clamped.zoom });
    }

    // Sync ReactFlow's internal state when at boundary
    // Only sync when we transition TO boundary or are actively being pushed against it
    if (needsClamp) {
      // Track that we're at boundary
      if (!isAtBoundaryRef.current) {
        isAtBoundaryRef.current = true;
        // Refresh container dimensions when we first hit boundary
        const container = containerRef.current;
        if (container) {
          containerDimsRef.current.width = container.clientWidth;
          containerDimsRef.current.height = container.clientHeight;
        }
      }
      // Sync ReactFlow to prevent internal state divergence
      reactFlowInstance.setViewport(clamped, { duration: 0 });
    } else {
      // No longer at boundary
      isAtBoundaryRef.current = false;
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
    // Skip re-clamping if animation is in progress or pending
    // The animation will end at a valid clamped position anyway
    if (isAnimatingRef.current || hasPendingAnimation) {
      // Still update container dimensions for the upcoming animation
      updateContainerDims();
      return;
    }

    // Update container dimensions before clamping to avoid stale values
    updateContainerDims();
    setViewport((prev) => clampViewport(prev));
    // Re-run when nodeBounds changes or any boundsDeps value changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeBounds, clampViewport, updateContainerDims, hasPendingAnimation, ...boundsDeps]);

  // ---------------------------------------------------------------------------
  // Auto-pan to selected node
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Only auto-pan when there's a selection (group or task view)
    // Skip when in workflow view (no selection)
    if (!selectedGroupName) return;
    if (panelView === "none" || panelView === "workflow") return;

    // Only pan when the GROUP changes, not when switching between group/task view
    // of the same group. The node position is the same either way.
    if (prevSelectionRef.current === selectedGroupName) return;
    prevSelectionRef.current = selectedGroupName;

    const selectedNode = nodes.find((n) => n.id === selectedGroupName);
    if (!selectedNode) return;

    // Use double RAF to ensure layout is complete (panel expansion animation, etc.)
    let innerFrameId: number;
    let animationTimeoutId: ReturnType<typeof setTimeout>;
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

        // Enable animation mode - onViewportChange will pass through without clamping
        isAnimatingRef.current = true;

        // Animate to the target (ReactFlow handles smooth animation)
        // ReactFlow will call onViewportChange with intermediate values
        reactFlowInstance.setViewport(targetViewport, { duration: ANIMATION.NODE_CENTER });

        // Disable animation mode after animation completes
        animationTimeoutId = setTimeout(() => {
          isAnimatingRef.current = false;
        }, ANIMATION.NODE_CENTER + ANIMATION.BUFFER);
      });
    });

    return () => {
      cancelAnimationFrame(outerFrameId);
      cancelAnimationFrame(innerFrameId);
      clearTimeout(animationTimeoutId);
      isAnimatingRef.current = false;
    };
  }, [selectedGroupName, panelView, nodes, reactFlowInstance, getVisibleArea, clampViewport, updateContainerDims]);

  // ---------------------------------------------------------------------------
  // Clear refs when selection is cleared (back to workflow view)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Clear prevSelectionRef when no selection, so re-selecting the same node
    // will trigger auto-pan again
    if (!selectedGroupName) {
      prevSelectionRef.current = null;
    }
  }, [selectedGroupName]);

  return { viewport, onViewportChange };
}
