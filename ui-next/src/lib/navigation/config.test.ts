// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { describe, it, expect } from "vitest";
import { buildNavigation } from "./config";

// =============================================================================
// buildNavigation Tests
//
// Documents the expected navigation structure.
// If routes are added/removed, these tests should be updated.
// =============================================================================

describe("buildNavigation", () => {
  describe("user navigation (non-admin)", () => {
    it("includes core user routes", () => {
      const nav = buildNavigation(false);
      const userItems = nav.sections[0].items;

      expect(userItems).toHaveLength(4);
      expect(userItems.map((i) => i.href)).toEqual(["/", "/workflows", "/pools", "/resources"]);
    });

    it("has correct route names", () => {
      const nav = buildNavigation(false);
      const userItems = nav.sections[0].items;

      expect(userItems.map((i) => i.name)).toEqual([
        "Dashboard",
        "Workflows",
        "Pools",
        "Resources",
      ]);
    });

    it("does not include admin section", () => {
      const nav = buildNavigation(false);

      expect(nav.sections).toHaveLength(1);
      expect(nav.sections.some((s) => s.label === "Admin")).toBe(false);
    });

    it("has empty bottom items", () => {
      const nav = buildNavigation(false);

      expect(nav.bottomItems).toEqual([]);
    });
  });

  describe("admin navigation", () => {
    it("includes admin section when isAdmin is true", () => {
      const nav = buildNavigation(true);

      expect(nav.sections).toHaveLength(2);
      expect(nav.sections[1].label).toBe("Admin");
    });

    it("admin section has expected routes", () => {
      const nav = buildNavigation(true);
      const adminItems = nav.sections[1].items;

      expect(adminItems).toHaveLength(3);
      expect(adminItems.map((i) => i.href)).toEqual([
        "/admin/settings",
        "/admin/roles",
        "/admin/tokens",
      ]);
    });

    it("admin section has correct route names", () => {
      const nav = buildNavigation(true);
      const adminItems = nav.sections[1].items;

      expect(adminItems.map((i) => i.name)).toEqual(["Settings", "Roles", "API Tokens"]);
    });

    it("still includes user routes", () => {
      const nav = buildNavigation(true);
      const userItems = nav.sections[0].items;

      expect(userItems).toHaveLength(4);
      expect(userItems[0].href).toBe("/");
    });
  });

  describe("structure", () => {
    it("all nav items have required properties", () => {
      const nav = buildNavigation(true);

      for (const section of nav.sections) {
        for (const item of section.items) {
          expect(item).toHaveProperty("name");
          expect(item).toHaveProperty("href");
          expect(item).toHaveProperty("icon");
          expect(typeof item.name).toBe("string");
          expect(typeof item.href).toBe("string");
          expect(item.href.startsWith("/")).toBe(true);
        }
      }
    });
  });
});
