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
 * Dataset manifest search utilities.
 *
 * Provides O(log n + k) recursive file search over ProcessedManifest using
 * binary search on pre-sorted arrays. Two modes auto-detected from the search term:
 * - term contains "/" → full path-prefix search on byPath
 * - term without "/" → filename-prefix search on byFilename, filtered to current path
 *
 * Results are capped at RESULT_LIMIT to bound worst-case scan time.
 */

import { binarySearchByPath } from "@/lib/api/adapter/datasets";
import type { DatasetFile, ProcessedManifest, RawFileItem } from "@/lib/api/adapter/datasets";

// =============================================================================
// Constants
// =============================================================================

const RESULT_LIMIT = 500;

// =============================================================================
// Types
// =============================================================================

export interface ManifestSearchResult {
  files: DatasetFile[];
  capped: boolean;
}

// =============================================================================
// Binary search helpers
// =============================================================================

function binarySearchByFilename(sorted: readonly { name: string; item: RawFileItem }[], prefix: string): number {
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid].name < prefix) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// =============================================================================
// Helpers
// =============================================================================

function rawToDatasetFile(raw: RawFileItem): DatasetFile {
  const name = raw.relative_path.split("/").pop() ?? raw.relative_path;
  return {
    name,
    type: "file",
    size: raw.size,
    checksum: raw.etag,
    url: raw.url,
    relativePath: raw.relative_path,
    storagePath: raw.storage_path,
  };
}

// =============================================================================
// Search modes
// =============================================================================

function searchByPath(byPath: readonly RawFileItem[], pathPrefix: string, termLower: string): ManifestSearchResult {
  const fullPrefix = pathPrefix + termLower;
  const start = binarySearchByPath(byPath, fullPrefix);
  const files: DatasetFile[] = [];
  let capped = false;

  for (let i = start; i < byPath.length; i++) {
    const item = byPath[i];
    if (!item.relative_path.startsWith(fullPrefix)) break;
    if (files.length >= RESULT_LIMIT) {
      capped = true;
      break;
    }
    files.push(rawToDatasetFile(item));
  }

  return { files, capped };
}

function searchByFilename(
  byFilename: readonly { name: string; item: RawFileItem }[],
  pathPrefix: string,
  termLower: string,
): ManifestSearchResult {
  const start = binarySearchByFilename(byFilename, termLower);
  const files: DatasetFile[] = [];
  let capped = false;

  for (let i = start; i < byFilename.length; i++) {
    const { name, item } = byFilename[i];
    if (!name.startsWith(termLower)) break;
    if (pathPrefix && !item.relative_path.startsWith(pathPrefix)) continue;
    if (files.length >= RESULT_LIMIT) {
      capped = true;
      break;
    }
    files.push(rawToDatasetFile(item));
  }

  return { files, capped };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Search a manifest for files matching the given term within the current path subtree.
 *
 * Auto-detects search mode:
 * - term contains "/" → path-prefix search (e.g. "train/img" matches "train/img001.jpg")
 * - term without "/" → filename-prefix search (e.g. "img" matches any file named "img*.ext")
 *
 * Results are a flat list of DatasetFile entries (all type="file", with relativePath set).
 * At most RESULT_LIMIT (500) results are returned; capped=true indicates truncation.
 *
 * @param manifest - ProcessedManifest from useDatasetFiles
 * @param path - Current directory path (empty string = root of the dataset/member)
 * @param term - Raw search term (case-insensitive matching applied internally)
 */
export function searchManifest(manifest: ProcessedManifest, path: string, term: string): ManifestSearchResult {
  const termLower = term.toLowerCase();
  const pathPrefix = path ? `${path}/` : "";

  if (term.includes("/")) {
    return searchByPath(manifest.byPath, pathPrefix, termLower);
  }

  return searchByFilename(manifest.byFilename, pathPrefix, termLower);
}

/**
 * Search a manifest for files with the given extension within the current path subtree.
 *
 * Scans `byPath` from the binary-searched start position for the current path prefix,
 * collecting files whose name ends with `.{extension}` (case-insensitive).
 * Capped at RESULT_LIMIT (500) results.
 *
 * @param manifest - ProcessedManifest from useDatasetFiles
 * @param path - Current directory path (empty string = root)
 * @param extension - File extension without dot (e.g. "png", "csv")
 */
export function searchByExtension(manifest: ProcessedManifest, path: string, extension: string): ManifestSearchResult {
  const pathPrefix = path ? `${path}/` : "";
  const start = pathPrefix ? binarySearchByPath(manifest.byPath, pathPrefix) : 0;
  const suffix = `.${extension.toLowerCase()}`;
  const files: DatasetFile[] = [];
  let capped = false;

  for (let i = start; i < manifest.byPath.length; i++) {
    const item = manifest.byPath[i];
    if (pathPrefix && !item.relative_path.startsWith(pathPrefix)) break;
    if (!item.relative_path.toLowerCase().endsWith(suffix)) continue;
    if (files.length >= RESULT_LIMIT) {
      capped = true;
      break;
    }
    files.push(rawToDatasetFile(item));
  }

  return { files, capped };
}
