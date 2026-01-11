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
 * **Single source of truth** for all viewport management in ReactFlow DAGs.
 * Handles:
 * - Initial viewport centering (on root node or deep-linked node)
 * - Layout direction change re-centering
 * - Selection-based auto-pan
 * - Dynamic boundary clamping
 *
 * Key insight: By controlling the viewport state ourselves, we clamp BEFORE
 * ReactFlow renders, eliminating any flicker or jitter at boundaries.
 *
 * Architecture (Side-by-Side Model):
 * - The DAG container IS the visible area (no overlay math needed)
 * - Container dimensions directly determine viewport boundaries
 * - Panel changes cause container resize → ReactFlow handles naturally
 *
 * This hook provides:
 * - Controlled viewport state (pass to ReactFlow's `viewport` prop)
 * - onViewportChange handler (pass to ReactFlow's `onViewportChange` prop)
 * - Auto-pan effect: Centers selected node after panel opens
 * - Dynamic bounds: Adjusts when container resizes
 */

"use client";

import { useState, useCallback, useEffect, useRef, type RefObject } from "react";
import { useReactFlow, type Node, type Viewport } from "@xyflow/react";
import { useSyncedRef, useRafCallback } from "@react-hookz/web";
import { useResizeObserver } from "usehooks-ts";
import { useStableCallback } from "@/hooks";
import { VIEWPORT, ANIMATION, NODE_DEFAULTS } from "../constants";
import type { LayoutDirection } from "../types";

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
  /** Container element ref for measuring (the DAG container) */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Currently selected node ID/name (for auto-pan) */
  selectedGroupName?: string | null;
  /** Current panel view state (for auto-pan trigger) */
  panelView?: string;
  /** All nodes (for finding selected node position) */
  nodes: Node[];

  // --- Initial load & layout direction change ---

  /** Current layout direction (TB or LR) - triggers re-center on change */
  layoutDirection: LayoutDirection;
  /** IDs of root nodes (nodes with no incoming edges) - for initial centering */
  rootNodeIds: string[];
  /**
   * Optional: Node ID to center on during initial load (from URL).
   * When provided, initial view will center on this node instead of the first root node.
   * Useful for deep-linking to a specific node.
   */
  initialSelectedNodeId?: string | null;
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

export function useViewportBoundaries({
  nodeBounds,
  containerRef,
  selectedGroupName = null,
  panelView = "none",
  nodes,
  layoutDirection,
  rootNodeIds,
  initialSelectedNodeId,
}: UseViewportBoundariesOptions): ViewportBoundariesResult {
  const reactFlowInstance = useReactFlow();

  // Controlled viewport state
  const [viewport, setViewport] = useState<Viewport>({
    x: 100,
    y: 50,
    zoom: VIEWPORT.DEFAULT_ZOOM,
  });

  // ---------------------------------------------------------------------------
  // Initialization & Layout Direction Tracking
  // ---------------------------------------------------------------------------

  /** Track if initial centering has been performed */
  const hasInitializedRef = useRef(false);
  /** Track previous layout direction for detecting changes */
  const prevLayoutDirectionRef = useRef(layoutDirection);
  /** Track if we've handled the initial selected node (only try once per deep link) */
  const hasHandledInitialSelectionRef = useRef(false);

  // Track previous selection to detect new selections (for auto-pan on selection)
  const prevSelectionRef = useRef<string | null>(null);

  // Flag to indicate animation is in progress - skip clamping during animation
  const isAnimatingRef = useRef(false);

  // Track if we're currently at a boundary (for sync optimization)
  const isAtBoundaryRef = useRef(false);

  // Reusable viewport object to avoid allocations in hot path
  const clampedViewportCache = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });

  // Cache container dimensions to avoid repeated DOM reads during pan
  const containerDimsRef = useRef<{ width: number; height: number }>({
    width: VIEWPORT.ESTIMATED_WIDTH as number,
    height: VIEWPORT.ESTIMATED_HEIGHT as number,
  });

  // Reusable objects to avoid allocations in hot path
  const boundsCache = useRef({ minX: 0, maxX: 0, minY: 0, maxY: 0 });

  // Stable refs for values used in handlers to avoid stale closures
  const nodeBoundsRef = useSyncedRef(nodeBounds);
  const viewportRef = useSyncedRef(viewport);
  const nodesRef = useSyncedRef(nodes);

  // ---------------------------------------------------------------------------
  // Container Resize Detection (via usehooks-ts)
  // ---------------------------------------------------------------------------

  // Use useResizeObserver for efficient container dimension tracking
  // This handles both window resize and panel-induced container resize automatically
  // Note: Cast to RefObject<HTMLElement> since usehooks-ts types don't accept null
  const { width: containerWidth = VIEWPORT.ESTIMATED_WIDTH, height: containerHeight = VIEWPORT.ESTIMATED_HEIGHT } =
    useResizeObserver({ ref: containerRef as React.RefObject<HTMLElement>, box: "border-box" });

  // Update cached dimensions when container size changes
  // This keeps the hot path fast by avoiding DOM reads during pan/zoom
  useEffect(() => {
    containerDimsRef.current = {
      width: containerWidth,
      height: containerHeight,
    };
  }, [containerWidth, containerHeight]);

  // ---------------------------------------------------------------------------
  // Helpers - Optimized for Hot Path (no allocations)
  // ---------------------------------------------------------------------------

  /**
   * Get visible area from container dimensions.
   * In the side-by-side model, the container IS the visible area.
   */
  const getVisibleArea = useCallback(() => {
    return containerDimsRef.current;
  }, []);

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

  /**
   * Get node dimensions from node data, falling back to defaults.
   */
  const getNodeDimensions = useCallback(
    (nodeId: string): { width: number; height: number } => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) {
        return { width: NODE_DEFAULTS.width, height: NODE_DEFAULTS.height };
      }
      const data = node.data as Record<string, unknown> | undefined;
      return {
        width: (data?.nodeWidth as number) || NODE_DEFAULTS.width,
        height: (data?.nodeHeight as number) || NODE_DEFAULTS.height,
      };
    },
    [nodesRef],
  );

  /**
   * Center viewport on a specific node with animation.
   * Uses the node's actual dimensions from data.
   *
   * @returns true if the node was found and centered, false otherwise.
   */
  const centerOnNode = useCallback(
    (nodeId: string, zoom: number, duration: number): boolean => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return false;

      const dims = getNodeDimensions(nodeId);
      const centerX = node.position.x + dims.width / 2;
      const centerY = node.position.y + dims.height / 2;

      // Enable animation mode
      isAnimatingRef.current = true;

      reactFlowInstance.setCenter(centerX, centerY, { zoom, duration });

      // Disable animation mode after animation completes
      setTimeout(() => {
        isAnimatingRef.current = false;
      }, duration + ANIMATION.BUFFER);

      return true;
    },
    [nodesRef, getNodeDimensions, reactFlowInstance],
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

    // Calculate visible area (inline - container IS visible area now)
    const visWidth = Math.max(100, dims.width);
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
  // Re-clamp viewport when bounds change (node bounds or container size)
  // Uses useRafCallback to defer setState per React Compiler guidelines
  // ---------------------------------------------------------------------------

  // RAF-throttled viewport update - triggers on next animation frame
  const [scheduleReclamp, cancelReclamp] = useRafCallback(() => {
    setViewport((prev) => clampViewport(prev));
  });

  // Re-clamp when container size or node bounds change
  useEffect(() => {
    // Check for pending animation inside effect (not during render)
    const hasPendingAnimation =
      selectedGroupName !== null &&
      panelView !== "none" &&
      panelView !== "workflow" &&
      prevSelectionRef.current !== selectedGroupName;

    // Skip re-clamping if animation is in progress or pending
    if (isAnimatingRef.current || hasPendingAnimation) {
      return;
    }

    // Schedule viewport re-clamp on next animation frame
    scheduleReclamp();

    return () => cancelReclamp();
  }, [nodeBounds, containerWidth, containerHeight, selectedGroupName, panelView, scheduleReclamp, cancelReclamp]);

  // ---------------------------------------------------------------------------
  // Initial Load Centering
  // Waits for nodes to be ready, then centers on:
  // 1. Deep-linked node (initialSelectedNodeId) if provided and found
  // 2. First root node otherwise
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Skip if already initialized
    if (hasInitializedRef.current) return;

    // Wait for nodes to be available (layout must be complete)
    if (nodes.length === 0) return;
    if (rootNodeIds.length === 0) return;

    // Delay to ensure container dimensions are measured (via useResizeObserver)
    const timer = setTimeout(() => {
      // Try to center on deep-linked node first
      if (initialSelectedNodeId && !hasHandledInitialSelectionRef.current) {
        hasHandledInitialSelectionRef.current = true;
        const found = centerOnNode(initialSelectedNodeId, VIEWPORT.INITIAL_ZOOM, ANIMATION.INITIAL_DURATION);
        if (found) {
          hasInitializedRef.current = true;
          prevLayoutDirectionRef.current = layoutDirection;
          // Mark this selection as handled so auto-pan doesn't trigger again
          prevSelectionRef.current = initialSelectedNodeId;
          return;
        }
        // Node not found - fall through to root
      }

      // Default: center on first root node
      centerOnNode(rootNodeIds[0], VIEWPORT.INITIAL_ZOOM, ANIMATION.INITIAL_DURATION);
      hasInitializedRef.current = true;
      prevLayoutDirectionRef.current = layoutDirection;
    }, ANIMATION.DELAY);

    return () => clearTimeout(timer);
  }, [
    nodes.length,
    rootNodeIds,
    layoutDirection,
    initialSelectedNodeId,
    centerOnNode,
  ]);

  // ---------------------------------------------------------------------------
  // Layout Direction Change Re-centering
  // When layout direction changes (after initial load), re-center on root
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Skip if not initialized yet (initial load handles this)
    if (!hasInitializedRef.current) return;

    // Skip if layout direction hasn't changed
    if (prevLayoutDirectionRef.current === layoutDirection) return;

    // Layout direction changed - re-center on root after layout settles
    const timer = setTimeout(() => {
      if (rootNodeIds.length > 0) {
        centerOnNode(rootNodeIds[0], VIEWPORT.INITIAL_ZOOM, ANIMATION.VIEWPORT_DURATION);
      }
      prevLayoutDirectionRef.current = layoutDirection;
    }, ANIMATION.DELAY);

    return () => clearTimeout(timer);
  }, [layoutDirection, rootNodeIds, centerOnNode]);

  // ---------------------------------------------------------------------------
  // Auto-pan to selected node (selection change after initial load)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Only auto-pan when there's a selection (group or task view)
    // Skip when in workflow view (no selection)
    if (!selectedGroupName) return;
    if (panelView === "none" || panelView === "workflow") return;

    // Only pan when the GROUP changes, not when switching between group/task view
    // of the same group. The node position is the same either way.
    if (prevSelectionRef.current === selectedGroupName) return;

    const selectedNode = nodes.find((n) => n.id === selectedGroupName);
    // If node not found yet (still loading/layouting), don't set ref - retry when nodes update
    if (!selectedNode) return;

    // Mark this selection as handled (node was found and we're about to pan)
    prevSelectionRef.current = selectedGroupName;

    // Use double RAF to ensure layout is complete
    let innerFrameId: number;
    let animationTimeoutId: ReturnType<typeof setTimeout>;
    const outerFrameId = requestAnimationFrame(() => {
      innerFrameId = requestAnimationFrame(() => {
        // Get node dimensions from data
        const dims = getNodeDimensions(selectedGroupName);
        const nodeCenterX = selectedNode.position.x + dims.width / 2;
        const nodeCenterY = selectedNode.position.y + dims.height / 2;

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
  }, [
    selectedGroupName,
    panelView,
    nodes,
    reactFlowInstance,
    getVisibleArea,
    clampViewport,
    getNodeDimensions,
  ]);

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
