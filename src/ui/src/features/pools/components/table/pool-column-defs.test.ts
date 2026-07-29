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
import type { ColumnDef } from "@tanstack/react-table";
import { createPoolColumns } from "@/features/pools/components/table/pool-column-defs";
import type { Pool } from "@/lib/api/adapter/types";
import { createMockPool } from "@/testing/factories";

function getAccessorValue(columns: ColumnDef<Pool, unknown>[], columnId: string, pool: Pool): unknown {
  const column = columns.find(({ id }) => id === columnId);
  if (!column || !("accessorFn" in column) || !column.accessorFn) {
    throw new Error(`Missing accessor for ${columnId}`);
  }
  return column.accessorFn(pool, 0);
}

describe("capacity columns", () => {
  it("exposes the same normalized used and free values shown by capacity surfaces", () => {
    const columns = createPoolColumns({});
    const negativeFree = createMockPool({
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
      quota: {
        used: 1,
        free: 7,
        limit: 8,
        totalUsage: 1,
        totalCapacity: 8,
        totalFree: 10,
      },
    });

    expect(getAccessorValue(columns, "capacity", negativeFree)).toBe(8);
    expect(getAccessorValue(columns, "capacityFree", negativeFree)).toBe(0);
    expect(getAccessorValue(columns, "capacity", excessiveFree)).toBe(0);
    expect(getAccessorValue(columns, "capacityFree", excessiveFree)).toBe(8);
  });
});
