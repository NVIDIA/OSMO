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
 * **Single source of truth** for viewport management in ReactFlow DAGs.
 *
 * ## Boundary Enforcement: translateExtent Only
 *
 * Uses React Flow's native `translateExtent` for instant boundary clamping.
 * No callbacks, no snap-back animations - just solid boundaries enforced by d3-zoom.
 *
 * The translateExtent is calculated based on the principle:
 * **"Any node can be centered in the viewport"**
 *
 * ## Architecture: Dependency Injection
 *
 * This hook is intentionally decoupled from layout concerns (panels, sidebars, etc.).
 * Consumers control re-centering behavior through:
 * - `getExpectedVisibleArea`: Callback to compute target visible area (for animations)
 * - `reCenterTrigger`: Counter to trigger re-centering on the selected node
 *
 * **UNCONTROLLED MODE**: ReactFlow manages viewport state internally.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useReactFlow, type CoordinateExtent, type Node, type Viewport } from "@xyflow/react";
import { useSyncedRef } from "@react-hookz/web";
import { useResizeObserver } from "usehooks-ts";
import { VIEWPORT, ANIMATION, NODE_DEFAULTS } from "../constants";
import type { LayoutDirection } from "../types";

// ============================================================================
// Constants
// ============================================================================

/** Tolerance for zoom comparison to avoid excessive re-renders */
const ZOOM_EPSILON = 0.01;

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
  /** Computed bounds of all nodes (assuming fully expanded for max bounds) */
  nodeBounds: NodeBounds;
  /** Container element ref for measuring (the DAG container) */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Currently selected node ID/name (for auto-pan) */
  selectedNodeId?: string | null;
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
   */
  initialSelectedNodeId?: string | null;

  // --- Generic re-centering (dependency injection) ---

  /**
   * Optional: Callback to get expected visible area for centering calculations.
   * Use this when the container is animating and you know the final dimensions.
   * If not provided, uses measured container dimensions.
   *
   * @example
   * ```tsx
   * // Consumer computes expected area based on their layout
   * getExpectedVisibleArea={() => ({
   *   width: outerWidth - (isPanelCollapsed ? 40 : outerWidth * 0.5),
   *   height: containerHeight,
   * })}
   * ```
   */
  getExpectedVisibleArea?: () => { width: number; height: number };

  /**
   * Optional: Increment to trigger re-centering on the selected node.
   * The hook will re-center when this value changes.
   *
   * @example
   * ```tsx
   * // Consumer triggers re-center when layout changes
   * const [reCenterTrigger, setReCenterTrigger] = useState(0);
   * useEffect(() => {
   *   if (panelStateChanged) setReCenterTrigger(t => t + 1);
   * }, [isPanelCollapsed, panelDragEnded]);
   * ```
   */
  reCenterTrigger?: number;
}

export interface ViewportBoundariesResult {
  /**
   * Pass to ReactFlow's `translateExtent` prop.
   * Dynamic bounds based on node bounds, container size, and current zoom.
   * React Flow enforces these natively via d3-zoom (instant clamp, no snap-back).
   */
  translateExtent: CoordinateExtent | undefined;

  /**
   * Pass to ReactFlow's `onViewportChange` prop.
   * Only used for tracking zoom changes to update translateExtent.
   * No clamping logic - boundaries are enforced natively by translateExtent.
   */
  onViewportChange: (viewport: Viewport) => void;
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
  // Zoom Tracking (for dynamic translateExtent)
  // ---------------------------------------------------------------------------

  // Initialize to 1.0 (React Flow's default) rather than our DEFAULT_ZOOM
  // This prevents mismatch on first render before onViewportChange fires
  const [currentZoom, setCurrentZoom] = useState(1.0);

  /**
   * Track zoom changes to update translateExtent.
   * Only updates state if zoom actually changed (avoids re-renders on pan).
   */
  const onViewportChange = useCallback((viewport: Viewport) => {
    setCurrentZoom((prev) => (Math.abs(prev - viewport.zoom) > ZOOM_EPSILON ? viewport.zoom : prev));
  }, []);

  // ---------------------------------------------------------------------------
  // Initialization & Tracking Refs
  // ---------------------------------------------------------------------------

  /** Track if initial centering has been performed */
  const hasInitializedRef = useRef(false);
  /** Track previous layout direction for detecting changes */
  const prevLayoutDirectionRef = useRef(layoutDirection);
  /** Track if we've handled the initial selected node (only try once per deep link) */
  const hasHandledInitialSelectionRef = useRef(false);

  // Track previous selection to detect new selections (for auto-pan on selection)
  const prevSelectionRef = useRef<string | null>(null);

  // Track previous re-center trigger to detect changes
  const prevReCenterTriggerRef = useRef(reCenterTrigger);

  // Flag to indicate animation is in progress
  const isAnimatingRef = useRef(false);

  // Counter to track animation generations
  const animationGenerationRef = useRef(0);

  // Stable refs for values used in handlers
  const nodeBoundsRef = useSyncedRef(nodeBounds);
  const nodesRef = useSyncedRef(nodes);
  const getExpectedVisibleAreaRef = useSyncedRef(getExpectedVisibleArea);

  // ---------------------------------------------------------------------------
  // Container Resize Detection
  // ---------------------------------------------------------------------------

  const { width: containerWidth = VIEWPORT.ESTIMATED_WIDTH, height: containerHeight = VIEWPORT.ESTIMATED_HEIGHT } =
    useResizeObserver({ ref: containerRef as React.RefObject<HTMLElement>, box: "border-box" });

  // ---------------------------------------------------------------------------
  // translateExtent: Dynamic Boundaries
  // ---------------------------------------------------------------------------

  /**
   * Calculate translateExtent based on "any node can be centered" principle.
   *
   * translateExtent is in FLOW coordinates (not viewport coordinates).
   * It defines the area that can be panned to - any point within this area
   * can be brought into view.
   *
   * To ensure any node can be centered at any zoom level, we need padding
   * that accounts for the visible area at the current zoom.
   *
   * At zoom Z with container size W×H:
   * - Visible area in flow coords = (W/Z) × (H/Z)
   * - To center a node at the edge, we need padding of (W/2)/Z or (H/2)/Z
   */
  const translateExtent = useMemo((): CoordinateExtent | undefined => {
    if (!nodeBounds || !containerWidth || !containerHeight) {
      return undefined;
    }

    // Padding in flow coordinates that allows edge nodes to be centered
    // Use current zoom to calculate how much padding is needed
    const zoom = currentZoom || VIEWPORT.DEFAULT_ZOOM;
    const paddingX = containerWidth / (2 * zoom);
    const paddingY = containerHeight / (2 * zoom);

    // The pannable area in flow coordinates
    // Any point within this area can be brought into view
    return [
      [nodeBounds.minX - paddingX, nodeBounds.minY - paddingY],
      [nodeBounds.maxX + paddingX, nodeBounds.maxY + paddingY],
    ];
  }, [nodeBounds, containerWidth, containerHeight, currentZoom]);

  // ---------------------------------------------------------------------------
  // Helpers for Centering
  // ---------------------------------------------------------------------------

  const containerDimsRef = useSyncedRef({ width: containerWidth, height: containerHeight });

  const getVisibleArea = useCallback(() => {
    return containerDimsRef.current;
  }, [containerDimsRef]);

  /**
   * Clamp viewport to current bounds (used for centering calculations).
   */
  const clampViewport = useCallback(
    (vp: Viewport, visibleArea?: { width: number; height: number }): Viewport => {
      const area = visibleArea ?? getVisibleArea();
      const bounds = nodeBoundsRef.current;
      const halfWidth = area.width / 2;
      const halfHeight = area.height / 2;

      const minX = halfWidth - bounds.maxX * vp.zoom;
      const maxX = halfWidth - bounds.minX * vp.zoom;
      const minY = halfHeight - bounds.maxY * vp.zoom;
      const maxY = halfHeight - bounds.minY * vp.zoom;

      return {
        x: Math.max(minX, Math.min(maxX, vp.x)),
        y: Math.max(minY, Math.min(maxY, vp.y)),
        zoom: vp.zoom,
      };
    },
    [getVisibleArea, nodeBoundsRef],
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
   */
  const centerOnNode = useCallback(
    (nodeId: string, zoom: number, duration: number, visibleArea?: { width: number; height: number }): boolean => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return false;

      const dims = getNodeDimensions(nodeId);
      const nodeCenterX = node.position.x + dims.width / 2;
      const nodeCenterY = node.position.y + dims.height / 2;

      const area = visibleArea ?? getVisibleArea();
      const { width, height } = area;

      const targetX = width / 2 - nodeCenterX * zoom;
      const targetY = height / 2 - nodeCenterY * zoom;

      const targetViewport = clampViewport({ x: targetX, y: targetY, zoom }, area);

      isAnimatingRef.current = true;
      const currentGeneration = ++animationGenerationRef.current;

      reactFlowInstance.setViewport(targetViewport, { duration }).then(() => {
        if (animationGenerationRef.current !== currentGeneration) {
          return;
        }
        isAnimatingRef.current = false;
      });

      return true;
    },
    [nodesRef, getNodeDimensions, getVisibleArea, clampViewport, reactFlowInstance],
  );

  // ---------------------------------------------------------------------------
  // Re-center on trigger change (generic - consumer controls when to trigger)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (prevReCenterTriggerRef.current === reCenterTrigger) return;
    prevReCenterTriggerRef.current = reCenterTrigger;

    if (!selectedNodeId) return;
    if (isAnimatingRef.current) return;

    // Use consumer-provided expected area, or fall back to measured container
    const visibleArea = getExpectedVisibleAreaRef.current?.() ?? getVisibleArea();
    const zoom = reactFlowInstance.getViewport().zoom;

    centerOnNode(selectedNodeId, zoom, ANIMATION.PANEL_TRANSITION, visibleArea);
  }, [reCenterTrigger, selectedNodeId, getVisibleArea, centerOnNode, reactFlowInstance, getExpectedVisibleAreaRef]);

  // ---------------------------------------------------------------------------
  // Initial Load Centering
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (hasInitializedRef.current) return;
    if (nodes.length === 0) return;
    if (rootNodeIds.length === 0) return;

    const timer = setTimeout(() => {
      if (initialSelectedNodeId && !hasHandledInitialSelectionRef.current) {
        hasHandledInitialSelectionRef.current = true;
        const found = centerOnNode(initialSelectedNodeId, VIEWPORT.INITIAL_ZOOM, ANIMATION.INITIAL_DURATION);
        if (found) {
          hasInitializedRef.current = true;
          prevLayoutDirectionRef.current = layoutDirection;
          prevSelectionRef.current = initialSelectedNodeId;
          return;
        }
      }

      centerOnNode(rootNodeIds[0], VIEWPORT.INITIAL_ZOOM, ANIMATION.INITIAL_DURATION);
      hasInitializedRef.current = true;
      prevLayoutDirectionRef.current = layoutDirection;
    }, ANIMATION.DELAY);

    return () => clearTimeout(timer);
  }, [nodes.length, rootNodeIds, layoutDirection, initialSelectedNodeId, centerOnNode]);

  // ---------------------------------------------------------------------------
  // Layout Direction Change Re-centering
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!hasInitializedRef.current) return;
    if (prevLayoutDirectionRef.current === layoutDirection) return;

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
    if (!selectedNodeId) return;
    if (prevSelectionRef.current === selectedNodeId) return;

    const selectedNode = nodes.find((n) => n.id === selectedNodeId);
    if (!selectedNode) return;

    // Use consumer-provided expected area, or fall back to measured container
    const visibleArea = getExpectedVisibleAreaRef.current?.() ?? getVisibleArea();
    const zoom = reactFlowInstance.getViewport().zoom;

    prevSelectionRef.current = selectedNodeId;

    centerOnNode(selectedNodeId, zoom, ANIMATION.PANEL_TRANSITION, visibleArea);
  }, [selectedNodeId, nodes, getVisibleArea, centerOnNode, reactFlowInstance, getExpectedVisibleAreaRef]);

  // ---------------------------------------------------------------------------
  // Clear refs when selection is cleared
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedNodeId) {
      prevSelectionRef.current = null;
    }
  }, [selectedNodeId]);

  return {
    translateExtent,
    onViewportChange,
  };
}
