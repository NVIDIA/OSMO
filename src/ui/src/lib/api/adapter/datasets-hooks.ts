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
 * Client-side React Query hooks for datasets.
 *
 * Separated from the main adapter to allow server-side usage of fetch functions
 * and query key builders without "use client" restrictions.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import type { SearchChip } from "@/stores/types";
import {
  buildAllDatasetsQueryKey,
  buildDatasetDetailQueryKey,
  buildDatasetLatestQueryKey,
  buildDatasetFilesQueryKey,
  fetchAllDatasets,
  fetchDatasetDetail,
  fetchDatasetDetailLatest,
  fetchDatasetFiles,
  type ProcessedManifest,
} from "@/lib/api/adapter/datasets";
import { QUERY_STALE_TIME } from "@/lib/config";

/**
 * Hook to fetch all datasets with server-side filtering.
 *
 * Fetches once with count: 10_000 — the shim applies client-side filters
 * (date ranges, sort) from the cache without triggering new API calls.
 *
 * Query key only includes server-side params (name, bucket, user, showAllUsers)
 * so client-side filter changes (created_at, updated_at) use the cached response.
 *
 * @param showAllUsers - Whether to include all users' datasets
 * @param searchChips - Active filter chips (server-side params extracted for query key)
 */
export function useAllDatasets(showAllUsers: boolean, searchChips: SearchChip[]) {
  return useQuery({
    queryKey: buildAllDatasetsQueryKey(searchChips, showAllUsers),
    queryFn: () => fetchAllDatasets(showAllUsers, searchChips),
    staleTime: QUERY_STALE_TIME.STATIC,
  });
}

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
 * Hook to fetch dataset detail with tag=latest for lightweight initial load.
 *
 * For datasets: returns only the version tagged "latest".
 * For collections: returns all members (tag ignored server-side).
 *
 * @param bucket - Bucket name
 * @param name - Dataset name
 * @param options - Query options
 */
export function useDatasetLatest(bucket: string, name: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: buildDatasetLatestQueryKey(bucket, name),
    queryFn: () => fetchDatasetDetailLatest(bucket, name),
    enabled: (options?.enabled ?? true) && !!bucket && !!name,
    staleTime: QUERY_STALE_TIME.STANDARD,
  });
}

/**
 * Hook to fetch all files for a dataset version from its location manifest.
 *
 * Fetches the full flat manifest once per version (keyed by location URL) and
 * returns a ProcessedManifest with pre-sorted arrays for O(log n) directory
 * listing and file search. Use buildDirectoryListing() and searchManifest()
 * from the adapter layer to query the manifest.
 *
 * @param location - The version's location URL (DatasetVersion.location), or null to disable
 * @param options - Query options
 */
export function useDatasetFiles(
  location: string | null,
  options?: { enabled?: boolean },
): ReturnType<typeof useQuery<ProcessedManifest>> {
  return useQuery<ProcessedManifest>({
    queryKey: buildDatasetFilesQueryKey(location),
    queryFn: () => fetchDatasetFiles(location),
    enabled: (options?.enabled ?? true) && !!location,
    staleTime: 60_000, // 1 minute
  });
}
