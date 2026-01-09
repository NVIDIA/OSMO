// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * useViewportBoundaries Hook
 *
 * Manages dynamic viewport boundaries for ReactFlow.
 * Ensures outermost nodes can always be centered in the visible area.
 *
 * Why not translateExtent?
 * - translateExtent is in world coordinates (zoom-independent)
 * - Our constraint is viewport-dependent (changes with zoom + panel width)
 * - ReactFlow doesn't support dynamic viewport-space constraints natively
 *
 * This hook provides:
 * - onMove handler: Enforces bounds during panning
 * - onMoveEnd handler: Final cleanup after pan ends
 * - Auto-pan effect: Centers selected node after panel opens
 * - Resize effect: Maintains bounds when panel resizes
 */

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import { VIEWPORT, NODE_COLLAPSED, ANIMATION } from "../constants";
import type { GroupNodeData } from "../types/dag-layout";
import type { Node } from "@xyflow/react";

// ============================================================================
// Types
// ============================================================================

interface NodeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  fitAllZoom: number;
}

interface UseViewportBoundariesOptions {
  /** Computed bounds of all nodes */
  nodeBounds: NodeBounds;
  /** Panel width as percentage (0-100) */
  panelPct: number;
  /** Whether panel is currently open */
  isPanelOpen: boolean;
  /** Container element ref for measuring */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Currently selected group (for auto-pan) */
  selectedGroupName: string | null;
  /** Current panel view state */
  panelView: "none" | "workflow" | "group" | "task";
  /** All nodes (for finding selected node position) */
  nodes: Node[];
}

interface ViewportBoundariesResult {
  /** Handler for ReactFlow onMove - enforces bounds during pan */
  handleMove: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void;
  /** Handler for ReactFlow onMoveEnd - final bound enforcement */
  handleMoveEnd: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useViewportBoundaries({
  nodeBounds,
  panelPct,
  isPanelOpen,
  containerRef,
  selectedGroupName,
  panelView,
  nodes,
}: UseViewportBoundariesOptions): ViewportBoundariesResult {
  const reactFlowInstance = useReactFlow();

  // Track previous selection to detect new selections vs resizes
  const prevSelectionRef = useRef<string | null>(null);

  // Track "desired" viewport position (where user wants to be)
  const desiredViewportRef = useRef<{ x: number; y: number } | null>(null);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get current visible area dimensions (accounting for panel).
   * Called fresh each time to avoid stale closures.
   */
  const getVisibleArea = useCallback(() => {
    const container = containerRef.current;
    const containerWidth = container?.clientWidth || VIEWPORT.ESTIMATED_WIDTH;
    const containerHeight = container?.clientHeight || VIEWPORT.ESTIMATED_HEIGHT;
    const panelWidthPx = isPanelOpen ? (panelPct / 100) * containerWidth : 0;
    return {
      width: containerWidth - panelWidthPx,
      height: containerHeight,
    };
  }, [containerRef, isPanelOpen, panelPct]);

  /**
   * Calculate viewport bounds that allow any outermost node to be centered.
   *
   * For a node at worldX to appear at screenX:
   *   screenX = worldX * zoom + viewport.x
   *
   * For rightmost node at center: viewport.x = visWidth/2 - maxX * zoom (minVpX)
   * For leftmost node at center: viewport.x = visWidth/2 - minX * zoom (maxVpX)
   */
  const getViewportBounds = useCallback(
    (zoom: number, visWidth: number, visHeight: number) => {
      return {
        minX: visWidth / 2 - nodeBounds.maxX * zoom,
        maxX: visWidth / 2 - nodeBounds.minX * zoom,
        minY: visHeight / 2 - nodeBounds.maxY * zoom,
        maxY: visHeight / 2 - nodeBounds.minY * zoom,
      };
    },
    [nodeBounds],
  );

  // ---------------------------------------------------------------------------
  // Auto-pan to selected node (only on NEW selection, after panel renders)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedGroupName || panelView === "none") return;

    // Only auto-pan on NEW selection
    const currentSelection = `${selectedGroupName}-${panelView}`;
    if (prevSelectionRef.current === currentSelection) return;
    prevSelectionRef.current = currentSelection;

    const selectedNode = nodes.find((n) => n.id === selectedGroupName);
    if (!selectedNode) return;

    // Double rAF ensures panel layout is complete before measuring
    let innerFrameId: number;

    const outerFrameId = requestAnimationFrame(() => {
      innerFrameId = requestAnimationFrame(() => {
        const nodeData = selectedNode.data as GroupNodeData;
        const nodeWidth = nodeData?.nodeWidth || NODE_COLLAPSED.width;
        const nodeHeight = nodeData?.nodeHeight || NODE_COLLAPSED.height;
        const nodeCenterX = selectedNode.position.x + nodeWidth / 2;
        const nodeCenterY = selectedNode.position.y + nodeHeight / 2;

        const viewport = reactFlowInstance.getViewport();
        const { width, height } = getVisibleArea();

        // Center node in visible area
        const targetX = -(nodeCenterX * viewport.zoom) + width / 2;
        const targetY = -(nodeCenterY * viewport.zoom) + height / 2;

        desiredViewportRef.current = { x: targetX, y: targetY };

        reactFlowInstance.setViewport(
          { x: targetX, y: targetY, zoom: viewport.zoom },
          { duration: ANIMATION.NODE_CENTER },
        );
      });
    });

    return () => {
      cancelAnimationFrame(outerFrameId);
      cancelAnimationFrame(innerFrameId);
    };
  }, [selectedGroupName, panelView, nodes, reactFlowInstance, getVisibleArea]);

  // ---------------------------------------------------------------------------
  // Enforce boundaries when visible area changes (panel resize)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const viewport = reactFlowInstance.getViewport();
    const { width, height } = getVisibleArea();
    const bounds = getViewportBounds(viewport.zoom, width, height);

    let newX = viewport.x;
    let newY = viewport.y;
    let needsUpdate = false;

    // If we have a desired position, try to get as close to it as bounds allow
    if (desiredViewportRef.current) {
      const desired = desiredViewportRef.current;
      newX = Math.max(bounds.minX, Math.min(bounds.maxX, desired.x));
      newY = Math.max(bounds.minY, Math.min(bounds.maxY, desired.y));
      needsUpdate = Math.abs(newX - viewport.x) > 0.5 || Math.abs(newY - viewport.y) > 0.5;
    } else {
      // No desired position - just clamp to bounds
      newX = Math.max(bounds.minX, Math.min(bounds.maxX, viewport.x));
      newY = Math.max(bounds.minY, Math.min(bounds.maxY, viewport.y));
      needsUpdate = newX !== viewport.x || newY !== viewport.y;
    }

    if (needsUpdate) {
      reactFlowInstance.setViewport(
        { x: newX, y: newY, zoom: viewport.zoom },
        { duration: ANIMATION.BOUNDARY_ENFORCE },
      );
    }
  }, [panelPct, isPanelOpen, reactFlowInstance, getViewportBounds, getVisibleArea]);

  // ---------------------------------------------------------------------------
  // Clear refs when panel closes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (panelView === "none") {
      prevSelectionRef.current = null;
      desiredViewportRef.current = null;
    }
  }, [panelView]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Enforce viewport bounds during panning.
   * Prevents user from panning nodes out of visible area.
   */
  const handleMove = useCallback(
    (_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
      const { width, height } = getVisibleArea();
      const bounds = getViewportBounds(viewport.zoom, width, height);

      const outOfBoundsX = viewport.x < bounds.minX || viewport.x > bounds.maxX;
      const outOfBoundsY = viewport.y < bounds.minY || viewport.y > bounds.maxY;

      if (outOfBoundsX || outOfBoundsY) {
        const clampedX = Math.max(bounds.minX, Math.min(bounds.maxX, viewport.x));
        const clampedY = Math.max(bounds.minY, Math.min(bounds.maxY, viewport.y));
        reactFlowInstance.setViewport({ x: clampedX, y: clampedY, zoom: viewport.zoom });
      }
    },
    [reactFlowInstance, getVisibleArea, getViewportBounds],
  );

  /**
   * Final boundary enforcement after pan ends.
   * Also stores position as "desired" for resize logic.
   */
  const handleMoveEnd = useCallback(() => {
    const viewport = reactFlowInstance.getViewport();
    const { width, height } = getVisibleArea();
    const bounds = getViewportBounds(viewport.zoom, width, height);

    const clampedX = Math.max(bounds.minX, Math.min(bounds.maxX, viewport.x));
    const clampedY = Math.max(bounds.minY, Math.min(bounds.maxY, viewport.y));

    // Store as desired position so resize respects it
    desiredViewportRef.current = { x: clampedX, y: clampedY };

    if (Math.abs(clampedX - viewport.x) > 0.5 || Math.abs(clampedY - viewport.y) > 0.5) {
      reactFlowInstance.setViewport(
        { x: clampedX, y: clampedY, zoom: viewport.zoom },
        { duration: ANIMATION.MOVE_END },
      );
    }
  }, [reactFlowInstance, getVisibleArea, getViewportBounds]);

  return { handleMove, handleMoveEnd };
}
