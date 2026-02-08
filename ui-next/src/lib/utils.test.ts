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

import { describe, it, expect } from "vitest";
import { cn, formatCompact, formatBytes, formatBytesPair, naturalCompare } from "@/lib/utils";

// =============================================================================
// naturalCompare (alphanumeric sorting)
// =============================================================================

describe("naturalCompare", () => {
  it("sorts strings with numbers naturally", () => {
    const items = ["item_1", "item_10", "item_2", "item_20", "item_3"];
    const sorted = [...items].sort(naturalCompare);
    expect(sorted).toEqual(["item_1", "item_2", "item_3", "item_10", "item_20"]);
  });

  it("handles workflow naming patterns", () => {
    const workflows = ["workflow_1", "workflow_10", "workflow_2", "workflow_100"];
    const sorted = [...workflows].sort(naturalCompare);
    expect(sorted).toEqual(["workflow_1", "workflow_2", "workflow_10", "workflow_100"]);
  });

  it("handles mixed prefixes", () => {
    const items = ["a10", "a2", "b1", "a1"];
    const sorted = [...items].sort(naturalCompare);
    expect(sorted).toEqual(["a1", "a2", "a10", "b1"]);
  });

  it("handles strings without numbers", () => {
    const items = ["zebra", "apple", "mango"];
    const sorted = [...items].sort(naturalCompare);
    expect(sorted).toEqual(["apple", "mango", "zebra"]);
  });

  it("handles pure numbers in strings", () => {
    const items = ["10", "2", "1", "20"];
    const sorted = [...items].sort(naturalCompare);
    expect(sorted).toEqual(["1", "2", "10", "20"]);
  });

  it("handles task naming patterns", () => {
    const tasks = ["task-0", "task-1", "task-10", "task-2", "task-9"];
    const sorted = [...tasks].sort(naturalCompare);
    expect(sorted).toEqual(["task-0", "task-1", "task-2", "task-9", "task-10"]);
  });

  it("handles resource naming patterns", () => {
    const resources = ["gpu-node-1", "gpu-node-10", "gpu-node-2", "cpu-node-1"];
    const sorted = [...resources].sort(naturalCompare);
    expect(sorted).toEqual(["cpu-node-1", "gpu-node-1", "gpu-node-2", "gpu-node-10"]);
  });

  it("is case-insensitive", () => {
    const items = ["B1", "a1", "A2", "b2"];
    const sorted = [...items].sort(naturalCompare);
    // Case-insensitive: a/A and b/B group together
    expect(sorted).toEqual(["a1", "A2", "B1", "b2"]);
  });

  it("handles empty strings", () => {
    const items = ["b", "", "a"];
    const sorted = [...items].sort(naturalCompare);
    expect(sorted).toEqual(["", "a", "b"]);
  });

  it("handles identical strings", () => {
    expect(naturalCompare("same", "same")).toBe(0);
  });
});

// =============================================================================
// cn (class name utility)
// =============================================================================

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", true && "active", false && "hidden")).toBe("base active");
  });

  it("handles undefined and null", () => {
    expect(cn("base", undefined, null, "end")).toBe("base end");
  });

  it("merges tailwind classes correctly", () => {
    // tailwind-merge should dedupe conflicting utilities
    expect(cn("p-4", "p-2")).toBe("p-2"); // Later wins
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles arrays", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("handles objects", () => {
    expect(cn({ active: true, hidden: false })).toBe("active");
  });
});

// =============================================================================
// formatCompact
// =============================================================================

describe("formatCompact", () => {
  it("returns plain number below 1000", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(1)).toBe("1");
    expect(formatCompact(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatCompact(1000)).toBe("1.0K");
    expect(formatCompact(1500)).toBe("1.5K");
    expect(formatCompact(24221)).toBe("24K"); // >= 10 rounds, no decimal
    expect(formatCompact(999999)).toBe("1,000K"); // Comma for large K values
  });

  it("formats millions with M suffix", () => {
    expect(formatCompact(1000000)).toBe("1.0M");
    expect(formatCompact(1234567)).toBe("1.2M");
    expect(formatCompact(50000000)).toBe("50M"); // >= 10 rounds, no decimal
  });

  it("formats billions with G suffix", () => {
    expect(formatCompact(1000000000)).toBe("1.0G");
    expect(formatCompact(1234567890)).toBe("1.2G");
  });

  it("handles boundary values", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1000)).toBe("1.0K");
    expect(formatCompact(999999)).toBe("1,000K");
    expect(formatCompact(1000000)).toBe("1.0M");
  });

  it("adds commas for large compact values", () => {
    expect(formatCompact(10000000)).toBe("10M"); // 10M, no comma needed
    expect(formatCompact(100000000)).toBe("100M");
    expect(formatCompact(1000000000)).toBe("1.0G");
    expect(formatCompact(15000000000)).toBe("15G");
  });
});

// =============================================================================
// formatBytes (binary units for memory/storage)
// =============================================================================

describe("formatBytes", () => {
  it("returns 0 Gi for zero", () => {
    const result = formatBytes(0);
    expect(result.display).toBe("0 Gi");
  });

  it("formats GiB values (1-1023 GiB)", () => {
    expect(formatBytes(1).display).toBe("1 Gi");
    expect(formatBytes(64).display).toBe("64 Gi");
    expect(formatBytes(512).display).toBe("512 Gi");
    expect(formatBytes(1023).display).toBe("1,023 Gi"); // Comma for 4 digits
  });

  it("formats TiB values (>= 1024 GiB)", () => {
    expect(formatBytes(1024).display).toBe("1 Ti");
    expect(formatBytes(2048).display).toBe("2 Ti");
    expect(formatBytes(1536).display).toBe("1.5 Ti");
    expect(formatBytes(10240).display).toBe("10 Ti");
  });

  it("formats MiB values (< 1 GiB)", () => {
    expect(formatBytes(0.5).display).toBe("512 Mi");
    expect(formatBytes(0.25).display).toBe("256 Mi");
    expect(formatBytes(0.001953125).display).toBe("2 Mi"); // 2 MiB
  });

  it("formats KiB values (very small)", () => {
    const tiny = 1 / 1024 / 1024; // 1 KiB in GiB
    expect(formatBytes(tiny).display).toBe("1 Ki");
  });

  it("removes trailing .0 for whole numbers", () => {
    expect(formatBytes(64).value).toBe("64");
    expect(formatBytes(1024).value).toBe("1");
    expect(formatBytes(2048).value).toBe("2");
  });

  it("keeps one decimal for non-whole numbers", () => {
    expect(formatBytes(1.5).value).toBe("1.5");
    expect(formatBytes(1536).value).toBe("1.5"); // 1.5 Ti
  });

  it("returns correct unit separately", () => {
    expect(formatBytes(64).unit).toBe("Gi");
    expect(formatBytes(1024).unit).toBe("Ti");
    expect(formatBytes(0.5).unit).toBe("Mi");
  });

  it("adds commas for large values", () => {
    expect(formatBytes(13578).display).toBe("13 Ti"); // 13.26 rounds to 13
    expect(formatBytes(1023).value).toBe("1,023"); // 1023 with comma
  });
});

// =============================================================================
// formatBytesPair (consistent units for used/total display)
// =============================================================================

describe("formatBytesPair", () => {
  it("uses same unit when both values are in same range", () => {
    const result = formatBytesPair(64, 256);
    expect(result.used).toBe("64");
    expect(result.total).toBe("256");
    expect(result.unit).toBe("Gi");
  });

  it("uses more granular unit when values span ranges", () => {
    // 5 Gi used, 2048 Gi (2 Ti) total → both should be in Gi
    const result = formatBytesPair(5, 2048);
    expect(result.used).toBe("5");
    expect(result.total).toBe("2,048"); // Comma for 4 digits
    expect(result.unit).toBe("Gi");
  });

  it("uses Ti when both are large", () => {
    // 1024 Gi (1 Ti) used, 4096 Gi (4 Ti) total
    const result = formatBytesPair(1024, 4096);
    expect(result.used).toBe("1");
    expect(result.total).toBe("4");
    expect(result.unit).toBe("Ti");
  });

  it("uses Mi when used is small", () => {
    // 512 Mi (0.5 Gi) used, 64 Gi total → both in Mi
    const result = formatBytesPair(0.5, 64);
    expect(result.used).toBe("512");
    expect(result.total).toBe("65,536"); // 64 * 1024 with comma
    expect(result.unit).toBe("Mi");
  });

  it("calculates free correctly in chosen unit", () => {
    // 64 Gi used, 256 Gi total → 192 Gi free
    const result = formatBytesPair(64, 256);
    expect(result.freeDisplay).toBe("192 Gi");
  });

  it("handles zero used - adopts total's unit", () => {
    // 0 is unitless, so adopt total's unit (Ti)
    const result = formatBytesPair(0, 1024);
    expect(result.used).toBe("0");
    expect(result.total).toBe("1");
    expect(result.unit).toBe("Ti");
    expect(result.freeDisplay).toBe("1 Ti");
  });

  it("handles equal used and total", () => {
    const result = formatBytesPair(64, 64);
    expect(result.used).toBe("64");
    expect(result.total).toBe("64");
    expect(result.freeDisplay).toBe("0 Gi");
  });

  it("adds commas for large values", () => {
    // Large values should have commas
    const result = formatBytesPair(100, 13578);
    expect(result.used).toBe("100");
    expect(result.total).toBe("13,578"); // Comma for 5 digits
    expect(result.unit).toBe("Gi");
    expect(result.freeDisplay).toBe("13,478 Gi");
  });
});
