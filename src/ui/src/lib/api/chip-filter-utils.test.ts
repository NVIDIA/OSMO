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
import {
  chipsToParams,
  filterChipsByFields,
  chipsToCacheKey,
  type ChipMappingConfig,
} from "@/lib/api/chip-filter-utils";
import { PoolStatus } from "@/lib/api/generated";
import type { SearchChip } from "@/stores/types";

// =============================================================================
// Test Types
// =============================================================================

interface TestFilterParams extends Record<string, unknown> {
  statuses: string[];
  platforms: string[];
  search: string;
}

// =============================================================================
// Test Fixtures
// =============================================================================

const TEST_MAPPING: ChipMappingConfig<TestFilterParams> = {
  status: { type: "array", paramKey: "statuses" },
  platform: { type: "array", paramKey: "platforms" },
  search: { type: "single", paramKey: "search" },
};

function createChip(field: string, value: string): SearchChip {
  return { field, value, label: `${field}: ${value}` };
}

// =============================================================================
// chipsToParams Tests
// =============================================================================

describe("chipsToParams", () => {
  it("returns empty object for empty chips array", () => {
    const result = chipsToParams<TestFilterParams>([], TEST_MAPPING);
    expect(result).toEqual({});
  });

  it("collects array type chips into arrays", () => {
    const chips: SearchChip[] = [createChip("status", PoolStatus.ONLINE), createChip("status", PoolStatus.OFFLINE)];
    const result = chipsToParams<TestFilterParams>(chips, TEST_MAPPING);
    expect(result.statuses).toEqual([PoolStatus.ONLINE, PoolStatus.OFFLINE]);
  });

  it("handles single type chips with last value wins", () => {
    const chips: SearchChip[] = [createChip("search", "first"), createChip("search", "second")];
    const result = chipsToParams<TestFilterParams>(chips, TEST_MAPPING);
    expect(result.search).toBe("second");
  });

  it("handles mixed array and single type chips", () => {
    const chips: SearchChip[] = [
      createChip("status", PoolStatus.ONLINE),
      createChip("platform", "dgx"),
      createChip("search", "my-pool"),
      createChip("status", PoolStatus.OFFLINE),
    ];
    const result = chipsToParams<TestFilterParams>(chips, TEST_MAPPING);
    expect(result.statuses).toEqual([PoolStatus.ONLINE, PoolStatus.OFFLINE]);
    expect(result.platforms).toEqual(["dgx"]);
    expect(result.search).toBe("my-pool");
  });

  it("ignores chips with fields not in mapping", () => {
    const chips: SearchChip[] = [createChip("unknown", "value"), createChip("status", PoolStatus.ONLINE)];
    const result = chipsToParams<TestFilterParams>(chips, TEST_MAPPING);
    expect(result.statuses).toEqual([PoolStatus.ONLINE]);
    expect(result).not.toHaveProperty("unknown");
  });

  it("handles single chip of array type", () => {
    const chips: SearchChip[] = [createChip("platform", "dgx")];
    const result = chipsToParams<TestFilterParams>(chips, TEST_MAPPING);
    expect(result.platforms).toEqual(["dgx"]);
  });
});

// =============================================================================
// filterChipsByFields Tests
// =============================================================================

describe("filterChipsByFields", () => {
  it("returns empty array for empty chips", () => {
    const result = filterChipsByFields([], new Set(["status"]));
    expect(result).toEqual([]);
  });

  it("includes chips matching handledFields by default", () => {
    const chips: SearchChip[] = [createChip("status", PoolStatus.ONLINE), createChip("platform", "dgx")];
    const result = filterChipsByFields(chips, new Set(["status"]));
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("status");
  });

  it("excludes chips matching handledFields when exclude is true", () => {
    const chips: SearchChip[] = [createChip("status", PoolStatus.ONLINE), createChip("platform", "dgx")];
    const result = filterChipsByFields(chips, new Set(["status"]), true);
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("platform");
  });

  it("returns no chips when handledFields is empty and exclude is false", () => {
    const chips: SearchChip[] = [createChip("status", PoolStatus.ONLINE), createChip("platform", "dgx")];
    const result = filterChipsByFields(chips, new Set());
    expect(result).toEqual([]);
  });

  it("returns all chips when handledFields is empty and exclude is true", () => {
    const chips: SearchChip[] = [createChip("status", PoolStatus.ONLINE), createChip("platform", "dgx")];
    const result = filterChipsByFields(chips, new Set(), true);
    expect(result).toHaveLength(2);
  });
});

// =============================================================================
// chipsToCacheKey Tests
// =============================================================================

describe("chipsToCacheKey", () => {
  it("returns empty string for empty chips", () => {
    const result = chipsToCacheKey([]);
    expect(result).toBe("");
  });

  it("creates cache key from single chip", () => {
    const chips: SearchChip[] = [createChip("status", PoolStatus.ONLINE)];
    const result = chipsToCacheKey(chips);
    expect(result).toBe(`status:${PoolStatus.ONLINE}`);
  });

  it("creates sorted cache key from multiple chips", () => {
    const chips: SearchChip[] = [createChip("status", PoolStatus.ONLINE), createChip("platform", "dgx")];
    const result = chipsToCacheKey(chips);
    expect(result).toBe(`platform:dgx,status:${PoolStatus.ONLINE}`);
  });

  it("produces deterministic output regardless of input order", () => {
    const chipsA: SearchChip[] = [createChip("status", PoolStatus.ONLINE), createChip("platform", "dgx")];
    const chipsB: SearchChip[] = [createChip("platform", "dgx"), createChip("status", PoolStatus.ONLINE)];
    expect(chipsToCacheKey(chipsA)).toBe(chipsToCacheKey(chipsB));
  });

  it("includes all chips in cache key", () => {
    const chips: SearchChip[] = [createChip("a", "1"), createChip("b", "2"), createChip("c", "3")];
    const result = chipsToCacheKey(chips);
    expect(result).toBe("a:1,b:2,c:3");
  });
});
