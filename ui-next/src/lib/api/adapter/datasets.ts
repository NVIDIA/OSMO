//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

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
  path?: string;
  version?: number;
  created_at: string;
  created_by?: string;
  updated_at: string;
  /** Size in bytes (backend may return string, we ensure number) */
  size_bytes: number;
  /** Number of files (backend may return string, we ensure number) */
  num_files: number;
  format: string;
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
 * Dataset file entry for file browser.
 */
export interface DatasetFile {
  name: string;
  type: "file" | "folder";
  size?: number;
  modified?: string;
  checksum?: string;
}

/**
 * Response from dataset detail endpoint (includes versions).
 */
export interface DatasetDetailResponse {
  dataset: Dataset;
  versions: DatasetVersion[];
}

/**
 * Response from file listing endpoint.
 */
export interface DatasetFilesResponse {
  files: DatasetFile[];
  path: string;
}

// =============================================================================
// Raw API Types (backend response shapes)
// =============================================================================

// Import actual types from generated client
import type {
  DataListEntry,
  DataListResponse,
  DataInfoResponse,
  DataInfoDatasetEntry,
  DatasetType,
} from "@/lib/api/generated";

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
    path: "", // Not available in list view
    version,
    created_at: raw.create_time,
    created_by: undefined, // Not available in list view
    updated_at: raw.last_created || raw.create_time,
    size_bytes: ensureNumber(raw.hash_location_size),
    num_files: 0, // Not available in list view (backend doesn't provide)
    format: raw.type, // Using type as format for now
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

export function transformDatasetDetail(raw: DataInfoResponse): DatasetDetailResponse {
  // Convert labels to Record<string, string>
  const labels: Record<string, string> = {};
  if (raw.labels) {
    for (const [key, value] of Object.entries(raw.labels)) {
      labels[key] = String(value);
    }
  }

  // Filter versions to only include dataset entries (not collections)
  const datasetVersions = (raw.versions || []).filter(isDatasetEntry);

  // Find highest version number (current version)
  const currentVersionNumber =
    datasetVersions.length > 0 ? Math.max(...datasetVersions.map((v) => parseInt(v.version, 10))) : 0;

  // Find the latest version entry (for metadata)
  const latestVersion = datasetVersions.find((v) => parseInt(v.version, 10) === currentVersionNumber) || null;

  return {
    dataset: {
      id: raw.id,
      name: raw.name,
      bucket: raw.bucket,
      path: raw.hash_location || "",
      version: currentVersionNumber,
      created_at: raw.created_date || "",
      created_by: raw.created_by,
      updated_at: latestVersion?.created_date || raw.created_date || "",
      size_bytes: ensureNumber(raw.hash_location_size),
      num_files: 0, // Not in DataInfoResponse
      format: raw.type,
      labels,
    },
    // Return filtered versions array (only dataset entries)
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
  dataset_type?: DatasetType;
  all_users?: boolean;
  count: number;
} {
  // Note: "format" in UI (parquet, arrow, etc.) is different from backend's dataset_type (DATASET, COLLECTION)
  // For now, we don't pass format to backend - will need client-side filtering for format
  const bucketChips = getChipValues(chips, "bucket");
  const userChips = getChipValues(chips, "user");
  const searchTerm = getFirstChipValue(chips, "name");

  return {
    count: limit,
    name: searchTerm,
    buckets: bucketChips.length > 0 ? bucketChips : undefined,
    // dataset_type is DATASET or COLLECTION, not file format - omit for now
    dataset_type: undefined,
    user: userChips.length > 0 ? userChips : undefined,
    all_users: showAllUsers,
  };
}

// =============================================================================
// API Fetch Functions
// =============================================================================

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
  const parsed: DataListResponse = typeof response === "string" ? JSON.parse(response) : (response as DataListResponse);

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
export async function fetchDatasetDetail(bucket: string, name: string): Promise<DatasetDetailResponse> {
  // Import generated client
  const { getInfoApiBucketBucketDatasetNameInfoGet } = await import("@/lib/api/generated");

  // Fetch from API
  const response = await getInfoApiBucketBucketDatasetNameInfoGet(bucket, name);

  // Parse response
  const parsed: DataInfoResponse = typeof response === "string" ? JSON.parse(response) : (response as DataInfoResponse);

  return transformDatasetDetail(parsed);
}

/**
 * Fetch files for a dataset at a specific path.
 *
 * @param bucket - Bucket name
 * @param name - Dataset name
 * @param path - Path within dataset (optional, defaults to root)
 */
export async function fetchDatasetFiles(
  bucket: string,
  name: string,
  path: string = "/",
): Promise<DatasetFilesResponse> {
  // Import generated client
  const { getInfoApiBucketBucketDatasetNameInfoGet } = await import("@/lib/api/generated");

  // Fetch from API
  // Note: The API may not support file listing at specific paths yet
  const _response = await getInfoApiBucketBucketDatasetNameInfoGet(bucket, name);

  // Parse response - for now, return empty files as API doesn't support this yet
  return {
    files: [],
    path,
  };
}

// =============================================================================
// Query Key Builders
// =============================================================================

/**
 * Build a stable query key for datasets list.
 * Changes to this key reset pagination.
 * Follows workflows pattern.
 */
export function buildDatasetsQueryKey(searchChips: SearchChip[], showAllUsers: boolean = false): readonly unknown[] {
  // Extract filter values by field
  const formats = getChipValues(searchChips, "format").sort();
  const buckets = getChipValues(searchChips, "bucket").sort();
  const users = getChipValues(searchChips, "user").sort();
  const search = getFirstChipValue(searchChips, "name");

  // Build query key - only include filters that have values
  const filters: Record<string, string | string[] | boolean> = {};
  if (search) filters.search = search;
  if (formats.length > 0) filters.formats = formats;
  if (buckets.length > 0) filters.buckets = buckets;
  if (users.length > 0) filters.users = users;
  filters.showAllUsers = showAllUsers;

  return ["datasets", "paginated", filters] as const;
}

/**
 * Build query key for dataset detail.
 */
export function buildDatasetDetailQueryKey(bucket: string, name: string): readonly unknown[] {
  return ["datasets", "detail", bucket, name] as const;
}

/**
 * Build query key for dataset files at a path.
 */
export function buildDatasetFilesQueryKey(bucket: string, name: string, path: string): readonly unknown[] {
  return ["datasets", "files", bucket, name, path] as const;
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
