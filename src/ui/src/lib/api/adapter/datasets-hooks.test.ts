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
 * Tests for datasets React Query hooks.
 *
 * These tests verify that the hooks correctly configure useQuery with:
 * - Proper query keys (from key builders)
 * - Correct query functions (fetch functions)
 * - Appropriate enabled/staleTime options
 *
 * The actual fetch functions are tested in datasets.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useQuery } from "@tanstack/react-query";
import type { SearchChip } from "@/stores/types";
import { QUERY_STALE_TIME } from "@/lib/config";
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

// Mock React Query
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    error: null,
  })),
}));

// Mock the fetch functions
vi.mock("@/lib/api/adapter/datasets", async () => {
  const actual = await vi.importActual("@/lib/api/adapter/datasets");
  return {
    ...actual,
    fetchAllDatasets: vi.fn(),
    fetchDatasetDetail: vi.fn(),
    fetchDatasetDetailLatest: vi.fn(),
    fetchDatasetFiles: vi.fn(),
  };
});

const mockUseQuery = vi.mocked(useQuery);

describe("useAllDatasets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls useQuery with correct query key for empty chips", () => {
    const searchChips: SearchChip[] = [];
    const showAllUsers = false;

    useAllDatasets(showAllUsers, searchChips);

    expect(mockUseQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.queryKey).toEqual(buildAllDatasetsQueryKey(searchChips, showAllUsers));
  });

  it("calls useQuery with correct query key for showAllUsers true", () => {
    const searchChips: SearchChip[] = [];
    const showAllUsers = true;

    useAllDatasets(showAllUsers, searchChips);

    expect(mockUseQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.queryKey).toEqual(buildAllDatasetsQueryKey(searchChips, showAllUsers));
  });

  it("calls useQuery with correct query key for chips with filters", () => {
    const searchChips: SearchChip[] = [
      { field: "name", value: "test-dataset", label: "test-dataset" },
      { field: "bucket", value: "my-bucket", label: "my-bucket" },
    ];
    const showAllUsers = false;

    useAllDatasets(showAllUsers, searchChips);

    expect(mockUseQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.queryKey).toEqual(buildAllDatasetsQueryKey(searchChips, showAllUsers));
  });

  it("uses QUERY_STALE_TIME.STATIC for staleTime", () => {
    useAllDatasets(false, []);

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.staleTime).toBe(QUERY_STALE_TIME.STATIC);
  });

  it("passes queryFn that calls fetchAllDatasets with correct args", () => {
    const searchChips: SearchChip[] = [{ field: "name", value: "test", label: "test" }];
    const showAllUsers = true;

    useAllDatasets(showAllUsers, searchChips);

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.queryFn).toBeDefined();

    // Execute the queryFn to verify it calls fetchAllDatasets
    const queryFn = callArgs.queryFn as (() => void) | undefined;
    queryFn?.();
    expect(fetchAllDatasets).toHaveBeenCalledWith(showAllUsers, searchChips);
  });
});

describe("useDataset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls useQuery with correct query key", () => {
    const bucket = "test-bucket";
    const name = "test-dataset";

    useDataset(bucket, name);

    expect(mockUseQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.queryKey).toEqual(buildDatasetDetailQueryKey(bucket, name));
  });

  it("defaults enabled to true when no options provided", () => {
    useDataset("bucket", "name");

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.enabled).toBe(true);
  });

  it("respects enabled option when set to false", () => {
    useDataset("bucket", "name", { enabled: false });

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.enabled).toBe(false);
  });

  it("respects enabled option when set to true", () => {
    useDataset("bucket", "name", { enabled: true });

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.enabled).toBe(true);
  });

  it("uses 1 minute staleTime", () => {
    useDataset("bucket", "name");

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.staleTime).toBe(60_000);
  });

  it("passes queryFn that calls fetchDatasetDetail with correct args", () => {
    const bucket = "my-bucket";
    const name = "my-dataset";

    useDataset(bucket, name);

    const callArgs = mockUseQuery.mock.calls[0][0];
    const queryFn = callArgs.queryFn as (() => void) | undefined;
    queryFn?.();
    expect(fetchDatasetDetail).toHaveBeenCalledWith(bucket, name);
  });
});

describe("useDatasetLatest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls useQuery with correct query key", () => {
    const bucket = "test-bucket";
    const name = "test-dataset";

    useDatasetLatest(bucket, name);

    expect(mockUseQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.queryKey).toEqual(buildDatasetLatestQueryKey(bucket, name));
  });

  it("is enabled when bucket and name are provided", () => {
    useDatasetLatest("bucket", "name");

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.enabled).toBe(true);
  });

  it("is disabled when bucket is empty", () => {
    useDatasetLatest("", "name");

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.enabled).toBe(false);
  });

  it("is disabled when name is empty", () => {
    useDatasetLatest("bucket", "");

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.enabled).toBe(false);
  });

  it("is disabled when options.enabled is false", () => {
    useDatasetLatest("bucket", "name", { enabled: false });

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.enabled).toBe(false);
  });

  it("uses QUERY_STALE_TIME.STANDARD for staleTime", () => {
    useDatasetLatest("bucket", "name");

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.staleTime).toBe(QUERY_STALE_TIME.STANDARD);
  });

  it("passes queryFn that calls fetchDatasetDetailLatest with correct args", () => {
    const bucket = "my-bucket";
    const name = "my-dataset";

    useDatasetLatest(bucket, name);

    const callArgs = mockUseQuery.mock.calls[0][0];
    const queryFn = callArgs.queryFn as (() => void) | undefined;
    queryFn?.();
    expect(fetchDatasetDetailLatest).toHaveBeenCalledWith(bucket, name);
  });
});

describe("useDatasetFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls useQuery with correct query key for valid location", () => {
    const location = "s3://bucket/path/manifest.json";

    useDatasetFiles(location);

    expect(mockUseQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.queryKey).toEqual(buildDatasetFilesQueryKey(location));
  });

  it("calls useQuery with correct query key for null location", () => {
    useDatasetFiles(null);

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.queryKey).toEqual(buildDatasetFilesQueryKey(null));
  });

  it("is enabled when location is provided", () => {
    useDatasetFiles("s3://bucket/path");

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.enabled).toBe(true);
  });

  it("is disabled when location is null", () => {
    useDatasetFiles(null);

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.enabled).toBe(false);
  });

  it("is disabled when location is empty string", () => {
    useDatasetFiles("");

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.enabled).toBe(false);
  });

  it("is disabled when options.enabled is false", () => {
    useDatasetFiles("s3://bucket/path", { enabled: false });

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.enabled).toBe(false);
  });

  it("uses 1 minute staleTime", () => {
    useDatasetFiles("s3://bucket/path");

    const callArgs = mockUseQuery.mock.calls[0][0];
    expect(callArgs.staleTime).toBe(60_000);
  });

  it("passes queryFn that calls fetchDatasetFiles with correct args", () => {
    const location = "s3://bucket/path/manifest.json";

    useDatasetFiles(location);

    const callArgs = mockUseQuery.mock.calls[0][0];
    const queryFn = callArgs.queryFn as (() => void) | undefined;
    queryFn?.();
    expect(fetchDatasetFiles).toHaveBeenCalledWith(location);
  });
});
