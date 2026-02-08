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
 * DAG Layout Tests
 *
 * Tests the workflow-specific layout calculations:
 * - Node dimension calculations based on task count and expansion state
 * - Initial expansion logic based on thresholds
 * - Edge building from group dependencies
 *
 * These tests focus on pure layout logic without requiring ELK worker.
 */

import { describe, it, expect } from "vitest";
import {
  getNodeDimensions,
  computeInitialExpandedGroups,
  buildEdges,
  TASK_ROW_HEIGHT,
  NODE_HEADER_HEIGHT,
  NODE_BORDER_WIDTH,
} from "@/app/(dashboard)/workflows/[name]/lib/dag-layout";
import { NODE_DEFAULTS, NODE_EXPANDED } from "@/components/dag/constants";
import type { GroupWithLayout } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a minimal group for testing layout calculations.
 * Uses type assertion since we only need the fields relevant for layout tests.
 */
function createGroup(
  name: string,
  taskCount: number,
  options: {
    status?: string;
    level?: number;
    lane?: number;
    downstreamGroups?: string[];
  } = {},
): GroupWithLayout {
  const tasks = Array.from({ length: taskCount }, (_, i) => ({
    name: `${name}-task-${i}`,
    status: "COMPLETED",
  })) as GroupWithLayout["tasks"];

  return {
    id: name,
    name,
    status: options.status ?? "COMPLETED",
    level: options.level ?? 0,
    lane: options.lane ?? 0,
    downstream_groups: options.downstreamGroups ?? [],
    remaining_upstream_groups: [],
    tasks,
  } as GroupWithLayout;
}

// =============================================================================
// getNodeDimensions Tests
// =============================================================================

describe("getNodeDimensions", () => {
  describe("collapsed nodes", () => {
    it("returns default dimensions for single-task group", () => {
      const group = createGroup("A", 1);
      const dims = getNodeDimensions(group, false);

      expect(dims.width).toBe(NODE_DEFAULTS.width);
      expect(dims.height).toBe(NODE_DEFAULTS.height);
    });

    it("returns default dimensions for empty group", () => {
      const group = createGroup("A", 0);
      const dims = getNodeDimensions(group, false);

      expect(dims.width).toBe(NODE_DEFAULTS.width);
      expect(dims.height).toBe(NODE_DEFAULTS.height);
    });

    it("returns taller dimensions for multi-task collapsed group", () => {
      const group = createGroup("A", 5);
      const dims = getNodeDimensions(group, false);

      // Multi-task collapsed groups have expand lip
      expect(dims.width).toBe(NODE_DEFAULTS.width);
      expect(dims.height).toBeGreaterThan(NODE_DEFAULTS.height);
    });
  });

  describe("expanded nodes", () => {
    it("returns default dimensions when expanded but single task", () => {
      const group = createGroup("A", 1);
      const dims = getNodeDimensions(group, true);

      // Single-task groups don't expand
      expect(dims.width).toBe(NODE_DEFAULTS.width);
      expect(dims.height).toBe(NODE_DEFAULTS.height);
    });

    it("returns expanded width for multi-task expanded group", () => {
      const group = createGroup("A", 5);
      const dims = getNodeDimensions(group, true);

      expect(dims.width).toBe(NODE_EXPANDED.width);
    });

    it("calculates height based on task count", () => {
      const group = createGroup("A", 3);
      const dims = getNodeDimensions(group, true);

      // Height = header + (tasks * row height) + collapse lip + border
      const expectedHeight = NODE_HEADER_HEIGHT + 3 * TASK_ROW_HEIGHT + 20 + NODE_BORDER_WIDTH;
      expect(dims.height).toBe(expectedHeight);
    });

    it("caps height at max height for many tasks", () => {
      const group = createGroup("A", 100); // Many tasks
      const dims = getNodeDimensions(group, true);

      expect(dims.height).toBeLessThanOrEqual(NODE_EXPANDED.maxHeight);
    });

    it("does not cap height for few tasks", () => {
      const group = createGroup("A", 3);
      const dims = getNodeDimensions(group, true);

      const calculatedHeight = NODE_HEADER_HEIGHT + 3 * TASK_ROW_HEIGHT + 20 + NODE_BORDER_WIDTH;
      expect(dims.height).toBe(calculatedHeight);
      expect(dims.height).toBeLessThan(NODE_EXPANDED.maxHeight);
    });
  });

  describe("edge cases", () => {
    it("handles group with no tasks array", () => {
      const group = { ...createGroup("A", 0), tasks: undefined } as unknown as GroupWithLayout;
      const dims = getNodeDimensions(group, false);

      expect(dims.width).toBe(NODE_DEFAULTS.width);
      expect(dims.height).toBe(NODE_DEFAULTS.height);
    });
  });
});

// =============================================================================
// computeInitialExpandedGroups Tests
// =============================================================================

describe("computeInitialExpandedGroups", () => {
  describe("no expandable groups", () => {
    it("returns empty set when all groups have 0-1 tasks", () => {
      const groups = [createGroup("A", 0), createGroup("B", 1), createGroup("C", 1)];

      const expanded = computeInitialExpandedGroups(groups);

      expect(expanded.size).toBe(0);
    });

    it("returns empty set for empty input", () => {
      const expanded = computeInitialExpandedGroups([]);
      expect(expanded.size).toBe(0);
    });
  });

  describe("single expandable group", () => {
    it("expands the only expandable group", () => {
      const groups = [
        createGroup("A", 1),
        createGroup("B", 5), // Only expandable one
        createGroup("C", 0),
      ];

      const expanded = computeInitialExpandedGroups(groups);

      expect(expanded.size).toBe(1);
      expect(expanded.has("B")).toBe(true);
    });
  });

  describe("multiple expandable groups", () => {
    it("expands groups with fewer tasks than threshold", () => {
      const groups = [
        createGroup("A", 5), // Below default threshold (20)
        createGroup("B", 10), // Below default threshold
        createGroup("C", 25), // Above default threshold
      ];

      const expanded = computeInitialExpandedGroups(groups);

      expect(expanded.has("A")).toBe(true);
      expect(expanded.has("B")).toBe(true);
      expect(expanded.has("C")).toBe(false);
    });

    it("respects custom task threshold", () => {
      const groups = [createGroup("A", 3), createGroup("B", 5), createGroup("C", 8)];

      const expanded = computeInitialExpandedGroups(groups, 5); // taskThreshold = 5

      expect(expanded.has("A")).toBe(true);
      expect(expanded.has("B")).toBe(false); // 5 >= 5
      expect(expanded.has("C")).toBe(false); // 8 >= 5
    });
  });

  describe("group count threshold", () => {
    it("collapses all when many groups", () => {
      // Create 15 groups (above default threshold of 10)
      const groups = Array.from({ length: 15 }, (_, i) => createGroup(`group-${i}`, 3));

      const expanded = computeInitialExpandedGroups(groups);

      expect(expanded.size).toBe(0);
    });

    it("expands when below group threshold", () => {
      // Create 5 groups (below default threshold of 10)
      const groups = Array.from({ length: 5 }, (_, i) => createGroup(`group-${i}`, 3));

      const expanded = computeInitialExpandedGroups(groups);

      // All 5 should be expanded (3 tasks < 20 threshold)
      expect(expanded.size).toBe(5);
    });

    it("respects custom group threshold", () => {
      const groups = Array.from({ length: 5 }, (_, i) => createGroup(`group-${i}`, 3));

      const expanded = computeInitialExpandedGroups(groups, 20, 3); // groupThreshold = 3

      // 5 groups >= 3 threshold → collapse all
      expect(expanded.size).toBe(0);
    });
  });

  describe("mixed scenarios", () => {
    it("correctly handles mix of single and multi-task groups", () => {
      const groups = [
        createGroup("single", 1), // Not expandable
        createGroup("small", 3), // Expandable, below threshold
        createGroup("medium", 15), // Expandable, below threshold
        createGroup("large", 50), // Expandable, above threshold
      ];

      const expanded = computeInitialExpandedGroups(groups);

      expect(expanded.has("single")).toBe(false); // Not expandable
      expect(expanded.has("small")).toBe(true);
      expect(expanded.has("medium")).toBe(true);
      expect(expanded.has("large")).toBe(false); // Above threshold
    });
  });
});

// =============================================================================
// buildEdges Tests
// =============================================================================

describe("buildEdges", () => {
  it("returns empty array for groups with no dependencies", () => {
    const groups = [createGroup("A", 1), createGroup("B", 1)];
    const edges = buildEdges(groups);

    expect(edges).toHaveLength(0);
  });

  it("creates edge for each downstream connection", () => {
    const groups = [createGroup("A", 1, { downstreamGroups: ["B", "C"] }), createGroup("B", 1), createGroup("C", 1)];

    const edges = buildEdges(groups);

    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.id === "A-B")).toBeDefined();
    expect(edges.find((e) => e.id === "A-C")).toBeDefined();
  });

  it("sets correct source and target", () => {
    const groups = [createGroup("A", 1, { downstreamGroups: ["B"] }), createGroup("B", 1)];

    const edges = buildEdges(groups);

    expect(edges[0].source).toBe("A");
    expect(edges[0].target).toBe("B");
  });

  it("sets correct edge type", () => {
    const groups = [createGroup("A", 1, { downstreamGroups: ["B"] }), createGroup("B", 1)];

    const edges = buildEdges(groups);

    expect(edges[0].type).toBe("smoothstep");
    expect(edges[0].sourceHandle).toBe("source");
    expect(edges[0].targetHandle).toBe("target");
  });

  describe("edge styling based on status", () => {
    it("animates edges from running groups", () => {
      const groups = [createGroup("A", 1, { status: "RUNNING", downstreamGroups: ["B"] }), createGroup("B", 1)];

      const edges = buildEdges(groups);

      expect(edges[0].animated).toBe(true);
    });

    it("does not animate edges from completed groups", () => {
      const groups = [createGroup("A", 1, { status: "COMPLETED", downstreamGroups: ["B"] }), createGroup("B", 1)];

      const edges = buildEdges(groups);

      expect(edges[0].animated).toBe(false);
    });

    it("applies CSS class based on status category", () => {
      const groups = [createGroup("A", 1, { status: "FAILED", downstreamGroups: ["B"] }), createGroup("B", 1)];

      const edges = buildEdges(groups);

      expect(edges[0].className).toContain("dag-edge--failed");
    });

    it("includes arrow marker", () => {
      const groups = [createGroup("A", 1, { downstreamGroups: ["B"] }), createGroup("B", 1)];

      const edges = buildEdges(groups);

      expect(edges[0].markerEnd).toBeDefined();
      expect(edges[0].markerEnd).toHaveProperty("type");
    });
  });

  describe("complex graphs", () => {
    it("handles diamond pattern", () => {
      const groups = [
        createGroup("A", 1, { downstreamGroups: ["B", "C"] }),
        createGroup("B", 1, { downstreamGroups: ["D"] }),
        createGroup("C", 1, { downstreamGroups: ["D"] }),
        createGroup("D", 1),
      ];

      const edges = buildEdges(groups);

      expect(edges).toHaveLength(4);
      expect(edges.map((e) => e.id).sort()).toEqual(["A-B", "A-C", "B-D", "C-D"]);
    });

    it("handles long chain", () => {
      const groups = [
        createGroup("A", 1, { downstreamGroups: ["B"] }),
        createGroup("B", 1, { downstreamGroups: ["C"] }),
        createGroup("C", 1, { downstreamGroups: ["D"] }),
        createGroup("D", 1),
      ];

      const edges = buildEdges(groups);

      expect(edges).toHaveLength(3);
    });
  });
});
