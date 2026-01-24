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
import { getLevelBadgeClasses, getLevelLabel, getLogRowClasses, isLevelAtLeast, getLevelsAtLeast } from "./level-utils";
import type { LogLevel } from "@/lib/api/log-adapter";

// =============================================================================
// getLevelBadgeClasses Tests
// =============================================================================

describe("getLevelBadgeClasses", () => {
  it("returns classes for all log levels", () => {
    const levels: LogLevel[] = ["debug", "info", "warn", "error", "fatal"];

    for (const level of levels) {
      const classes = getLevelBadgeClasses(level);
      expect(classes).toContain("rounded");
      expect(classes).toContain("text-xs");
      expect(classes).toContain("font-semibold");
    }
  });

  it("returns fallback classes for undefined level", () => {
    const classes = getLevelBadgeClasses(undefined);
    expect(classes).toContain("rounded");
    expect(classes).toContain("text-xs");
  });
});

// =============================================================================
// getLevelLabel Tests
// =============================================================================

describe("getLevelLabel", () => {
  it("returns correct uppercase labels for all levels", () => {
    expect(getLevelLabel("debug")).toBe("DEBUG");
    expect(getLevelLabel("info")).toBe("INFO");
    expect(getLevelLabel("warn")).toBe("WARN");
    expect(getLevelLabel("error")).toBe("ERROR");
    expect(getLevelLabel("fatal")).toBe("FATAL");
  });

  it("returns ??? for undefined level", () => {
    expect(getLevelLabel(undefined)).toBe("???");
  });
});

// =============================================================================
// getLogRowClasses Tests
// =============================================================================

describe("getLogRowClasses", () => {
  it("returns base classes for all levels", () => {
    const levels: (LogLevel | undefined)[] = ["debug", "info", "warn", "error", "fatal", undefined];

    for (const level of levels) {
      const classes = getLogRowClasses(level);
      expect(classes).toContain("group");
      expect(classes).toContain("relative");
      expect(classes).toContain("px-3");
      expect(classes).toContain("py-1");
      expect(classes).toContain("hover:bg-muted/50");
    }
  });

  it("adds expanded class when expanded option is true", () => {
    const classes = getLogRowClasses("info", { expanded: true });
    expect(classes).toContain("bg-muted/30");
  });

  it("does not add level-specific styling", () => {
    // Row classes are now level-agnostic - level styling is on the badge only
    const errorClasses = getLogRowClasses("error");
    const infoClasses = getLogRowClasses("info");
    expect(errorClasses).toBe(infoClasses);
  });
});

// =============================================================================
// isLevelAtLeast Tests
// =============================================================================

describe("isLevelAtLeast", () => {
  it("returns true when level equals minimum", () => {
    expect(isLevelAtLeast("info", "info")).toBe(true);
    expect(isLevelAtLeast("error", "error")).toBe(true);
  });

  it("returns true when level is above minimum", () => {
    expect(isLevelAtLeast("error", "info")).toBe(true);
    expect(isLevelAtLeast("fatal", "debug")).toBe(true);
    expect(isLevelAtLeast("warn", "info")).toBe(true);
  });

  it("returns false when level is below minimum", () => {
    expect(isLevelAtLeast("info", "warn")).toBe(false);
    expect(isLevelAtLeast("debug", "error")).toBe(false);
  });

  it("returns false for undefined level", () => {
    expect(isLevelAtLeast(undefined, "debug")).toBe(false);
  });
});

// =============================================================================
// getLevelsAtLeast Tests
// =============================================================================

describe("getLevelsAtLeast", () => {
  it("returns all levels from debug and up", () => {
    const levels = getLevelsAtLeast("debug");
    expect(levels).toEqual(["debug", "info", "warn", "error", "fatal"]);
  });

  it("returns levels from info and up", () => {
    const levels = getLevelsAtLeast("info");
    expect(levels).toEqual(["info", "warn", "error", "fatal"]);
  });

  it("returns levels from warn and up", () => {
    const levels = getLevelsAtLeast("warn");
    expect(levels).toEqual(["warn", "error", "fatal"]);
  });

  it("returns levels from error and up", () => {
    const levels = getLevelsAtLeast("error");
    expect(levels).toEqual(["error", "fatal"]);
  });

  it("returns only fatal for fatal", () => {
    const levels = getLevelsAtLeast("fatal");
    expect(levels).toEqual(["fatal"]);
  });
});
