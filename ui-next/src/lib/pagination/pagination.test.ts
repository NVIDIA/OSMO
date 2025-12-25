/**
 * SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchPaginatedResources, invalidateResourcesCache, _getCacheState } from "@/lib/api/adapter/pagination";
import type { Resource } from "@/lib/api/adapter/types";

// =============================================================================
// Test fixtures
// =============================================================================

function createMockResource(index: number): Resource {
  return {
    hostname: `node-${String(index).padStart(3, "0")}.cluster.local`,
    name: `node-${String(index).padStart(3, "0")}`,
    platform: index % 2 === 0 ? "dgx" : "base",
    resourceType: "SHARED" as const,
    backend: "k8s",
    gpu: { total: 8, used: index % 8 },
    cpu: { total: 128, used: 64 },
    memory: { total: 512, used: 256 },
    storage: { total: 1024, used: 512 },
    conditions: ["Ready"],
    poolMemberships: [{ pool: `pool-${index % 3}`, platform: index % 2 === 0 ? "dgx" : "base" }],
  };
}

function createMockBackendResponse(count: number) {
  const resources = Array.from({ length: count }, (_, i) => ({
    hostname: `node-${String(i).padStart(3, "0")}.cluster.local`,
    resource_type: "SHARED",
    backend: "k8s",
    conditions: ["Ready"],
    exposed_fields: {
      node: `node-${String(i).padStart(3, "0")}`,
      "pool/platform": [`pool-${i % 3}/${i % 2 === 0 ? "dgx" : "base"}`],
    },
    allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * 1024 * 1024, storage: 1024 * 1024 * 1024 * 1024 },
    usage_fields: { gpu: i % 8, cpu: 64, memory: 256 * 1024 * 1024, storage: 512 * 1024 * 1024 * 1024 },
    pool_platform_labels: { [`pool-${i % 3}`]: [i % 2 === 0 ? "dgx" : "base"] },
  }));

  return { resources };
}

// =============================================================================
// Tests
// =============================================================================

describe("fetchPaginatedResources", () => {
  beforeEach(() => {
    // Clear cache before each test
    invalidateResourcesCache();
  });

  it("fetches first page and caches result", async () => {
    const mockResponse = createMockBackendResponse(100);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse);

    const result = await fetchPaginatedResources({ limit: 20, offset: 0, all_pools: true }, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(20);
    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(100);
    expect(result.nextCursor).toBeDefined();

    // Cache should be valid
    const cacheState = _getCacheState();
    expect(cacheState.isValid).toBe(true);
    expect(cacheState.itemCount).toBe(100);
  });

  it("returns subsequent pages from cache", async () => {
    const mockResponse = createMockBackendResponse(100);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse);

    // First page - triggers fetch
    const page1 = await fetchPaginatedResources({ limit: 20, offset: 0, all_pools: true }, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Second page - should use cache
    const page2 = await fetchPaginatedResources({ limit: 20, cursor: page1.nextCursor!, all_pools: true }, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1); // Still only 1 call
    expect(page2.items).toHaveLength(20);
    expect(page2.items[0].name).toBe("node-020"); // Starts after first page
  });

  it("returns correct hasMore flag for last page", async () => {
    const mockResponse = createMockBackendResponse(50);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse);

    // First page
    const page1 = await fetchPaginatedResources({ limit: 30, offset: 0, all_pools: true }, fetchFn);
    expect(page1.hasMore).toBe(true);
    expect(page1.items).toHaveLength(30);

    // Second (last) page
    const page2 = await fetchPaginatedResources({ limit: 30, cursor: page1.nextCursor!, all_pools: true }, fetchFn);
    expect(page2.hasMore).toBe(false);
    expect(page2.items).toHaveLength(20); // Remaining items
  });

  it("handles empty response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ resources: [] });

    const result = await fetchPaginatedResources({ limit: 20, offset: 0, all_pools: true }, fetchFn);

    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.total).toBe(0);
  });

  it("refetches on first page after cache invalidation", async () => {
    const mockResponse = createMockBackendResponse(50);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse);

    // First fetch
    await fetchPaginatedResources({ limit: 20, offset: 0, all_pools: true }, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Invalidate cache
    invalidateResourcesCache();

    // Should refetch
    await fetchPaginatedResources({ limit: 20, offset: 0, all_pools: true }, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("handles offset-based pagination fallback", async () => {
    const mockResponse = createMockBackendResponse(100);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse);

    // First page to populate cache
    await fetchPaginatedResources({ limit: 25, offset: 0, all_pools: true }, fetchFn);

    // Use offset instead of cursor
    const page2 = await fetchPaginatedResources({ limit: 25, offset: 25, all_pools: true }, fetchFn);

    expect(page2.items).toHaveLength(25);
    expect(page2.items[0].name).toBe("node-025");
  });

  it("extracts pools and platforms from resources", async () => {
    const mockResponse = createMockBackendResponse(10);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse);

    const result = await fetchPaginatedResources({ limit: 10, offset: 0, all_pools: true }, fetchFn);

    expect(result.pools).toContain("pool-0");
    expect(result.pools).toContain("pool-1");
    expect(result.pools).toContain("pool-2");
    expect(result.platforms).toContain("dgx");
    expect(result.platforms).toContain("base");
  });
});

describe("invalidateResourcesCache", () => {
  it("clears the cache", async () => {
    const mockResponse = createMockBackendResponse(50);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse);

    // Populate cache
    await fetchPaginatedResources({ limit: 20, offset: 0, all_pools: true }, fetchFn);

    const beforeInvalidate = _getCacheState();
    expect(beforeInvalidate.isValid).toBe(true);

    // Invalidate
    invalidateResourcesCache();

    const afterInvalidate = _getCacheState();
    expect(afterInvalidate.isValid).toBe(false);
    expect(afterInvalidate.itemCount).toBe(0);
  });
});

describe("cursor encoding/decoding", () => {
  beforeEach(() => {
    invalidateResourcesCache();
  });

  it("cursor correctly encodes pagination position", async () => {
    const mockResponse = createMockBackendResponse(100);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse);

    const page1 = await fetchPaginatedResources({ limit: 25, offset: 0, all_pools: true }, fetchFn);

    // Cursor should be base64 encoded "25"
    expect(page1.nextCursor).toBe(btoa("25"));
  });

  it("handles invalid cursor gracefully", async () => {
    const mockResponse = createMockBackendResponse(100);
    const fetchFn = vi.fn().mockResolvedValue(mockResponse);

    // Populate cache
    await fetchPaginatedResources({ limit: 20, offset: 0, all_pools: true }, fetchFn);

    // Invalid cursor should fallback to offset 0
    const result = await fetchPaginatedResources({ limit: 20, cursor: "invalid-cursor", all_pools: true }, fetchFn);

    // Should still work (using offset 0 as fallback)
    expect(result.items).toBeDefined();
  });
});
