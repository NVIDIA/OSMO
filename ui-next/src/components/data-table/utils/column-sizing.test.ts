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
import { remToPx, getColumnCSSVariable, getColumnCSSValue } from "./column-sizing";

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
