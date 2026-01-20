//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { LogEntry } from "@/lib/api/log-adapter";
import type { SearchChip } from "@/components/filter-bar";
import { applyFilters, matchesFilter, buildActiveFiltersMap, DEFAULT_MATCHERS } from "./filters";

// =============================================================================
// Test Fixtures
// =============================================================================

function createEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: "test-entry-1",
    timestamp: new Date("2026-01-15T10:30:00Z"),
    message: "Test log message",
    labels: {
      workflow: "test-workflow",
      level: "info",
      task: "task-1",
      source: "user",
      ...overrides.labels,
    },
    ...overrides,
  };
}

function createChip(field: string, value: string): SearchChip {
  return { field, value, label: `${field}: ${value}` };
}

// =============================================================================
// matchesFilter Tests
// =============================================================================

describe("matchesFilter", () => {
  it("matches level filter correctly", () => {
    const entry = createEntry({ labels: { workflow: "test", level: "error" } });

    expect(matchesFilter(entry, "level", "error")).toBe(true);
    expect(matchesFilter(entry, "level", "info")).toBe(false);
  });

  it("matches task filter correctly", () => {
    const entry = createEntry({ labels: { workflow: "test", task: "my-task" } });

    expect(matchesFilter(entry, "task", "my-task")).toBe(true);
    expect(matchesFilter(entry, "task", "other-task")).toBe(false);
  });

  it("matches source filter correctly", () => {
    const entry = createEntry({ labels: { workflow: "test", source: "user" } });

    expect(matchesFilter(entry, "source", "user")).toBe(true);
    expect(matchesFilter(entry, "source", "osmo")).toBe(false);
  });

  it("matches text filter case-insensitively", () => {
    const entry = createEntry({ message: "Error: Connection failed" });

    expect(matchesFilter(entry, "text", "connection")).toBe(true);
    expect(matchesFilter(entry, "text", "CONNECTION")).toBe(true);
    expect(matchesFilter(entry, "text", "timeout")).toBe(false);
  });

  it("returns false for unknown field", () => {
    const entry = createEntry();

    expect(matchesFilter(entry, "unknown-field", "value")).toBe(false);
  });

  it("supports custom matchers", () => {
    const entry = createEntry({ message: "Important message" });
    const customMatchers = {
      ...DEFAULT_MATCHERS,
      custom: (e: LogEntry, v: string) => e.message.startsWith(v),
    };

    expect(matchesFilter(entry, "custom", "Important", customMatchers)).toBe(true);
    expect(matchesFilter(entry, "custom", "Unimportant", customMatchers)).toBe(false);
  });
});

// =============================================================================
// applyFilters Tests
// =============================================================================

describe("applyFilters", () => {
  const entries: LogEntry[] = [
    createEntry({ id: "1", labels: { workflow: "test", level: "info", task: "task-a" } }),
    createEntry({ id: "2", labels: { workflow: "test", level: "error", task: "task-a" } }),
    createEntry({ id: "3", labels: { workflow: "test", level: "info", task: "task-b" } }),
    createEntry({ id: "4", labels: { workflow: "test", level: "error", task: "task-b" } }),
    createEntry({ id: "5", labels: { workflow: "test", level: "warn", task: "task-a" } }),
  ];

  it("returns all entries when no chips", () => {
    const result = applyFilters(entries, []);
    expect(result).toHaveLength(5);
    expect(result).toEqual(entries);
  });

  it("filters by single field", () => {
    const chips = [createChip("level", "error")];
    const result = applyFilters(entries, chips);

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["2", "4"]);
  });

  it("applies OR logic within same field", () => {
    const chips = [createChip("level", "error"), createChip("level", "warn")];
    const result = applyFilters(entries, chips);

    expect(result).toHaveLength(3);
    expect(result.map((e) => e.id)).toEqual(["2", "4", "5"]);
  });

  it("applies AND logic across different fields", () => {
    const chips = [createChip("level", "error"), createChip("task", "task-a")];
    const result = applyFilters(entries, chips);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("2");
  });

  it("handles complex filter combinations", () => {
    // (level=error OR level=warn) AND task=task-a
    const chips = [createChip("level", "error"), createChip("level", "warn"), createChip("task", "task-a")];
    const result = applyFilters(entries, chips);

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["2", "5"]);
  });

  it("returns empty array when no matches", () => {
    const chips = [createChip("level", "fatal")];
    const result = applyFilters(entries, chips);

    expect(result).toHaveLength(0);
  });
});

// =============================================================================
// buildActiveFiltersMap Tests
// =============================================================================

describe("buildActiveFiltersMap", () => {
  it("returns empty map when no chips", () => {
    const result = buildActiveFiltersMap([]);
    expect(result.size).toBe(0);
  });

  it("creates map with single chip", () => {
    const chips = [createChip("level", "error")];
    const result = buildActiveFiltersMap(chips);

    expect(result.size).toBe(1);
    expect(result.get("level")?.has("error")).toBe(true);
  });

  it("groups multiple values for same field", () => {
    const chips = [createChip("level", "error"), createChip("level", "warn")];
    const result = buildActiveFiltersMap(chips);

    expect(result.size).toBe(1);
    expect(result.get("level")?.size).toBe(2);
    expect(result.get("level")?.has("error")).toBe(true);
    expect(result.get("level")?.has("warn")).toBe(true);
  });

  it("handles multiple fields", () => {
    const chips = [createChip("level", "error"), createChip("task", "task-a"), createChip("level", "warn")];
    const result = buildActiveFiltersMap(chips);

    expect(result.size).toBe(2);
    expect(result.get("level")?.size).toBe(2);
    expect(result.get("task")?.size).toBe(1);
    expect(result.get("task")?.has("task-a")).toBe(true);
  });
});
