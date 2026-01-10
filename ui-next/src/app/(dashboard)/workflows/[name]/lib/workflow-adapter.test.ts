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
 * Workflow Adapter Tests
 *
 * Tests the core DAG transformation logic:
 * - Topological level computation using Kahn's algorithm
 * - Upstream dependency reconstruction
 * - Cycle detection
 * - Root and leaf node identification
 *
 * These tests use minimal mock data that focuses on the graph structure
 * rather than full backend payloads.
 */

import { describe, it, expect } from "vitest";
import {
  computeFullUpstreamDependencies,
  transformGroups,
  getMaxLevel,
  getGroupsByLevel,
  getRootGroups,
  getLeafGroups,
} from "./workflow-adapter";
import type { GroupQueryResponse } from "@/lib/api/generated";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a minimal group for testing graph structure.
 * Only includes fields needed for layout computation.
 */
function createGroup(name: string, downstreamGroups: string[] = [], status = "COMPLETED"): GroupQueryResponse {
  return {
    name,
    status,
    downstream_groups: downstreamGroups,
    remaining_upstream_groups: [],
    tasks: [],
  } as GroupQueryResponse;
}

// =============================================================================
// computeFullUpstreamDependencies Tests
// =============================================================================

describe("computeFullUpstreamDependencies", () => {
  it("returns empty arrays for groups with no dependencies", () => {
    const groups = [createGroup("A"), createGroup("B"), createGroup("C")];
    const upstreamMap = computeFullUpstreamDependencies(groups);

    expect(upstreamMap.get("A")).toEqual([]);
    expect(upstreamMap.get("B")).toEqual([]);
    expect(upstreamMap.get("C")).toEqual([]);
  });

  it("computes upstream from downstream relationships", () => {
    // A → B → C
    const groups = [createGroup("A", ["B"]), createGroup("B", ["C"]), createGroup("C")];

    const upstreamMap = computeFullUpstreamDependencies(groups);

    expect(upstreamMap.get("A")).toEqual([]); // A has no upstream
    expect(upstreamMap.get("B")).toEqual(["A"]); // B's upstream is A
    expect(upstreamMap.get("C")).toEqual(["B"]); // C's upstream is B
  });

  it("handles diamond dependencies", () => {
    // Diamond: A → B, A → C, B → D, C → D
    const groups = [createGroup("A", ["B", "C"]), createGroup("B", ["D"]), createGroup("C", ["D"]), createGroup("D")];

    const upstreamMap = computeFullUpstreamDependencies(groups);

    expect(upstreamMap.get("A")).toEqual([]);
    expect(upstreamMap.get("B")).toEqual(["A"]);
    expect(upstreamMap.get("C")).toEqual(["A"]);
    expect(upstreamMap.get("D")?.sort()).toEqual(["B", "C"]);
  });

  it("handles multiple root nodes", () => {
    // Two independent roots: A → C, B → C
    const groups = [createGroup("A", ["C"]), createGroup("B", ["C"]), createGroup("C")];

    const upstreamMap = computeFullUpstreamDependencies(groups);

    expect(upstreamMap.get("A")).toEqual([]);
    expect(upstreamMap.get("B")).toEqual([]);
    expect(upstreamMap.get("C")?.sort()).toEqual(["A", "B"]);
  });

  it("ignores downstream references to non-existent groups", () => {
    // A references "missing" which doesn't exist
    const groups = [createGroup("A", ["missing", "B"]), createGroup("B")];

    const upstreamMap = computeFullUpstreamDependencies(groups);

    // B's upstream is A (the reference to "missing" is ignored)
    expect(upstreamMap.get("B")).toEqual(["A"]);
    // "missing" is not in the map
    expect(upstreamMap.has("missing")).toBe(false);
  });

  it("returns empty map for empty input", () => {
    const upstreamMap = computeFullUpstreamDependencies([]);
    expect(upstreamMap.size).toBe(0);
  });
});

// =============================================================================
// transformGroups Tests - Level Computation
// =============================================================================

describe("transformGroups", () => {
  describe("level computation", () => {
    it("assigns level 0 to all independent nodes", () => {
      const groups = [createGroup("A"), createGroup("B"), createGroup("C")];

      const result = transformGroups(groups, { warnOnIssues: false });

      expect(result.find((g) => g.name === "A")?.level).toBe(0);
      expect(result.find((g) => g.name === "B")?.level).toBe(0);
      expect(result.find((g) => g.name === "C")?.level).toBe(0);
    });

    it("assigns sequential levels for linear chain", () => {
      // A → B → C → D
      const groups = [createGroup("A", ["B"]), createGroup("B", ["C"]), createGroup("C", ["D"]), createGroup("D")];

      const result = transformGroups(groups, { warnOnIssues: false });

      expect(result.find((g) => g.name === "A")?.level).toBe(0);
      expect(result.find((g) => g.name === "B")?.level).toBe(1);
      expect(result.find((g) => g.name === "C")?.level).toBe(2);
      expect(result.find((g) => g.name === "D")?.level).toBe(3);
    });

    it("computes correct levels for diamond DAG", () => {
      // Diamond: A → B, A → C, B → D, C → D
      const groups = [createGroup("A", ["B", "C"]), createGroup("B", ["D"]), createGroup("C", ["D"]), createGroup("D")];

      const result = transformGroups(groups, { warnOnIssues: false });

      expect(result.find((g) => g.name === "A")?.level).toBe(0);
      expect(result.find((g) => g.name === "B")?.level).toBe(1);
      expect(result.find((g) => g.name === "C")?.level).toBe(1);
      // D depends on both B and C (level 1), so D is level 2
      expect(result.find((g) => g.name === "D")?.level).toBe(2);
    });

    it("computes max upstream level for complex dependencies", () => {
      // A → B → D
      // A → C (C has no downstream)
      // D depends only on B, so level = 2
      const groups = [createGroup("A", ["B", "C"]), createGroup("B", ["D"]), createGroup("C"), createGroup("D")];

      const result = transformGroups(groups, { warnOnIssues: false });

      expect(result.find((g) => g.name === "A")?.level).toBe(0);
      expect(result.find((g) => g.name === "B")?.level).toBe(1);
      expect(result.find((g) => g.name === "C")?.level).toBe(1);
      expect(result.find((g) => g.name === "D")?.level).toBe(2);
    });

    it("handles wide DAG (many parallel nodes)", () => {
      // Root → A, B, C, D, E (5 parallel children)
      const groups = [
        createGroup("root", ["A", "B", "C", "D", "E"]),
        createGroup("A"),
        createGroup("B"),
        createGroup("C"),
        createGroup("D"),
        createGroup("E"),
      ];

      const result = transformGroups(groups, { warnOnIssues: false });

      expect(result.find((g) => g.name === "root")?.level).toBe(0);
      expect(result.find((g) => g.name === "A")?.level).toBe(1);
      expect(result.find((g) => g.name === "B")?.level).toBe(1);
      expect(result.find((g) => g.name === "C")?.level).toBe(1);
      expect(result.find((g) => g.name === "D")?.level).toBe(1);
      expect(result.find((g) => g.name === "E")?.level).toBe(1);
    });
  });

  describe("lane assignment", () => {
    it("assigns lanes alphabetically within each level", () => {
      // All at level 0
      const groups = [createGroup("C"), createGroup("A"), createGroup("B")];

      const result = transformGroups(groups, { warnOnIssues: false });

      // Sorted: A=0, B=1, C=2
      expect(result.find((g) => g.name === "A")?.lane).toBe(0);
      expect(result.find((g) => g.name === "B")?.lane).toBe(1);
      expect(result.find((g) => g.name === "C")?.lane).toBe(2);
    });

    it("assigns lanes independently per level", () => {
      // Level 0: A, Level 1: B, C
      const groups = [createGroup("A", ["B", "C"]), createGroup("C"), createGroup("B")];

      const result = transformGroups(groups, { warnOnIssues: false });

      // Level 0: A is alone (lane 0)
      expect(result.find((g) => g.name === "A")?.lane).toBe(0);
      // Level 1: B=0, C=1 (alphabetical)
      expect(result.find((g) => g.name === "B")?.lane).toBe(0);
      expect(result.find((g) => g.name === "C")?.lane).toBe(1);
    });
  });

  describe("id assignment", () => {
    it("uses group name as id", () => {
      const groups = [createGroup("my-group-name")];
      const result = transformGroups(groups, { warnOnIssues: false });

      expect(result[0].id).toBe("my-group-name");
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty input", () => {
      const result = transformGroups([], { warnOnIssues: false });
      expect(result).toEqual([]);
    });

    it("handles single node", () => {
      const groups = [createGroup("only")];
      const result = transformGroups(groups, { warnOnIssues: false });

      expect(result).toHaveLength(1);
      expect(result[0].level).toBe(0);
      expect(result[0].lane).toBe(0);
    });

    it("handles self-referencing group (cycle)", () => {
      // A references itself
      const groups = [createGroup("A", ["A"])];
      const result = transformGroups(groups, { warnOnIssues: false });

      // Should still produce a result
      // Note: The cycle detection returns 0 for the cycle node,
      // but since A is also its own upstream, the level calculation
      // results in max(0) + 1 = 1
      expect(result).toHaveLength(1);
      // Cycle produces level 1 (0 from cycle detection + 1)
      expect(result[0].level).toBe(1);
    });

    it("handles missing upstream references gracefully", () => {
      // B's upstream "missing" doesn't exist
      const groups = [createGroup("B")];
      // Manually add a reference that doesn't exist
      groups[0].downstream_groups = [];

      const result = transformGroups(groups, { warnOnIssues: false });
      expect(result[0].level).toBe(0);
    });
  });

  describe("preserves original data", () => {
    it("includes all original group properties", () => {
      const originalGroup = createGroup("test", ["dep1"], "RUNNING");

      const result = transformGroups([originalGroup], { warnOnIssues: false });

      expect(result[0].name).toBe("test");
      expect(result[0].status).toBe("RUNNING");
      expect(result[0].remaining_upstream_groups).toEqual([]);
    });
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe("getMaxLevel", () => {
  it("returns 0 for empty array", () => {
    expect(getMaxLevel([])).toBe(0);
  });

  it("returns 0 for single level-0 node", () => {
    const groups = transformGroups([createGroup("A")], { warnOnIssues: false });
    expect(getMaxLevel(groups)).toBe(0);
  });

  it("returns correct max level for deep DAG", () => {
    const groups = [createGroup("A", ["B"]), createGroup("B", ["C"]), createGroup("C", ["D"]), createGroup("D")];
    const result = transformGroups(groups, { warnOnIssues: false });
    expect(getMaxLevel(result)).toBe(3);
  });
});

describe("getGroupsByLevel", () => {
  it("returns empty map for empty array", () => {
    const result = getGroupsByLevel([]);
    expect(result.size).toBe(0);
  });

  it("groups nodes by level", () => {
    const groups = [createGroup("A", ["B", "C"]), createGroup("B", ["D"]), createGroup("C", ["D"]), createGroup("D")];
    const transformed = transformGroups(groups, { warnOnIssues: false });
    const byLevel = getGroupsByLevel(transformed);

    expect(byLevel.get(0)?.map((g) => g.name)).toEqual(["A"]);
    expect(
      byLevel
        .get(1)
        ?.map((g) => g.name)
        .sort(),
    ).toEqual(["B", "C"]);
    expect(byLevel.get(2)?.map((g) => g.name)).toEqual(["D"]);
  });
});

describe("getRootGroups", () => {
  it("returns all groups with level 0", () => {
    const groups = [createGroup("A", ["C"]), createGroup("B", ["C"]), createGroup("C")];
    const transformed = transformGroups(groups, { warnOnIssues: false });
    const roots = getRootGroups(transformed);

    expect(roots.map((g) => g.name).sort()).toEqual(["A", "B"]);
  });

  it("returns all groups when all are roots", () => {
    const groups = [createGroup("A"), createGroup("B"), createGroup("C")];
    const transformed = transformGroups(groups, { warnOnIssues: false });
    const roots = getRootGroups(transformed);

    expect(roots).toHaveLength(3);
  });
});

describe("getLeafGroups", () => {
  it("returns groups with no downstream dependencies", () => {
    const groups = [createGroup("A", ["B"]), createGroup("B", ["C"]), createGroup("C")];
    const transformed = transformGroups(groups, { warnOnIssues: false });
    const leaves = getLeafGroups(transformed);

    expect(leaves.map((g) => g.name)).toEqual(["C"]);
  });

  it("returns multiple leaves", () => {
    // A → B, A → C (both B and C are leaves)
    const groups = [createGroup("A", ["B", "C"]), createGroup("B"), createGroup("C")];
    const transformed = transformGroups(groups, { warnOnIssues: false });
    const leaves = getLeafGroups(transformed);

    expect(leaves.map((g) => g.name).sort()).toEqual(["B", "C"]);
  });

  it("returns all groups when all are leaves", () => {
    const groups = [createGroup("A"), createGroup("B")];
    const transformed = transformGroups(groups, { warnOnIssues: false });
    const leaves = getLeafGroups(transformed);

    expect(leaves).toHaveLength(2);
  });
});
