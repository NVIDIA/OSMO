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

/**
 * Tests for datasets-hooks.ts React Query hook configurations.
 *
 * These tests verify the hook configurations by mocking useQuery and
 * examining the options passed to it. This allows testing the enabled
 * conditions, query keys, and fetch function wiring without needing
 * @testing-library/react.
 *
 * The actual fetch functions are tested in datasets.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SearchChip } from "@/stores/types";

// Capture the options passed to useQuery
let lastUseQueryOptions: Record<string, unknown> | null = null;

// Mock @tanstack/react-query
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn((options: Record<string, unknown>) => {
    lastUseQueryOptions = options;
    return {
      data: undefined,
      isLoading: false,
      isSuccess: false,
      isError: false,
      error: null,
    };
  }),
}));

// Mock the datasets adapter module
vi.mock("@/lib/api/adapter/datasets", () => ({
  buildAllDatasetsQueryKey: vi.fn((chips: SearchChip[], showAllUsers: boolean) => [
    "datasets",
    "all",
    { chips, showAllUsers },
  ]),
  buildDatasetDetailQueryKey: vi.fn((bucket: string, name: string) => ["datasets", "detail", bucket, name]),
  buildDatasetLatestQueryKey: vi.fn((bucket: string, name: string) => ["datasets", "detail", bucket, name, "latest"]),
  buildDatasetFilesQueryKey: vi.fn((location: string | null) => ["datasets", "files", location]),
  fetchAllDatasets: vi.fn(),
  fetchDatasetDetail: vi.fn(),
  fetchDatasetDetailLatest: vi.fn(),
  fetchDatasetFiles: vi.fn(),
}));

// Mock the config module
vi.mock("@/lib/config", () => ({
  QUERY_STALE_TIME: {
    REALTIME: 30_000,
    STANDARD: 120_000,
    STATIC: 600_000,
  },
}));

// Import after mocking
import { useAllDatasets, useDataset, useDatasetLatest, useDatasetFiles } from "@/lib/api/adapter/datasets-hooks";
import {
  buildAllDatasetsQueryKey,
  buildDatasetDetailQueryKey,
  buildDatasetLatestQueryKey,
  buildDatasetFilesQueryKey,
  fetchAllDatasets,
  fetchDatasetDetail,
  fetchDatasetDetailLatest,
  fetchDatasetFiles,
} from "@/lib/api/adapter/datasets";
import { QUERY_STALE_TIME } from "@/lib/config";

// =============================================================================
// Test Setup
// =============================================================================

beforeEach(() => {
  lastUseQueryOptions = null;
  vi.clearAllMocks();
});

// =============================================================================
// useAllDatasets Tests
// =============================================================================

describe("useAllDatasets", () => {
  it("passes correct query key for showAllUsers false with empty chips", () => {
    useAllDatasets(false, []);

    expect(buildAllDatasetsQueryKey).toHaveBeenCalledWith([], false);
    expect(lastUseQueryOptions?.queryKey).toEqual(["datasets", "all", { chips: [], showAllUsers: false }]);
  });

  it("passes correct query key for showAllUsers true", () => {
    useAllDatasets(true, []);

    expect(buildAllDatasetsQueryKey).toHaveBeenCalledWith([], true);
    expect(lastUseQueryOptions?.queryKey).toEqual(["datasets", "all", { chips: [], showAllUsers: true }]);
  });

  it("passes search chips to query key builder", () => {
    const searchChips: SearchChip[] = [{ field: "name", value: "test", label: "Name: test" }];

    useAllDatasets(false, searchChips);

    expect(buildAllDatasetsQueryKey).toHaveBeenCalledWith(searchChips, false);
  });

  it("creates queryFn that calls fetchAllDatasets with correct args", async () => {
    const searchChips: SearchChip[] = [{ field: "bucket", value: "my-bucket", label: "Bucket: my-bucket" }];

    useAllDatasets(true, searchChips);

    const queryFn = lastUseQueryOptions?.queryFn as () => Promise<unknown>;
    expect(queryFn).toBeDefined();

    await queryFn();
    expect(fetchAllDatasets).toHaveBeenCalledWith(true, searchChips);
  });

  it("uses STATIC stale time", () => {
    useAllDatasets(false, []);

    expect(lastUseQueryOptions?.staleTime).toBe(QUERY_STALE_TIME.STATIC);
  });
});

// =============================================================================
// useDataset Tests
// =============================================================================

describe("useDataset", () => {
  it("passes correct query key for bucket and name", () => {
    useDataset("my-bucket", "my-dataset");

    expect(buildDatasetDetailQueryKey).toHaveBeenCalledWith("my-bucket", "my-dataset");
    expect(lastUseQueryOptions?.queryKey).toEqual(["datasets", "detail", "my-bucket", "my-dataset"]);
  });

  it("creates queryFn that calls fetchDatasetDetail with correct args", async () => {
    useDataset("bucket-1", "dataset-1");

    const queryFn = lastUseQueryOptions?.queryFn as () => Promise<unknown>;
    await queryFn();

    expect(fetchDatasetDetail).toHaveBeenCalledWith("bucket-1", "dataset-1");
  });

  it("is enabled by default when no options provided", () => {
    useDataset("bucket", "name");

    expect(lastUseQueryOptions?.enabled).toBe(true);
  });

  it("is enabled when enabled option is true", () => {
    useDataset("bucket", "name", { enabled: true });

    expect(lastUseQueryOptions?.enabled).toBe(true);
  });

  it("is disabled when enabled option is false", () => {
    useDataset("bucket", "name", { enabled: false });

    expect(lastUseQueryOptions?.enabled).toBe(false);
  });

  it("uses 60 second stale time", () => {
    useDataset("bucket", "name");

    expect(lastUseQueryOptions?.staleTime).toBe(60_000);
  });
});

// =============================================================================
// useDatasetLatest Tests
// =============================================================================

describe("useDatasetLatest", () => {
  it("passes correct query key for bucket and name", () => {
    useDatasetLatest("my-bucket", "my-dataset");

    expect(buildDatasetLatestQueryKey).toHaveBeenCalledWith("my-bucket", "my-dataset");
    expect(lastUseQueryOptions?.queryKey).toEqual(["datasets", "detail", "my-bucket", "my-dataset", "latest"]);
  });

  it("creates queryFn that calls fetchDatasetDetailLatest with correct args", async () => {
    useDatasetLatest("bucket-2", "dataset-2");

    const queryFn = lastUseQueryOptions?.queryFn as () => Promise<unknown>;
    await queryFn();

    expect(fetchDatasetDetailLatest).toHaveBeenCalledWith("bucket-2", "dataset-2");
  });

  it("is enabled when bucket and name are valid and no options", () => {
    useDatasetLatest("valid-bucket", "valid-name");

    expect(lastUseQueryOptions?.enabled).toBe(true);
  });

  it("is disabled when enabled option is false", () => {
    useDatasetLatest("bucket", "name", { enabled: false });

    expect(lastUseQueryOptions?.enabled).toBe(false);
  });

  it("is disabled when bucket is empty string", () => {
    useDatasetLatest("", "name");

    expect(lastUseQueryOptions?.enabled).toBe(false);
  });

  it("is disabled when name is empty string", () => {
    useDatasetLatest("bucket", "");

    expect(lastUseQueryOptions?.enabled).toBe(false);
  });

  it("is disabled when both bucket and name are empty", () => {
    useDatasetLatest("", "");

    expect(lastUseQueryOptions?.enabled).toBe(false);
  });

  it("uses STANDARD stale time", () => {
    useDatasetLatest("bucket", "name");

    expect(lastUseQueryOptions?.staleTime).toBe(QUERY_STALE_TIME.STANDARD);
  });
});

// =============================================================================
// useDatasetFiles Tests
// =============================================================================

describe("useDatasetFiles", () => {
  it("passes correct query key for valid location", () => {
    useDatasetFiles("https://example.com/manifest");

    expect(buildDatasetFilesQueryKey).toHaveBeenCalledWith("https://example.com/manifest");
    expect(lastUseQueryOptions?.queryKey).toEqual(["datasets", "files", "https://example.com/manifest"]);
  });

  it("passes null location to query key builder", () => {
    useDatasetFiles(null);

    expect(buildDatasetFilesQueryKey).toHaveBeenCalledWith(null);
    expect(lastUseQueryOptions?.queryKey).toEqual(["datasets", "files", null]);
  });

  it("creates queryFn that calls fetchDatasetFiles with correct args", async () => {
    useDatasetFiles("https://example.com/files");

    const queryFn = lastUseQueryOptions?.queryFn as () => Promise<unknown>;
    await queryFn();

    expect(fetchDatasetFiles).toHaveBeenCalledWith("https://example.com/files");
  });

  it("is enabled when location is valid and no options", () => {
    useDatasetFiles("https://example.com/manifest");

    expect(lastUseQueryOptions?.enabled).toBe(true);
  });

  it("is disabled when enabled option is false", () => {
    useDatasetFiles("https://example.com/manifest", { enabled: false });

    expect(lastUseQueryOptions?.enabled).toBe(false);
  });

  it("is disabled when location is null", () => {
    useDatasetFiles(null);

    expect(lastUseQueryOptions?.enabled).toBe(false);
  });

  it("is disabled when location is empty string", () => {
    useDatasetFiles("");

    expect(lastUseQueryOptions?.enabled).toBe(false);
  });

  it("uses 60 second stale time", () => {
    useDatasetFiles("https://example.com/files");

    expect(lastUseQueryOptions?.staleTime).toBe(60_000);
  });
});
