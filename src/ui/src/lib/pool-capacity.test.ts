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
import { normalizePhysicalCapacity } from "@/lib/pool-capacity";

describe("normalizePhysicalCapacity", () => {
  it("derives shared physical usage from capacity and free GPUs", () => {
    expect(normalizePhysicalCapacity({ totalCapacity: 8, totalFree: 6 })).toEqual({
      used: 2,
      free: 6,
      total: 8,
    });
  });

  it("clamps inconsistent capacity values for presentation", () => {
    expect(normalizePhysicalCapacity({ totalCapacity: 8, totalFree: 10 })).toEqual({
      used: 0,
      free: 8,
      total: 8,
    });
    expect(normalizePhysicalCapacity({ totalCapacity: 8, totalFree: -1 })).toEqual({
      used: 8,
      free: 0,
      total: 8,
    });
    expect(normalizePhysicalCapacity({ totalCapacity: -1, totalFree: 0 })).toEqual({
      used: 0,
      free: 0,
      total: 0,
    });
  });
});
