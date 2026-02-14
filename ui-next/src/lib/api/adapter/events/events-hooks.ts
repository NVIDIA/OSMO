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

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { customFetch } from "@/lib/api/fetcher";
import { parseEventsResponse } from "@/lib/api/adapter/events/events-parser";
import { QUERY_STALE_TIME } from "@/lib/config";
import type { K8sEvent } from "@/lib/api/adapter/events/events-types";

const EMPTY_EVENTS: K8sEvent[] = [];

function buildEventsQueryKey(url: string) {
  return ["events", url] as const;
}

export interface UseEventsParams {
  /** Events URL from workflow/task response (e.g., workflow.events or task.events) */
  url: string;
  enabled?: boolean;
}

export interface UseEventsReturn {
  events: K8sEvent[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch and parse Kubernetes events from a URL.
 *
 * Events are lazily loaded - the hook only fetches when enabled.
 * Use this with conditional rendering (e.g., activeTab === "events") to defer loading.
 *
 * @example
 * ```tsx
 * const { events, isLoading, error } = useEvents({
 *   url: workflow.events,
 *   enabled: activeTab === "events"
 * });
 * ```
 */
export function useEvents(params: UseEventsParams): UseEventsReturn {
  const { url, enabled = true } = params;

  const query = useQuery({
    queryKey: buildEventsQueryKey(url),
    queryFn: async ({ signal }) => {
      // Use customFetch which handles auth, errors, and text/plain responses
      const rawResponse = await customFetch<string>(
        {
          url,
          method: "GET",
          signal,
        },
        {},
      );

      // Parse plain text → structured events
      const textResponse = typeof rawResponse === "string" ? rawResponse : String(rawResponse || "");

      return parseEventsResponse(textResponse);
    },
    enabled: enabled && !!url,
    staleTime: QUERY_STALE_TIME.STANDARD, // 2min - events are historical
  });

  const events = query.data ?? EMPTY_EVENTS;

  return useMemo(
    () => ({
      events,
      isLoading: query.isLoading,
      error: query.error as Error | null,
      refetch: query.refetch,
    }),
    [events, query.isLoading, query.error, query.refetch],
  );
}
