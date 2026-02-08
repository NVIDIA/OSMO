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
 * Renders nodes with correct dimensions and colors provided by parent.
 *
 * Performance: Memoized to prevent re-renders during viewport changes.
 * Theme: Colors are provided by parent component via nodeColor/nodeStrokeColor props.
 */

import { memo } from "react";
import type { MiniMapNodeProps } from "@xyflow/react";
import { NODE_DEFAULTS } from "@/components/dag/constants";

/**
 * Default fallback colors for minimap nodes (used if parent doesn't provide colors).
 * Reads from CSS variables defined in globals.css for theme-aware colors.
 */
function getMinimapColors() {
  if (typeof document === "undefined") {
    // SSR fallback - return dark mode colors
    return { fill: "#52525b", stroke: "#3f3f46" };
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    fill: styles.getPropertyValue("--minimap-node-fill").trim(),
    stroke: styles.getPropertyValue("--minimap-node-stroke").trim(),
  };
}

/** Legacy export for backward compatibility */
export const MINIMAP_COLORS = {
  get fill() {
    return getMinimapColors().fill;
  },
  get stroke() {
    return getMinimapColors().stroke;
  },
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
