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

import { describe, it, expect, beforeEach } from "vitest";
import {
  remToPx,
  getColumnCSSVariable,
  getColumnCSSValue,
  getTruncationThreshold,
  getRemToPx,
  _invalidateRemToPxCache,
} from "./column-sizing";

// =============================================================================
// remToPx Tests
// =============================================================================

describe("remToPx", () => {
  it("converts rem to pixels using provided base font size", () => {
    expect(remToPx(1, 16)).toBe(16);
    expect(remToPx(2, 16)).toBe(32);
    expect(remToPx(1.5, 16)).toBe(24);
  });

  it("handles different base font sizes", () => {
    expect(remToPx(1, 14)).toBe(14);
    expect(remToPx(2, 18)).toBe(36);
  });

  it("handles zero", () => {
    expect(remToPx(0, 16)).toBe(0);
  });

  it("handles fractional rem values", () => {
    expect(remToPx(0.5, 16)).toBe(8);
    expect(remToPx(0.25, 16)).toBe(4);
  });
});

// =============================================================================
// CSS Variable Tests
// =============================================================================

describe("getColumnCSSVariable", () => {
  it("generates valid CSS variable name", () => {
    expect(getColumnCSSVariable("name")).toBe("--col-name");
    expect(getColumnCSSVariable("status")).toBe("--col-status");
  });

  it("sanitizes special characters", () => {
    expect(getColumnCSSVariable("col.name")).toBe("--col-col-name");
    expect(getColumnCSSVariable("col/name")).toBe("--col-col-name");
  });

  it("allows hyphens and underscores", () => {
    expect(getColumnCSSVariable("my-column")).toBe("--col-my-column");
    expect(getColumnCSSVariable("my_column")).toBe("--col-my_column");
  });
});

describe("getColumnCSSValue", () => {
  it("generates CSS var() reference with default fallback", () => {
    expect(getColumnCSSValue("name")).toBe("var(--col-name, 150px)");
  });

  it("uses custom fallback", () => {
    expect(getColumnCSSValue("name", 200)).toBe("var(--col-name, 200px)");
    expect(getColumnCSSValue("status", 100)).toBe("var(--col-status, 100px)");
  });
});

// =============================================================================
// getTruncationThreshold Tests - Single Source of Truth
// =============================================================================

describe("getTruncationThreshold", () => {
  it("returns contentWidth when larger than configuredWidth", () => {
    expect(getTruncationThreshold(300, 200)).toBe(300);
    expect(getTruncationThreshold(500, 256)).toBe(500);
  });

  it("returns configuredWidth when larger than contentWidth", () => {
    expect(getTruncationThreshold(100, 200)).toBe(200);
    expect(getTruncationThreshold(150, 256)).toBe(256);
  });

  it("returns either when equal", () => {
    expect(getTruncationThreshold(200, 200)).toBe(200);
  });

  it("handles zero contentWidth (unmeasured)", () => {
    // When content hasn't been measured, threshold falls back to configuredWidth
    expect(getTruncationThreshold(0, 256)).toBe(256);
    expect(getTruncationThreshold(0, 150)).toBe(150);
  });

  it("handles zero configuredWidth", () => {
    expect(getTruncationThreshold(300, 0)).toBe(300);
  });

  it("handles both zero (edge case)", () => {
    expect(getTruncationThreshold(0, 0)).toBe(0);
  });
});

// =============================================================================
// getRemToPx Tests - Caching Behavior
// =============================================================================

describe("getRemToPx", () => {
  beforeEach(() => {
    // Reset cache before each test
    _invalidateRemToPxCache();
  });

  it("returns a positive number", () => {
    const result = getRemToPx();
    expect(result).toBeGreaterThan(0);
  });

  it("returns consistent value on subsequent calls (caching)", () => {
    const first = getRemToPx();
    const second = getRemToPx();
    const third = getRemToPx();

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("returns default value (16) in test environment without document.documentElement", () => {
    // In jsdom/vitest, document.documentElement exists but may not have computed styles
    // The function should gracefully handle this
    const result = getRemToPx();
    expect(result).toBeGreaterThanOrEqual(14); // Common range for base font sizes
    expect(result).toBeLessThanOrEqual(18);
  });
});

describe("_invalidateRemToPxCache", () => {
  it("clears the cache so next call recomputes", () => {
    // Get initial value (populates cache)
    const initial = getRemToPx();

    // Invalidate
    _invalidateRemToPxCache();

    // Next call should recompute (same value, but proves function exists)
    const afterInvalidate = getRemToPx();

    expect(afterInvalidate).toBe(initial); // Same environment, same result
  });
});
