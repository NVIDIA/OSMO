//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { classifySnapZone, SNAP_ZONES } from "./panel-state-machine";

describe("classifySnapZone", () => {
  it("returns null for normal zone (below 80%)", () => {
    expect(classifySnapZone(50)).toBeNull();
    expect(classifySnapZone(79)).toBeNull();
    expect(classifySnapZone(79.9)).toBeNull();
  });

  it("returns 'soft' for soft-snap zone (80% to <90%)", () => {
    expect(classifySnapZone(80)).toBe("soft");
    expect(classifySnapZone(85)).toBe("soft");
    expect(classifySnapZone(89)).toBe("soft");
    expect(classifySnapZone(89.9)).toBe("soft");
  });

  it("returns 'full' for full-snap zone (>=90%)", () => {
    expect(classifySnapZone(90)).toBe("full");
    expect(classifySnapZone(95)).toBe("full");
    expect(classifySnapZone(100)).toBe("full");
  });

  it("handles edge cases correctly", () => {
    expect(classifySnapZone(0)).toBeNull();
    expect(classifySnapZone(79.99999)).toBeNull();
    expect(classifySnapZone(80.00001)).toBe("soft");
    expect(classifySnapZone(89.99999)).toBe("soft");
    expect(classifySnapZone(90.00001)).toBe("full");
  });
});

describe("SNAP_ZONES constants", () => {
  it("defines correct thresholds", () => {
    expect(SNAP_ZONES.SOFT_SNAP_START).toBe(80);
    expect(SNAP_ZONES.FULL_SNAP_START).toBe(90);
    expect(SNAP_ZONES.SOFT_SNAP_TARGET).toBe(80);
    expect(SNAP_ZONES.FULL_SNAP_TARGET).toBe(100);
  });

  it("has logical threshold ordering", () => {
    expect(SNAP_ZONES.SOFT_SNAP_START).toBeLessThan(SNAP_ZONES.FULL_SNAP_START);
    expect(SNAP_ZONES.SOFT_SNAP_TARGET).toBeLessThan(SNAP_ZONES.FULL_SNAP_TARGET);
  });
});
