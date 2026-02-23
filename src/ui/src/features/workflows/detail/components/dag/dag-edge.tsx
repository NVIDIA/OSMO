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
 * DagEdge — Custom ReactFlow edge with semi-circle "port cap" decorations.
 *
 * At each endpoint a circle is centered at the node border (HANDLE_OFFSET px
 * inward from the handle position). Because ReactFlow renders the HTML node
 * layer above the SVG edge layer, exactly the outer half of each circle is
 * visible — producing the semi-circle effect that "touches" the node.
 *
 * The arrow tip lands at the outermost point of the target cap so the edge
 * visually "meets" the semi-circle before entering the node.
 *
 * Cap fill color is driven by CSS variables (--dag-status-*-color) so it
 * automatically adapts to light / dark mode.
 */

"use client";

import { memo } from "react";
import { BaseEdge, getSmoothStepPath, Position } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { HANDLE_OFFSET } from "@/components/dag/constants";
import type { StatusCategory } from "@/features/workflows/detail/lib/status-utils";

// ============================================================================
// Types
// ============================================================================

export interface DagEdgeData extends Record<string, unknown> {
  /** Status category of the source node — determines source cap color */
  status: StatusCategory;
  /** Status category of the target node — determines target cap color */
  targetCategory: StatusCategory;
}

// ============================================================================
// Cap offset lookup
// ============================================================================

/**
 * How far to move the cap center FROM the handle position TOWARD the node.
 * HANDLE_OFFSET places the center at the nominal node border; the extra +3
 * accounts for the handle element's own half-height so the circle center
 * lands slightly inside the node, producing a clean true semicircle.
 */
const CAP_INSET = HANDLE_OFFSET + 3;

/**
 * How much closer to the node the cap's outer edge sits vs the raw handle
 * position. The edge path endpoints are shifted by this amount so the line
 * meets the cap circle without a gap.
 */
const CAP_ADJUST = CAP_INSET - HANDLE_OFFSET;

/** Shift cap center from handle position toward node center */
const CAP_OFFSETS: Record<Position, { dx: number; dy: number }> = {
  [Position.Top]: { dx: 0, dy: CAP_INSET },
  [Position.Bottom]: { dx: 0, dy: -CAP_INSET },
  [Position.Left]: { dx: CAP_INSET, dy: 0 },
  [Position.Right]: { dx: -CAP_INSET, dy: 0 },
};

/** Shift edge endpoints inward so they meet the cap outer edge */
const EDGE_ADJUSTMENTS: Record<Position, { dx: number; dy: number }> = {
  [Position.Top]: { dx: 0, dy: CAP_ADJUST },
  [Position.Bottom]: { dx: 0, dy: -CAP_ADJUST },
  [Position.Left]: { dx: CAP_ADJUST, dy: 0 },
  [Position.Right]: { dx: -CAP_ADJUST, dy: 0 },
};

// ============================================================================
// Component
// ============================================================================

export const DagEdge = memo(function DagEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const srcAdj = EDGE_ADJUSTMENTS[sourcePosition];
  const tgtAdj = EDGE_ADJUSTMENTS[targetPosition];

  const [edgePath] = getSmoothStepPath({
    sourceX: sourceX + srcAdj.dx,
    sourceY: sourceY + srcAdj.dy,
    sourcePosition,
    targetX: targetX + tgtAdj.dx,
    targetY: targetY + tgtAdj.dy,
    targetPosition,
  });

  const edgeData = data as DagEdgeData | undefined;
  const targetCategory = edgeData?.targetCategory ?? "waiting";

  const srcOff = CAP_OFFSETS[sourcePosition];
  const tgtOff = CAP_OFFSETS[targetPosition];

  return (
    <>
      {/* Edge path with arrowhead — rendered first (bottom layer) */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
      />
      {/*
       * Source cap: circle centered at the source node's border.
       * Inner half hidden by the node, outer half visible as a semi-circle.
       * The edge line originates from the circle's outermost point.
       */}
      {/* Source cap — fill via currentColor, same CSS variable as the edge line and arrow */}
      <circle
        cx={sourceX + srcOff.dx}
        cy={sourceY + srcOff.dy}
        r={HANDLE_OFFSET}
        className="dag-edge-cap"
      />
      {/*
       * Target cap — explicit fill since it may differ from source category.
       * Arrow tip lands at this circle's outermost point.
       */}
      <circle
        cx={targetX + tgtOff.dx}
        cy={targetY + tgtOff.dy}
        r={HANDLE_OFFSET}
        className="dag-edge-cap"
        style={{ fill: `var(--dag-status-${targetCategory}-color)` }}
      />
    </>
  );
});

/** Edge types map — pass to ReactFlow's edgeTypes prop */
export const dagEdgeTypes = {
  dagEdge: DagEdge,
};
