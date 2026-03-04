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
 * Datasets API Adapter
 *
 * Transforms backend dataset API responses to UI-friendly types.
 * Provides fetch functions and query key builders that work on both server and client.
 *
 * NOTE: This file does NOT have "use client" so it can be used in server components.
 * React Query hooks (useDataset, useDatasetFiles) are marked with "use client" via the hook itself.
 */

import type { PaginatedResponse, PaginationParams } from "@/lib/api/pagination/types";
import type { SearchChip } from "@/stores/types";

// =============================================================================
// Types
// =============================================================================

/**
 * Dataset metadata (UI type with fixes for backend quirks).
 */
export interface Dataset {
  id: string;
  name: string;
  bucket: string;
  /** DATASET or COLLECTION */
  type: (typeof DatasetType)[keyof typeof DatasetType];
  path?: string;
  version?: number;
  created_at: string;
  created_by?: string;
  updated_at: string;
  /** Size in bytes (backend may return string, we ensure number) */
  size_bytes: number;
  labels?: Record<string, string>;
  retention_policy?: string;
  description?: string;
}

/**
 * Dataset version entry (matches backend DataInfoDatasetEntry).
 */
export interface DatasetVersion {
  name: string;
  version: string;
  status: string;
  created_by: string;
  created_date: string;
  last_used: string;
  retention_policy: number;
  size: number;
  checksum: string;
  location: string;
  uri: string;
  metadata: Record<string, unknown>;
  tags: string[];
  collections: string[];
}

/**
 * Dataset file entry for file browser (used for directory listings).
 * - "file": regular file
 * - "folder": directory
 * - "dataset-member": top-level collection member (shown as navigable dataset entry)
 */
export interface DatasetFile {
  name: string;
  type: "file" | "folder" | "dataset-member";
  /** Display label (used for dataset-member entries, e.g. "imagenet-1k v2") */
  label?: string;
  size?: number;
  modified?: string;
  checksum?: string;
  /** URL to access/preview the file (for public buckets) */
  url?: string;
  /** Path relative to the dataset root (e.g., "train/img1.jpg") */
  relativePath?: string;
  /** Storage path for this file (e.g., "s3://bucket/path/file.txt") */
  storagePath?: string;
}

/**
 * Raw file item from the dataset version's location manifest.
 * The location URL returns a flat list of all files with relative_path fields.
 */
export interface RawFileItem {
  /** Path relative to dataset root, e.g. "train/n00000001/img1.jpg" */
  relative_path: string;
  size?: number;
  etag?: string;
  storage_path?: string;
  /** Direct URL to access/download the file */
  url?: string;
}

/**
 * Processed manifest — built once per location fetch, cached by React Query.
 *
 * - byPath: files sorted ascending by relative_path (enables binary-search directory listing)
 * - byFilename: sorted by lowercase last-segment filename (enables binary-search filename filter)
 * - fileTypes: sorted unique lowercase extensions (for future type filter)
 */
export interface ProcessedManifest {
  byPath: RawFileItem[];
  byFilename: readonly { name: string; item: RawFileItem }[];
  fileTypes: readonly string[];
}

/**
 * Collection member entry (maps to DataInfoCollectionEntry from backend).
 */
export interface CollectionMember {
  /** "{name}:{version}" — used as switcher key */
  id: string;
  name: string;
  version: string;
  location: string;
  uri: string;
  size: number;
}

/**
 * Response from dataset detail endpoint (type discriminant = DATASET).
 */
export interface DatasetDetailResponse {
  type: (typeof DatasetType)["DATASET"];
  dataset: Dataset;
  versions: DatasetVersion[];
}

/**
 * Response from dataset detail endpoint (type discriminant = COLLECTION).
 */
export interface CollectionDetailResponse {
  type: (typeof DatasetType)["COLLECTION"];
  dataset: Dataset;
  members: CollectionMember[];
}

/**
 * Union of dataset and collection detail responses (discriminated by `type`).
 */
export type DetailResponse = DatasetDetailResponse | CollectionDetailResponse;

// =============================================================================
// Raw API Types (backend response shapes)
// =============================================================================

// Import actual types from generated client
import type {
  DataListEntry,
  DataListResponse,
  DataInfoResponse,
  DataInfoDatasetEntry,
  DataInfoCollectionEntry,
} from "@/lib/api/generated";
import { DatasetType } from "@/lib/api/generated";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get all chip values for a specific field.
 */
function getChipValues(chips: SearchChip[], field: string): string[] {
  return chips.filter((c) => c.field === field).map((c) => c.value);
}

/**
 * Get the first chip value for a field (for single-value filters).
 */
function getFirstChipValue(chips: SearchChip[], field: string): string | undefined {
  return chips.find((c) => c.field === field)?.value;
}

/**
 * Ensure number (backend may return strings for numeric fields).
 */
function ensureNumber(value: number | string | undefined): number {
  if (value === undefined || value === null) return 0;
  return typeof value === "string" ? parseInt(value, 10) || 0 : value;
}

// =============================================================================
// Transforms
// =============================================================================

/**
 * Transform raw dataset list entry to UI type.
 * The backend API returns DataListEntry which is simpler than our UI needs.
 */
export function transformDatasetListEntry(raw: DataListEntry): Dataset {
  // Parse version from version_id (e.g., "v1" -> 1, "version-2" -> 2)
  let version = 0;
  if (raw.version_id) {
    const match = raw.version_id.match(/\d+/);
    version = match ? parseInt(match[0], 10) : 0;
  }

  return {
    id: raw.id,
    name: raw.name,
    bucket: raw.bucket,
    type: raw.type,
    path: "", // Not available in list view
    version,
    created_at: raw.create_time,
    created_by: undefined, // Not available in list view
    updated_at: raw.last_created || raw.create_time,
    size_bytes: ensureNumber(raw.hash_location_size),
    labels: {}, // Not available in list view
  };
}

/**
 * Transform raw dataset list response.
 */
export function transformDatasetList(raw: DataListResponse): Dataset[] {
  return raw.datasets.map(transformDatasetListEntry);
}

/**
 * Transform raw dataset detail response (dataset + versions).
 */
/**
 * Type guard to check if a version is a DataInfoDatasetEntry (not a collection).
 */
function isDatasetEntry(version: unknown): version is DataInfoDatasetEntry {
  return (
    typeof version === "object" &&
    version !== null &&
    "status" in version &&
    "created_by" in version &&
    "created_date" in version
  );
}

/**
 * Type guard to check if a version is a DataInfoCollectionEntry (not a dataset).
 */
function isCollectionEntry(version: unknown): version is DataInfoCollectionEntry {
  return typeof version === "object" && version !== null && !("status" in version);
}

export function transformDatasetDetail(raw: DataInfoResponse): DetailResponse {
  // Convert labels to Record<string, string>
  const labels: Record<string, string> = {};
  if (raw.labels) {
    for (const [key, value] of Object.entries(raw.labels)) {
      labels[key] = String(value);
    }
  }

  if (raw.type === DatasetType.COLLECTION) {
    const collectionEntries = (raw.versions || []).filter(isCollectionEntry);
    return {
      type: DatasetType.COLLECTION,
      dataset: {
        id: raw.id,
        name: raw.name,
        bucket: raw.bucket,
        type: DatasetType.COLLECTION,
        path: raw.hash_location || "",
        created_at: raw.created_date || "",
        created_by: raw.created_by,
        updated_at: raw.created_date || "",
        size_bytes: ensureNumber(raw.hash_location_size),
        labels,
      },
      members: collectionEntries.map((e) => ({
        id: `${e.name}:${e.version}`,
        name: e.name,
        version: e.version,
        location: e.location,
        uri: e.uri,
        size: e.size,
      })),
    };
  }

  // DATASET case (default)
  const datasetVersions = (raw.versions || []).filter(isDatasetEntry);

  // Find highest version number (current version)
  const currentVersionNumber =
    datasetVersions.length > 0 ? Math.max(...datasetVersions.map((v) => parseInt(v.version, 10))) : 0;

  // Find the latest version entry (for metadata)
  const latestVersion = datasetVersions.find((v) => parseInt(v.version, 10) === currentVersionNumber) || null;

  return {
    type: DatasetType.DATASET,
    dataset: {
      id: raw.id,
      name: raw.name,
      bucket: raw.bucket,
      type: DatasetType.DATASET,
      path: raw.hash_location || "",
      version: currentVersionNumber,
      created_at: raw.created_date || "",
      created_by: raw.created_by,
      updated_at: latestVersion?.created_date || raw.created_date || "",
      size_bytes: ensureNumber(raw.hash_location_size),
      labels,
    },
    versions: datasetVersions as DatasetVersion[],
  };
}

// =============================================================================
// Types
// =============================================================================

export interface DatasetFilterParams {
  /** Search chips from FilterBar */
  searchChips: SearchChip[];
  /** Show all users' datasets (default: false = current user only) */
  showAllUsers?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build API parameters from search chips and options.
 * Follows workflows pattern for server-side filtering.
 */
function buildApiParams(
  chips: SearchChip[],
  showAllUsers: boolean,
  limit: number,
): {
  name?: string;
  user?: string[];
  buckets?: string[];
  all_users?: boolean;
  count: number;
} {
  const bucketChips = getChipValues(chips, "bucket");
  const userChips = getChipValues(chips, "user");
  const searchTerm = getFirstChipValue(chips, "name");

  return {
    count: limit,
    name: searchTerm,
    buckets: bucketChips.length > 0 ? bucketChips : undefined,
    user: userChips.length > 0 ? userChips : undefined,
    // all_users overrides user filter on the backend — force false when user chips are active
    all_users: userChips.length > 0 ? false : showAllUsers,
  };
}

// =============================================================================
// API Fetch Functions
// =============================================================================

/**
 * Fetch all datasets in a single request with server-side filtering.
 *
 * Uses count: 10_000 to retrieve all datasets at once, bypassing the broken
 * offset-based pagination. Client-side shim (datasets-shim.ts) handles
 * date range filtering and sorting after the fetch.
 *
 * @param showAllUsers - Whether to fetch all users' datasets or just the current user's
 * @param searchChips - Active filter chips (server-side params extracted: name, bucket, user)
 */
export async function fetchAllDatasets(showAllUsers: boolean, searchChips: SearchChip[]): Promise<Dataset[]> {
  const { listDatasetFromBucketApiBucketListDatasetGet } = await import("@/lib/api/generated");

  const apiParams = buildApiParams(searchChips, showAllUsers, 10_000);
  const response = await listDatasetFromBucketApiBucketListDatasetGet(apiParams);

  const rawData = response.data;
  const parsed: DataListResponse = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
  return transformDatasetList(parsed);
}

/**
 * Fetch paginated datasets with server-side filtering.
 *
 * Follows workflows pattern: passes all filter parameters to the backend API.
 * Backend handles filtering and returns filtered results.
 *
 * NOTE: Backend API lacks offset parameter, so pagination only works within
 * the initial fetch. See BACKEND_TODOS.md Issue #23 for details.
 *
 * @param params - Pagination and filter parameters
 */
export async function fetchPaginatedDatasets(
  params: PaginationParams & DatasetFilterParams,
): Promise<PaginatedResponse<Dataset>> {
  const { offset = 0, limit, searchChips, showAllUsers = false } = params;

  // Import generated client
  const { listDatasetFromBucketApiBucketListDatasetGet } = await import("@/lib/api/generated");

  // Build API params from chips (server-side filtering)
  const apiParams = buildApiParams(searchChips, showAllUsers, limit);

  // Fetch from API - backend does the filtering
  const response = await listDatasetFromBucketApiBucketListDatasetGet(apiParams);

  // Parse response (backend may return string or object)
  const rawData = response.data;
  const parsed: DataListResponse = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

  const datasets = transformDatasetList(parsed);

  // Calculate hasMore - since API doesn't support offset, assume no more if less than limit
  const hasMore = datasets.length === limit;

  return {
    items: datasets,
    hasMore,
    nextOffset: hasMore ? offset + limit : undefined,
    // Backend doesn't provide totals
    total: undefined,
    filteredTotal: undefined,
  };
}

/**
 * Fetch dataset detail by name (includes versions).
 *
 * @param bucket - Bucket name
 * @param name - Dataset name
 */
export async function fetchDatasetDetail(bucket: string, name: string): Promise<DetailResponse> {
  // Import generated client
  const { getInfoApiBucketBucketDatasetNameInfoGet } = await import("@/lib/api/generated");

  // Fetch from API
  const response = await getInfoApiBucketBucketDatasetNameInfoGet(bucket, name);

  // Parse response
  const rawData = response.data;
  const parsed: DataInfoResponse = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

  return transformDatasetDetail(parsed);
}

/**
 * Fetch dataset detail with tag=latest for lightweight initial load.
 *
 * For datasets: returns only the version tagged "latest" (1 version instead of all).
 * For collections: tag is ignored server-side; returns all members (same as full call).
 *
 * @param bucket - Bucket name
 * @param name - Dataset name
 */
export async function fetchDatasetDetailLatest(bucket: string, name: string): Promise<DetailResponse> {
  const { getInfoApiBucketBucketDatasetNameInfoGet } = await import("@/lib/api/generated");

  const response = await getInfoApiBucketBucketDatasetNameInfoGet(bucket, name, { tag: "latest" });

  const rawData = response.data;
  const parsed: DataInfoResponse = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

  return transformDatasetDetail(parsed);
}

/**
 * Fetch all files for a dataset version from the version's location URL.
 *
 * Fetches the raw flat manifest, then builds a ProcessedManifest with three
 * sorted/indexed structures for O(log n) directory listing and file search.
 * The result is cached by React Query — the O(n log n) sort happens once.
 *
 * Returns an empty ProcessedManifest if no location URL is provided.
 *
 * @param location - The version's location URL (DatasetVersion.location)
 */
export async function fetchDatasetFiles(location: string | null): Promise<ProcessedManifest> {
  if (!location) return { byPath: [], byFilename: [], fileTypes: [] };
  const { fetchManifest } = await import("@/lib/api/server/dataset-actions");
  const items = (await fetchManifest(location)) as RawFileItem[];

  // Sort by full relative_path — enables binary-search directory listing
  const byPath = [...items].sort((a, b) => a.relative_path.localeCompare(b.relative_path));

  // Build filename index sorted by lowercase last-segment name — enables binary-search filename filter
  const byFilename = byPath
    .map((item) => ({ name: item.relative_path.split("/").pop()?.toLowerCase() ?? "", item }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Collect unique lowercase extensions for future type filter
  const extSet = new Set<string>();
  for (const item of byPath) {
    const ext = item.relative_path.split(".").pop()?.toLowerCase();
    if (ext) extSet.add(ext);
  }
  const fileTypes = [...extSet].sort();

  return { byPath, byFilename, fileTypes };
}

/**
 * Binary search lower bound: first index where items[i].relative_path >= prefix.
 * Requires items sorted ascending by relative_path.
 */
export function binarySearchByPath(sorted: readonly RawFileItem[], prefix: string): number {
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid].relative_path < prefix) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Build a directory listing for a specific path from the sorted flat file list.
 *
 * Accepts the `byPath` array from ProcessedManifest (sorted by relative_path).
 * For non-root paths uses binary search to skip to the right prefix range — O(log n + k)
 * where k = entries directly under that path. Root level is always O(n).
 *
 * Returns folders before files; both groups sorted alphabetically.
 *
 * @param items - Sorted flat file list (ProcessedManifest.byPath)
 * @param path - Current directory path (empty string = root)
 */
export function buildDirectoryListing(items: RawFileItem[], path: string): DatasetFile[] {
  const prefix = path ? `${path}/` : "";
  const seenFolders = new Set<string>();
  const result: DatasetFile[] = [];

  const start = prefix ? binarySearchByPath(items, prefix) : 0;

  for (let i = start; i < items.length; i++) {
    const { relative_path, size, etag, url, storage_path } = items[i];
    if (prefix && !relative_path.startsWith(prefix)) break;

    const rest = relative_path.slice(prefix.length);
    const slashIndex = rest.indexOf("/");

    if (slashIndex === -1) {
      result.push({
        name: rest,
        type: "file",
        size,
        checksum: etag,
        url,
        relativePath: relative_path,
        storagePath: storage_path,
      });
    } else {
      const folderName = rest.slice(0, slashIndex);
      if (!seenFolders.has(folderName)) {
        seenFolders.add(folderName);
        result.push({ name: folderName, type: "folder" });
      }
    }
  }

  // Folders first, then files; each group sorted alphabetically
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// =============================================================================
// Query Key Builders
// =============================================================================

/**
 * Build a stable query key for the all-datasets fetch.
 *
 * Only includes server-side filter params (name, bucket, user, showAllUsers).
 * Client-side filters (created_at, updated_at) are intentionally excluded so
 * they don't trigger new API calls — the shim handles them from the cache.
 */
function buildDatasetFilters(
  searchChips: SearchChip[],
  showAllUsers: boolean,
): Record<string, string | string[] | boolean> {
  const buckets = getChipValues(searchChips, "bucket").sort();
  const users = getChipValues(searchChips, "user").sort();
  const search = getFirstChipValue(searchChips, "name");
  const filters: Record<string, string | string[] | boolean> = {};
  if (search) filters.search = search;
  if (buckets.length > 0) filters.buckets = buckets;
  if (users.length > 0) filters.users = users;
  filters.showAllUsers = showAllUsers;
  return filters;
}

export function buildAllDatasetsQueryKey(searchChips: SearchChip[], showAllUsers: boolean = false): readonly unknown[] {
  return ["datasets", "all", buildDatasetFilters(searchChips, showAllUsers)] as const;
}

/**
 * Build a stable query key for datasets list.
 * Changes to this key reset pagination.
 * Follows workflows pattern.
 */
export function buildDatasetsQueryKey(searchChips: SearchChip[], showAllUsers: boolean = false): readonly unknown[] {
  return ["datasets", "paginated", buildDatasetFilters(searchChips, showAllUsers)] as const;
}

/**
 * Build query key for dataset detail.
 */
export function buildDatasetDetailQueryKey(bucket: string, name: string): readonly unknown[] {
  return ["datasets", "detail", bucket, name] as const;
}

/**
 * Build query key for dataset detail (latest version only).
 * Separate cache entry from the full detail query so the lightweight call
 * doesn't interfere with the all-versions fetch.
 */
export function buildDatasetLatestQueryKey(bucket: string, name: string): readonly unknown[] {
  return ["datasets", "detail", bucket, name, "latest"] as const;
}

/**
 * Build query key for the dataset version's full file manifest.
 * Keyed by location URL only — path filtering is done client-side via buildDirectoryListing.
 */
export function buildDatasetFilesQueryKey(location: string | null): readonly unknown[] {
  return ["datasets", "files", location] as const;
}

/**
 * Check if any filters are active.
 */
export function hasActiveFilters(searchChips: SearchChip[]): boolean {
  return searchChips.length > 0;
}

// =============================================================================
// NOTE: React Query hooks are in datasets-hooks.ts (separate file with "use client")
// =============================================================================
