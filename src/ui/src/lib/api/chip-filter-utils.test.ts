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

import type { SearchChip } from "@/stores/types";

import {
  chipsToParams,
  filterChipsByFields,
  chipsToCacheKey,
  type ChipMappingConfig,
} from "@/lib/api/chip-filter-utils";

// =============================================================================
// Test Types
// =============================================================================

interface TestFilterParams {
  [key: string]: unknown;
  statuses: string[];
  platforms: string[];
  search: string;
}

// =============================================================================
// chipsToParams Tests
// =============================================================================

describe("chipsToParams", () => {
  const testMapping: ChipMappingConfig<TestFilterParams> = {
    status: { type: "array", paramKey: "statuses" },
    platform: { type: "array", paramKey: "platforms" },
    search: { type: "single", paramKey: "search" },
  };

  it("returns empty object when chips array is empty", () => {
    const result = chipsToParams<TestFilterParams>([], testMapping);

    expect(result).toEqual({});
  });

  it("collects array type chips into array parameter", () => {
    const chips: SearchChip[] = [{ field: "status", value: "ONLINE", label: "Online" }];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result.statuses).toEqual(["ONLINE"]);
  });

  it("accumulates multiple chips for same array field", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "status", value: "OFFLINE", label: "Offline" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result.statuses).toEqual(["ONLINE", "OFFLINE"]);
  });

  it("sets single type chip as string parameter", () => {
    const chips: SearchChip[] = [{ field: "search", value: "my-pool", label: "my-pool" }];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result.search).toBe("my-pool");
  });

  it("uses last value for single type when multiple chips exist", () => {
    const chips: SearchChip[] = [
      { field: "search", value: "first", label: "first" },
      { field: "search", value: "second", label: "second" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result.search).toBe("second");
  });

  it("ignores chips with unmapped fields", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "unknown", value: "ignored", label: "Ignored" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result.statuses).toEqual(["ONLINE"]);
    expect(Object.keys(result)).toEqual(["statuses"]);
  });

  it("handles mixed array and single type chips", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "platform", value: "dgx", label: "DGX" },
      { field: "search", value: "test", label: "test" },
      { field: "status", value: "OFFLINE", label: "Offline" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result.statuses).toEqual(["ONLINE", "OFFLINE"]);
    expect(result.platforms).toEqual(["dgx"]);
    expect(result.search).toBe("test");
  });
});

// =============================================================================
// filterChipsByFields Tests
// =============================================================================

describe("filterChipsByFields", () => {
  const testChips: SearchChip[] = [
    { field: "status", value: "ONLINE", label: "Online" },
    { field: "platform", value: "dgx", label: "DGX" },
    { field: "search", value: "test", label: "test" },
  ];

  it("returns chips matching handled fields in include mode", () => {
    const handledFields = new Set(["status", "platform"]);

    const result = filterChipsByFields(testChips, handledFields);

    expect(result).toHaveLength(2);
    expect(result[0].field).toBe("status");
    expect(result[1].field).toBe("platform");
  });

  it("returns chips not matching handled fields in exclude mode", () => {
    const handledFields = new Set(["status", "platform"]);

    const result = filterChipsByFields(testChips, handledFields, true);

    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("search");
  });

  it("returns empty array when no chips match in include mode", () => {
    const handledFields = new Set(["nonexistent"]);

    const result = filterChipsByFields(testChips, handledFields);

    expect(result).toEqual([]);
  });

  it("returns all chips when no chips match in exclude mode", () => {
    const handledFields = new Set(["nonexistent"]);

    const result = filterChipsByFields(testChips, handledFields, true);

    expect(result).toHaveLength(3);
  });

  it("returns empty array when chips array is empty", () => {
    const handledFields = new Set(["status"]);

    const result = filterChipsByFields([], handledFields);

    expect(result).toEqual([]);
  });
});

// =============================================================================
// chipsToCacheKey Tests
// =============================================================================

describe("chipsToCacheKey", () => {
  it("converts chips to sorted cache key string", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "platform", value: "dgx", label: "DGX" },
    ];

    const result = chipsToCacheKey(chips);

    expect(result).toBe("platform:dgx,status:ONLINE");
  });

  it("returns deterministic key regardless of input order", () => {
    const chipsA: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "platform", value: "dgx", label: "DGX" },
    ];
    const chipsB: SearchChip[] = [
      { field: "platform", value: "dgx", label: "DGX" },
      { field: "status", value: "ONLINE", label: "Online" },
    ];

    const resultA = chipsToCacheKey(chipsA);
    const resultB = chipsToCacheKey(chipsB);

    expect(resultA).toBe(resultB);
  });

  it("returns empty string when chips array is empty", () => {
    const result = chipsToCacheKey([]);

    expect(result).toBe("");
  });

  it("handles single chip", () => {
    const chips: SearchChip[] = [{ field: "search", value: "test", label: "test" }];

    const result = chipsToCacheKey(chips);

    expect(result).toBe("search:test");
  });
});
