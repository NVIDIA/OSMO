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

import type { SearchChip } from "@/components/filter-bar/lib/types";
import { getContextFilterChips, hasTextSearch } from "@/components/log-viewer/lib/show-in-context";

const chips: SearchChip[] = [
  { field: "source", value: "user", label: "source:user" },
  { field: "text", value: "failed", label: "failed" },
  { field: "task", value: "train", label: "task:train" },
  { field: "text", value: "timeout", label: "timeout" },
];

describe("show in context filters", () => {
  it("detects text-search result views", () => {
    expect(hasTextSearch(chips)).toBe(true);
    expect(hasTextSearch(chips.filter((chip) => chip.field !== "text"))).toBe(false);
  });

  it("removes every text search while preserving structured filters", () => {
    expect(getContextFilterChips(chips)).toEqual([
      { field: "source", value: "user", label: "source:user" },
      { field: "task", value: "train", label: "task:train" },
    ]);
  });
});
