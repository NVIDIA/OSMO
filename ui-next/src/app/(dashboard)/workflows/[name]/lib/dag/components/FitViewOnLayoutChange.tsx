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
 * FitViewOnLayoutChange Component
 *
 * Automatically adjusts the viewport when layout direction changes.
 * Zooms to the first root node with smooth animation.
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import type { LayoutDirection, GroupNodeData } from "../types/dag-layout";
import {
  VIEWPORT_ANIMATION_DURATION,
  INITIAL_ANIMATION_DURATION,
  ANIMATION_DELAY,
  NODE_COLLAPSED_WIDTH,
  NODE_COLLAPSED_HEIGHT,
} from "../constants";

interface FitViewOnLayoutChangeProps {
  layoutDirection: LayoutDirection;
  rootNodeIds: string[];
}

export function FitViewOnLayoutChange({ layoutDirection, rootNodeIds }: FitViewOnLayoutChangeProps) {
  const { setCenter, getNode } = useReactFlow();
  const prevLayout = useRef(layoutDirection);
  const hasInitialized = useRef(false);

  const zoomToRoot = useCallback(
    (duration: number = INITIAL_ANIMATION_DURATION) => {
      if (rootNodeIds.length === 0) return;

      const firstRootId = rootNodeIds[0];
      const rootNode = getNode(firstRootId);

      if (rootNode) {
        const data = rootNode.data as GroupNodeData;
        const nodeWidth = data?.nodeWidth || NODE_COLLAPSED_WIDTH;
        const nodeHeight = data?.nodeHeight || NODE_COLLAPSED_HEIGHT;
        const centerX = rootNode.position.x + nodeWidth / 2;
        const centerY = rootNode.position.y + nodeHeight / 2;

        setCenter(centerX, centerY, {
          zoom: 1,
          duration,
        });
      }
    },
    [rootNodeIds, getNode, setCenter],
  );

  useEffect(() => {
    if (!hasInitialized.current || prevLayout.current !== layoutDirection) {
      const timer = setTimeout(() => {
        zoomToRoot(hasInitialized.current ? VIEWPORT_ANIMATION_DURATION : INITIAL_ANIMATION_DURATION);
        hasInitialized.current = true;
        prevLayout.current = layoutDirection;
      }, ANIMATION_DELAY);
      return () => clearTimeout(timer);
    }
  }, [layoutDirection, zoomToRoot]);

  return null;
}
