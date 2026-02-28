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
 * Hook for fetching dataset or collection detail data.
 *
 * Returns `detail` as a discriminated union — callers narrow via `detail.type`.
 */

"use client";

import { useDataset } from "@/lib/api/adapter/datasets-hooks";

export function useDatasetDetail(bucket: string, name: string) {
  const { data, isLoading, error, refetch } = useDataset(bucket, name);

  return {
    detail: data,
    isLoading,
    error,
    refetch,
  };
}
