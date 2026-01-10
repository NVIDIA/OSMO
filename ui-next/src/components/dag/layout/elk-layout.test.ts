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
 * Generic ELK Layout Tests
 *
 * Tests the generic DAG layout utilities:
 * - Root node finding
 * - Initial expansion computation
 * - Edge building
 *
 * These tests focus on pure utility functions that don't require ELK worker.
 */

import { describe, it, expect } from "vitest";
import { findRootNodes, computeInitialExpandedNodes, buildEdges } from "./elk-layout";
import type { DAGInputNode } from "../types";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a minimal input node for testing.
 */
function createNode(id: string, downstreamIds: string[] = [], dimensions = { width: 200, height: 80 }): DAGInputNode {
  return {
    id,
    label: id,
    width: dimensions.width,
    height: dimensions.height,
    downstreamIds,
  };
}

// =============================================================================
// findRootNodes Tests
// =============================================================================

describe("findRootNodes", () => {
  it("returns all nodes when none have incoming edges", () => {
    const nodes = [createNode("A"), createNode("B"), createNode("C")];

    const roots = findRootNodes(nodes);

    expect(roots.sort()).toEqual(["A", "B", "C"]);
  });

  it("returns only nodes with no incoming edges", () => {
    // A → B → C (A is root)
    const nodes = [createNode("A", ["B"]), createNode("B", ["C"]), createNode("C")];

    const roots = findRootNodes(nodes);

    expect(roots).toEqual(["A"]);
  });

  it("handles multiple roots", () => {
    // A → C, B → C (A and B are roots)
    const nodes = [createNode("A", ["C"]), createNode("B", ["C"]), createNode("C")];

    const roots = findRootNodes(nodes);

    expect(roots.sort()).toEqual(["A", "B"]);
  });

  it("returns empty array for empty input", () => {
    const roots = findRootNodes([]);
    expect(roots).toEqual([]);
  });

  it("handles diamond DAG correctly", () => {
    // Diamond: A → B, A → C, B → D, C → D
    const nodes = [createNode("A", ["B", "C"]), createNode("B", ["D"]), createNode("C", ["D"]), createNode("D")];

    const roots = findRootNodes(nodes);

    expect(roots).toEqual(["A"]);
  });

  it("handles single node", () => {
    const nodes = [createNode("lonely")];

    const roots = findRootNodes(nodes);

    expect(roots).toEqual(["lonely"]);
  });

  it("ignores references to non-existent nodes", () => {
    // A references "missing" which doesn't exist
    const nodes = [createNode("A", ["missing", "B"]), createNode("B")];

    const roots = findRootNodes(nodes);

    // A is still a root (has no incoming edges)
    expect(roots).toEqual(["A"]);
  });
});

// =============================================================================
// computeInitialExpandedNodes Tests
// =============================================================================

describe("computeInitialExpandedNodes", () => {
  describe("no expandable nodes", () => {
    it("returns empty set when no nodes are expandable", () => {
      const nodes = [createNode("A"), createNode("B"), createNode("C")];
      const isExpandable = () => false;
      const shouldExpand = () => true;

      const expanded = computeInitialExpandedNodes(nodes, isExpandable, shouldExpand);

      expect(expanded.size).toBe(0);
    });
  });

  describe("single expandable node", () => {
    it("expands the only expandable node", () => {
      const nodes = [createNode("A"), createNode("B"), createNode("C")];
      const isExpandable = (n: DAGInputNode) => n.id === "B";
      const shouldExpand = () => true;

      const expanded = computeInitialExpandedNodes(nodes, isExpandable, shouldExpand);

      expect(expanded.size).toBe(1);
      expect(expanded.has("B")).toBe(true);
    });
  });

  describe("multiple expandable nodes", () => {
    it("expands nodes that pass shouldExpand check", () => {
      const nodes = [createNode("A"), createNode("B"), createNode("C")];
      const isExpandable = () => true; // All are expandable
      const shouldExpand = (n: DAGInputNode) => n.id !== "C"; // A and B should expand

      const expanded = computeInitialExpandedNodes(nodes, isExpandable, shouldExpand);

      expect(expanded.has("A")).toBe(true);
      expect(expanded.has("B")).toBe(true);
      expect(expanded.has("C")).toBe(false);
    });

    it("respects shouldExpand returning false", () => {
      const nodes = [createNode("A"), createNode("B")];
      const isExpandable = () => true;
      const shouldExpand = () => false;

      const expanded = computeInitialExpandedNodes(nodes, isExpandable, shouldExpand);

      expect(expanded.size).toBe(0);
    });
  });

  describe("group threshold", () => {
    it("collapses all when too many groups", () => {
      const nodes = Array.from({ length: 15 }, (_, i) => createNode(`node-${i}`));
      const isExpandable = () => true;
      const shouldExpand = () => true;

      const expanded = computeInitialExpandedNodes(nodes, isExpandable, shouldExpand, 10);

      expect(expanded.size).toBe(0);
    });

    it("expands when below threshold", () => {
      const nodes = Array.from({ length: 5 }, (_, i) => createNode(`node-${i}`));
      const isExpandable = () => true;
      const shouldExpand = () => true;

      const expanded = computeInitialExpandedNodes(nodes, isExpandable, shouldExpand, 10);

      expect(expanded.size).toBe(5);
    });
  });

  describe("empty input", () => {
    it("returns empty set for empty nodes array", () => {
      const expanded = computeInitialExpandedNodes(
        [],
        () => true,
        () => true,
      );

      expect(expanded.size).toBe(0);
    });
  });
});

// =============================================================================
// buildEdges Tests
// =============================================================================

describe("buildEdges", () => {
  describe("basic edge creation", () => {
    it("returns empty array for nodes with no connections", () => {
      const nodes = [createNode("A"), createNode("B")];

      const edges = buildEdges(nodes);

      expect(edges).toHaveLength(0);
    });

    it("creates edge for each downstream connection", () => {
      const nodes = [createNode("A", ["B", "C"]), createNode("B"), createNode("C")];

      const edges = buildEdges(nodes);

      expect(edges).toHaveLength(2);
      expect(edges.find((e) => e.id === "A-B")).toBeDefined();
      expect(edges.find((e) => e.id === "A-C")).toBeDefined();
    });

    it("sets correct source and target", () => {
      const nodes = [createNode("source", ["target"]), createNode("target")];

      const edges = buildEdges(nodes);

      expect(edges[0].source).toBe("source");
      expect(edges[0].target).toBe("target");
    });
  });

  describe("edge properties", () => {
    it("sets edge type to smoothstep", () => {
      const nodes = [createNode("A", ["B"]), createNode("B")];

      const edges = buildEdges(nodes);

      expect(edges[0].type).toBe("smoothstep");
    });

    it("sets source and target handles", () => {
      const nodes = [createNode("A", ["B"]), createNode("B")];

      const edges = buildEdges(nodes);

      expect(edges[0].sourceHandle).toBe("source");
      expect(edges[0].targetHandle).toBe("target");
    });

    it("includes arrow marker", () => {
      const nodes = [createNode("A", ["B"]), createNode("B")];

      const edges = buildEdges(nodes);

      expect(edges[0].markerEnd).toBeDefined();
    });
  });

  describe("with style provider", () => {
    it("applies style from provider", () => {
      const nodes = [createNode("A", ["B"]), createNode("B")];
      const getStyle = () => ({
        color: "#ff0000",
        strokeColor: "#cc0000",
        animated: true,
        dashed: true,
      });

      const edges = buildEdges(nodes, getStyle);

      expect(edges[0].animated).toBe(true);
      expect(edges[0].style?.stroke).toBe("#ff0000");
      expect(edges[0].style?.strokeDasharray).toBeDefined();
    });

    it("passes source and target to style provider", () => {
      const nodes = [createNode("A", ["B"]), createNode("B")];
      const getStyle = vi.fn().mockReturnValue({
        color: "#000",
        strokeColor: "#000",
      });

      buildEdges(nodes, getStyle);

      expect(getStyle).toHaveBeenCalledWith("A", "B");
    });

    it("uses defaults when no style provider", () => {
      const nodes = [createNode("A", ["B"]), createNode("B")];

      const edges = buildEdges(nodes);

      expect(edges[0].animated).toBe(false);
    });
  });

  describe("complex graphs", () => {
    it("handles diamond pattern", () => {
      const nodes = [createNode("A", ["B", "C"]), createNode("B", ["D"]), createNode("C", ["D"]), createNode("D")];

      const edges = buildEdges(nodes);

      expect(edges).toHaveLength(4);
      const edgeIds = edges.map((e) => e.id).sort();
      expect(edgeIds).toEqual(["A-B", "A-C", "B-D", "C-D"]);
    });

    it("handles wide DAG (one source, many targets)", () => {
      const nodes = [
        createNode("root", ["A", "B", "C", "D", "E"]),
        createNode("A"),
        createNode("B"),
        createNode("C"),
        createNode("D"),
        createNode("E"),
      ];

      const edges = buildEdges(nodes);

      expect(edges).toHaveLength(5);
    });

    it("handles deep chain", () => {
      const nodes = [
        createNode("A", ["B"]),
        createNode("B", ["C"]),
        createNode("C", ["D"]),
        createNode("D", ["E"]),
        createNode("E"),
      ];

      const edges = buildEdges(nodes);

      expect(edges).toHaveLength(4);
    });
  });
});

// Need to import vi for the mock test
import { vi } from "vitest";
