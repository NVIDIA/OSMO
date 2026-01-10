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
 * MiniMapNode Component
 *
 * Custom node renderer for the ReactFlow MiniMap.
 * Renders nodes with correct dimensions and customizable colors.
 *
 * Performance: Memoized to prevent re-renders during viewport changes.
 */

import { memo } from "react";
import type { MiniMapNodeProps } from "@xyflow/react";
import { NODE_DEFAULTS } from "../constants";

/** Default colors for minimap nodes */
export const MINIMAP_COLORS = {
  fill: "#52525b", // zinc-600
  stroke: "#3f3f46", // zinc-700
} as const;

export const MiniMapNode = memo(function MiniMapNode({
  x,
  y,
  width,
  height,
  color,
  strokeColor,
  strokeWidth,
}: MiniMapNodeProps) {
  const nodeWidth = width || NODE_DEFAULTS.width;
  const nodeHeight = height || NODE_DEFAULTS.height;

  return (
    <rect
      x={x}
      y={y}
      width={nodeWidth}
      height={nodeHeight}
      fill={color || MINIMAP_COLORS.fill}
      stroke={strokeColor || MINIMAP_COLORS.stroke}
      strokeWidth={strokeWidth || 2}
      rx={4}
      ry={4}
      aria-hidden="true"
    />
  );
});
