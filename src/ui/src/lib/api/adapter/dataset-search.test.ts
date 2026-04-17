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
import { searchManifest, searchByExtension } from "@/lib/api/adapter/dataset-search";
import type { ProcessedManifest, RawFileItem } from "@/lib/api/adapter/datasets";

// =============================================================================
// Test fixtures
// =============================================================================

function createRawFileItem(relativePath: string, size?: number): RawFileItem {
  return {
    relative_path: relativePath,
    size: size ?? 100,
    etag: `etag-${relativePath}`,
    url: `https://storage.example.com/${relativePath}`,
    storage_path: `s3://bucket/${relativePath}`,
  };
}

function buildProcessedManifest(paths: string[]): ProcessedManifest {
  const items = paths.map((p) => createRawFileItem(p));
  const byPath = [...items].sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  const byFilename = byPath
    .map((item) => ({ name: item.relative_path.split("/").pop()?.toLowerCase() ?? "", item }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const extSet = new Set<string>();
  for (const item of byPath) {
    const ext = item.relative_path.split(".").pop()?.toLowerCase();
    if (ext) extSet.add(ext);
  }
  return { byPath, byFilename, fileTypes: [...extSet].sort() };
}

const samplePaths = [
  "train/cat001.jpg",
  "train/cat002.jpg",
  "train/dog001.jpg",
  "train/images/img001.png",
  "train/images/img002.png",
  "test/cat001.jpg",
  "test/dog001.jpg",
  "readme.txt",
  "config.json",
  "data.csv",
];

const sampleManifest = buildProcessedManifest(samplePaths);

// =============================================================================
// searchManifest tests
// =============================================================================

describe("searchManifest", () => {
  describe("path-prefix search (term contains /)", () => {
    it("finds files matching path prefix at root", () => {
      const result = searchManifest(sampleManifest, "", "train/cat");
      expect(result.files).toHaveLength(2);
      expect(result.files[0].relativePath).toBe("train/cat001.jpg");
      expect(result.files[1].relativePath).toBe("train/cat002.jpg");
      expect(result.capped).toBe(false);
    });

    it("finds files matching path prefix within subdirectory", () => {
      const result = searchManifest(sampleManifest, "train", "images/img");
      expect(result.files).toHaveLength(2);
      expect(result.files[0].relativePath).toBe("train/images/img001.png");
      expect(result.files[1].relativePath).toBe("train/images/img002.png");
    });

    it("returns empty result when path prefix has no matches", () => {
      const result = searchManifest(sampleManifest, "", "nonexistent/path");
      expect(result.files).toHaveLength(0);
      expect(result.capped).toBe(false);
    });

    it("is case insensitive for path search", () => {
      const result = searchManifest(sampleManifest, "", "TRAIN/CAT");
      expect(result.files).toHaveLength(2);
    });
  });

  describe("filename-prefix search (term without /)", () => {
    it("finds files matching filename prefix at root", () => {
      const result = searchManifest(sampleManifest, "", "cat");
      expect(result.files).toHaveLength(3);
      expect(result.files.map((f) => f.name)).toContain("cat001.jpg");
    });

    it("filters by current path when searching by filename", () => {
      const result = searchManifest(sampleManifest, "train", "cat");
      expect(result.files).toHaveLength(2);
      expect(result.files.every((f) => f.relativePath?.startsWith("train/"))).toBe(true);
    });

    it("returns empty result when filename prefix has no matches", () => {
      const result = searchManifest(sampleManifest, "", "xyz");
      expect(result.files).toHaveLength(0);
      expect(result.capped).toBe(false);
    });

    it("is case insensitive for filename search", () => {
      const result = searchManifest(sampleManifest, "", "CAT");
      expect(result.files).toHaveLength(3);
    });

    it("finds files when path filter excludes all matches", () => {
      const result = searchManifest(sampleManifest, "nonexistent", "cat");
      expect(result.files).toHaveLength(0);
    });
  });

  describe("DatasetFile transformation", () => {
    it("extracts filename from relative path", () => {
      const result = searchManifest(sampleManifest, "", "readme");
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe("readme.txt");
    });

    it("includes all file properties", () => {
      const result = searchManifest(sampleManifest, "", "config");
      expect(result.files).toHaveLength(1);
      const file = result.files[0];
      expect(file.type).toBe("file");
      expect(file.size).toBe(100);
      expect(file.checksum).toBe("etag-config.json");
      expect(file.url).toBe("https://storage.example.com/config.json");
      expect(file.relativePath).toBe("config.json");
      expect(file.storagePath).toBe("s3://bucket/config.json");
    });
  });

  describe("result capping", () => {
    it("caps results at RESULT_LIMIT (500)", () => {
      const manyPaths = Array.from({ length: 600 }, (_, i) => `files/file${String(i).padStart(4, "0")}.txt`);
      const largeManifest = buildProcessedManifest(manyPaths);
      const result = searchManifest(largeManifest, "", "file");
      expect(result.files.length).toBe(500);
      expect(result.capped).toBe(true);
    });

    it("does not cap when under limit", () => {
      const result = searchManifest(sampleManifest, "", "cat");
      expect(result.capped).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty manifest", () => {
      const emptyManifest: ProcessedManifest = { byPath: [], byFilename: [], fileTypes: [] };
      const result = searchManifest(emptyManifest, "", "test");
      expect(result.files).toHaveLength(0);
      expect(result.capped).toBe(false);
    });

    it("returns empty when path prefix does not match start of paths", () => {
      // Searching with "/" at root creates fullPrefix "/" which doesn't match paths like "train/..."
      const result = searchManifest(sampleManifest, "", "/");
      expect(result.files).toHaveLength(0);
    });

    it("handles search from nested path", () => {
      const result = searchManifest(sampleManifest, "train/images", "img001");
      expect(result.files).toHaveLength(1);
      expect(result.files[0].relativePath).toBe("train/images/img001.png");
    });
  });
});

// =============================================================================
// searchByExtension tests
// =============================================================================

describe("searchByExtension", () => {
  it("finds all files with matching extension at root", () => {
    const result = searchByExtension(sampleManifest, "", "jpg");
    expect(result.files).toHaveLength(5);
    expect(result.files.every((f) => f.name.endsWith(".jpg"))).toBe(true);
  });

  it("finds files with matching extension in subdirectory", () => {
    const result = searchByExtension(sampleManifest, "train", "jpg");
    expect(result.files).toHaveLength(3);
    expect(result.files.every((f) => f.relativePath?.startsWith("train/"))).toBe(true);
  });

  it("is case insensitive for extension", () => {
    const result = searchByExtension(sampleManifest, "", "JPG");
    expect(result.files).toHaveLength(5);
  });

  it("returns empty result for non-existent extension", () => {
    const result = searchByExtension(sampleManifest, "", "xyz");
    expect(result.files).toHaveLength(0);
    expect(result.capped).toBe(false);
  });

  it("finds files in nested directory", () => {
    const result = searchByExtension(sampleManifest, "train/images", "png");
    expect(result.files).toHaveLength(2);
    expect(result.files.every((f) => f.relativePath?.startsWith("train/images/"))).toBe(true);
  });

  it("handles extension without dot in parameter", () => {
    const result = searchByExtension(sampleManifest, "", "json");
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe("config.json");
  });

  describe("result capping", () => {
    it("caps results at RESULT_LIMIT (500)", () => {
      const manyPaths = Array.from({ length: 600 }, (_, i) => `files/file${String(i).padStart(4, "0")}.txt`);
      const largeManifest = buildProcessedManifest(manyPaths);
      const result = searchByExtension(largeManifest, "", "txt");
      expect(result.files.length).toBe(500);
      expect(result.capped).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles empty manifest", () => {
      const emptyManifest: ProcessedManifest = { byPath: [], byFilename: [], fileTypes: [] };
      const result = searchByExtension(emptyManifest, "", "jpg");
      expect(result.files).toHaveLength(0);
      expect(result.capped).toBe(false);
    });

    it("handles path filter that excludes all matches", () => {
      const result = searchByExtension(sampleManifest, "nonexistent", "jpg");
      expect(result.files).toHaveLength(0);
    });

    it("stops scanning when path prefix no longer matches", () => {
      const result = searchByExtension(sampleManifest, "train", "csv");
      expect(result.files).toHaveLength(0);
    });
  });
});
