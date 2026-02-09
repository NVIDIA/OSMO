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
 * Client-side React Query hooks for datasets.
 *
 * Separated from the main adapter to allow server-side usage of fetch functions
 * and query key builders without "use client" restrictions.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import {
  buildDatasetDetailQueryKey,
  buildDatasetFilesQueryKey,
  fetchDatasetDetail,
  fetchDatasetFiles,
} from "@/lib/api/adapter/datasets";

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
