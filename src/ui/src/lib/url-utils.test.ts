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

import { parseUrlChips } from "@/lib/url-utils";

describe("parseUrlChips", () => {
  it("returns empty array when param is undefined", () => {
    const result = parseUrlChips(undefined);

    expect(result).toEqual([]);
  });

  it("returns empty array when param is empty string", () => {
    const result = parseUrlChips("");

    expect(result).toEqual([]);
  });

  it("parses single filter from string param", () => {
    const result = parseUrlChips("status:RUNNING");

    expect(result).toEqual([{ field: "status", value: "RUNNING", label: "status: RUNNING" }]);
  });

  it("parses comma-separated filters from string param (nuqs format)", () => {
    const result = parseUrlChips("status:RUNNING,user:alice");

    expect(result).toEqual([
      { field: "status", value: "RUNNING", label: "status: RUNNING" },
      { field: "user", value: "alice", label: "user: alice" },
    ]);
  });

  it("parses filters from array param (legacy format)", () => {
    const result = parseUrlChips(["status:RUNNING", "user:alice"]);

    expect(result).toEqual([
      { field: "status", value: "RUNNING", label: "status: RUNNING" },
      { field: "user", value: "alice", label: "user: alice" },
    ]);
  });

  it("flattens comma-separated values within array elements", () => {
    const result = parseUrlChips(["status:RUNNING,status:PENDING", "user:alice"]);

    expect(result).toEqual([
      { field: "status", value: "RUNNING", label: "status: RUNNING" },
      { field: "status", value: "PENDING", label: "status: PENDING" },
      { field: "user", value: "alice", label: "user: alice" },
    ]);
  });

  it("filters out strings without colon separator", () => {
    const result = parseUrlChips("status:RUNNING,invalidfilter,user:alice");

    expect(result).toEqual([
      { field: "status", value: "RUNNING", label: "status: RUNNING" },
      { field: "user", value: "alice", label: "user: alice" },
    ]);
  });

  it("filters out strings with empty field", () => {
    const result = parseUrlChips(":value,status:RUNNING");

    expect(result).toEqual([{ field: "status", value: "RUNNING", label: "status: RUNNING" }]);
  });

  it("filters out strings with empty value", () => {
    const result = parseUrlChips("field:,status:RUNNING");

    expect(result).toEqual([{ field: "status", value: "RUNNING", label: "status: RUNNING" }]);
  });

  it("handles values containing colons correctly", () => {
    const result = parseUrlChips("time:12:30:45");

    expect(result).toEqual([{ field: "time", value: "12:30:45", label: "time: 12:30:45" }]);
  });

  it("handles URL-encoded values correctly", () => {
    const result = parseUrlChips("name:John%20Doe");

    expect(result).toEqual([{ field: "name", value: "John%20Doe", label: "name: John%20Doe" }]);
  });
});
