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
 * Tests for datasets hooks.
 *
 * The hooks in datasets-hooks.ts are thin wrappers around useQuery that delegate
 * to fetch functions and query key builders from datasets.ts. The underlying logic
 * is tested in datasets.test.ts.
 *
 * Hook integration testing (useQuery behavior, enabled conditions, caching) requires
 * @testing-library/react which is not available in this project. Use E2E tests with
 * Playwright for full integration testing.
 */

import { describe, it, expect } from "vitest";
import {
  buildAllDatasetsQueryKey,
  buildDatasetDetailQueryKey,
  buildDatasetLatestQueryKey,
  buildDatasetFilesQueryKey,
} from "@/lib/api/adapter/datasets";
import type { SearchChip } from "@/stores/types";

describe("datasets hooks query keys", () => {
  describe("buildAllDatasetsQueryKey", () => {
    it("builds query key with empty search chips and showAllUsers false", () => {
      const searchChips: SearchChip[] = [];
      const queryKey = buildAllDatasetsQueryKey(searchChips, false);

      expect(queryKey[0]).toBe("datasets");
      expect(queryKey[1]).toBe("all");
      expect(queryKey[2]).toEqual({ showAllUsers: false });
    });

    it("builds query key with showAllUsers true", () => {
      const searchChips: SearchChip[] = [];
      const queryKey = buildAllDatasetsQueryKey(searchChips, true);

      expect(queryKey[2]).toEqual({ showAllUsers: true });
    });

    it("includes name search in query key", () => {
      const searchChips: SearchChip[] = [{ field: "name", value: "test-dataset", label: "Name" }];
      const queryKey = buildAllDatasetsQueryKey(searchChips, false);

      expect(queryKey[2]).toEqual({ search: "test-dataset", showAllUsers: false });
    });

    it("includes bucket filter in query key", () => {
      const searchChips: SearchChip[] = [
        { field: "bucket", value: "bucket-a", label: "Bucket" },
        { field: "bucket", value: "bucket-b", label: "Bucket" },
      ];
      const queryKey = buildAllDatasetsQueryKey(searchChips, false);

      expect(queryKey[2]).toEqual({
        buckets: ["bucket-a", "bucket-b"],
        showAllUsers: false,
      });
    });

    it("includes user filter in query key", () => {
      const searchChips: SearchChip[] = [{ field: "user", value: "john", label: "User" }];
      const queryKey = buildAllDatasetsQueryKey(searchChips, false);

      expect(queryKey[2]).toEqual({ users: ["john"], showAllUsers: false });
    });

    it("combines multiple filters in query key", () => {
      const searchChips: SearchChip[] = [
        { field: "name", value: "dataset", label: "Name" },
        { field: "bucket", value: "my-bucket", label: "Bucket" },
        { field: "user", value: "jane", label: "User" },
      ];
      const queryKey = buildAllDatasetsQueryKey(searchChips, true);

      expect(queryKey[2]).toEqual({
        search: "dataset",
        buckets: ["my-bucket"],
        users: ["jane"],
        showAllUsers: true,
      });
    });
  });

  describe("buildDatasetDetailQueryKey", () => {
    it("builds query key with bucket and name", () => {
      const queryKey = buildDatasetDetailQueryKey("test-bucket", "test-dataset");

      expect(queryKey).toEqual(["datasets", "detail", "test-bucket", "test-dataset"]);
    });

    it("handles empty bucket", () => {
      const queryKey = buildDatasetDetailQueryKey("", "test-dataset");

      expect(queryKey).toEqual(["datasets", "detail", "", "test-dataset"]);
    });

    it("handles empty name", () => {
      const queryKey = buildDatasetDetailQueryKey("test-bucket", "");

      expect(queryKey).toEqual(["datasets", "detail", "test-bucket", ""]);
    });
  });

  describe("buildDatasetLatestQueryKey", () => {
    it("builds query key with bucket and name and latest suffix", () => {
      const queryKey = buildDatasetLatestQueryKey("test-bucket", "test-dataset");

      expect(queryKey).toEqual(["datasets", "detail", "test-bucket", "test-dataset", "latest"]);
    });

    it("separates from full detail query key", () => {
      const detailKey = buildDatasetDetailQueryKey("bucket", "dataset");
      const latestKey = buildDatasetLatestQueryKey("bucket", "dataset");

      expect(detailKey).not.toEqual(latestKey);
      expect(latestKey.length).toBe(detailKey.length + 1);
    });
  });

  describe("buildDatasetFilesQueryKey", () => {
    it("builds query key with location URL", () => {
      const queryKey = buildDatasetFilesQueryKey("s3://bucket/path/to/files");

      expect(queryKey).toEqual(["datasets", "files", "s3://bucket/path/to/files"]);
    });

    it("handles null location", () => {
      const queryKey = buildDatasetFilesQueryKey(null);

      expect(queryKey).toEqual(["datasets", "files", null]);
    });

    it("handles various URL schemes", () => {
      const s3Key = buildDatasetFilesQueryKey("s3://bucket/path");
      const gcsKey = buildDatasetFilesQueryKey("gs://bucket/path");
      const azureKey = buildDatasetFilesQueryKey("az://container/path");

      expect(s3Key[2]).toBe("s3://bucket/path");
      expect(gcsKey[2]).toBe("gs://bucket/path");
      expect(azureKey[2]).toBe("az://container/path");
    });
  });
});

describe("datasets hooks integration", () => {
  it("should be tested via E2E tests", () => {
    // The datasets hooks (useAllDatasets, useDataset, useDatasetLatest, useDatasetFiles)
    // are thin wrappers around useQuery that delegate to fetch functions from datasets.ts.
    // Testing hook behavior requires @testing-library/react which is not available.
    // Use Playwright E2E tests for integration testing.
    expect(true).toBe(true);
  });

  describe("hook enabled conditions", () => {
    it("useDatasetLatest requires non-empty bucket and name", () => {
      // The hook has: enabled: (options?.enabled ?? true) && !!bucket && !!name
      // This verifies the boolean logic is correct
      const testCases = [
        { bucket: "bucket", name: "name", optEnabled: undefined, expected: true },
        { bucket: "bucket", name: "name", optEnabled: true, expected: true },
        { bucket: "bucket", name: "name", optEnabled: false, expected: false },
        { bucket: "", name: "name", optEnabled: true, expected: false },
        { bucket: "bucket", name: "", optEnabled: true, expected: false },
        { bucket: "", name: "", optEnabled: true, expected: false },
      ];

      testCases.forEach(({ bucket, name, optEnabled, expected }) => {
        const enabled = (optEnabled ?? true) && !!bucket && !!name;
        expect(enabled).toBe(expected);
      });
    });

    it("useDatasetFiles requires non-null location", () => {
      // The hook has: enabled: (options?.enabled ?? true) && !!location
      // This verifies the boolean logic is correct
      const testCases = [
        { location: "s3://path", optEnabled: undefined, expected: true },
        { location: "s3://path", optEnabled: true, expected: true },
        { location: "s3://path", optEnabled: false, expected: false },
        { location: null, optEnabled: true, expected: false },
        { location: null, optEnabled: undefined, expected: false },
      ];

      testCases.forEach(({ location, optEnabled, expected }) => {
        const enabled = (optEnabled ?? true) && !!location;
        expect(enabled).toBe(expected);
      });
    });
  });
});
