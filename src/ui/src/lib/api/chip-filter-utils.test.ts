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
// chipsToParams
// =============================================================================

describe("chipsToParams", () => {
  interface TestFilterParams extends Record<string, unknown> {
    statuses: string[];
    platforms: string[];
    search: string;
  }

  const testMapping: ChipMappingConfig<TestFilterParams> = {
    status: { type: "array", paramKey: "statuses" },
    platform: { type: "array", paramKey: "platforms" },
    search: { type: "single", paramKey: "search" },
  };

  it("returns empty object when chips array is empty", () => {
    const result = chipsToParams<TestFilterParams>([], testMapping);

    expect(result).toEqual({});
  });

  it("converts single array-type chip to array with one element", () => {
    const chips: SearchChip[] = [{ field: "status", value: "ONLINE", label: "Online" }];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ statuses: ["ONLINE"] });
  });

  it("collects multiple chips with same array-type field into single array", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "status", value: "OFFLINE", label: "Offline" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ statuses: ["ONLINE", "OFFLINE"] });
  });

  it("converts single-type chip to string value", () => {
    const chips: SearchChip[] = [{ field: "search", value: "my-pool", label: "my-pool" }];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ search: "my-pool" });
  });

  it("uses last value for single-type chips when multiple provided", () => {
    const chips: SearchChip[] = [
      { field: "search", value: "first-search", label: "first-search" },
      { field: "search", value: "last-search", label: "last-search" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ search: "last-search" });
  });

  it("ignores chips with fields not in mapping", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "unknown", value: "ignored", label: "Ignored" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ statuses: ["ONLINE"] });
  });

  it("handles mixed array and single type chips", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "platform", value: "dgx", label: "DGX" },
      { field: "search", value: "my-pool", label: "my-pool" },
      { field: "status", value: "OFFLINE", label: "Offline" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({
      statuses: ["ONLINE", "OFFLINE"],
      platforms: ["dgx"],
      search: "my-pool",
    });
  });

  it("includes empty string values in array-type params", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "", label: "Empty" },
      { field: "status", value: "ONLINE", label: "Online" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ statuses: ["", "ONLINE"] });
  });

  it("allows empty string value for single-type params", () => {
    const chips: SearchChip[] = [{ field: "search", value: "", label: "Empty" }];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ search: "" });
  });
});

// =============================================================================
// filterChipsByFields
// =============================================================================

describe("filterChipsByFields", () => {
  const chips: SearchChip[] = [
    { field: "status", value: "ONLINE", label: "Online" },
    { field: "platform", value: "dgx", label: "DGX" },
    { field: "search", value: "query", label: "query" },
  ];

  it("returns chips with fields in handledFields set when exclude is false", () => {
    const handledFields = new Set(["status", "platform"]);

    const result = filterChipsByFields(chips, handledFields, false);

    expect(result).toEqual([
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "platform", value: "dgx", label: "DGX" },
    ]);
  });

  it("returns chips with fields NOT in handledFields set when exclude is true", () => {
    const handledFields = new Set(["status", "platform"]);

    const result = filterChipsByFields(chips, handledFields, true);

    expect(result).toEqual([{ field: "search", value: "query", label: "query" }]);
  });

  it("uses exclude false as default when not provided", () => {
    const handledFields = new Set(["status"]);

    const result = filterChipsByFields(chips, handledFields);

    expect(result).toEqual([{ field: "status", value: "ONLINE", label: "Online" }]);
  });

  it("returns empty array when no chips match handledFields", () => {
    const handledFields = new Set(["unknown"]);

    const result = filterChipsByFields(chips, handledFields);

    expect(result).toEqual([]);
  });

  it("returns empty array when chips array is empty", () => {
    const handledFields = new Set(["status"]);

    const result = filterChipsByFields([], handledFields);

    expect(result).toEqual([]);
  });

  it("returns empty array when handledFields set is empty with exclude false", () => {
    const result = filterChipsByFields(chips, new Set(), false);

    expect(result).toEqual([]);
  });

  it("returns all chips when handledFields set is empty with exclude true", () => {
    const result = filterChipsByFields(chips, new Set(), true);

    expect(result).toEqual(chips);
  });
});

// =============================================================================
// chipsToCacheKey
// =============================================================================

describe("chipsToCacheKey", () => {
  it("returns empty string when chips array is empty", () => {
    const result = chipsToCacheKey([]);

    expect(result).toBe("");
  });

  it("returns field:value format for single chip", () => {
    const chips: SearchChip[] = [{ field: "status", value: "ONLINE", label: "Online" }];

    const result = chipsToCacheKey(chips);

    expect(result).toBe("status:ONLINE");
  });

  it("returns sorted comma-separated keys for multiple chips", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "platform", value: "dgx", label: "DGX" },
    ];

    const result = chipsToCacheKey(chips);

    expect(result).toBe("platform:dgx,status:ONLINE");
  });

  it("produces deterministic output regardless of input order", () => {
    const chipsOrderA: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "platform", value: "dgx", label: "DGX" },
      { field: "search", value: "query", label: "query" },
    ];

    const chipsOrderB: SearchChip[] = [
      { field: "search", value: "query", label: "query" },
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "platform", value: "dgx", label: "DGX" },
    ];

    const resultA = chipsToCacheKey(chipsOrderA);
    const resultB = chipsToCacheKey(chipsOrderB);

    expect(resultA).toBe(resultB);
    expect(resultA).toBe("platform:dgx,search:query,status:ONLINE");
  });

  it("includes duplicate chips in cache key", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Online" },
      { field: "status", value: "ONLINE", label: "Online" },
    ];

    const result = chipsToCacheKey(chips);

    expect(result).toBe("status:ONLINE,status:ONLINE");
  });

  it("handles chips with empty string values", () => {
    const chips: SearchChip[] = [{ field: "search", value: "", label: "Empty" }];

    const result = chipsToCacheKey(chips);

    expect(result).toBe("search:");
  });
});
