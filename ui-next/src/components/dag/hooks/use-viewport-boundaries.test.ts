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

      expect(result.x).toBeCloseTo(-150);
      expect(result.y).toBeCloseTo(-250);
      expect(result.zoom).toBe(1.0);
    });

    it("clamps centering when node is at the extreme edge", () => {
      const nodeEdge: Node = {
        id: "edge",
        position: { x: -5000, y: -5000 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const result = calculateCenteringViewport(nodeEdge, nodeBounds, containerDims, 1.0);

      // Max possible X for nodeBounds.minX=0 with pad=containerWidth/2=400 is 400.
      expect(result.x).toBeLessThanOrEqual(400);
      expect(result.y).toBeLessThanOrEqual(400);
    });
  });

  describe("clampToTranslateExtent", () => {
    it("maintains viewport if already inside bounds", () => {
      const vp: Viewport = { x: -100, y: -100, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);
      expect(result).toEqual(vp);
    });

    it("clamps X when viewport is too far left", () => {
      const vp: Viewport = { x: 10000, y: 0, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      // pad = containerWidth/2 = 800/2 = 400. minEx = 0 - 400 = -400.
      // validMaxX = -(-400) * 1 = 400.
      expect(result.x).toBeCloseTo(400);
    });

    it("clamps X when viewport is too far right", () => {
      const vp: Viewport = { x: -10000, y: 0, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      // pad = containerWidth/2 = 800/2 = 400. maxEx = 1000 + 400 = 1400.
      // validMinX = 800 - 1400 * 1 = -600.
      expect(result.x).toBeCloseTo(-600);
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

    it("returns true when growing width but shrinking height (mixed)", () => {
      const currentTarget = { width: 1000, height: 400 };
      const effective = { width: 800, height: 600 };
      expect(shouldUpdateBoundariesImmediately(currentTarget, effective)).toBe(true);
    });

    it("returns true when growing height but shrinking width (mixed)", () => {
      const currentTarget = { width: 600, height: 800 };
      const effective = { width: 800, height: 600 };
      expect(shouldUpdateBoundariesImmediately(currentTarget, effective)).toBe(true);
    });

    it("returns false for very small shrinkage (< 1px)", () => {
      const currentTarget = { width: 799.5, height: 599.5 };
      const effective = { width: 800, height: 600 };
      expect(shouldUpdateBoundariesImmediately(currentTarget, effective)).toBe(false);
    });

    it("returns true for very small growth (< 1px)", () => {
      const currentTarget = { width: 800.5, height: 600.5 };
      const effective = { width: 800, height: 600 };
      expect(shouldUpdateBoundariesImmediately(currentTarget, effective)).toBe(true);
    });
  });

  // ============================================================================
  // Extended Edge Case Tests
  // ============================================================================

  describe("calculateCenteringViewport - Edge Cases", () => {
    it("handles node with missing dimensions (uses defaults)", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: {}, // No nodeWidth/nodeHeight
        type: "group",
      };

      const result = calculateCenteringViewport(node, nodeBounds, containerDims, 1.0);

      // Should not throw and should produce valid viewport
      expect(result.x).toBeDefined();
      expect(result.y).toBeDefined();
      expect(result.zoom).toBe(1.0);
    });

    it("respects explicit zero width (should treat 0 as valid, not missing)", () => {
      const nodeZeroWidth: Node = {
        id: "zero-width",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 0, nodeHeight: 100 },
        type: "group",
      };

      const nodeDefaultWidth: Node = {
        id: "default-width",
        position: { x: 500, y: 500 },
        data: { nodeHeight: 100 }, // No width specified - should use default
        type: "group",
      };

      const resultZero = calculateCenteringViewport(nodeZeroWidth, nodeBounds, containerDims, 1.0);
      const resultDefault = calculateCenteringViewport(nodeDefaultWidth, nodeBounds, containerDims, 1.0);

      // DESIRED BEHAVIOR: Zero width should be respected, not treated as missing
      // Center of zero-width node should be at x=500 (position + 0/2)
      // Center of default-width node should be at x=590 (position + 180/2)
      expect(resultZero).toBeDefined();
      expect(Number.isFinite(resultZero.x)).toBe(true);
      expect(Number.isFinite(resultZero.y)).toBe(true);

      // These should be DIFFERENT because zero is a valid dimension
      // Center x for zero width: 500 + 0/2 = 500
      // Center x for default width: 500 + 180/2 = 590
      // So viewport.x calculations will differ
      expect(resultZero.x).not.toBeCloseTo(resultDefault.x, 0);
    });

    it("respects explicit zero height (should treat 0 as valid, not missing)", () => {
      const nodeZeroHeight: Node = {
        id: "zero-height",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 0 },
        type: "group",
      };

      const nodeDefaultHeight: Node = {
        id: "default-height",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100 }, // No height specified - should use default
        type: "group",
      };

      const resultZero = calculateCenteringViewport(nodeZeroHeight, nodeBounds, containerDims, 1.0);
      const resultDefault = calculateCenteringViewport(nodeDefaultHeight, nodeBounds, containerDims, 1.0);

      // DESIRED BEHAVIOR: Zero height should be respected, not treated as missing
      expect(resultZero).toBeDefined();
      expect(Number.isFinite(resultZero.x)).toBe(true);
      expect(Number.isFinite(resultZero.y)).toBe(true);

      // These should be DIFFERENT because zero is a valid dimension
      expect(resultZero.y).not.toBeCloseTo(resultDefault.y, 0);
    });

    it("handles node at origin (0, 0)", () => {
      const node: Node = {
        id: "test",
        position: { x: 0, y: 0 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const result = calculateCenteringViewport(node, nodeBounds, containerDims, 1.0);

      // Center of node = (50, 50)
      // Required viewport offset = (400 - 50, 300 - 50) = (350, 250)
      expect(result.x).toBeCloseTo(350);
      expect(result.y).toBeCloseTo(250);
      expect(result.zoom).toBe(1.0);
    });

    it("handles very large zoom levels", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const result = calculateCenteringViewport(node, nodeBounds, containerDims, 10.0);

      expect(result.zoom).toBe(10.0);
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
    });

    it("handles very small zoom levels", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const result = calculateCenteringViewport(node, nodeBounds, containerDims, 0.1);

      expect(result.zoom).toBe(0.1);
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
    });

    it("handles collapsed bounds (validMinX > validMaxX)", () => {
      const tinyContainer: Dimensions = { width: 10, height: 10 };
      const largeBounds: NodeBounds = {
        minX: 0,
        maxX: 10000,
        minY: 0,
        maxY: 10000,
        fitAllZoom: 0.01,
      };

      const node: Node = {
        id: "test",
        position: { x: 5000, y: 5000 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const result = calculateCenteringViewport(node, largeBounds, tinyContainer, 1.0);

      // Should use midpoint formula when bounds are collapsed
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
    });

    it("handles very small container dimensions", () => {
      const tinyContainer: Dimensions = { width: 1, height: 1 };
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const result = calculateCenteringViewport(node, nodeBounds, tinyContainer, 1.0);

      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
    });

    it("produces consistent results for node at top-left bound", () => {
      const node: Node = {
        id: "test",
        position: { x: nodeBounds.minX, y: nodeBounds.minY },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const result = calculateCenteringViewport(node, nodeBounds, containerDims, 1.0);

      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
      expect(result.zoom).toBe(1.0);
    });

    it("produces consistent results for node at bottom-right bound", () => {
      const node: Node = {
        id: "test",
        position: { x: nodeBounds.maxX - 100, y: nodeBounds.maxY - 100 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const result = calculateCenteringViewport(node, nodeBounds, containerDims, 1.0);

      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
      expect(result.zoom).toBe(1.0);
    });
  });

  describe("clampToTranslateExtent - Edge Cases", () => {
    it("handles zero zoom level gracefully", () => {
      const vp: Viewport = { x: -100, y: -100, zoom: 0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      // Should not crash, though behavior with zoom=0 is undefined
      expect(result).toBeDefined();
      expect(result.zoom).toBe(0);
    });

    it("handles negative zoom gracefully", () => {
      const vp: Viewport = { x: -100, y: -100, zoom: -1 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      // Should not crash
      expect(result).toBeDefined();
      expect(result.zoom).toBe(-1);
    });

    it("handles very high zoom levels", () => {
      const vp: Viewport = { x: -5000, y: -5000, zoom: 100 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
      expect(result.zoom).toBe(100);
    });

    it("clamps Y when viewport is too far up", () => {
      const vp: Viewport = { x: 0, y: 10000, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      // pad = containerHeight/2 = 600/2 = 300. minEy = 0 - 300 = -300.
      // validMaxY = -(-300) * 1 = 300.
      expect(result.y).toBeCloseTo(300);
    });

    it("clamps Y when viewport is too far down", () => {
      const vp: Viewport = { x: 0, y: -10000, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      // pad = containerHeight/2 = 600/2 = 300. maxEy = 1000 + 300 = 1300.
      // validMinY = 600 - 1300 * 1 = -700.
      expect(result.y).toBeCloseTo(-700);
    });

    it("clamps both X and Y simultaneously", () => {
      const vp: Viewport = { x: -10000, y: -10000, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      expect(result.x).toBeCloseTo(-600);
      expect(result.y).toBeCloseTo(-700);
    });

    it("handles inverted node bounds (minX > maxX)", () => {
      const invertedBounds: NodeBounds = {
        minX: 1000,
        maxX: 0,
        minY: 1000,
        maxY: 0,
        fitAllZoom: 0.5,
      };

      const vp: Viewport = { x: -100, y: -100, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, invertedBounds);

      // Should handle gracefully and use midpoint formula
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
    });

    it("handles container larger than node bounds with padding", () => {
      const smallBounds: NodeBounds = {
        minX: 0,
        maxX: 100,
        minY: 0,
        maxY: 100,
        fitAllZoom: 1.0,
      };

      const vp: Viewport = { x: -100, y: -100, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, smallBounds);

      // Padding = (400, 300), extent = [-400, -300] to [500, 400]
      // With container (800, 600) and zoom 1.0
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
    });

    it("maintains viewport with fractional coordinates", () => {
      const vp: Viewport = { x: -123.456, y: -234.567, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      // Should maintain precision
      expect(result.x).toBeCloseTo(-123.456);
      expect(result.y).toBeCloseTo(-234.567);
    });

    it("handles collapsed bounds in Y axis (validMinY > validMaxY)", () => {
      const vp: Viewport = { x: 0, y: 0, zoom: 1.0 };
      const tinyContainer: Dimensions = { width: 800, height: 10 };
      const largeBounds: NodeBounds = {
        minX: 0,
        maxX: 1000,
        minY: 0,
        maxY: 10000,
        fitAllZoom: 0.01,
      };

      const result = clampToTranslateExtent(vp, tinyContainer, largeBounds);

      // Should use midpoint formula for Y
      expect(Number.isFinite(result.y)).toBe(true);
    });
  });

  // ============================================================================
  // Coordinate System Verification Tests
  // ============================================================================

  describe("Coordinate System & Formula Verification", () => {
    it("centering then clamping should be stable (idempotent)", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const centeredVp = calculateCenteringViewport(node, nodeBounds, containerDims, 1.0);
      const clampedVp = clampToTranslateExtent(centeredVp, containerDims, nodeBounds);

      // After centering, clamping should not change the viewport significantly
      expect(Math.abs(centeredVp.x - clampedVp.x)).toBeLessThan(0.01);
      expect(Math.abs(centeredVp.y - clampedVp.y)).toBeLessThan(0.01);
    });

    it("clamping twice should produce identical results (idempotent)", () => {
      const vp: Viewport = { x: -5000, y: -5000, zoom: 1.0 };
      const firstClamp = clampToTranslateExtent(vp, containerDims, nodeBounds);
      const secondClamp = clampToTranslateExtent(firstClamp, containerDims, nodeBounds);

      expect(firstClamp).toEqual(secondClamp);
    });

    it("centering on symmetric nodes should produce symmetric viewports", () => {
      const centerX = (nodeBounds.maxX + nodeBounds.minX) / 2;
      const centerY = (nodeBounds.maxY + nodeBounds.minY) / 2;

      const nodeLeft: Node = {
        id: "left",
        position: { x: centerX - 200, y: centerY },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const nodeRight: Node = {
        id: "right",
        position: { x: centerX + 200, y: centerY },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const vpLeft = calculateCenteringViewport(nodeLeft, nodeBounds, containerDims, 1.0);
      const vpRight = calculateCenteringViewport(nodeRight, nodeBounds, containerDims, 1.0);

      // Y should be identical, X should differ by 2 * (offset distance)
      expect(vpLeft.y).toBeCloseTo(vpRight.y);
      // X difference should equal 2 * 200 (the position offset between nodes)
      expect(Math.abs(vpLeft.x - vpRight.x)).toBeCloseTo(400);
    });

    it("zoom affects viewport offset calculation", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const vp1x = calculateCenteringViewport(node, nodeBounds, containerDims, 1.0);
      const vp2x = calculateCenteringViewport(node, nodeBounds, containerDims, 2.0);

      // At higher zoom, the viewport offset becomes more negative (to center same node)
      // The relationship is not linear due to dynamic padding and clamping
      expect(vp2x.zoom).toBe(2.0);
      expect(vp1x.zoom).toBe(1.0);
      // Higher zoom should result in more negative offset (pan further to keep node centered)
      expect(vp2x.x).toBeLessThan(vp1x.x);
      expect(vp2x.y).toBeLessThan(vp1x.y);
    });

    it("padding formula creates valid extents for various container sizes", () => {
      const sizes: Dimensions[] = [
        { width: 400, height: 300 },
        { width: 800, height: 600 },
        { width: 1920, height: 1080 },
        { width: 3840, height: 2160 },
      ];

      sizes.forEach((dims) => {
        const vp: Viewport = { x: 0, y: 0, zoom: 1.0 };
        const result = clampToTranslateExtent(vp, dims, nodeBounds);

        // Should produce finite results for all container sizes
        expect(Number.isFinite(result.x)).toBe(true);
        expect(Number.isFinite(result.y)).toBe(true);
      });
    });

    it("dynamic padding allows any node to be centered", () => {
      // Test that a node at each corner can be centered without hitting bounds
      const corners = [
        { x: nodeBounds.minX, y: nodeBounds.minY }, // top-left
        { x: nodeBounds.maxX - 100, y: nodeBounds.minY }, // top-right
        { x: nodeBounds.minX, y: nodeBounds.maxY - 100 }, // bottom-left
        { x: nodeBounds.maxX - 100, y: nodeBounds.maxY - 100 }, // bottom-right
      ];

      corners.forEach((position, idx) => {
        const node: Node = {
          id: `corner-${idx}`,
          position,
          data: { nodeWidth: 100, nodeHeight: 100 },
          type: "group",
        };

        const centered = calculateCenteringViewport(node, nodeBounds, containerDims, 1.0);
        const clamped = clampToTranslateExtent(centered, containerDims, nodeBounds);

        // Centering should not require clamping (within small tolerance)
        expect(Math.abs(centered.x - clamped.x)).toBeLessThan(0.1);
        expect(Math.abs(centered.y - clamped.y)).toBeLessThan(0.1);
      });
    });

    it("d3-zoom constraint formula is correctly implemented", () => {
      // Verify the specific d3-zoom formula: viewport.x ∈ [width - maxX × zoom, -minX × zoom]
      const zoom = 1.5;
      const padX = containerDims.width / 2;
      const padY = containerDims.height / 2;
      const minEx = nodeBounds.minX - padX;
      const maxEx = nodeBounds.maxX + padX;
      const minEy = nodeBounds.minY - padY;
      const maxEy = nodeBounds.maxY + padY;

      const expectedMinX = containerDims.width - maxEx * zoom;
      const expectedMaxX = -minEx * zoom;
      const expectedMinY = containerDims.height - maxEy * zoom;
      const expectedMaxY = -minEy * zoom;

      // Test clamping at boundaries
      const vpLeft: Viewport = { x: -99999, y: 0, zoom };
      const resultLeft = clampToTranslateExtent(vpLeft, containerDims, nodeBounds);
      expect(resultLeft.x).toBeCloseTo(expectedMinX);

      const vpRight: Viewport = { x: 99999, y: 0, zoom };
      const resultRight = clampToTranslateExtent(vpRight, containerDims, nodeBounds);
      expect(resultRight.x).toBeCloseTo(expectedMaxX);

      const vpTop: Viewport = { x: 0, y: 99999, zoom };
      const resultTop = clampToTranslateExtent(vpTop, containerDims, nodeBounds);
      expect(resultTop.y).toBeCloseTo(expectedMaxY);

      const vpBottom: Viewport = { x: 0, y: -99999, zoom };
      const resultBottom = clampToTranslateExtent(vpBottom, containerDims, nodeBounds);
      expect(resultBottom.y).toBeCloseTo(expectedMinY);
    });
  });

  // ============================================================================
  // Regression & Bug Prevention Tests
  // ============================================================================

  describe("Regression Prevention", () => {
    it("does not lose precision with repeated operations", () => {
      let vp: Viewport = { x: -123.456789, y: -234.567891, zoom: 1.0 };

      // Apply clamping multiple times
      for (let i = 0; i < 10; i++) {
        vp = clampToTranslateExtent(vp, containerDims, nodeBounds);
      }

      // Should maintain reasonable precision
      expect(Math.abs(vp.x + 123.456789)).toBeLessThan(0.001);
      expect(Math.abs(vp.y + 234.567891)).toBeLessThan(0.001);
    });

    it("handles rapid dimension changes consistently", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const dims1: Dimensions = { width: 800, height: 600 };
      const dims2: Dimensions = { width: 1200, height: 800 };

      const vp1 = calculateCenteringViewport(node, nodeBounds, dims1, 1.0);
      const _vp2 = calculateCenteringViewport(node, nodeBounds, dims2, 1.0);
      const vp3 = calculateCenteringViewport(node, nodeBounds, dims1, 1.0);

      // Returning to original dimensions should produce original viewport
      expect(vp1.x).toBeCloseTo(vp3.x);
      expect(vp1.y).toBeCloseTo(vp3.y);
    });

    it("maintains stability with extreme node positions", () => {
      const extremeNode: Node = {
        id: "extreme",
        position: { x: -1000000, y: -1000000 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const result = calculateCenteringViewport(extremeNode, nodeBounds, containerDims, 1.0);

      // Should clamp to bounds without overflow
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
      expect(Math.abs(result.x)).toBeLessThan(1000000);
      expect(Math.abs(result.y)).toBeLessThan(1000000);
    });

    it("handles boundary conditions without off-by-one errors", () => {
      // Test at exact boundary values
      const vp: Viewport = { x: -600, y: -700, zoom: 1.0 };
      const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

      // Should remain at boundary, not move off it
      expect(result.x).toBeCloseTo(-600);
      expect(result.y).toBeCloseTo(-700);
    });
  });

  // ============================================================================
  // Zoom Snap Logic Tests
  // ============================================================================

  describe("Zoom Precision & Edge Cases", () => {
    it("respects zoom values slightly above 1.0 (e.g., 1.01)", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      // Test zoom value slightly above 1.0
      const result = calculateCenteringViewport(node, nodeBounds, containerDims, 1.01);

      expect(result.zoom).toBe(1.01);
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
    });

    it("respects zoom values slightly below 1.0 (e.g., 0.99)", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      // Test zoom value slightly below 1.0
      const result = calculateCenteringViewport(node, nodeBounds, containerDims, 0.99);

      expect(result.zoom).toBe(0.99);
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
    });

    it("handles zoom at exact 1.0 correctly", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const result = calculateCenteringViewport(node, nodeBounds, containerDims, 1.0);

      expect(result.zoom).toBe(1.0);
    });

    it("clamping preserves zoom level exactly", () => {
      const testZooms = [0.5, 0.8, 0.99, 1.0, 1.01, 1.2, 1.5];

      testZooms.forEach((zoom) => {
        const vp: Viewport = { x: -100, y: -100, zoom };
        const result = clampToTranslateExtent(vp, containerDims, nodeBounds);

        // Clamping should never modify zoom - only position
        expect(result.zoom).toBe(zoom);
      });
    });

    it("handles zoom values in allowed range (MIN_ZOOM to MAX_ZOOM)", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      // Test at boundaries defined in VIEWPORT constants
      const minZoomResult = calculateCenteringViewport(node, nodeBounds, containerDims, 0.1);
      expect(minZoomResult.zoom).toBe(0.1);

      const maxZoomResult = calculateCenteringViewport(node, nodeBounds, containerDims, 1.5);
      expect(maxZoomResult.zoom).toBe(1.5);

      const defaultZoomResult = calculateCenteringViewport(node, nodeBounds, containerDims, 0.8);
      expect(defaultZoomResult.zoom).toBe(0.8);
    });

    it("zoom near 1.0 boundary does not cause unexpected snapping in pure functions", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      // These pure functions should never modify zoom values
      // The snap logic (line 366) is in performClamping, NOT in pure functions
      const zooms = [0.995, 1.0, 1.005];
      zooms.forEach((zoom) => {
        const result = calculateCenteringViewport(node, nodeBounds, containerDims, zoom);
        expect(result.zoom).toBe(zoom); // Pure function preserves exact zoom
      });
    });

    it("small zoom variations produce correspondingly small viewport differences", () => {
      const node: Node = {
        id: "test",
        position: { x: 500, y: 500 },
        data: { nodeWidth: 100, nodeHeight: 100 },
        type: "group",
      };

      const vp1 = calculateCenteringViewport(node, nodeBounds, containerDims, 1.0);
      const vp2 = calculateCenteringViewport(node, nodeBounds, containerDims, 1.001);

      // Small zoom change should produce small viewport change
      const deltaX = Math.abs(vp1.x - vp2.x);
      const deltaY = Math.abs(vp1.y - vp2.y);

      // With 0.1% zoom change, viewport offset change should be proportionally small
      expect(deltaX).toBeLessThan(10); // Reasonable threshold
      expect(deltaY).toBeLessThan(10);
    });
  });
});
