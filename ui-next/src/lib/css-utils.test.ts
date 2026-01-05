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
import { parseCssValue } from "./css-utils";

// =============================================================================
// parseCssValue Tests
// =============================================================================

describe("parseCssValue", () => {
  const defaultRootFontSize = 16;

  describe("rem values", () => {
    it("converts rem to pixels", () => {
      expect(parseCssValue("1rem", defaultRootFontSize)).toBe(16);
      expect(parseCssValue("2rem", defaultRootFontSize)).toBe(32);
      expect(parseCssValue("0.5rem", defaultRootFontSize)).toBe(8);
    });

    it("handles different root font sizes", () => {
      expect(parseCssValue("1rem", 14)).toBe(14);
      expect(parseCssValue("2rem", 18)).toBe(36);
    });

    it("handles decimal rem values", () => {
      expect(parseCssValue("1.5rem", defaultRootFontSize)).toBe(24);
      expect(parseCssValue("3.5rem", defaultRootFontSize)).toBe(56);
    });

    it("handles zero rem", () => {
      expect(parseCssValue("0rem", defaultRootFontSize)).toBe(0);
    });
  });

  describe("px values", () => {
    it("extracts pixel values directly", () => {
      expect(parseCssValue("16px", defaultRootFontSize)).toBe(16);
      expect(parseCssValue("100px", defaultRootFontSize)).toBe(100);
    });

    it("handles decimal pixel values", () => {
      expect(parseCssValue("16.5px", defaultRootFontSize)).toBe(16.5);
    });

    it("handles zero px", () => {
      expect(parseCssValue("0px", defaultRootFontSize)).toBe(0);
    });

    it("ignores root font size for px values", () => {
      expect(parseCssValue("16px", 14)).toBe(16);
      expect(parseCssValue("16px", 20)).toBe(16);
    });
  });

  describe("unitless values", () => {
    it("parses unitless numbers", () => {
      expect(parseCssValue("16", defaultRootFontSize)).toBe(16);
      expect(parseCssValue("100", defaultRootFontSize)).toBe(100);
    });

    it("handles decimal unitless values", () => {
      expect(parseCssValue("16.5", defaultRootFontSize)).toBe(16.5);
    });
  });

  describe("whitespace handling", () => {
    it("trims leading whitespace", () => {
      expect(parseCssValue("  16px", defaultRootFontSize)).toBe(16);
      expect(parseCssValue("  1rem", defaultRootFontSize)).toBe(16);
    });

    it("trims trailing whitespace", () => {
      expect(parseCssValue("16px  ", defaultRootFontSize)).toBe(16);
      expect(parseCssValue("1rem  ", defaultRootFontSize)).toBe(16);
    });

    it("trims both leading and trailing whitespace", () => {
      expect(parseCssValue("  16px  ", defaultRootFontSize)).toBe(16);
    });
  });

  describe("invalid values", () => {
    it("returns 0 for non-numeric strings", () => {
      expect(parseCssValue("abc", defaultRootFontSize)).toBe(0);
      expect(parseCssValue("auto", defaultRootFontSize)).toBe(0);
    });

    it("returns 0 for empty string", () => {
      expect(parseCssValue("", defaultRootFontSize)).toBe(0);
    });

    it("returns 0 for whitespace only", () => {
      expect(parseCssValue("   ", defaultRootFontSize)).toBe(0);
    });

    it("handles mixed invalid input", () => {
      // parseFloat stops at first non-numeric, so "16abc" becomes 16
      expect(parseCssValue("16abc", defaultRootFontSize)).toBe(16);
    });
  });

  describe("edge cases", () => {
    it("handles negative rem values", () => {
      expect(parseCssValue("-1rem", defaultRootFontSize)).toBe(-16);
    });

    it("handles negative px values", () => {
      expect(parseCssValue("-16px", defaultRootFontSize)).toBe(-16);
    });

    it("handles very small rem values", () => {
      expect(parseCssValue("0.0625rem", defaultRootFontSize)).toBe(1);
    });

    it("handles very large rem values", () => {
      expect(parseCssValue("100rem", defaultRootFontSize)).toBe(1600);
    });
  });
});
