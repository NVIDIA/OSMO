// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { describe, it, expect } from "vitest";
import type { SearchChip } from "@/components/filter-bar";
import { chipsToLogQuery, hasActiveFilters } from "./chips-to-log-query";

// =============================================================================
// Helper
// =============================================================================

function chip(field: string, value: string): SearchChip {
  return { field, value, label: `${field}: ${value}` };
}

// =============================================================================
// chipsToLogQuery Tests
// =============================================================================

describe("chipsToLogQuery", () => {
  describe("empty chips", () => {
    it("returns empty object for empty array", () => {
      const result = chipsToLogQuery([]);
      expect(result).toEqual({});
    });
  });

  describe("level filtering", () => {
    it("extracts single level chip", () => {
      const chips = [chip("level", "error")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({ levels: ["error"] });
    });

    it("extracts multiple level chips (OR logic)", () => {
      const chips = [chip("level", "error"), chip("level", "warn")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({ levels: ["error", "warn"] });
    });

    it("ignores invalid level values", () => {
      const chips = [chip("level", "error"), chip("level", "invalid")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({ levels: ["error"] });
    });

    it("returns empty when all level values invalid", () => {
      const chips = [chip("level", "invalid"), chip("level", "unknown")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({});
    });
  });

  describe("task filtering", () => {
    it("extracts single task chip", () => {
      const chips = [chip("task", "train")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({ taskName: "train" });
    });

    it("takes only first task chip (single task filter)", () => {
      const chips = [chip("task", "train"), chip("task", "eval")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({ taskName: "train" });
    });
  });

  describe("source filtering", () => {
    it("extracts single source chip", () => {
      const chips = [chip("source", "user")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({ sources: ["user"] });
    });

    it("extracts multiple source chips", () => {
      const chips = [chip("source", "user"), chip("source", "osmo")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({ sources: ["user", "osmo"] });
    });

    it("ignores invalid source values", () => {
      const chips = [chip("source", "user"), chip("source", "invalid")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({ sources: ["user"] });
    });
  });

  describe("text search", () => {
    it("extracts text chip as search", () => {
      const chips = [chip("text", "timeout")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({ search: "timeout" });
    });

    it("takes only first text chip", () => {
      const chips = [chip("text", "timeout"), chip("text", "error")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({ search: "timeout" });
    });
  });

  describe("combined filters (AND logic)", () => {
    it("combines level and task filters", () => {
      const chips = [chip("level", "error"), chip("task", "train")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({
        levels: ["error"],
        taskName: "train",
      });
    });

    it("combines all filter types", () => {
      const chips = [
        chip("level", "error"),
        chip("level", "warn"),
        chip("task", "train"),
        chip("source", "user"),
        chip("text", "timeout"),
      ];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({
        levels: ["error", "warn"],
        taskName: "train",
        sources: ["user"],
        search: "timeout",
      });
    });
  });

  describe("unknown fields", () => {
    it("ignores unknown field types", () => {
      const chips = [chip("unknown", "value"), chip("level", "error")];
      const result = chipsToLogQuery(chips);
      expect(result).toEqual({ levels: ["error"] });
    });
  });
});

// =============================================================================
// hasActiveFilters Tests
// =============================================================================

describe("hasActiveFilters", () => {
  it("returns false for empty chips", () => {
    expect(hasActiveFilters([])).toBe(false);
  });

  it("returns true when chips present", () => {
    expect(hasActiveFilters([chip("level", "error")])).toBe(true);
  });
});
