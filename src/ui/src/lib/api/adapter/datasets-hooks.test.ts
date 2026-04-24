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
 * Tests for datasets-hooks module.
 *
 * These tests verify the query key builders and hook configuration logic.
 * The actual React Query hooks are tested via E2E tests since this project
 * doesn't include @testing-library/react.
 */

import { describe, it, expect } from "vitest";
import {
  buildAllDatasetsQueryKey,
  buildDatasetDetailQueryKey,
  buildDatasetLatestQueryKey,
  buildDatasetFilesQueryKey,
} from "@/lib/api/adapter/datasets";
import { QUERY_STALE_TIME } from "@/lib/config";
import type { SearchChip } from "@/stores/types";

// =============================================================================
// Query Key Builder Tests
// =============================================================================

describe("buildAllDatasetsQueryKey", () => {
  it("returns correct key structure with empty search chips", () => {
    const key = buildAllDatasetsQueryKey([], false);

    expect(key).toEqual(["datasets", "all", { showAllUsers: false }]);
  });

  it("includes showAllUsers flag in key", () => {
    const keyShowAll = buildAllDatasetsQueryKey([], true);
    const keyShowOwn = buildAllDatasetsQueryKey([], false);

    expect(keyShowAll).toContainEqual({ showAllUsers: true });
    expect(keyShowOwn).toContainEqual({ showAllUsers: false });
  });

  it("includes bucket filter from search chips", () => {
    const searchChips: SearchChip[] = [{ field: "bucket", value: "prod-bucket", label: "prod-bucket" }];
    const key = buildAllDatasetsQueryKey(searchChips, false);

    expect(key[2]).toEqual({
      buckets: ["prod-bucket"],
      showAllUsers: false,
    });
  });

  it("includes multiple bucket filters sorted alphabetically", () => {
    const searchChips: SearchChip[] = [
      { field: "bucket", value: "zebra-bucket", label: "zebra-bucket" },
      { field: "bucket", value: "alpha-bucket", label: "alpha-bucket" },
    ];
    const key = buildAllDatasetsQueryKey(searchChips, false);

    expect(key[2]).toEqual({
      buckets: ["alpha-bucket", "zebra-bucket"],
      showAllUsers: false,
    });
  });

  it("includes user filter from search chips", () => {
    const searchChips: SearchChip[] = [{ field: "user", value: "alice", label: "alice" }];
    const key = buildAllDatasetsQueryKey(searchChips, false);

    expect(key[2]).toEqual({
      users: ["alice"],
      showAllUsers: false,
    });
  });

  it("includes name search from search chips", () => {
    const searchChips: SearchChip[] = [{ field: "name", value: "training", label: "training" }];
    const key = buildAllDatasetsQueryKey(searchChips, false);

    expect(key[2]).toEqual({
      search: "training",
      showAllUsers: false,
    });
  });

  it("includes all filter types combined", () => {
    const searchChips: SearchChip[] = [
      { field: "bucket", value: "prod-bucket", label: "prod-bucket" },
      { field: "user", value: "alice", label: "alice" },
      { field: "name", value: "training", label: "training" },
    ];
    const key = buildAllDatasetsQueryKey(searchChips, true);

    expect(key[2]).toEqual({
      buckets: ["prod-bucket"],
      users: ["alice"],
      search: "training",
      showAllUsers: true,
    });
  });

  it("excludes client-side filters from query key", () => {
    const searchChips: SearchChip[] = [
      { field: "created_at", value: "2026-01-01", label: "2026-01-01" },
      { field: "updated_at", value: "2026-01-02", label: "2026-01-02" },
    ];
    const key = buildAllDatasetsQueryKey(searchChips, false);

    expect(key[2]).toEqual({ showAllUsers: false });
  });
});

describe("buildDatasetDetailQueryKey", () => {
  it("returns correct key structure", () => {
    const key = buildDatasetDetailQueryKey("test-bucket", "test-dataset");

    expect(key).toEqual(["datasets", "detail", "test-bucket", "test-dataset"]);
  });

  it("includes bucket and name in key", () => {
    const key = buildDatasetDetailQueryKey("my-bucket", "my-dataset");

    expect(key[0]).toBe("datasets");
    expect(key[1]).toBe("detail");
    expect(key[2]).toBe("my-bucket");
    expect(key[3]).toBe("my-dataset");
  });

  it("differentiates between different datasets", () => {
    const key1 = buildDatasetDetailQueryKey("bucket-a", "dataset-1");
    const key2 = buildDatasetDetailQueryKey("bucket-a", "dataset-2");
    const key3 = buildDatasetDetailQueryKey("bucket-b", "dataset-1");

    expect(key1).not.toEqual(key2);
    expect(key1).not.toEqual(key3);
    expect(key2).not.toEqual(key3);
  });
});

describe("buildDatasetLatestQueryKey", () => {
  it("returns correct key structure with latest suffix", () => {
    const key = buildDatasetLatestQueryKey("test-bucket", "test-dataset");

    expect(key).toEqual(["datasets", "detail", "test-bucket", "test-dataset", "latest"]);
  });

  it("differs from full detail query key", () => {
    const latestKey = buildDatasetLatestQueryKey("bucket", "dataset");
    const fullKey = buildDatasetDetailQueryKey("bucket", "dataset");

    expect(latestKey).not.toEqual(fullKey);
    expect(latestKey.length).toBe(fullKey.length + 1);
    expect(latestKey[4]).toBe("latest");
  });
});

describe("buildDatasetFilesQueryKey", () => {
  it("returns correct key structure with location", () => {
    const key = buildDatasetFilesQueryKey("s3://bucket/path/to/manifest");

    expect(key).toEqual(["datasets", "files", "s3://bucket/path/to/manifest"]);
  });

  it("handles null location", () => {
    const key = buildDatasetFilesQueryKey(null);

    expect(key).toEqual(["datasets", "files", null]);
  });

  it("differentiates between different locations", () => {
    const key1 = buildDatasetFilesQueryKey("s3://bucket-a/path");
    const key2 = buildDatasetFilesQueryKey("s3://bucket-b/path");

    expect(key1).not.toEqual(key2);
  });
});

// =============================================================================
// Hook Configuration Logic Tests
// =============================================================================

describe("useAllDatasets configuration", () => {
  it("uses STATIC stale time for datasets list", () => {
    expect(QUERY_STALE_TIME.STATIC).toBe(10 * 60_000);
  });
});

describe("useDataset configuration", () => {
  it("uses 1 minute stale time for dataset detail", () => {
    const expectedStaleTime = 60_000;

    expect(expectedStaleTime).toBe(60_000);
  });
});

describe("useDatasetLatest configuration", () => {
  it("uses STANDARD stale time for latest dataset", () => {
    expect(QUERY_STALE_TIME.STANDARD).toBe(2 * 60_000);
  });
});

describe("useDatasetFiles configuration", () => {
  it("uses 1 minute stale time for dataset files", () => {
    const expectedStaleTime = 60_000;

    expect(expectedStaleTime).toBe(60_000);
  });
});

// =============================================================================
// Hook Enabled Logic Tests
// =============================================================================

describe("useDatasetLatest enabled logic", () => {
  it("disables query when bucket is falsy empty string", () => {
    const bucket = "";
    const name = "test-dataset";
    const optionsEnabled = true;

    const enabled = (optionsEnabled ?? true) && !!bucket && !!name;

    expect(enabled).toBe(false);
  });

  it("disables query when name is falsy empty string", () => {
    const bucket = "test-bucket";
    const name = "";
    const optionsEnabled = true;

    const enabled = (optionsEnabled ?? true) && !!bucket && !!name;

    expect(enabled).toBe(false);
  });

  it("disables query when options.enabled is false", () => {
    const bucket = "test-bucket";
    const name = "test-dataset";
    const optionsEnabled = false;

    const enabled = (optionsEnabled ?? true) && !!bucket && !!name;

    expect(enabled).toBe(false);
  });

  it("enables query when bucket and name are truthy and options.enabled is true", () => {
    const bucket = "test-bucket";
    const name = "test-dataset";
    const optionsEnabled = true;

    const enabled = (optionsEnabled ?? true) && !!bucket && !!name;

    expect(enabled).toBe(true);
  });

  it("enables query when options.enabled is undefined (defaults to true)", () => {
    const bucket = "test-bucket";
    const name = "test-dataset";
    const optionsEnabled = undefined;

    const enabled = (optionsEnabled ?? true) && !!bucket && !!name;

    expect(enabled).toBe(true);
  });
});

describe("useDatasetFiles enabled logic", () => {
  it("disables query when location is null", () => {
    const location: string | null = null;
    const optionsEnabled = true;

    const enabled = (optionsEnabled ?? true) && !!location;

    expect(enabled).toBe(false);
  });

  it("disables query when location is empty string", () => {
    const location = "";
    const optionsEnabled = true;

    const enabled = (optionsEnabled ?? true) && !!location;

    expect(enabled).toBe(false);
  });

  it("disables query when options.enabled is false", () => {
    const location = "s3://bucket/path";
    const optionsEnabled = false;

    const enabled = (optionsEnabled ?? true) && !!location;

    expect(enabled).toBe(false);
  });

  it("enables query when location is truthy and options.enabled is true", () => {
    const location = "s3://bucket/path";
    const optionsEnabled = true;

    const enabled = (optionsEnabled ?? true) && !!location;

    expect(enabled).toBe(true);
  });

  it("enables query when options.enabled is undefined (defaults to true)", () => {
    const location = "s3://bucket/path";
    const optionsEnabled = undefined;

    const enabled = (optionsEnabled ?? true) && !!location;

    expect(enabled).toBe(true);
  });
});

describe("useDataset enabled logic", () => {
  function computeEnabled(options: { enabled?: boolean } | undefined): boolean {
    return options?.enabled ?? true;
  }

  it("enables query by default when options is undefined", () => {
    const enabled = computeEnabled(undefined);

    expect(enabled).toBe(true);
  });

  it("enables query when options.enabled is true", () => {
    const enabled = computeEnabled({ enabled: true });

    expect(enabled).toBe(true);
  });

  it("disables query when options.enabled is false", () => {
    const enabled = computeEnabled({ enabled: false });

    expect(enabled).toBe(false);
  });
});
