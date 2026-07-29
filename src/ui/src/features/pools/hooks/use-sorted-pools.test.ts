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

import { describe, expect, it } from "vitest";
import { sortPools } from "@/features/pools/hooks/use-sorted-pools";
import { createMockPool } from "@/testing/factories";

describe("sortPools", () => {
  it("sorts capacity by shared physical utilization", () => {
    const halfUsed = createMockPool({
      name: "half-used",
      quota: {
        used: 1,
        free: 7,
        limit: 8,
        totalUsage: 1,
        totalCapacity: 8,
        totalFree: 4,
      },
    });
    const quarterUsed = createMockPool({
      name: "quarter-used",
      quota: {
        used: 3,
        free: 5,
        limit: 8,
        totalUsage: 3,
        totalCapacity: 8,
        totalFree: 6,
      },
    });

    const sorted = sortPools([halfUsed, quarterUsed], {
      column: "capacity",
      direction: "asc",
    });

    expect(sorted.map((pool) => pool.name)).toEqual(["quarter-used", "half-used"]);
  });

  it("sorts transient invalid used and free values by their normalized presentation", () => {
    const negativeFree = createMockPool({
      name: "negative-free",
      quota: {
        used: 1,
        free: 7,
        limit: 8,
        totalUsage: 1,
        totalCapacity: 8,
        totalFree: -1,
      },
    });
    const excessiveFree = createMockPool({
      name: "excessive-free",
      quota: {
        used: 1,
        free: 7,
        limit: 8,
        totalUsage: 1,
        totalCapacity: 8,
        totalFree: 10,
      },
    });

    const byUsed = sortPools([negativeFree, excessiveFree], {
      column: "capacity",
      direction: "asc",
    });
    const byFree = sortPools([negativeFree, excessiveFree], {
      column: "capacityFree",
      direction: "asc",
    });

    expect(byUsed.map((pool) => pool.name)).toEqual(["excessive-free", "negative-free"]);
    expect(byFree.map((pool) => pool.name)).toEqual(["negative-free", "excessive-free"]);
  });
});
