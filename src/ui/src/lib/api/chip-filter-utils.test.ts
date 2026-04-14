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

  it("converts single array chip to array parameter", () => {
    const chips: SearchChip[] = [{ field: "status", value: "ONLINE", label: "Status: ONLINE" }];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ statuses: ["ONLINE"] });
  });

  it("collects multiple array chips into same array parameter", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Status: ONLINE" },
      { field: "status", value: "OFFLINE", label: "Status: OFFLINE" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ statuses: ["ONLINE", "OFFLINE"] });
  });

  it("converts single type chip to string parameter", () => {
    const chips: SearchChip[] = [{ field: "search", value: "my-pool", label: "Search: my-pool" }];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ search: "my-pool" });
  });

  it("uses last value for single type when multiple chips have same field", () => {
    const chips: SearchChip[] = [
      { field: "search", value: "first-search", label: "Search: first-search" },
      { field: "search", value: "last-search", label: "Search: last-search" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ search: "last-search" });
  });

  it("ignores chips with fields not in mapping", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Status: ONLINE" },
      { field: "unknown", value: "ignored", label: "Unknown: ignored" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({ statuses: ["ONLINE"] });
  });

  it("handles mixed array and single type chips", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Status: ONLINE" },
      { field: "platform", value: "dgx", label: "Platform: dgx" },
      { field: "search", value: "my-pool", label: "Search: my-pool" },
      { field: "status", value: "OFFLINE", label: "Status: OFFLINE" },
    ];

    const result = chipsToParams<TestFilterParams>(chips, testMapping);

    expect(result).toEqual({
      statuses: ["ONLINE", "OFFLINE"],
      platforms: ["dgx"],
      search: "my-pool",
    });
  });
});

// =============================================================================
// filterChipsByFields
// =============================================================================

describe("filterChipsByFields", () => {
  const chips: SearchChip[] = [
    { field: "status", value: "ONLINE", label: "Status: ONLINE" },
    { field: "platform", value: "dgx", label: "Platform: dgx" },
    { field: "search", value: "my-pool", label: "Search: my-pool" },
  ];

  it("returns chips matching handled fields when exclude is false", () => {
    const handledFields = new Set(["status", "platform"]);

    const result = filterChipsByFields(chips, handledFields, false);

    expect(result).toHaveLength(2);
    expect(result[0].field).toBe("status");
    expect(result[1].field).toBe("platform");
  });

  it("returns chips matching handled fields by default", () => {
    const handledFields = new Set(["search"]);

    const result = filterChipsByFields(chips, handledFields);

    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("search");
  });

  it("returns chips NOT in handled fields when exclude is true", () => {
    const handledFields = new Set(["status", "platform"]);

    const result = filterChipsByFields(chips, handledFields, true);

    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("search");
  });

  it("returns empty array when no chips match", () => {
    const handledFields = new Set(["unknown"]);

    const result = filterChipsByFields(chips, handledFields);

    expect(result).toEqual([]);
  });

  it("returns all chips when exclude is true and no chips match handled fields", () => {
    const handledFields = new Set(["unknown"]);

    const result = filterChipsByFields(chips, handledFields, true);

    expect(result).toHaveLength(3);
  });
});

// =============================================================================
// chipsToCacheKey
// =============================================================================

describe("chipsToCacheKey", () => {
  it("returns empty string for empty chips array", () => {
    const result = chipsToCacheKey([]);

    expect(result).toBe("");
  });

  it("creates cache key from single chip", () => {
    const chips: SearchChip[] = [{ field: "status", value: "ONLINE", label: "Status: ONLINE" }];

    const result = chipsToCacheKey(chips);

    expect(result).toBe("status:ONLINE");
  });

  it("sorts cache key entries alphabetically", () => {
    const chips: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Status: ONLINE" },
      { field: "platform", value: "dgx", label: "Platform: dgx" },
      { field: "search", value: "my-pool", label: "Search: my-pool" },
    ];

    const result = chipsToCacheKey(chips);

    expect(result).toBe("platform:dgx,search:my-pool,status:ONLINE");
  });

  it("produces same key regardless of input order", () => {
    const chipsOrderA: SearchChip[] = [
      { field: "status", value: "ONLINE", label: "Status: ONLINE" },
      { field: "platform", value: "dgx", label: "Platform: dgx" },
    ];
    const chipsOrderB: SearchChip[] = [
      { field: "platform", value: "dgx", label: "Platform: dgx" },
      { field: "status", value: "ONLINE", label: "Status: ONLINE" },
    ];

    const resultA = chipsToCacheKey(chipsOrderA);
    const resultB = chipsToCacheKey(chipsOrderB);

    expect(resultA).toBe(resultB);
    expect(resultA).toBe("platform:dgx,status:ONLINE");
  });
});
