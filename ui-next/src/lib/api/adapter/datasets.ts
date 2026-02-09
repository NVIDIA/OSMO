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
  path: string;
  version: number;
  created_at: string;
  updated_at: string;
  /** Size in bytes (backend may return string, we ensure number) */
  size_bytes: number;
  /** Number of files (backend may return string, we ensure number) */
  num_files: number;
  format: string;
  labels: Record<string, string>;
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

interface RawDataset {
  name: string;
  bucket: string;
  path: string;
  version: number;
  created_at: string;
  updated_at: string;
  size_bytes: number | string; // Backend may return string
  num_files: number | string; // Backend may return string
  format: string;
  labels: Record<string, string>;
  retention_policy?: string;
  description?: string;
}

interface RawDatasetListResponse {
  entries: RawDataset[];
  total: number;
}

interface RawDatasetDetailResponse extends RawDataset {
  versions: DatasetVersion[];
}

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
 * Transform raw dataset to UI type.
 * Fixes backend quirks (string→number for size_bytes, num_files).
 */
export function transformDataset(raw: RawDataset): Dataset {
  return {
    ...raw,
    size_bytes: ensureNumber(raw.size_bytes),
    num_files: ensureNumber(raw.num_files),
  };
}

/**
 * Transform raw dataset list response.
 */
export function transformDatasetList(raw: RawDatasetListResponse): Dataset[] {
  return raw.entries.map(transformDataset);
}

/**
 * Transform raw dataset detail response (dataset + versions).
 */
export function transformDatasetDetail(raw: RawDatasetDetailResponse): DatasetDetailResponse {
  const { versions, ...datasetData } = raw;
  return {
    dataset: transformDataset(datasetData),
    versions,
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

  // Build query params
  const queryParams = new URLSearchParams();
  queryParams.set("offset", offset.toString());
  queryParams.set("limit", limit.toString());

  if (formatChips.length > 0) {
    formatChips.forEach((f) => queryParams.append("format", f));
  }
  if (bucketChips.length > 0) {
    bucketChips.forEach((b) => queryParams.append("bucket", b));
  }
  if (searchTerm) {
    queryParams.set("search", searchTerm);
  }

  // Import generated client
  const { listDatasetApiBucketListDatasetGet } = await import("@/lib/api/generated");

  // Fetch from API
  const response = await listDatasetApiBucketListDatasetGet({
    offset,
    limit,
  });

  // Parse response (backend may return string or object)
  const parsed: RawDatasetListResponse =
    typeof response === "string" ? JSON.parse(response) : (response as RawDatasetListResponse);

  const datasets = transformDatasetList(parsed);

  // Calculate hasMore
  const hasMore = datasets.length === limit;

  return {
    items: datasets,
    hasMore,
    nextOffset: hasMore ? offset + limit : undefined,
    total: parsed.total,
    filteredTotal: parsed.total, // Backend doesn't distinguish, use same value
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
  const { getDatasetInfoApiBucketBucketDatasetNameInfoGet } = await import("@/lib/api/generated");

  // Fetch from API
  const response = await getDatasetInfoApiBucketBucketDatasetNameInfoGet(bucket, name);

  // Parse response
  const parsed: RawDatasetDetailResponse =
    typeof response === "string" ? JSON.parse(response) : (response as RawDatasetDetailResponse);

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
  const { getDatasetInfoApiBucketBucketDatasetNameInfoGet } = await import("@/lib/api/generated");

  // Fetch from API with path param
  // The mock handler supports ?path=X to return files at that path
  const response = await getDatasetInfoApiBucketBucketDatasetNameInfoGet(bucket, name, {
    path,
  });

  // Parse response
  const parsed: RawDatasetDetailResponse & { files?: DatasetFile[] } =
    typeof response === "string" ? JSON.parse(response) : (response as RawDatasetDetailResponse & { files?: DatasetFile[] });

  return {
    files: parsed.files || [],
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
