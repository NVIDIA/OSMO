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
 * FitViewOnLayoutChange Component
 *
 * Automatically adjusts the viewport when layout direction changes.
 * Zooms to the first root node with smooth animation.
 */

"use client";

import { useEffect, useRef, useCallback, memo } from "react";
import { useReactFlow } from "@xyflow/react";
import type { LayoutDirection } from "../types";
import { ANIMATION, NODE_DEFAULTS } from "../constants";

export interface FitViewOnLayoutChangeProps {
  /** Current layout direction */
  layoutDirection: LayoutDirection;
  /** IDs of root nodes (nodes with no incoming edges) */
  rootNodeIds: string[];
  /** Function to get node dimensions by ID */
  getNodeDimensions?: (nodeId: string) => { width: number; height: number } | null;
  /**
   * Optional: Node ID to center on during initial load.
   * When provided (e.g., from URL via nuqs), initial view will center on this node
   * instead of the first root node. Useful for deep-linking to a specific node.
   */
  initialSelectedNodeId?: string | null;
}

/**
 * Memoized component to prevent re-renders during panning/zooming.
 * Only re-renders when layout direction or root nodes change.
 */
export const FitViewOnLayoutChange = memo(function FitViewOnLayoutChange({
  layoutDirection,
  rootNodeIds,
  getNodeDimensions,
  initialSelectedNodeId,
}: FitViewOnLayoutChangeProps) {
  const { setCenter, getNode } = useReactFlow();
  const prevLayout = useRef(layoutDirection);
  const hasInitialized = useRef(false);
  // Track if we've handled the initial selected node (only try once)
  const hasHandledInitialSelection = useRef(false);

  /**
   * Center on a specific node with animation.
   * Returns true if the node was found and centered, false otherwise.
   */
  const centerOnNode = useCallback(
    (nodeId: string, duration: number = ANIMATION.INITIAL_DURATION): boolean => {
      const node = getNode(nodeId);
      if (!node) return false;

      const dims = getNodeDimensions?.(nodeId) ?? {
        width: NODE_DEFAULTS.width,
        height: NODE_DEFAULTS.height,
      };
      const centerX = node.position.x + dims.width / 2;
      const centerY = node.position.y + dims.height / 2;

      setCenter(centerX, centerY, {
        zoom: 1,
        duration,
      });
      return true;
    },
    [getNode, setCenter, getNodeDimensions],
  );

  const zoomToRoot = useCallback(
    (duration: number = ANIMATION.INITIAL_DURATION) => {
      if (rootNodeIds.length === 0) return;
      centerOnNode(rootNodeIds[0], duration);
    },
    [rootNodeIds, centerOnNode],
  );

  // Handle initial load: center on selected node (from URL) or root node
  useEffect(() => {
    if (hasInitialized.current) return;

    const timer = setTimeout(() => {
      // If there's an initial selection from URL, center on that node
      if (initialSelectedNodeId && !hasHandledInitialSelection.current) {
        hasHandledInitialSelection.current = true;
        const found = centerOnNode(initialSelectedNodeId, ANIMATION.INITIAL_DURATION);
        if (found) {
          hasInitialized.current = true;
          prevLayout.current = layoutDirection;
          return;
        }
        // Node not found (maybe not rendered yet) - fall through to root
      }

      // Default: center on first root node
      zoomToRoot(ANIMATION.INITIAL_DURATION);
      hasInitialized.current = true;
      prevLayout.current = layoutDirection;
    }, ANIMATION.DELAY);

    return () => clearTimeout(timer);
  }, [layoutDirection, zoomToRoot, initialSelectedNodeId, centerOnNode]);

  // Handle layout direction changes (after initial load)
  useEffect(() => {
    if (!hasInitialized.current) return;
    if (prevLayout.current === layoutDirection) return;

    const timer = setTimeout(() => {
      zoomToRoot(ANIMATION.VIEWPORT_DURATION);
      prevLayout.current = layoutDirection;
    }, ANIMATION.DELAY);

    return () => clearTimeout(timer);
  }, [layoutDirection, zoomToRoot]);

  return null;
});
