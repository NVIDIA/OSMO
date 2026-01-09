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
