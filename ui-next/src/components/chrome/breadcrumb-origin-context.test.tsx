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

/**
 * Breadcrumb Origin Context Tests
 *
 * Pure logic tests for breadcrumb origin tracking behavior.
 * Tests the Map-based storage logic that underlies the context.
 *
 * These tests codify the expected behavior for:
 * - Setting and retrieving origins
 * - Multiple workflow origins
 * - Overwriting origins
 * - Clearing origins
 * - Shared link scenarios
 * - Deep link scenarios
 */

import { describe, it, expect, beforeEach } from "vitest";

/**
 * Simple implementation of origin storage logic for testing.
 * This mirrors the behavior of BreadcrumbOriginContext without React dependencies.
 */
class OriginStorage {
  private origins: Map<string, string> = new Map();

  setOrigin(detailPagePath: string, originPath: string): void {
    this.origins.set(detailPagePath, originPath);
  }

  getOrigin(detailPagePath: string): string | null {
    return this.origins.get(detailPagePath) ?? null;
  }

  clearOrigin(detailPagePath: string): void {
    this.origins.delete(detailPagePath);
  }

  clearAll(): void {
    this.origins.clear();
  }
}

describe("BreadcrumbOriginContext - Logic", () => {
  let storage: OriginStorage;

  beforeEach(() => {
    storage = new OriginStorage();
  });

  describe("setOrigin / getOrigin", () => {
    it("should store and retrieve origin", () => {
      storage.setOrigin("/workflows/my-workflow", "/workflows?f=status:RUNNING");

      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows?f=status:RUNNING");
    });

    it("should return null when origin does not exist", () => {
      expect(storage.getOrigin("/workflows/nonexistent")).toBeNull();
    });

    it("should handle clean URLs (no filters)", () => {
      storage.setOrigin("/workflows/my-workflow", "/workflows");

      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows");
    });

    it("should handle URLs with multiple filters", () => {
      storage.setOrigin("/workflows/my-workflow", "/workflows?f=status:RUNNING&f=user:alice&all=true");

      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows?f=status:RUNNING&f=user:alice&all=true");
    });
  });

  describe("multiple origins", () => {
    it("should store origins for different workflows independently", () => {
      storage.setOrigin("/workflows/workflow-1", "/workflows?f=status:RUNNING");
      storage.setOrigin("/workflows/workflow-2", "/workflows?f=status:COMPLETED");
      storage.setOrigin("/workflows/workflow-3", "/workflows");

      expect(storage.getOrigin("/workflows/workflow-1")).toBe("/workflows?f=status:RUNNING");
      expect(storage.getOrigin("/workflows/workflow-2")).toBe("/workflows?f=status:COMPLETED");
      expect(storage.getOrigin("/workflows/workflow-3")).toBe("/workflows");
    });

    it("should overwrite origin for same detail page", () => {
      // First visit from filtered view
      storage.setOrigin("/workflows/my-workflow", "/workflows?f=status:RUNNING");
      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows?f=status:RUNNING");

      // Second visit from different filter
      storage.setOrigin("/workflows/my-workflow", "/workflows?f=status:COMPLETED");
      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows?f=status:COMPLETED");
    });
  });

  describe("clearOrigin", () => {
    it("should clear specific origin", () => {
      storage.setOrigin("/workflows/workflow-1", "/workflows?f=status:RUNNING");
      storage.setOrigin("/workflows/workflow-2", "/workflows?f=status:COMPLETED");

      storage.clearOrigin("/workflows/workflow-1");

      expect(storage.getOrigin("/workflows/workflow-1")).toBeNull();
      expect(storage.getOrigin("/workflows/workflow-2")).toBe("/workflows?f=status:COMPLETED");
    });

    it("should not error when clearing nonexistent origin", () => {
      expect(() => {
        storage.clearOrigin("/workflows/nonexistent");
      }).not.toThrow();
    });
  });

  describe("clearAll", () => {
    it("should clear all origins", () => {
      storage.setOrigin("/workflows/workflow-1", "/workflows?f=status:RUNNING");
      storage.setOrigin("/workflows/workflow-2", "/workflows?f=status:COMPLETED");
      storage.setOrigin("/workflows/workflow-3", "/workflows");

      storage.clearAll();

      expect(storage.getOrigin("/workflows/workflow-1")).toBeNull();
      expect(storage.getOrigin("/workflows/workflow-2")).toBeNull();
      expect(storage.getOrigin("/workflows/workflow-3")).toBeNull();
    });
  });

  describe("shared link scenarios", () => {
    it("should preserve filters from shared link", () => {
      // Scenario: User opens shared link with filters
      const sharedLinkUrl = "/workflows?f=status:RUNNING&f=pool:ml-team";

      // User clicks a workflow row
      storage.setOrigin("/workflows/my-workflow", sharedLinkUrl);

      // Breadcrumb should navigate back to shared link (with filters)
      expect(storage.getOrigin("/workflows/my-workflow")).toBe(sharedLinkUrl);
    });

    it("should preserve bookmark URL with filters", () => {
      // Scenario: User opens bookmark with specific filters
      const bookmarkUrl = "/workflows?f=user:alice&f=priority:HIGH";

      storage.setOrigin("/workflows/urgent-task", bookmarkUrl);

      expect(storage.getOrigin("/workflows/urgent-task")).toBe(bookmarkUrl);
    });
  });

  describe("edge cases", () => {
    it("should handle special characters in workflow names", () => {
      storage.setOrigin("/workflows/my%20workflow%20%28test%29", "/workflows?f=status:RUNNING");

      expect(storage.getOrigin("/workflows/my%20workflow%20%28test%29")).toBe("/workflows?f=status:RUNNING");
    });

    it("should handle empty filter URL", () => {
      storage.setOrigin("/workflows/my-workflow", "/workflows?");

      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows?");
    });

    it("should distinguish between similar paths", () => {
      storage.setOrigin("/workflows/test", "/workflows");
      storage.setOrigin("/workflows/test-2", "/workflows?f=status:RUNNING");
      storage.setOrigin("/workflows/test-20", "/workflows?f=status:COMPLETED");

      expect(storage.getOrigin("/workflows/test")).toBe("/workflows");
      expect(storage.getOrigin("/workflows/test-2")).toBe("/workflows?f=status:RUNNING");
      expect(storage.getOrigin("/workflows/test-20")).toBe("/workflows?f=status:COMPLETED");
    });
  });

  describe("navigation flow scenarios", () => {
    it("should handle back-and-forth navigation", () => {
      // User starts at filtered view
      storage.setOrigin("/workflows/workflow-1", "/workflows?f=status:RUNNING");

      // User goes back, changes filter, clicks different workflow
      storage.setOrigin("/workflows/workflow-2", "/workflows?f=status:COMPLETED");

      // Both origins should coexist
      expect(storage.getOrigin("/workflows/workflow-1")).toBe("/workflows?f=status:RUNNING");
      expect(storage.getOrigin("/workflows/workflow-2")).toBe("/workflows?f=status:COMPLETED");
    });

    it("should handle revisiting same workflow from different filters", () => {
      // First visit: from RUNNING filter
      storage.setOrigin("/workflows/my-workflow", "/workflows?f=status:RUNNING");
      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows?f=status:RUNNING");

      // User goes back, changes to COMPLETED filter, clicks same workflow
      storage.setOrigin("/workflows/my-workflow", "/workflows?f=status:COMPLETED");

      // Origin should be updated (latest wins)
      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows?f=status:COMPLETED");
    });

    it("should handle clean URL followed by filtered URL", () => {
      // First: User clicks from clean workflows page
      storage.setOrigin("/workflows/my-workflow", "/workflows");
      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows");

      // Later: Same workflow from filtered view
      storage.setOrigin("/workflows/my-workflow", "/workflows?f=status:RUNNING");
      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows?f=status:RUNNING");
    });
  });

  describe("deep link scenarios", () => {
    it("should return null for deep-linked workflow (no origin)", () => {
      // Scenario: User types URL directly or opens bookmark to detail page
      // No setOrigin() was called
      expect(storage.getOrigin("/workflows/my-workflow")).toBeNull();
    });

    it("should work after deep link, then navigation", () => {
      // Start: User deep links to detail page (no origin)
      expect(storage.getOrigin("/workflows/my-workflow")).toBeNull();

      // User clicks breadcrumb, goes to table, clicks another workflow
      storage.setOrigin("/workflows/other-workflow", "/workflows?f=status:RUNNING");

      // Original deep-linked workflow still has no origin
      expect(storage.getOrigin("/workflows/my-workflow")).toBeNull();
      // But new workflow has origin
      expect(storage.getOrigin("/workflows/other-workflow")).toBe("/workflows?f=status:RUNNING");
    });
  });

  describe("isolation - different list pages", () => {
    it("should keep workflow origins separate from pool origins", () => {
      // Note: Pools use panel, not navigation, but testing isolation principle
      storage.setOrigin("/workflows/my-workflow", "/workflows?f=status:RUNNING");
      storage.setOrigin("/pools/my-pool", "/pools?f=platform:dgx");

      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows?f=status:RUNNING");
      expect(storage.getOrigin("/pools/my-pool")).toBe("/pools?f=platform:dgx");
    });
  });

  describe("real-world workflow: user journey", () => {
    it("should handle complete user journey with filters", () => {
      // 1. User opens bookmark with filters
      // Simulates: /workflows?f=status:RUNNING&f=user:alice

      // 2. User clicks workflow-1 from table
      storage.setOrigin("/workflows/workflow-1", "/workflows?f=status:RUNNING&f=user:alice");

      // 3. User navigates within detail page (tabs, logs, etc)
      // Origin remains unchanged (keyed by detail page path only)

      // 4. User clicks breadcrumb → should go back to filtered table
      expect(storage.getOrigin("/workflows/workflow-1")).toBe("/workflows?f=status:RUNNING&f=user:alice");

      // 5. Back at table, user changes filters
      // Simulates: /workflows?f=status:COMPLETED

      // 6. User clicks workflow-2
      storage.setOrigin("/workflows/workflow-2", "/workflows?f=status:COMPLETED");

      // 7. Multiple origins should coexist
      expect(storage.getOrigin("/workflows/workflow-1")).toBe("/workflows?f=status:RUNNING&f=user:alice");
      expect(storage.getOrigin("/workflows/workflow-2")).toBe("/workflows?f=status:COMPLETED");
    });

    it("should handle user changing filters and revisiting same workflow", () => {
      // 1. User at /workflows?f=status:RUNNING
      storage.setOrigin("/workflows/my-workflow", "/workflows?f=status:RUNNING");

      // 2. User clicks breadcrumb, back to table
      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows?f=status:RUNNING");

      // 3. User changes filter to COMPLETED
      // 4. User clicks SAME workflow again
      storage.setOrigin("/workflows/my-workflow", "/workflows?f=status:COMPLETED");

      // 5. Origin updated to latest (COMPLETED wins)
      expect(storage.getOrigin("/workflows/my-workflow")).toBe("/workflows?f=status:COMPLETED");
    });
  });
});
