// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { describe, it, expect } from "vitest";
import { cn, formatNumber, formatCompact } from "./utils";

// =============================================================================
// cn (class name utility)
// =============================================================================

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", true && "active", false && "hidden")).toBe("base active");
  });

  it("handles undefined and null", () => {
    expect(cn("base", undefined, null, "end")).toBe("base end");
  });

  it("merges tailwind classes correctly", () => {
    // tailwind-merge should dedupe conflicting utilities
    expect(cn("p-4", "p-2")).toBe("p-2"); // Later wins
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles arrays", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("handles objects", () => {
    expect(cn({ active: true, hidden: false })).toBe("active");
  });
});

// =============================================================================
// formatNumber
// =============================================================================

describe("formatNumber", () => {
  it("formats small numbers without commas", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1)).toBe("1");
    expect(formatNumber(999)).toBe("999");
  });

  it("formats thousands with commas", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatNumber(999999)).toBe("999,999");
  });

  it("formats millions with commas", () => {
    expect(formatNumber(1000000)).toBe("1,000,000");
    expect(formatNumber(1234567890)).toBe("1,234,567,890");
  });

  it("removes decimal places", () => {
    expect(formatNumber(1234.5678)).toBe("1,235"); // Rounds
    expect(formatNumber(1234.1)).toBe("1,234");
  });

  it("handles negative numbers", () => {
    expect(formatNumber(-1234)).toBe("-1,234");
    expect(formatNumber(-999999)).toBe("-999,999");
  });
});

// =============================================================================
// formatCompact
// =============================================================================

describe("formatCompact", () => {
  it("returns plain number below 1000", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(1)).toBe("1");
    expect(formatCompact(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatCompact(1000)).toBe("1.0K");
    expect(formatCompact(1500)).toBe("1.5K");
    expect(formatCompact(24221)).toBe("24.2K");
    expect(formatCompact(999999)).toBe("1000.0K");
  });

  it("formats millions with M suffix", () => {
    expect(formatCompact(1000000)).toBe("1.0M");
    expect(formatCompact(1234567)).toBe("1.2M");
    expect(formatCompact(50000000)).toBe("50.0M");
  });

  it("formats billions with G suffix", () => {
    expect(formatCompact(1000000000)).toBe("1.0G");
    expect(formatCompact(1234567890)).toBe("1.2G");
  });

  it("handles boundary values", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1000)).toBe("1.0K");
    expect(formatCompact(999999)).toBe("1000.0K");
    expect(formatCompact(1000000)).toBe("1.0M");
  });
});
