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

function createRawItem(relativePath: string, size = 100): RawFileItem {
  return {
    relative_path: relativePath,
    size,
    etag: `etag-${relativePath}`,
    storage_path: `s3://bucket/${relativePath}`,
    url: `https://example.com/${relativePath}`,
  };
}

function createManifest(paths: string[]): ProcessedManifest {
  const sortedPaths = [...paths].sort();
  const byPath = sortedPaths.map((p) => createRawItem(p));
  const byFilename = sortedPaths
    .map((p) => ({
      name: p.split("/").pop()!.toLowerCase(),
      item: createRawItem(p),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const fileTypes = [...new Set(sortedPaths.map((p) => p.split(".").pop()!.toLowerCase()))].sort();

  return { byPath, byFilename, fileTypes };
}

// =============================================================================
// searchManifest tests
// =============================================================================

describe("searchManifest", () => {
  describe("path-prefix search (term contains /)", () => {
    it("should find files matching path prefix at root", () => {
      const manifest = createManifest([
        "train/img001.jpg",
        "train/img002.jpg",
        "test/img001.jpg",
        "validate/img001.jpg",
      ]);

      const result = searchManifest(manifest, "", "train/");

      expect(result.files).toHaveLength(2);
      expect(result.files[0].relativePath).toBe("train/img001.jpg");
      expect(result.files[1].relativePath).toBe("train/img002.jpg");
      expect(result.capped).toBe(false);
    });

    it("should find files matching partial path prefix", () => {
      const manifest = createManifest(["train/images/cat.jpg", "train/images/dog.jpg", "train/labels/cat.txt"]);

      const result = searchManifest(manifest, "", "train/im");

      expect(result.files).toHaveLength(2);
      expect(result.files[0].relativePath).toBe("train/images/cat.jpg");
      expect(result.files[1].relativePath).toBe("train/images/dog.jpg");
      expect(result.capped).toBe(false);
    });

    it("should combine current path with search term", () => {
      const manifest = createManifest(["data/train/img001.jpg", "data/train/img002.jpg", "data/test/img001.jpg"]);

      const result = searchManifest(manifest, "data", "train/img");

      expect(result.files).toHaveLength(2);
      expect(result.files[0].relativePath).toBe("data/train/img001.jpg");
      expect(result.files[1].relativePath).toBe("data/train/img002.jpg");
      expect(result.capped).toBe(false);
    });

    it("should lowercase search term for path matching", () => {
      // Note: searchManifest lowercases the search term, but compares against actual paths.
      // Files must have lowercase paths to match a lowercase search term.
      const manifest = createManifest(["train/img001.jpg", "train/img002.jpg", "test/img001.jpg"]);

      const result = searchManifest(manifest, "", "TRAIN/IMG");

      expect(result.files).toHaveLength(2);
      expect(result.files[0].relativePath).toBe("train/img001.jpg");
      expect(result.files[1].relativePath).toBe("train/img002.jpg");
      expect(result.capped).toBe(false);
    });

    it("should return empty result when no files match", () => {
      const manifest = createManifest(["train/img001.jpg", "test/img001.jpg"]);

      const result = searchManifest(manifest, "", "validate/");

      expect(result.files).toHaveLength(0);
      expect(result.capped).toBe(false);
    });
  });

  describe("filename-prefix search (term without /)", () => {
    it("should find files by filename prefix at root", () => {
      const manifest = createManifest(["train/image001.jpg", "test/image002.jpg", "train/label001.txt"]);

      const result = searchManifest(manifest, "", "image");

      expect(result.files).toHaveLength(2);
      expect(result.capped).toBe(false);
    });

    it("should filter results to current path subtree", () => {
      const manifest = createManifest(["train/image001.jpg", "test/image002.jpg", "train/nested/image003.jpg"]);

      const result = searchManifest(manifest, "train", "image");

      expect(result.files).toHaveLength(2);
      expect(result.files.every((f) => f.relativePath?.startsWith("train/"))).toBe(true);
      expect(result.capped).toBe(false);
    });

    it("should perform case-insensitive filename matching", () => {
      const manifest = createManifest(["train/IMAGE001.jpg", "train/Image002.jpg", "train/image003.jpg"]);

      const result = searchManifest(manifest, "", "image");

      expect(result.files).toHaveLength(3);
      expect(result.capped).toBe(false);
    });

    it("should return empty result when no filenames match", () => {
      const manifest = createManifest(["train/cat.jpg", "train/dog.jpg"]);

      const result = searchManifest(manifest, "", "bird");

      expect(result.files).toHaveLength(0);
      expect(result.capped).toBe(false);
    });

    it("should exclude files outside current path", () => {
      const manifest = createManifest(["train/photo.jpg", "test/photo.jpg", "validate/photo.jpg"]);

      const result = searchManifest(manifest, "train", "photo");

      expect(result.files).toHaveLength(1);
      expect(result.files[0].relativePath).toBe("train/photo.jpg");
      expect(result.capped).toBe(false);
    });
  });

  describe("result transformation", () => {
    it("should transform raw items to DatasetFile format", () => {
      const manifest = createManifest(["train/image.jpg"]);

      const result = searchManifest(manifest, "", "train/");

      expect(result.files[0]).toEqual({
        name: "image.jpg",
        type: "file",
        size: 100,
        checksum: "etag-train/image.jpg",
        url: "https://example.com/train/image.jpg",
        relativePath: "train/image.jpg",
        storagePath: "s3://bucket/train/image.jpg",
      });
    });

    it("should handle files without path separators", () => {
      const manifest = createManifest(["readme.txt"]);

      const result = searchManifest(manifest, "", "readme");

      expect(result.files[0].name).toBe("readme.txt");
      expect(result.files[0].relativePath).toBe("readme.txt");
    });
  });

  describe("result capping", () => {
    it("should cap results at 500 and set capped flag", () => {
      const paths = Array.from({ length: 600 }, (_, i) => `train/file${String(i).padStart(4, "0")}.jpg`);
      const manifest = createManifest(paths);

      const result = searchManifest(manifest, "", "train/");

      expect(result.files).toHaveLength(500);
      expect(result.capped).toBe(true);
    });

    it("should not set capped flag when under limit", () => {
      const paths = Array.from({ length: 100 }, (_, i) => `train/file${i}.jpg`);
      const manifest = createManifest(paths);

      const result = searchManifest(manifest, "", "train/");

      expect(result.files).toHaveLength(100);
      expect(result.capped).toBe(false);
    });
  });
});

// =============================================================================
// searchByExtension tests
// =============================================================================

describe("searchByExtension", () => {
  it("should find files with matching extension at root", () => {
    const manifest = createManifest(["train/cat.jpg", "train/dog.png", "train/readme.txt"]);

    const result = searchByExtension(manifest, "", "jpg");

    expect(result.files).toHaveLength(1);
    expect(result.files[0].relativePath).toBe("train/cat.jpg");
    expect(result.capped).toBe(false);
  });

  it("should perform case-insensitive extension matching", () => {
    const manifest = createManifest(["train/cat.JPG", "train/dog.Jpg", "train/bird.jpg"]);

    const result = searchByExtension(manifest, "", "jpg");

    expect(result.files).toHaveLength(3);
    expect(result.capped).toBe(false);
  });

  it("should filter results to current path subtree", () => {
    const manifest = createManifest(["train/cat.jpg", "test/dog.jpg", "validate/bird.jpg"]);

    const result = searchByExtension(manifest, "train", "jpg");

    expect(result.files).toHaveLength(1);
    expect(result.files[0].relativePath).toBe("train/cat.jpg");
    expect(result.capped).toBe(false);
  });

  it("should search nested directories within path", () => {
    const manifest = createManifest(["data/train/cat.jpg", "data/train/nested/dog.jpg", "data/test/bird.jpg"]);

    const result = searchByExtension(manifest, "data/train", "jpg");

    expect(result.files).toHaveLength(2);
    expect(result.capped).toBe(false);
  });

  it("should return empty result when no files have extension", () => {
    const manifest = createManifest(["train/cat.jpg", "train/dog.png"]);

    const result = searchByExtension(manifest, "", "txt");

    expect(result.files).toHaveLength(0);
    expect(result.capped).toBe(false);
  });

  it("should search from root when path is empty", () => {
    const manifest = createManifest(["cat.jpg", "train/dog.jpg", "test/bird.jpg"]);

    const result = searchByExtension(manifest, "", "jpg");

    expect(result.files).toHaveLength(3);
    expect(result.capped).toBe(false);
  });

  it("should stop scanning when leaving path subtree", () => {
    const manifest = createManifest(["aaa/file.jpg", "bbb/file.jpg", "ccc/file.jpg"]);

    const result = searchByExtension(manifest, "aaa", "jpg");

    expect(result.files).toHaveLength(1);
    expect(result.files[0].relativePath).toBe("aaa/file.jpg");
    expect(result.capped).toBe(false);
  });

  it("should cap results at 500 and set capped flag", () => {
    const paths = Array.from({ length: 600 }, (_, i) => `train/file${String(i).padStart(4, "0")}.jpg`);
    const manifest = createManifest(paths);

    const result = searchByExtension(manifest, "", "jpg");

    expect(result.files).toHaveLength(500);
    expect(result.capped).toBe(true);
  });

  it("should transform raw items to DatasetFile format", () => {
    const manifest = createManifest(["train/image.png"]);

    const result = searchByExtension(manifest, "", "png");

    expect(result.files[0]).toEqual({
      name: "image.png",
      type: "file",
      size: 100,
      checksum: "etag-train/image.png",
      url: "https://example.com/train/image.png",
      relativePath: "train/image.png",
      storagePath: "s3://bucket/train/image.png",
    });
  });
});
