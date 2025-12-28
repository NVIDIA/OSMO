// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * MiniMapNode Component
 *
 * Custom node renderer for the ReactFlow MiniMap.
 * Renders nodes with correct dimensions and status colors.
 */

import type { MiniMapNodeProps } from "@xyflow/react";
import { NODE_COLLAPSED_WIDTH, NODE_COLLAPSED_HEIGHT } from "../constants";

export function MiniMapNode({ x, y, width, height, color, strokeColor, strokeWidth }: MiniMapNodeProps) {
  const nodeWidth = width || NODE_COLLAPSED_WIDTH;
  const nodeHeight = height || NODE_COLLAPSED_HEIGHT;

  return (
    <rect
      x={x}
      y={y}
      width={nodeWidth}
      height={nodeHeight}
      fill={color || "#52525b"}
      stroke={strokeColor || "#3f3f46"}
      strokeWidth={strokeWidth || 2}
      rx={4}
      ry={4}
      aria-hidden="true"
    />
  );
}
