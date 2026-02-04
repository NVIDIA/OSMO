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
 * Plain Text Log Adapter
 *
 * Stateless adapter for the OSMO backend that returns plain text logs.
 * Caching is handled by React Query at the hook level.
 */

import type { LogAdapter, LogDataResult, AdapterCapabilities } from "../types";
import { PLAIN_TEXT_ADAPTER_CAPABILITIES, LOG_QUERY_DEFAULTS, FACETABLE_FIELDS } from "../constants";
import { parseLogBatch } from "./log-parser";
import { filterEntries, computeHistogram, computeFacets, type FilterParams } from "./compute";

export interface PlainTextAdapterConfig {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export interface QueryAllParams {
  workflowId: string;
  groupId?: string;
  taskId?: string;
  levels?: FilterParams["levels"];
  tasks?: FilterParams["tasks"];
  retries?: FilterParams["retries"];
  sources?: FilterParams["sources"];
  search?: string;
  searchRegex?: boolean;
  start?: Date;
  end?: Date;
  histogramBuckets?: number;
  facetFields?: string[];
}

/**
 * Stateless adapter for plain text logs from the OSMO backend.
 * Fetches and processes logs on every call - caching handled by React Query.
 */
export class PlainTextAdapter implements LogAdapter {
  readonly capabilities: AdapterCapabilities;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: PlainTextAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? "";
    this.fetchFn = config.fetchFn ?? fetch.bind(globalThis);
    this.capabilities = { ...PLAIN_TEXT_ADAPTER_CAPABILITIES };
  }

  /**
   * Fetches and returns all log data in a single call.
   * Returns entries, histogram, and facets together for efficient caching.
   */
  async queryAll(params: QueryAllParams, signal?: AbortSignal): Promise<LogDataResult> {
    const logText = await this.fetchLogs(params.workflowId, params.groupId, params.taskId, signal);
    const allEntries = parseLogBatch(logText, params.workflowId);

    if (signal?.aborted) {
      throw new Error("Log processing aborted");
    }

    const filterParams: FilterParams = {
      levels: params.levels,
      tasks: params.tasks,
      retries: params.retries,
      sources: params.sources,
      search: params.search,
      searchRegex: params.searchRegex,
      start: params.start,
      end: params.end,
    };

    const filteredEntries = filterEntries(allEntries, filterParams);
    const histogram = computeHistogram(allEntries, params.histogramBuckets ?? LOG_QUERY_DEFAULTS.HISTOGRAM_BUCKETS);
    const facets = computeFacets(allEntries, params.facetFields ?? FACETABLE_FIELDS);

    return {
      entries: filteredEntries,
      histogram,
      facets,
      stats: {
        totalCount: allEntries.length,
        filteredCount: filteredEntries.length,
      },
    };
  }

  private async fetchLogs(
    workflowId: string,
    groupId?: string,
    taskId?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const urlParams = new URLSearchParams();
    if (groupId) urlParams.set("group_id", groupId);
    if (taskId) urlParams.set("task_id", taskId);

    const queryString = urlParams.toString();
    const url = `${this.baseUrl}/api/workflow/${encodeURIComponent(workflowId)}/logs${queryString ? `?${queryString}` : ""}`;

    const response = await this.fetchFn(url, {
      method: "GET",
      headers: { Accept: "text/plain" },
      signal,
      credentials: "include", // Forward cookies (Envoy session) for authentication
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }
}
