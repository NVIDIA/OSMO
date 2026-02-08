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
import {
  parseNumericFilter,
  validateNumericFilter,
  compareNumeric,
} from "@/app/(dashboard)/pools/lib/pool-search-fields";

// =============================================================================
// parseNumericFilter Tests
// =============================================================================

describe("parseNumericFilter", () => {
  describe("valid inputs", () => {
    it("parses >= operator with integer", () => {
      const result = parseNumericFilter(">=10");
      expect(result).toEqual({ operator: ">=", value: 10, isPercent: false });
    });

    it("parses > operator with integer", () => {
      const result = parseNumericFilter(">5");
      expect(result).toEqual({ operator: ">", value: 5, isPercent: false });
    });

    it("parses <= operator with integer", () => {
      const result = parseNumericFilter("<=100");
      expect(result).toEqual({ operator: "<=", value: 100, isPercent: false });
    });

    it("parses < operator with integer", () => {
      const result = parseNumericFilter("<50");
      expect(result).toEqual({ operator: "<", value: 50, isPercent: false });
    });

    it("parses = operator with integer", () => {
      const result = parseNumericFilter("=42");
      expect(result).toEqual({ operator: "=", value: 42, isPercent: false });
    });

    it("parses percentage values", () => {
      const result = parseNumericFilter(">=90%");
      expect(result).toEqual({ operator: ">=", value: 90, isPercent: true });
    });

    it("parses decimal values", () => {
      const result = parseNumericFilter(">=10.5");
      expect(result).toEqual({ operator: ">=", value: 10.5, isPercent: false });
    });

    it("parses decimal percentage values", () => {
      const result = parseNumericFilter("<=75.5%");
      expect(result).toEqual({ operator: "<=", value: 75.5, isPercent: true });
    });

    it("parses zero", () => {
      const result = parseNumericFilter("=0");
      expect(result).toEqual({ operator: "=", value: 0, isPercent: false });
    });

    it("parses zero percent", () => {
      const result = parseNumericFilter(">=0%");
      expect(result).toEqual({ operator: ">=", value: 0, isPercent: true });
    });

    it("handles whitespace around input", () => {
      const result = parseNumericFilter("  >=10  ");
      expect(result).toEqual({ operator: ">=", value: 10, isPercent: false });
    });

    it("handles trailing whitespace after percent", () => {
      const result = parseNumericFilter(">=90%  ");
      expect(result).toEqual({ operator: ">=", value: 90, isPercent: true });
    });
  });

  describe("invalid inputs", () => {
    it("returns null for empty string", () => {
      expect(parseNumericFilter("")).toBeNull();
    });

    it("returns null for whitespace only", () => {
      expect(parseNumericFilter("   ")).toBeNull();
    });

    it("returns null for no operator", () => {
      expect(parseNumericFilter("10")).toBeNull();
    });

    it("returns null for invalid operator", () => {
      expect(parseNumericFilter("==10")).toBeNull();
      expect(parseNumericFilter("!=10")).toBeNull();
      expect(parseNumericFilter("~10")).toBeNull();
    });

    it("returns null for operator only", () => {
      expect(parseNumericFilter(">=")).toBeNull();
      expect(parseNumericFilter(">")).toBeNull();
    });

    it("returns null for non-numeric value", () => {
      expect(parseNumericFilter(">=abc")).toBeNull();
      expect(parseNumericFilter(">=ten")).toBeNull();
    });

    it("returns null for negative values", () => {
      expect(parseNumericFilter(">=-10")).toBeNull();
    });

    it("returns null for mixed invalid input", () => {
      expect(parseNumericFilter(">=10abc")).toBeNull();
      expect(parseNumericFilter(">=10%extra")).toBeNull();
    });

    it("returns null for percent in wrong position", () => {
      expect(parseNumericFilter(">=%10")).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("correctly distinguishes >= from >", () => {
      const gte = parseNumericFilter(">=10");
      const gt = parseNumericFilter(">10");
      expect(gte?.operator).toBe(">=");
      expect(gt?.operator).toBe(">");
    });

    it("correctly distinguishes <= from <", () => {
      const lte = parseNumericFilter("<=10");
      const lt = parseNumericFilter("<10");
      expect(lte?.operator).toBe("<=");
      expect(lt?.operator).toBe("<");
    });

    it("parses large numbers", () => {
      const result = parseNumericFilter(">=1000000");
      expect(result).toEqual({ operator: ">=", value: 1000000, isPercent: false });
    });

    it("parses 100%", () => {
      const result = parseNumericFilter("=100%");
      expect(result).toEqual({ operator: "=", value: 100, isPercent: true });
    });
  });
});

// =============================================================================
// validateNumericFilter Tests
// =============================================================================

describe("validateNumericFilter", () => {
  describe("valid inputs", () => {
    it("returns true for valid integer filter", () => {
      expect(validateNumericFilter(">=10")).toBe(true);
    });

    it("returns true for valid percentage filter", () => {
      expect(validateNumericFilter(">=90%")).toBe(true);
    });

    it("returns true for valid decimal filter", () => {
      expect(validateNumericFilter(">=10.5")).toBe(true);
    });

    it("returns true for all operators", () => {
      expect(validateNumericFilter(">=10")).toBe(true);
      expect(validateNumericFilter(">10")).toBe(true);
      expect(validateNumericFilter("<=10")).toBe(true);
      expect(validateNumericFilter("<10")).toBe(true);
      expect(validateNumericFilter("=10")).toBe(true);
    });
  });

  describe("error messages", () => {
    it("returns error for empty input", () => {
      expect(validateNumericFilter("")).toBe("Enter a value (e.g. >=10)");
      expect(validateNumericFilter("   ")).toBe("Enter a value (e.g. >=10)");
    });

    it("returns error for missing operator", () => {
      expect(validateNumericFilter("10")).toBe("Start with >=, >, <=, <, or =");
    });

    it("returns error for invalid format", () => {
      expect(validateNumericFilter(">=abc")).toBe("Invalid format");
    });

    it("returns error for percent over 100", () => {
      expect(validateNumericFilter(">=150%")).toBe("Max 100%");
      expect(validateNumericFilter(">=101%")).toBe("Max 100%");
    });
  });

  describe("options", () => {
    it("rejects percent when allowPercent is false", () => {
      expect(validateNumericFilter(">=90%", { allowPercent: false })).toBe("Don't use % for this field");
    });

    it("allows discrete when allowPercent is false", () => {
      expect(validateNumericFilter(">=90", { allowPercent: false })).toBe(true);
    });

    it("rejects discrete when allowDiscrete is false", () => {
      expect(validateNumericFilter(">=90", { allowDiscrete: false })).toBe("Use % (e.g. >=90%)");
    });

    it("allows percent when allowDiscrete is false", () => {
      expect(validateNumericFilter(">=90%", { allowDiscrete: false })).toBe(true);
    });

    it("allows both by default", () => {
      expect(validateNumericFilter(">=90")).toBe(true);
      expect(validateNumericFilter(">=90%")).toBe(true);
    });
  });

  describe("boundary cases", () => {
    it("accepts exactly 100%", () => {
      expect(validateNumericFilter("=100%")).toBe(true);
      expect(validateNumericFilter("<=100%")).toBe(true);
    });

    it("accepts 0%", () => {
      expect(validateNumericFilter(">=0%")).toBe(true);
    });

    it("accepts 0", () => {
      expect(validateNumericFilter(">=0")).toBe(true);
    });
  });
});

// =============================================================================
// compareNumeric Tests
// =============================================================================

describe("compareNumeric", () => {
  describe(">= operator", () => {
    it("returns true when actual >= target", () => {
      expect(compareNumeric(10, ">=", 10, false)).toBe(true);
      expect(compareNumeric(15, ">=", 10, false)).toBe(true);
    });

    it("returns false when actual < target", () => {
      expect(compareNumeric(5, ">=", 10, false)).toBe(false);
    });
  });

  describe("> operator", () => {
    it("returns true when actual > target", () => {
      expect(compareNumeric(15, ">", 10, false)).toBe(true);
    });

    it("returns false when actual <= target", () => {
      expect(compareNumeric(10, ">", 10, false)).toBe(false);
      expect(compareNumeric(5, ">", 10, false)).toBe(false);
    });
  });

  describe("<= operator", () => {
    it("returns true when actual <= target", () => {
      expect(compareNumeric(10, "<=", 10, false)).toBe(true);
      expect(compareNumeric(5, "<=", 10, false)).toBe(true);
    });

    it("returns false when actual > target", () => {
      expect(compareNumeric(15, "<=", 10, false)).toBe(false);
    });
  });

  describe("< operator", () => {
    it("returns true when actual < target", () => {
      expect(compareNumeric(5, "<", 10, false)).toBe(true);
    });

    it("returns false when actual >= target", () => {
      expect(compareNumeric(10, "<", 10, false)).toBe(false);
      expect(compareNumeric(15, "<", 10, false)).toBe(false);
    });
  });

  describe("= operator", () => {
    it("returns true when actual equals target", () => {
      expect(compareNumeric(10, "=", 10, false)).toBe(true);
    });

    it("returns false when actual does not equal target", () => {
      expect(compareNumeric(5, "=", 10, false)).toBe(false);
      expect(compareNumeric(15, "=", 10, false)).toBe(false);
    });
  });

  describe("percentage mode", () => {
    it("rounds actual value before comparison", () => {
      // 89.5 rounds to 90
      expect(compareNumeric(89.5, ">=", 90, true)).toBe(true);
      // 89.4 rounds to 89
      expect(compareNumeric(89.4, ">=", 90, true)).toBe(false);
    });

    it("handles exact percentage matches with rounding", () => {
      // 90.4 rounds to 90
      expect(compareNumeric(90.4, "=", 90, true)).toBe(true);
      // 90.6 rounds to 91
      expect(compareNumeric(90.6, "=", 90, true)).toBe(false);
    });

    it("does not round in non-percentage mode", () => {
      expect(compareNumeric(89.5, ">=", 90, false)).toBe(false);
      expect(compareNumeric(90.5, ">=", 90, false)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles zero", () => {
      expect(compareNumeric(0, ">=", 0, false)).toBe(true);
      expect(compareNumeric(0, "=", 0, false)).toBe(true);
      expect(compareNumeric(0, ">", 0, false)).toBe(false);
    });

    it("handles negative actual values (edge case)", () => {
      // While input validation prevents negative targets,
      // actual values could theoretically be negative
      expect(compareNumeric(-5, ">=", 0, false)).toBe(false);
      expect(compareNumeric(-5, "<", 0, false)).toBe(true);
    });

    it("handles large numbers", () => {
      expect(compareNumeric(1000000, ">=", 999999, false)).toBe(true);
    });

    it("handles decimal precision", () => {
      expect(compareNumeric(10.001, ">", 10, false)).toBe(true);
      expect(compareNumeric(9.999, "<", 10, false)).toBe(true);
    });
  });
});
