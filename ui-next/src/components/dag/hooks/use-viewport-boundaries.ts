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
import { useSyncedRef } from "@react-hookz/web";
import { useResizeObserver } from "usehooks-ts";
import { useEventCallback } from "usehooks-ts";
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

  // --- Panel state for accurate centering calculations ---

  /**
   * Optional: Outer container ref (the parent that contains both DAG and panel).
   * Used to calculate expected visible width during panel transitions.
   */
  outerContainerRef?: RefObject<HTMLDivElement | null>;
  /** Panel width percentage when expanded (default: 50) */
  panelWidthPct?: number;
  /** Whether the panel is currently collapsed */
  isPanelCollapsed?: boolean;
  /** Collapsed panel width in pixels (default: 40) */
  collapsedPanelWidthPx?: number;
  /**
   * Whether the panel is currently being resized by dragging.
   * When true, defer centering until drag ends (we don't know final width yet).
   */
  isPanelDragging?: boolean;
}

export interface ViewportBoundariesResult {
  /** Controlled viewport state - pass to ReactFlow's `viewport` prop */
  viewport: Viewport;
  /** Handler for viewport changes - pass to ReactFlow's `onViewportChange` prop */
  onViewportChange: (viewport: Viewport) => void;
  /**
   * Cancel any pending auto-pan animations.
   * Call this when user starts manually interacting (pan/zoom/drag).
   * Pass to ReactFlow's `onMoveStart` prop.
   */
  onUserInteractionStart: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useViewportBoundaries({
  nodeBounds,
  containerRef,
  selectedGroupName = null,
  nodes,
  layoutDirection,
  rootNodeIds,
  initialSelectedNodeId,
  // Panel state for accurate centering
  outerContainerRef,
  panelWidthPct = 50,
  isPanelCollapsed = false,
  collapsedPanelWidthPx = 40,
  isPanelDragging = false,
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

  // Track previous panel state to detect resize/collapse changes
  const prevPanelCollapsedRef = useRef(isPanelCollapsed);
  const prevPanelWidthPctRef = useRef(panelWidthPct);
  const prevPanelDraggingRef = useRef(isPanelDragging);

  // Flag to indicate animation is in progress - skip clamping during animation
  const isAnimatingRef = useRef(false);

  // Counter to track animation generations - prevents old animation callbacks
  // from interfering with newer animations
  const animationGenerationRef = useRef(0);

  // Store cancel function for pending auto-pan (to cancel on user interaction)
  const cancelPendingAutoPanRef = useRef<(() => void) | null>(null);

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
   * Calculate the expected visible width after panel transition completes.
   * This allows us to center on the correct position immediately,
   * without waiting for the panel animation to finish.
   *
   * @param targetCollapsed - The target collapsed state we're transitioning TO
   * @returns Expected visible dimensions after transition
   */
  const getExpectedVisibleArea = useCallback(
    (targetCollapsed: boolean): { width: number; height: number } => {
      // If no outer container ref provided, fall back to current dimensions
      const outer = outerContainerRef?.current;
      if (!outer) {
        return containerDimsRef.current;
      }

      const outerWidth = outer.clientWidth;
      const height = containerDimsRef.current.height;

      // Calculate expected DAG container width based on target panel state
      const panelWidth = targetCollapsed
        ? collapsedPanelWidthPx
        : (outerWidth * panelWidthPct) / 100;

      const expectedWidth = Math.max(100, outerWidth - panelWidth);

      return { width: expectedWidth, height };
    },
    [outerContainerRef, panelWidthPct, collapsedPanelWidthPx],
  );

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
   *
   * @param vp - The viewport to clamp
   * @param visibleArea - Optional visible area override (for panel transitions)
   */
  const clampViewport = useCallback(
    (vp: Viewport, visibleArea?: { width: number; height: number }): Viewport => {
      const area = visibleArea ?? getVisibleArea();
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
   * Uses manual calculation for consistent centering across all use cases.
   *
   * IMPORTANT: During animation, we temporarily "release" control to ReactFlow's
   * internal panZoom system. We don't update our React state during animation to
   * avoid interfering with ReactFlow's smooth animation. After animation completes,
   * we sync our state to the final position.
   *
   * @param nodeId - The node ID to center on
   * @param zoom - Target zoom level
   * @param duration - Animation duration in ms
   * @param visibleArea - Optional visible area override (for panel transitions)
   * @returns true if the node was found and centered, false otherwise.
   */
  const centerOnNode = useCallback(
    (
      nodeId: string,
      zoom: number,
      duration: number,
      visibleArea?: { width: number; height: number },
    ): boolean => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return false;

      const dims = getNodeDimensions(nodeId);
      const nodeCenterX = node.position.x + dims.width / 2;
      const nodeCenterY = node.position.y + dims.height / 2;

      // Use provided visible area or fall back to current container dimensions
      const area = visibleArea ?? getVisibleArea();
      const { width, height } = area;

      // Calculate viewport position to center the node
      // screenX = graphX * zoom + viewport.x → viewport.x = screenX - graphX * zoom
      // To center: screenX = width/2, so viewport.x = width/2 - nodeCenterX * zoom
      const targetX = width / 2 - nodeCenterX * zoom;
      const targetY = height / 2 - nodeCenterY * zoom;

      // Clamp the target position to stay within bounds using the SAME area
      // (critical for panel transitions where current dimensions differ from target)
      const targetViewport = clampViewport({ x: targetX, y: targetY, zoom }, area);

      // Enable animation mode - during this period, we don't update React state
      // to avoid interfering with ReactFlow's internal animation
      isAnimatingRef.current = true;

      // Increment generation counter to track this specific animation
      const currentGeneration = ++animationGenerationRef.current;

      // Start the animation via ReactFlow's panZoom system
      // The promise resolves when animation completes
      reactFlowInstance.setViewport(targetViewport, { duration }).then(() => {
        // Only process if this is still the latest animation
        // (a newer animation may have started, making this one stale)
        if (animationGenerationRef.current !== currentGeneration) {
          return;
        }

        // Animation complete - sync our state to the final position
        // and disable animation mode
        isAnimatingRef.current = false;
        setViewport(targetViewport);
      });

      return true;
    },
    [nodesRef, getNodeDimensions, getVisibleArea, clampViewport, reactFlowInstance, setViewport],
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
  const onViewportChange = useEventCallback((newViewport: Viewport) => {
    // Fast path: During animation, DON'T update state at all.
    // Let ReactFlow's panZoom drive the animation uninterrupted.
    // Updating state would cause React to re-render, which triggers
    // ReactFlow's useViewportSync to call syncViewport(), potentially
    // interfering with the ongoing animation.
    // Our state will be synced to the final position when animation completes.
    if (isAnimatingRef.current) {
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
  // ---------------------------------------------------------------------------

  // Re-clamp when container size or node bounds change
  // Note: Effects run after render, so calling setState here is safe.
  // We use functional update to avoid stale closure issues.
  useEffect(() => {
    // Skip re-clamping if any animation is in progress
    // (centering animations handle their own clamping with expected dimensions)
    if (isAnimatingRef.current) {
      return;
    }

    // Clamp viewport synchronously (no RAF delay for immediate UI update)
    setViewport((prev) => clampViewport(prev));
  }, [nodeBounds, containerWidth, containerHeight, clampViewport]);

  // ---------------------------------------------------------------------------
  // Re-center on panel collapse/expand (when there's a selection)
  // Animation runs IN PARALLEL with panel CSS transition for seamless motion.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const panelCollapsedChanged = prevPanelCollapsedRef.current !== isPanelCollapsed;

    // Update ref for next comparison
    prevPanelCollapsedRef.current = isPanelCollapsed;

    // Only re-center if collapse state actually changed
    if (!panelCollapsedChanged) return;

    // Only re-center if there's a selection AND it has been centered before
    if (!selectedGroupName || prevSelectionRef.current !== selectedGroupName) return;

    // Skip if animation is already in progress
    if (isAnimatingRef.current) return;

    // Calculate expected visible area for the FINAL panel state
    const expectedArea = getExpectedVisibleArea(isPanelCollapsed);

    // Get current zoom level from our controlled state (avoid stale ReactFlow internal state)
    const currentZoom = viewportRef.current.zoom;

    // Start centering animation IMMEDIATELY (no delay).
    // Both animations run in parallel, creating a single seamless motion.
    centerOnNode(selectedGroupName, currentZoom, ANIMATION.PANEL_TRANSITION, expectedArea);
  }, [isPanelCollapsed, selectedGroupName, viewportRef, getExpectedVisibleArea, centerOnNode]);

  // ---------------------------------------------------------------------------
  // Re-center when panel drag ends (manual resize)
  // We don't know the final width until dragging stops, so defer until then.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const wasDragging = prevPanelDraggingRef.current;
    const dragJustEnded = wasDragging && !isPanelDragging;

    // Update refs
    prevPanelDraggingRef.current = isPanelDragging;
    prevPanelWidthPctRef.current = panelWidthPct;

    // Only re-center when drag ends
    if (!dragJustEnded) return;

    // Only re-center if there's a selection AND it has been centered before
    if (!selectedGroupName || prevSelectionRef.current !== selectedGroupName) return;

    // Skip if animation is already in progress
    if (isAnimatingRef.current) return;

    // Use CURRENT container dimensions (final after drag)
    // No need for expected dimensions since panel is already at final size
    const currentZoom = viewportRef.current.zoom;

    // Short animation since panel is already at final position
    centerOnNode(selectedGroupName, currentZoom, ANIMATION.BOUNDARY_ENFORCE);
  }, [isPanelDragging, panelWidthPct, selectedGroupName, viewportRef, centerOnNode]);

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
  }, [nodes.length, rootNodeIds, layoutDirection, initialSelectedNodeId, centerOnNode]);

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
    // Only auto-pan when there's a selection
    // selectedGroupName being non-null is the authoritative signal for selection
    // (panelView can have intermediate states during navigation transitions)
    if (!selectedGroupName) return;

    // Only pan when the GROUP changes, not when switching between group/task view
    // of the same group. The node position is the same either way.
    if (prevSelectionRef.current === selectedGroupName) return;

    const selectedNode = nodes.find((n) => n.id === selectedGroupName);
    // If node not found yet (still loading/layouting), don't set ref - retry when nodes update
    if (!selectedNode) return;

    // Calculate expected visible area for the FINAL panel state.
    // When selecting a node, the panel will expand (targetCollapsed = false).
    // Using expected dimensions allows immediate, accurate centering that
    // runs in parallel with the panel CSS transition.
    const expectedArea = getExpectedVisibleArea(false);

    // Use current zoom level from our controlled state (avoid stale ReactFlow internal state)
    const currentZoom = viewportRef.current.zoom;

    // Mark this selection as handled immediately
    prevSelectionRef.current = selectedGroupName;

    // Start centering animation IMMEDIATELY (no RAF delay).
    // Duration matches panel CSS transition for seamless parallel animation.
    centerOnNode(selectedGroupName, currentZoom, ANIMATION.PANEL_TRANSITION, expectedArea);

    // Store cleanup for user interaction cancellation
    // Note: We don't set isAnimatingRef to false in cleanup because centerOnNode
    // handles its own animation timing. Cleanup is only for clearing the cancel ref.
    const timerId = setTimeout(() => {
      cancelPendingAutoPanRef.current = null;
    }, ANIMATION.PANEL_TRANSITION + ANIMATION.BUFFER);

    cancelPendingAutoPanRef.current = () => {
      clearTimeout(timerId);
      cancelPendingAutoPanRef.current = null;
      // Note: Don't set isAnimatingRef.current = false here, as centerOnNode
      // manages its own timing. User cancellation just clears the cancel ref.
    };

    // Effect cleanup just clears the timeout, doesn't affect animation state
    return () => {
      clearTimeout(timerId);
    };
  }, [selectedGroupName, nodes, viewportRef, getExpectedVisibleArea, centerOnNode]);

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

  // ---------------------------------------------------------------------------
  // User Interaction Handler
  // ---------------------------------------------------------------------------

  /**
   * Cancel any pending auto-pan when user starts interacting with the viewport.
   * This respects user intent - if they're manually panning/zooming, don't fight them.
   * Pass this to ReactFlow's `onMoveStart` prop.
   *
   * IMPORTANT: We check `isAnimatingRef` to avoid cancelling our own programmatic
   * animations. ReactFlow fires `onMoveStart` for ALL viewport movements, including
   * `setViewport()` calls with duration. Without this check, our centering animations
   * would cancel themselves.
   */
  const onUserInteractionStart = useEventCallback(() => {
    // Don't cancel if we're in the middle of a programmatic animation
    // (our own setViewport calls trigger onMoveStart too)
    if (isAnimatingRef.current) {
      return;
    }

    if (cancelPendingAutoPanRef.current) {
      cancelPendingAutoPanRef.current();
    }
  });

  return { viewport, onViewportChange, onUserInteractionStart };
}
