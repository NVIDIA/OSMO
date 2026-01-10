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

import { useEffect, useRef, useCallback } from "react";
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
}

export function FitViewOnLayoutChange({ layoutDirection, rootNodeIds, getNodeDimensions }: FitViewOnLayoutChangeProps) {
  const { setCenter, getNode } = useReactFlow();
  const prevLayout = useRef(layoutDirection);
  const hasInitialized = useRef(false);

  const zoomToRoot = useCallback(
    (duration: number = ANIMATION.INITIAL_DURATION) => {
      if (rootNodeIds.length === 0) return;

      const firstRootId = rootNodeIds[0];
      const rootNode = getNode(firstRootId);

      if (rootNode) {
        const dims = getNodeDimensions?.(firstRootId) ?? {
          width: NODE_DEFAULTS.width,
          height: NODE_DEFAULTS.height,
        };
        const centerX = rootNode.position.x + dims.width / 2;
        const centerY = rootNode.position.y + dims.height / 2;

        setCenter(centerX, centerY, {
          zoom: 1,
          duration,
        });
      }
    },
    [rootNodeIds, getNode, setCenter, getNodeDimensions],
  );

  useEffect(() => {
    if (!hasInitialized.current || prevLayout.current !== layoutDirection) {
      const timer = setTimeout(() => {
        zoomToRoot(hasInitialized.current ? ANIMATION.VIEWPORT_DURATION : ANIMATION.INITIAL_DURATION);
        hasInitialized.current = true;
        prevLayout.current = layoutDirection;
      }, ANIMATION.DELAY);
      return () => clearTimeout(timer);
    }
  }, [layoutDirection, zoomToRoot]);

  return null;
}
