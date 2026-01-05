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
  remToPx,
  pxToRem,
  resolveColumns,
  calculateColumnWidths,
  getColumnCSSVariable,
  getColumnCSSValue,
  generateCSSVariables,
} from "./column-sizing";
import type { ColumnSizeConfig } from "../types";

// =============================================================================
// Unit Conversion Tests
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

describe("pxToRem", () => {
  it("converts pixels to rem using provided base font size", () => {
    expect(pxToRem(16, 16)).toBe(1);
    expect(pxToRem(32, 16)).toBe(2);
    expect(pxToRem(24, 16)).toBe(1.5);
  });

  it("handles different base font sizes", () => {
    expect(pxToRem(14, 14)).toBe(1);
    expect(pxToRem(36, 18)).toBe(2);
  });

  it("handles zero", () => {
    expect(pxToRem(0, 16)).toBe(0);
  });

  it("round-trips correctly with remToPx", () => {
    const rem = 2.5;
    const baseFontSize = 16;
    expect(pxToRem(remToPx(rem, baseFontSize), baseFontSize)).toBe(rem);
  });
});

// =============================================================================
// resolveColumns Tests
// =============================================================================

describe("resolveColumns", () => {
  const baseFontSize = 16;

  const sampleColumns: ColumnSizeConfig[] = [
    { id: "name", minWidthRem: 8, share: 2 },
    { id: "status", minWidthRem: 4, share: 1 },
    { id: "quota", minWidthRem: 6, share: 1.5 },
  ];

  it("resolves columns without overrides using config values", () => {
    const resolved = resolveColumns(sampleColumns, {}, {}, baseFontSize);

    expect(resolved).toHaveLength(3);
    expect(resolved[0]).toEqual({
      id: "name",
      minWidthPx: 128, // 8rem * 16px
      maxWidthPx: Infinity,
      share: 2,
    });
    expect(resolved[1]).toEqual({
      id: "status",
      minWidthPx: 64, // 4rem * 16px
      maxWidthPx: Infinity,
      share: 1,
    });
  });

  it("applies minWidthPx overrides", () => {
    const overrides = {
      name: { minWidthPx: 200, share: 2 },
    };
    const resolved = resolveColumns(sampleColumns, overrides, {}, baseFontSize);

    expect(resolved[0].minWidthPx).toBe(200); // Override takes precedence
    expect(resolved[1].minWidthPx).toBe(64); // Config value
  });

  it("applies share overrides", () => {
    const overrides = {
      name: { minWidthPx: 128, share: 5 },
    };
    const resolved = resolveColumns(sampleColumns, overrides, {}, baseFontSize);

    expect(resolved[0].share).toBe(5); // Override
    expect(resolved[1].share).toBe(1); // Config value
  });

  it("uses natural widths as maxWidthPx when available", () => {
    const naturalWidths = {
      name: 180,
      status: 100,
    };
    const resolved = resolveColumns(sampleColumns, {}, naturalWidths, baseFontSize);

    expect(resolved[0].maxWidthPx).toBe(180);
    expect(resolved[1].maxWidthPx).toBe(100);
    expect(resolved[2].maxWidthPx).toBe(Infinity); // No natural width
  });

  it("handles empty columns array", () => {
    const resolved = resolveColumns([], {}, {}, baseFontSize);
    expect(resolved).toEqual([]);
  });
});

// =============================================================================
// calculateColumnWidths Tests
// =============================================================================

describe("calculateColumnWidths", () => {
  it("returns empty result for no columns", () => {
    const result = calculateColumnWidths([], 1000);

    expect(result).toEqual({
      widths: {},
      totalWidth: 0,
      needsScroll: false,
      whitespace: 1000,
    });
  });

  it("assigns minimum widths when container is smaller than total min", () => {
    const columns = [
      { id: "a", minWidthPx: 200, maxWidthPx: Infinity, share: 1 },
      { id: "b", minWidthPx: 200, maxWidthPx: Infinity, share: 1 },
    ];
    const result = calculateColumnWidths(columns, 300); // Less than total min (400)

    expect(result.widths).toEqual({ a: 200, b: 200 });
    expect(result.totalWidth).toBe(400);
    expect(result.needsScroll).toBe(true);
    expect(result.whitespace).toBe(0);
  });

  it("keeps at minimum widths when no content measurements exist", () => {
    const columns = [
      { id: "a", minWidthPx: 100, maxWidthPx: Infinity, share: 1 },
      { id: "b", minWidthPx: 100, maxWidthPx: Infinity, share: 2 },
    ];
    const result = calculateColumnWidths(columns, 500);

    // No content measurements (all maxWidthPx = Infinity), stay at mins
    expect(result.widths).toEqual({ a: 100, b: 100 });
    expect(result.totalWidth).toBe(200);
    expect(result.needsScroll).toBe(false);
    expect(result.whitespace).toBe(300);
  });

  it("distributes extra space by share when content is measured", () => {
    const columns = [
      { id: "a", minWidthPx: 100, maxWidthPx: 300, share: 1 },
      { id: "b", minWidthPx: 100, maxWidthPx: 300, share: 2 },
    ];
    // Total min = 200, container = 500, extra = 300
    // share ratio: a=1/3, b=2/3
    // a growth: floor(100) = 100, b growth: floor(200) = 200
    const result = calculateColumnWidths(columns, 500);

    expect(result.widths.a).toBe(200); // 100 + 100
    expect(result.widths.b).toBe(300); // 100 + 200 (capped at max)
    expect(result.needsScroll).toBe(false);
  });

  it("caps growth at maxWidthPx", () => {
    const columns = [
      { id: "a", minWidthPx: 100, maxWidthPx: 120, share: 1 }, // Can only grow 20px
      { id: "b", minWidthPx: 100, maxWidthPx: 500, share: 1 },
    ];
    const result = calculateColumnWidths(columns, 600);

    expect(result.widths.a).toBe(120); // Capped at max
    expect(result.widths.b).toBeLessThanOrEqual(500);
  });

  it("leaves whitespace when all columns hit max", () => {
    const columns = [
      { id: "a", minWidthPx: 100, maxWidthPx: 150, share: 1 },
      { id: "b", minWidthPx: 100, maxWidthPx: 150, share: 1 },
    ];
    const result = calculateColumnWidths(columns, 500);

    // Both max out at 150, total = 300, container = 500
    expect(result.widths.a).toBe(150);
    expect(result.widths.b).toBe(150);
    expect(result.whitespace).toBe(200);
  });

  it("handles zero container width", () => {
    const columns = [
      { id: "a", minWidthPx: 100, maxWidthPx: Infinity, share: 1 },
    ];
    const result = calculateColumnWidths(columns, 0);

    expect(result.widths.a).toBe(100);
    expect(result.needsScroll).toBe(true);
  });

  it("handles columns with zero share", () => {
    const columns = [
      { id: "a", minWidthPx: 100, maxWidthPx: 200, share: 0 },
      { id: "b", minWidthPx: 100, maxWidthPx: 200, share: 1 },
    ];
    const result = calculateColumnWidths(columns, 400);

    // Column a has 0 share, should stay at min
    // Column b gets all extra space
    expect(result.widths.a).toBe(100);
    expect(result.widths.b).toBe(200); // Gets all 200 extra, capped at max
  });
});

// =============================================================================
// CSS Variable Helpers Tests
// =============================================================================

describe("getColumnCSSVariable", () => {
  it("generates CSS variable name from column id", () => {
    expect(getColumnCSSVariable("name")).toBe("--col-name");
    expect(getColumnCSSVariable("status")).toBe("--col-status");
  });

  it("sanitizes special characters in column id", () => {
    expect(getColumnCSSVariable("col.name")).toBe("--col-col-name");
    expect(getColumnCSSVariable("col/name")).toBe("--col-col-name");
    expect(getColumnCSSVariable("col name")).toBe("--col-col-name");
  });

  it("preserves valid characters", () => {
    expect(getColumnCSSVariable("col-name")).toBe("--col-col-name");
    expect(getColumnCSSVariable("col_name")).toBe("--col-col_name");
    expect(getColumnCSSVariable("colName123")).toBe("--col-colName123");
  });
});

describe("getColumnCSSValue", () => {
  it("generates CSS var() reference with default fallback", () => {
    expect(getColumnCSSValue("name")).toBe("var(--col-name, 100px)");
  });

  it("uses custom fallback value", () => {
    expect(getColumnCSSValue("name", 200)).toBe("var(--col-name, 200px)");
  });
});

describe("generateCSSVariables", () => {
  it("generates CSS variables object from widths", () => {
    const widths = { name: 150, status: 80, quota: 120 };
    const result = generateCSSVariables(widths);

    expect(result).toEqual({
      "--col-name": "150px",
      "--col-status": "80px",
      "--col-quota": "120px",
    });
  });

  it("handles empty widths object", () => {
    const result = generateCSSVariables({});
    expect(result).toEqual({});
  });
});
