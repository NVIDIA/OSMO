// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * FitViewOnLayoutChange Component
 *
 * Automatically adjusts the viewport when layout direction changes.
 * Zooms to the first root node with smooth animation.
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import type { LayoutDirection, GroupNodeData } from "../types";
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

export function FitViewOnLayoutChange({
  layoutDirection,
  rootNodeIds,
}: FitViewOnLayoutChangeProps) {
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
    [rootNodeIds, getNode, setCenter]
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
