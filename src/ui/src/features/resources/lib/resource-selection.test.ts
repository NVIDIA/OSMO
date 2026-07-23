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
import {
  findResourceForSelection,
  getResourceRowId,
  getResourceSelectionState,
} from "@/features/resources/lib/resource-selection";
import { createMockResource } from "@/testing/factories";

describe("resource selection", () => {
  const backendAResource = createMockResource({
    name: "ovx001",
    backend: "backend-a",
    poolMemberships: [{ pool: "pool-a", platform: "platform-a" }],
  });
  const backendBResource = createMockResource({
    name: "ovx001",
    backend: "backend-b",
    poolMemberships: [{ pool: "pool-b", platform: "platform-b" }],
  });
  const resources = [backendAResource, backendBResource];

  it("uses configured pool membership to disambiguate duplicate names", () => {
    expect(findResourceForSelection(resources, "ovx001", "pool-b")).toBe(backendBResource);
  });

  it("derives click state that resolves back to the clicked duplicate", () => {
    const selection = getResourceSelectionState(backendBResource, "pool-a");

    expect(selection).toEqual({ resourceName: "ovx001", poolName: "pool-b" });
    expect(findResourceForSelection(resources, selection.resourceName, selection.poolName)).toBe(backendBResource);
  });

  it("uses backend-aware row IDs for duplicate names", () => {
    expect(getResourceRowId(backendAResource)).toBe("backend-a/ovx001");
    expect(getResourceRowId(backendBResource)).toBe("backend-b/ovx001");
  });

  it("provides a stable panel key for each resource identity", () => {
    const sameResourceWithDifferentMembership = {
      ...backendBResource,
      poolMemberships: [{ pool: "pool-c", platform: "platform-c" }],
    };

    expect(getResourceRowId(backendBResource)).not.toBe(getResourceRowId(backendAResource));
    expect(getResourceRowId(sameResourceWithDifferentMembership)).toBe(getResourceRowId(backendBResource));
  });
});
