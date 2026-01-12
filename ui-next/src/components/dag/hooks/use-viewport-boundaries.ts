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
 * - Selection-based auto-pan with smooth animation
 * - Dynamic boundary clamping
 *
 * **UNCONTROLLED MODE**: ReactFlow manages viewport state internally.
 * This allows native smooth animations while we handle:
 * - Centering via `reactFlowInstance.setViewport()` with duration
 * - Boundary enforcement via `onViewportChange` callback
 *
 * Architecture (Side-by-Side Model):
 * - The DAG container IS the visible area (no overlay math needed)
 * - Container dimensions directly determine viewport boundaries
 * - Panel changes cause container resize → ReactFlow handles naturally
 */

"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
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

/** Duration for boundary snap animation (ms) - keep short for responsiveness */
const BOUNDARY_SNAP_DURATION = 50;

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
  /**
   * Handler for viewport changes - pass to ReactFlow's `onViewportChange` prop.
   * Enforces boundaries when user pans/zooms outside allowed area.
   */
  onViewportChange: (viewport: Viewport) => void;
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

  // Flag to indicate animation is in progress - skip boundary enforcement during animation
  const isAnimatingRef = useRef(false);

  // Flag to prevent infinite loop when enforcing boundaries
  // When we call setViewport to clamp, it triggers onViewportChange again
  const isEnforcingBoundaryRef = useRef(false);

  // Counter to track animation generations - prevents old animation callbacks
  // from interfering with newer animations
  const animationGenerationRef = useRef(0);

  // Stable refs for values used in handlers to avoid stale closures
  const nodeBoundsRef = useSyncedRef(nodeBounds);
  const nodesRef = useSyncedRef(nodes);

  // ---------------------------------------------------------------------------
  // Container Resize Detection (via usehooks-ts)
  // ---------------------------------------------------------------------------

  const { width: containerWidth = VIEWPORT.ESTIMATED_WIDTH, height: containerHeight = VIEWPORT.ESTIMATED_HEIGHT } =
    useResizeObserver({ ref: containerRef as React.RefObject<HTMLElement>, box: "border-box" });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get visible area from container dimensions.
   * Uses useSyncedRef to always access latest values without stale closures.
   */
  const containerDimsRef = useSyncedRef({ width: containerWidth, height: containerHeight });
  const getVisibleArea = useCallback(() => {
    return containerDimsRef.current;
  }, [containerDimsRef]);

  /**
   * Calculate the expected visible width after panel transition completes.
   */
  const getExpectedVisibleArea = useCallback(
    (targetCollapsed: boolean): { width: number; height: number } => {
      const outer = outerContainerRef?.current;
      if (!outer) {
        return containerDimsRef.current;
      }

      const outerWidth = outer.clientWidth;
      const height = containerDimsRef.current.height;

      const panelWidth = targetCollapsed ? collapsedPanelWidthPx : (outerWidth * panelWidthPct) / 100;
      const expectedWidth = Math.max(100, outerWidth - panelWidth);

      return { width: expectedWidth, height };
    },
    [outerContainerRef, panelWidthPct, collapsedPanelWidthPx, containerDimsRef],
  );

  /**
   * Calculate viewport bounds for given zoom level and visible area.
   */
  const getViewportBounds = useCallback(
    (zoom: number, visWidth: number, visHeight: number) => {
      const bounds = nodeBoundsRef.current;
      const halfVisWidth = visWidth * 0.5;
      const halfVisHeight = visHeight * 0.5;

      return {
        minX: halfVisWidth - bounds.maxX * zoom,
        maxX: halfVisWidth - bounds.minX * zoom,
        minY: halfVisHeight - bounds.maxY * zoom,
        maxY: halfVisHeight - bounds.minY * zoom,
      };
    },
    [nodeBoundsRef],
  );

  /**
   * Clamp viewport to bounds.
   */
  const clampViewport = useCallback(
    (vp: Viewport, visibleArea?: { width: number; height: number }): Viewport => {
      const area = visibleArea ?? getVisibleArea();
      const limits = getViewportBounds(vp.zoom, area.width, area.height);

      const clampedX = Math.max(limits.minX, Math.min(limits.maxX, vp.x));
      const clampedY = Math.max(limits.minY, Math.min(limits.maxY, vp.y));

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
   *
   * Uses ReactFlow's native animation (uncontrolled mode = smooth animations!).
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

      // Mark animation in progress - skip boundary enforcement during animation
      isAnimatingRef.current = true;
      const currentGeneration = ++animationGenerationRef.current;

      // Use ReactFlow's native animation - works great in uncontrolled mode!
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
  // Viewport Change Handler (Boundary Enforcement)
  // ---------------------------------------------------------------------------

  /**
   * Viewport change handler - enforces boundaries in uncontrolled mode.
   *
   * When user pans/zooms outside bounds, we snap them back with a short animation.
   * During programmatic animations (isAnimatingRef = true), we skip enforcement
   * to allow smooth transitions to the target.
   */
  const onViewportChange = useEventCallback((newViewport: Viewport) => {
    // Skip during our own animations
    if (isAnimatingRef.current) {
      return;
    }

    // Skip if we're already enforcing boundaries (prevents infinite loop)
    if (isEnforcingBoundaryRef.current) {
      return;
    }

    const area = getVisibleArea();
    const clamped = clampViewport(newViewport, area);

    // Check if viewport is outside bounds
    const needsClamp =
      Math.abs(newViewport.x - clamped.x) >= VIEWPORT_EPSILON ||
      Math.abs(newViewport.y - clamped.y) >= VIEWPORT_EPSILON;

    if (needsClamp) {
      // Set flag to prevent re-entry
      isEnforcingBoundaryRef.current = true;

      // Snap back to bounds with a short animation for smoothness
      reactFlowInstance.setViewport(clamped, { duration: BOUNDARY_SNAP_DURATION }).then(() => {
        isEnforcingBoundaryRef.current = false;
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Re-clamp viewport when bounds change (node bounds or container size)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (isAnimatingRef.current) return;
    if (isEnforcingBoundaryRef.current) return;

    const currentVp = reactFlowInstance.getViewport();
    const clamped = clampViewport(currentVp);

    if (
      Math.abs(currentVp.x - clamped.x) >= VIEWPORT_EPSILON ||
      Math.abs(currentVp.y - clamped.y) >= VIEWPORT_EPSILON
    ) {
      isEnforcingBoundaryRef.current = true;
      reactFlowInstance.setViewport(clamped, { duration: BOUNDARY_SNAP_DURATION }).then(() => {
        isEnforcingBoundaryRef.current = false;
      });
    }
  }, [nodeBounds, containerWidth, containerHeight, clampViewport, reactFlowInstance]);

  // ---------------------------------------------------------------------------
  // Re-center on panel collapse/expand (when there's a selection)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const panelCollapsedChanged = prevPanelCollapsedRef.current !== isPanelCollapsed;
    prevPanelCollapsedRef.current = isPanelCollapsed;

    if (!panelCollapsedChanged) return;
    if (!selectedGroupName || prevSelectionRef.current !== selectedGroupName) return;
    if (isAnimatingRef.current) return;

    const expectedArea = getExpectedVisibleArea(isPanelCollapsed);
    const currentZoom = reactFlowInstance.getViewport().zoom;

    centerOnNode(selectedGroupName, currentZoom, ANIMATION.PANEL_TRANSITION, expectedArea);
  }, [isPanelCollapsed, selectedGroupName, getExpectedVisibleArea, centerOnNode, reactFlowInstance]);

  // ---------------------------------------------------------------------------
  // Re-center when panel drag ends (manual resize)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const wasDragging = prevPanelDraggingRef.current;
    const dragJustEnded = wasDragging && !isPanelDragging;

    prevPanelDraggingRef.current = isPanelDragging;
    prevPanelWidthPctRef.current = panelWidthPct;

    if (!dragJustEnded) return;
    if (!selectedGroupName || prevSelectionRef.current !== selectedGroupName) return;
    if (isAnimatingRef.current) return;

    const currentZoom = reactFlowInstance.getViewport().zoom;
    centerOnNode(selectedGroupName, currentZoom, ANIMATION.BOUNDARY_ENFORCE);
  }, [isPanelDragging, panelWidthPct, selectedGroupName, centerOnNode, reactFlowInstance]);

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
    if (!selectedGroupName) return;
    if (prevSelectionRef.current === selectedGroupName) return;

    const selectedNode = nodes.find((n) => n.id === selectedGroupName);
    if (!selectedNode) return;

    const expectedArea = getExpectedVisibleArea(false);
    const currentZoom = reactFlowInstance.getViewport().zoom;

    prevSelectionRef.current = selectedGroupName;

    centerOnNode(selectedGroupName, currentZoom, ANIMATION.PANEL_TRANSITION, expectedArea);
  }, [selectedGroupName, nodes, getExpectedVisibleArea, centerOnNode, reactFlowInstance]);

  // ---------------------------------------------------------------------------
  // Clear refs when selection is cleared
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedGroupName) {
      prevSelectionRef.current = null;
    }
  }, [selectedGroupName]);

  return { onViewportChange };
}
