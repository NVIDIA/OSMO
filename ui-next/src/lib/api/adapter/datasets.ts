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
 * Provides hooks for fetching datasets with pagination, detail, versions, and file listings.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import type { PaginatedResponse, PaginationParams } from "@/lib/api/pagination/types";
import type { SearchChip } from "@/stores/types";

// =============================================================================
// Types
// =============================================================================

/**
 * Dataset metadata (UI type with fixes for backend quirks).
 */
export interface Dataset {
  name: string;
  bucket: string;
  path?: string;
  version?: number;
  created_at: string;
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
 * Dataset version entry.
 */
export interface DatasetVersion {
  version: number;
  created_at: string;
  size_bytes: number;
  num_files: number;
  commit_message?: string;
  created_by: string;
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

/**
 * Filter parameters for datasets list.
 */
export interface DatasetFilterParams {
  /** Search chips from FilterBar */
  searchChips: SearchChip[];
}

// =============================================================================
// Raw API Types (backend response shapes)
// =============================================================================

// Import actual types from generated client
import type { DataListEntry, DataListResponse, DataInfoResponse } from "@/lib/api/generated";

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
  return {
    name: raw.name,
    bucket: raw.bucket,
    path: "", // Not available in list view
    version: 0, // Not available in list view - use version_id?
    created_at: raw.create_time,
    updated_at: raw.last_created || raw.create_time,
    size_bytes: ensureNumber(raw.hash_location_size),
    num_files: 0, // Not available in list view
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
export function transformDatasetDetail(raw: DataInfoResponse): DatasetDetailResponse {
  const { versions: _versions, ...datasetData } = raw;

  // Convert labels to Record<string, string>
  const labels: Record<string, string> = {};
  if (datasetData.labels) {
    for (const [key, value] of Object.entries(datasetData.labels)) {
      labels[key] = String(value);
    }
  }

  return {
    dataset: {
      name: datasetData.name,
      bucket: datasetData.bucket,
      path: "", // Not in DataInfoResponse
      version: 0, // Not in DataInfoResponse directly
      created_at: datasetData.created_date || "",
      updated_at: datasetData.created_date || "",
      size_bytes: ensureNumber(datasetData.hash_location_size),
      num_files: 0, // Not in DataInfoResponse
      format: datasetData.type,
      labels,
    },
    // Simplified versions - the actual API response doesn't match our DatasetVersion type
    // For now, return empty array until we understand the actual version structure
    versions: [],
  };
}

// =============================================================================
// API Fetch Functions
// =============================================================================

/**
 * Fetch paginated datasets with server-side filtering.
 *
 * @param params - Pagination and filter parameters
 */
export async function fetchPaginatedDatasets(
  params: PaginationParams & DatasetFilterParams,
): Promise<PaginatedResponse<Dataset>> {
  const { offset = 0, limit, searchChips } = params;

  // Extract filter values from chips
  const formatChips = getChipValues(searchChips, "format");
  const bucketChips = getChipValues(searchChips, "bucket");
  const searchTerm = getFirstChipValue(searchChips, "name");

  // Import generated client
  const { listDatasetFromBucketApiBucketListDatasetGet } = await import("@/lib/api/generated");

  // Fetch from API - note: the API doesn't use offset/limit in the standard way
  // It uses "count" instead of "limit" and no offset parameter
  const response = await listDatasetFromBucketApiBucketListDatasetGet({
    name: searchTerm,
    buckets: bucketChips.length > 0 ? bucketChips : undefined,
    dataset_type: formatChips.length > 0 ? (formatChips[0] as never) : undefined, // API only supports single format
    count: limit,
  });

  // Parse response (backend may return string or object)
  const parsed: DataListResponse = typeof response === "string" ? JSON.parse(response) : (response as DataListResponse);

  const datasets = transformDatasetList(parsed);

  // Calculate hasMore based on whether we got a full page
  // Note: API doesn't support offset-based pagination, so this is a best-effort approach
  const hasMore = datasets.length === limit;

  return {
    items: datasets,
    hasMore,
    nextOffset: hasMore ? offset + limit : undefined,
    // API doesn't provide total or filteredTotal, use undefined
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
 */
export function buildDatasetsQueryKey(searchChips: SearchChip[]): readonly unknown[] {
  // Extract filter values by field
  const formats = getChipValues(searchChips, "format").sort();
  const buckets = getChipValues(searchChips, "bucket").sort();
  const search = getFirstChipValue(searchChips, "name");

  // Build query key - only include filters that have values
  const filters: Record<string, string | string[]> = {};
  if (search) filters.search = search;
  if (formats.length > 0) filters.formats = formats;
  if (buckets.length > 0) filters.buckets = buckets;

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

// =============================================================================
// React Query Hooks
// =============================================================================

/**
 * Hook to fetch dataset detail by name.
 *
 * @param bucket - Bucket name
 * @param name - Dataset name
 * @param options - Query options
 */
export function useDataset(bucket: string, name: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: buildDatasetDetailQueryKey(bucket, name),
    queryFn: () => fetchDatasetDetail(bucket, name),
    enabled: options?.enabled ?? true,
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Hook to fetch dataset files at a specific path.
 *
 * @param bucket - Bucket name
 * @param name - Dataset name
 * @param path - Path within dataset
 * @param options - Query options
 */
export function useDatasetFiles(bucket: string, name: string, path: string = "/", options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: buildDatasetFilesQueryKey(bucket, name, path),
    queryFn: () => fetchDatasetFiles(bucket, name, path),
    enabled: options?.enabled ?? true,
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Check if any filters are active.
 */
export function hasActiveFilters(searchChips: SearchChip[]): boolean {
  return searchChips.length > 0;
}
