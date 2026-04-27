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
import { buildDirectoryListing, processManifestItems, type RawFileItem } from "@/lib/api/adapter/datasets";

function createRawItem(relativePath: string): RawFileItem {
  return {
    relative_path: relativePath,
    size: 1,
    etag: `etag-${relativePath}`,
    storage_path: `s3://bucket/${relativePath}`,
    url: `https://example.com/${relativePath}`,
  };
}

/**
 * Drives the full manifest pipeline (sort → binary-search → directory listing)
 * the same way production does, so sort-vs-search comparator inconsistencies
 * surface here. The fake manifest is passed raw; processManifestItems sorts it.
 */
function listAtPath(paths: string[], path: string) {
  const manifest = processManifestItems(paths.map(createRawItem));
  return buildDirectoryListing(manifest.byPath, path);
}

describe("dataset manifest browsing", () => {
  it("lists children of a directory whose sibling shares its name as a prefix", () => {
    // Hive-style partitioned layout: two sibling directories where one directory's
    // name is a prefix of the other ("processed" vs "processed_invalid"). Under
    // Unicode collation (localeCompare), "_" and "/" are treated as equivalent
    // punctuation, which sorts "processed_invalid/..." BEFORE "processed/..." —
    // the opposite of `<` ordering. binarySearchByPath uses `<`, so if the
    // manifest sort disagrees the search starts at the wrong index and the
    // listing comes back empty.
    const result = listAtPath(
      [
        "processed/sequence_id=s01/robot_name=sharpa_wave/a.parquet",
        "processed/sequence_id=s02/robot_name=sharpa_wave/b.parquet",
        "processed_invalid/sequence_id=s01/robot_name=sharpa_wave/c.parquet",
        "processed_invalid/sequence_id=s02/robot_name=sharpa_wave/d.parquet",
      ],
      "processed",
    );

    expect(result).toEqual([
      { name: "sequence_id=s01", type: "folder" },
      { name: "sequence_id=s02", type: "folder" },
    ]);
  });

  it("lists children of the sibling directory too", () => {
    const result = listAtPath(
      [
        "processed/sequence_id=s01/robot_name=sharpa_wave/a.parquet",
        "processed_invalid/sequence_id=s01/robot_name=sharpa_wave/c.parquet",
        "processed_invalid/sequence_id=s02/robot_name=sharpa_wave/d.parquet",
      ],
      "processed_invalid",
    );

    expect(result).toEqual([
      { name: "sequence_id=s01", type: "folder" },
      { name: "sequence_id=s02", type: "folder" },
    ]);
  });

  it("lists root-level siblings including the prefix-sharing directory", () => {
    const result = listAtPath(
      [
        "processed/sequence_id=s01/robot_name=sharpa_wave/a.parquet",
        "processed_invalid/sequence_id=s01/robot_name=sharpa_wave/c.parquet",
        "quality.csv",
      ],
      "",
    );

    expect(result).toEqual([
      { name: "processed", type: "folder" },
      { name: "processed_invalid", type: "folder" },
      expect.objectContaining({ name: "quality.csv", type: "file" }),
    ]);
  });
});
