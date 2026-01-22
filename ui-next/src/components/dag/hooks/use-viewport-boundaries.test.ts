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

import { describe, it, expect } from "vitest";
import {
  calculateCenteringViewport,
  clampToTranslateExtent,
  shouldUpdateBoundariesImmediately,
  type Dimensions,
  type NodeBounds,
} from "./use-viewport-boundaries";
import type { Node, Viewport } from "@xyflow/react";

describe("useViewportBoundaries - Pure Logic", () => {
  const nodeBounds: NodeBounds = {
    minX: 0,
    maxX: 1000,
    minY: 0,
    maxY: 1000,
    fitAllZoom: 0.5,
  };

  const containerDims: Dimensions = {
    width: 800,
    height: 600,
  };

  describe("calculateCenteringViewport", () => {
    it("centers a node exactly when within bounds", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };
      const zoom = 1.0;

      // Center of node = (550, 550)
      // Center of viewport = (400, 300)
      // Required viewport offset = (400 - 550*1, 300 - 550*1) = (-150, -250)
      const result = calculateCenteringViewport(node, nodeBounds, containerDims, zoom);

      expect(result.x).toBe(-150);
      expect(result.y).toBe(-250);
      expect(result.zoom).toBe(1.0);
    });

    it("clamps centering when node is at the extreme edge", () => {
      const nodeEdge: Node = {
        id: "edge",
        position: { x: -500, y: -500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const result = calculateCenteringViewport(nodeEdge, nodeBounds, containerDims, 1.0);

      // Max possible X for nodeBounds.minX=0 is 400.
      expect(result.x).toBeLessThanOrEqual(400);
      expect(result.y).toBeLessThanOrEqual(300);
    });
  });

  describe("clampToTranslateExtent", () => {
    it("maintains viewport if already inside bounds", () => {
      const vp: Viewport = { x: -100, y: -100, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);
      expect(result).toEqual(vp);
    });

    it("clamps X when viewport is too far left", () => {
      const vp: Viewport = { x: 1000, y: 0, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      // px = 400. minEx = 0 - 400 = -400.
      // validMaxX = -(-400) * 1 = 400.
      expect(result.x).toBe(400);
    });

    it("clamps X when viewport is too far right", () => {
      const vp: Viewport = { x: -2000, y: 0, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      // px = 400. maxEx = 1000 + 400 = 1400.
      // validMinX = 800 - 1400 * 1 = -600.
      expect(result.x).toBe(-600);
    });
  });

  describe("shouldUpdateBoundariesImmediately", () => {
    it("returns true when growing in width", () => {
      const currentTarget = { width: 1000, height: 600 };
      const effective = { width: 800, height: 600 };
      expect(shouldUpdateBoundariesImmediately(currentTarget, effective)).toBe(true);
    });

    it("returns true when growing in height", () => {
      const currentTarget = { width: 800, height: 800 };
      const effective = { width: 800, height: 600 };
      expect(shouldUpdateBoundariesImmediately(currentTarget, effective)).toBe(true);
    });

    it("returns false when shrinking", () => {
      const currentTarget = { width: 600, height: 400 };
      const effective = { width: 800, height: 600 };
      expect(shouldUpdateBoundariesImmediately(currentTarget, effective)).toBe(false);
    });

    it("returns false when dimensions are identical", () => {
      const currentTarget = { width: 800, height: 600 };
      const effective = { width: 800, height: 600 };
      expect(shouldUpdateBoundariesImmediately(currentTarget, effective)).toBe(false);
    });
  });
});
