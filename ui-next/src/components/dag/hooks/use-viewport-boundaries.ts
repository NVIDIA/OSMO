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
 * Manages dynamic viewport boundaries for ReactFlow.
 * Ensures outermost nodes can always be centered in the visible area.
 *
 * This hook provides:
 * - onMove handler: Enforces bounds during panning
 * - onMoveEnd handler: Final cleanup after pan ends
 * - Auto-pan effect: Centers selected node after panel opens
 * - Resize effect: Maintains bounds when panel resizes
 */

"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useReactFlow, type Node } from "@xyflow/react";
import { VIEWPORT, ANIMATION, NODE_DEFAULTS } from "../constants";

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
  /** Panel width as percentage (0-100) */
  panelPct: number;
  /** Whether panel is currently open */
  isPanelOpen: boolean;
  /** Container element ref for measuring */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Currently selected node ID/name (for auto-pan) */
  selectedGroupName: string | null;
  /** Current panel view state */
  panelView: string;
  /** All nodes (for finding selected node position) */
  nodes: Node[];
}

export interface ViewportBoundariesResult {
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

  // Track "desired" viewport position
  const desiredViewportRef = useRef<{ x: number; y: number } | null>(null);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
  // Auto-pan to selected node
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedGroupName || panelView === "none") return;

    const currentSelection = `${selectedGroupName}-${panelView}`;
    if (prevSelectionRef.current === currentSelection) return;
    prevSelectionRef.current = currentSelection;

    const selectedNode = nodes.find((n) => n.id === selectedGroupName);
    if (!selectedNode) return;

    let innerFrameId: number;

    const outerFrameId = requestAnimationFrame(() => {
      innerFrameId = requestAnimationFrame(() => {
        // Get node dimensions from data if available
        const nodeData = selectedNode.data as Record<string, unknown> | undefined;
        const nodeWidth = (nodeData?.nodeWidth as number) || NODE_DEFAULTS.width;
        const nodeHeight = (nodeData?.nodeHeight as number) || NODE_DEFAULTS.height;
        const nodeCenterX = selectedNode.position.x + nodeWidth / 2;
        const nodeCenterY = selectedNode.position.y + nodeHeight / 2;

        const viewport = reactFlowInstance.getViewport();
        const { width, height } = getVisibleArea();

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
  // Enforce boundaries when visible area changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const viewport = reactFlowInstance.getViewport();
    const { width, height } = getVisibleArea();
    const bounds = getViewportBounds(viewport.zoom, width, height);

    let newX = viewport.x;
    let newY = viewport.y;
    let needsUpdate = false;

    if (desiredViewportRef.current) {
      const desired = desiredViewportRef.current;
      newX = Math.max(bounds.minX, Math.min(bounds.maxX, desired.x));
      newY = Math.max(bounds.minY, Math.min(bounds.maxY, desired.y));
      needsUpdate = Math.abs(newX - viewport.x) > 0.5 || Math.abs(newY - viewport.y) > 0.5;
    } else {
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

  const handleMoveEnd = useCallback(() => {
    const viewport = reactFlowInstance.getViewport();
    const { width, height } = getVisibleArea();
    const bounds = getViewportBounds(viewport.zoom, width, height);

    const clampedX = Math.max(bounds.minX, Math.min(bounds.maxX, viewport.x));
    const clampedY = Math.max(bounds.minY, Math.min(bounds.maxY, viewport.y));

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
