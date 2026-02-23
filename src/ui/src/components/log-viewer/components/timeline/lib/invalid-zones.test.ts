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
import { calculateBucketWidth } from "@/components/log-viewer/components/timeline/lib/invalid-zones";

describe("calculateBucketWidth", () => {
  it("should return 0 for empty array", () => {
    expect(calculateBucketWidth([])).toBe(0);
  });

  it("should return 0 for single bucket", () => {
    expect(calculateBucketWidth([new Date(1000)])).toBe(0);
  });

  it("should calculate width from first two buckets", () => {
    const buckets = [new Date(1000), new Date(2000), new Date(3000)];
    expect(calculateBucketWidth(buckets)).toBe(1000);
  });
});
