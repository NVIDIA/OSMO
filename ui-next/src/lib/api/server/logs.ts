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

import { cache } from "react";
import { QueryClient } from "@tanstack/react-query";
import { getServerApiBaseUrl, getServerFetchHeaders } from "@/lib/api/server/config";
import { parseLogBatch } from "@/lib/api/log-adapter/adapters/log-parser";
import { computeHistogram, computeFacets } from "@/lib/api/log-adapter/adapters/compute";
import { FACETABLE_FIELDS, LOG_QUERY_DEFAULTS } from "@/lib/api/log-adapter/constants";
import type { LogDataResult } from "@/lib/api/log-adapter/types";
import { createLogDataQueryKey, type LogDataQueryKeyParams } from "@/lib/api/log-adapter/query-keys";

export interface PrefetchLogDataParams {
  workflowId: string;
  histogramBuckets?: number;
  facetFields?: string[];
}

// Dev-only cache for HMR survival (avoids expensive re-parsing during hot reload)
const DEV_CACHE_KEY = "__osmoServerLogCache__";

function getDevCache(): Map<string, LogDataResult> | null {
  if (process.env.NODE_ENV === "production") return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g[DEV_CACHE_KEY]) {
    g[DEV_CACHE_KEY] = new Map<string, LogDataResult>();
  }
  return g[DEV_CACHE_KEY] as Map<string, LogDataResult>;
}

// Dev utility: Clear cache via console
if (typeof globalThis !== "undefined" && process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__clearServerLogCache = () => {
    const devCache = getDevCache();
    const size = devCache?.size ?? 0;
    devCache?.clear();
    console.log(`[Server] Log cache cleared (${size} entries)`);
    return size;
  };
}

/**
 * Fetches log data on the server.
 * Uses React cache() for per-request deduplication.
 * In dev, also uses HMR-surviving cache to avoid expensive re-parsing.
 */
export const fetchLogData = cache(async (params: PrefetchLogDataParams): Promise<LogDataResult> => {
  const buckets = params.histogramBuckets ?? LOG_QUERY_DEFAULTS.HISTOGRAM_BUCKETS;
  const cacheKey = `${params.workflowId}:${buckets}`;

  const devCache = getDevCache();
  const cached = devCache?.get(cacheKey);
  if (cached) return cached;

  const baseUrl = getServerApiBaseUrl();
  const headers = await getServerFetchHeaders();
  const url = `${baseUrl}/api/workflow/${encodeURIComponent(params.workflowId)}/logs`;

  const response = await fetch(url, {
    headers: { ...headers, Accept: "text/plain" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText}`);
  }

  const logText = await response.text();
  const entries = parseLogBatch(logText, params.workflowId);
  const histogram = computeHistogram(entries, buckets);
  const facets = computeFacets(entries, params.facetFields ?? FACETABLE_FIELDS);

  const result: LogDataResult = {
    entries,
    histogram,
    facets,
    stats: {
      totalCount: entries.length,
      filteredCount: entries.length,
    },
  };

  devCache?.set(cacheKey, result);
  return result;
});

/**
 * Prefetch log data into QueryClient for SSR hydration.
 */
export async function prefetchLogData(queryClient: QueryClient, params: PrefetchLogDataParams): Promise<void> {
  const keyParams: LogDataQueryKeyParams = {
    workflowId: params.workflowId,
    histogramBuckets: params.histogramBuckets,
    facetFields: params.facetFields,
  };

  await queryClient.prefetchQuery({
    queryKey: createLogDataQueryKey(keyParams),
    queryFn: () => fetchLogData(params),
  });
}
