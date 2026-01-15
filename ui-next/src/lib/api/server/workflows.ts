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
 * Server-Side Workflow Fetching
 *
 * Fetch workflows data on the server for SSR/RSC.
 * Uses React's cache() for request deduplication.
 */

import { cache } from "react";
import { QueryClient } from "@tanstack/react-query";
import {
  getServerApiBaseUrl,
  getServerFetchHeaders,
  handleResponse,
  DEFAULT_REVALIDATE,
  type ServerFetchOptions,
} from "./config";
import { normalizeWorkflowTimestamps } from "../adapter/utils";
import type {
  WorkflowQueryResponse,
  SrcServiceCoreWorkflowObjectsListResponse,
  WorkflowPriority,
  WorkflowStatus,
} from "../generated";

/** Type alias for better readability */
type WorkflowsListResponse = SrcServiceCoreWorkflowObjectsListResponse;

// =============================================================================
// Types
// =============================================================================

export interface WorkflowsQueryParams {
  /** Filter by status (can specify multiple) */
  status?: WorkflowStatus[];
  /** Filter by priority */
  priority?: WorkflowPriority;
  /** Filter by pool */
  pool?: string;
  /** Search term for workflow name */
  search?: string;
  /** Max results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// =============================================================================
// Fetch Functions
// =============================================================================

/**
 * Fetch workflows list from the server.
 *
 * Uses React's cache() for request deduplication within a single render.
 *
 * @param params - Query parameters for filtering
 * @param options - Fetch options (revalidate, tags)
 * @returns Workflows list response
 */
export const fetchWorkflows = cache(
  async (params: WorkflowsQueryParams = {}, options: ServerFetchOptions = {}): Promise<WorkflowsListResponse> => {
    const { revalidate = DEFAULT_REVALIDATE, tags = ["workflows"] } = options;

    const baseUrl = getServerApiBaseUrl();
    const headers = await getServerFetchHeaders();

    // Build query string
    const queryParams = new URLSearchParams();
    if (params.status) {
      params.status.forEach((s) => queryParams.append("status", s));
    }
    if (params.priority) {
      queryParams.append("priority", params.priority);
    }
    if (params.pool) {
      queryParams.append("pool", params.pool);
    }
    if (params.search) {
      queryParams.append("search", params.search);
    }
    if (params.limit !== undefined) {
      queryParams.append("limit", String(params.limit));
    }
    if (params.offset !== undefined) {
      queryParams.append("offset", String(params.offset));
    }

    const queryString = queryParams.toString();
    const url = `${baseUrl}/api/workflows${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(url, {
      headers,
      next: {
        revalidate,
        tags,
      },
    });

    const rawData = await handleResponse<unknown>(response, url);

    // Parse string response if needed (backend quirk)
    const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

    return parsed as WorkflowsListResponse;
  },
);

/**
 * Fetch a single workflow by name.
 *
 * @param name - Workflow name
 * @param verbose - Whether to include full task details
 * @param options - Fetch options
 * @returns Workflow data or null if not found
 */
export const fetchWorkflowByName = cache(
  async (name: string, verbose = true, options: ServerFetchOptions = {}): Promise<WorkflowQueryResponse | null> => {
    const { revalidate = DEFAULT_REVALIDATE, tags = ["workflows", `workflow-${name}`] } = options;

    const baseUrl = getServerApiBaseUrl();
    const headers = await getServerFetchHeaders();
    const url = `${baseUrl}/api/workflow/${encodeURIComponent(name)}?verbose=${verbose}`;

    const response = await fetch(url, {
      headers,
      next: {
        revalidate,
        tags,
      },
    });

    if (response.status === 404) {
      return null;
    }

    const rawData = await handleResponse<unknown>(response, url);

    // Parse string response if needed (backend quirk)
    const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

    // Normalize timestamps at the API boundary
    return normalizeWorkflowTimestamps(parsed) as WorkflowQueryResponse;
  },
);

// =============================================================================
// Prefetch for TanStack Query Hydration
// =============================================================================

/**
 * Prefetch workflows into a QueryClient for hydration.
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param params - Query parameters
 * @param options - Fetch options
 */
export async function prefetchWorkflows(
  queryClient: QueryClient,
  params: WorkflowsQueryParams = {},
  options: ServerFetchOptions = {},
): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: ["workflows", params],
    queryFn: () => fetchWorkflows(params, options),
  });
}
