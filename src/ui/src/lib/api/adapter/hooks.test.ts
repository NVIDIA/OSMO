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
import { extractPoolMemberships } from "@/lib/api/adapter/hooks";
import type { ResourcesResponse } from "@/lib/api/generated";

describe("extractPoolMemberships", () => {
  it("selects the matching backend when resource names are duplicated", () => {
    const response = {
      resources: [
        {
          hostname: "ovx001",
          backend: "backend-a",
          exposed_fields: { node: "ovx001" },
          pool_platform_labels: { "pool-a": ["platform-a"] },
        },
        {
          hostname: "ovx001",
          backend: "backend-b",
          exposed_fields: { node: "ovx001" },
          pool_platform_labels: { "pool-b": ["platform-b"] },
        },
      ],
    } as unknown as ResourcesResponse;

    expect(extractPoolMemberships(response, "ovx001", "backend-b")).toEqual([
      { pool: "pool-b", platform: "platform-b" },
    ]);
  });
});
