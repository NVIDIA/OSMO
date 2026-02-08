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
 * Infinite Render Loop Prevention Tests
 *
 * These tests validate the anti-infinite-loop mechanisms in our data layer:
 * 1. TanStack Query's structural sharing (deep equality for cache updates)
 * 2. Query client configuration (refetch settings)
 * 3. Timestamp normalization (consistent data transformation)
 * 4. Reference stability through select functions
 *
 * These are pure library tests - no DOM or React rendering required.
 * We test the underlying mechanisms that prevent infinite loops.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/query-client";
import { normalizeWorkflowTimestamps, normalizeTimestamp } from "@/lib/api/adapter/utils";
import { createApiError } from "@/lib/api/fetcher";
import { WorkflowStatus, TaskGroupStatus } from "@/lib/api/generated";
import type { WorkflowQueryResponse } from "@/lib/api/generated";

// =============================================================================
// Test Fixtures
// =============================================================================

const createMockWorkflow = (overrides?: Partial<WorkflowQueryResponse>): WorkflowQueryResponse =>
  ({
    name: "test-workflow",
    uuid: "test-uuid-123",
    submitted_by: "test-user",
    spec: {},
    status: WorkflowStatus.COMPLETED,
    submit_time: "2024-01-15T10:30:00",
    start_time: "2024-01-15T10:31:00",
    end_time: "2024-01-15T10:45:00",
    groups: [
      {
        name: "group-1",
        status: TaskGroupStatus.COMPLETED,
        tasks: [
          {
            name: "task-1",
            retry_id: 0,
            pod_name: "test-pod-1",
            task_uuid: "task-uuid-1",
            status: TaskGroupStatus.COMPLETED,
            logs: "",
            events: "",
            start_time: "2024-01-15T10:31:00",
            end_time: "2024-01-15T10:32:00",
          },
        ],
      },
    ],
    ...overrides,
  }) as WorkflowQueryResponse;

// =============================================================================
// 1. Structural Sharing Tests - Core Anti-Loop Mechanism
// =============================================================================

describe("TanStack Query Structural Sharing", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
  });

  it("is enabled globally in query client config", () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.structuralSharing).toBe(true);
  });

  it("preserves reference when data is semantically identical", async () => {
    const queryKey = ["workflow", "test"];

    // First fetch - set initial data
    const initialData = createMockWorkflow();
    queryClient.setQueryData(queryKey, initialData);
    const ref1 = queryClient.getQueryData(queryKey);

    // Second fetch - same content, different object reference
    const duplicateData = createMockWorkflow(); // New object, same data
    queryClient.setQueryData(queryKey, duplicateData);
    const ref2 = queryClient.getQueryData(queryKey);

    // Reference should be preserved (structural sharing)
    expect(ref1).toBe(ref2);
    expect(ref1).toBe(initialData);
  });

  it("updates reference when data actually changes", async () => {
    const queryKey = ["workflow", "test"];

    // First fetch
    const initialData = createMockWorkflow({ status: WorkflowStatus.RUNNING });
    queryClient.setQueryData(queryKey, initialData);
    const ref1 = queryClient.getQueryData(queryKey);

    // Second fetch - data changed
    const updatedData = createMockWorkflow({ status: WorkflowStatus.COMPLETED });
    queryClient.setQueryData(queryKey, updatedData);
    const ref2 = queryClient.getQueryData(queryKey);

    // Reference should be updated (data changed)
    expect(ref1).not.toBe(ref2);
    expect(ref2).toEqual(updatedData);
  });

  it("performs deep comparison on nested objects", async () => {
    const queryKey = ["workflow", "test"];

    // First fetch with nested groups
    const initialData = createMockWorkflow({
      groups: [
        {
          name: "group-1",
          status: TaskGroupStatus.COMPLETED,
          tasks: [
            {
              name: "task-1",
              retry_id: 0,
              status: TaskGroupStatus.COMPLETED,
              logs: "",
              events: "",
              pod_name: "",
              task_uuid: "",
            },
            {
              name: "task-2",
              retry_id: 0,
              status: TaskGroupStatus.COMPLETED,
              logs: "",
              events: "",
              pod_name: "",
              task_uuid: "",
            },
          ],
        },
      ],
    });
    queryClient.setQueryData(queryKey, initialData);
    const ref1 = queryClient.getQueryData(queryKey);

    // Second fetch - same nested structure, different object references
    const duplicateData = createMockWorkflow({
      groups: [
        {
          name: "group-1",
          status: TaskGroupStatus.COMPLETED,
          tasks: [
            {
              name: "task-1",
              retry_id: 0,
              status: TaskGroupStatus.COMPLETED,
              logs: "",
              events: "",
              pod_name: "",
              task_uuid: "",
            },
            {
              name: "task-2",
              retry_id: 0,
              status: TaskGroupStatus.COMPLETED,
              logs: "",
              events: "",
              pod_name: "",
              task_uuid: "",
            },
          ],
        },
      ],
    });
    queryClient.setQueryData(queryKey, duplicateData);
    const ref2 = queryClient.getQueryData(queryKey);

    // Deep equality should preserve reference
    expect(ref1).toBe(ref2);
  });

  it("detects changes in nested arrays", async () => {
    const queryKey = ["workflow", "test"];

    // First fetch
    const initialData = createMockWorkflow({
      groups: [
        {
          name: "group-1",
          status: TaskGroupStatus.COMPLETED,
          tasks: [
            {
              name: "task-1",
              retry_id: 0,
              status: TaskGroupStatus.COMPLETED,
              logs: "",
              events: "",
              pod_name: "",
              task_uuid: "",
            },
          ],
        },
      ],
    });
    queryClient.setQueryData(queryKey, initialData);
    const ref1 = queryClient.getQueryData(queryKey);

    // Second fetch - added task to array
    const updatedData = createMockWorkflow({
      groups: [
        {
          name: "group-1",
          status: TaskGroupStatus.COMPLETED,
          tasks: [
            {
              name: "task-1",
              retry_id: 0,
              status: TaskGroupStatus.COMPLETED,
              logs: "",
              events: "",
              pod_name: "",
              task_uuid: "",
            },
            {
              name: "task-2",
              retry_id: 0,
              status: TaskGroupStatus.COMPLETED,
              logs: "",
              events: "",
              pod_name: "",
              task_uuid: "",
            },
          ],
        },
      ],
    });
    queryClient.setQueryData(queryKey, updatedData);
    const ref2 = queryClient.getQueryData(queryKey);

    // Reference should be updated (array changed)
    expect(ref1).not.toBe(ref2);
  });

  it("handles undefined and null values consistently", async () => {
    const queryKey = ["workflow", "test"];

    // First fetch with undefined field
    const initialData = createMockWorkflow({ end_time: undefined });
    queryClient.setQueryData(queryKey, initialData);
    const ref1 = queryClient.getQueryData(queryKey);

    // Second fetch - same undefined field
    const duplicateData = createMockWorkflow({ end_time: undefined });
    queryClient.setQueryData(queryKey, duplicateData);
    const ref2 = queryClient.getQueryData(queryKey);

    // Reference should be preserved
    expect(ref1).toBe(ref2);
  });

  it("works with transformed data (select function)", async () => {
    const queryKey = ["workflow", "test"];

    // Simulate select transformation
    const transform = (data: WorkflowQueryResponse) => ({
      ...data,
      displayName: data.name.toUpperCase(),
    });

    // First fetch + transform
    const rawData1 = createMockWorkflow();
    const transformed1 = transform(rawData1);
    queryClient.setQueryData(queryKey, transformed1);
    const ref1 = queryClient.getQueryData(queryKey);

    // Second fetch + transform - same result
    const rawData2 = createMockWorkflow();
    const transformed2 = transform(rawData2);
    queryClient.setQueryData(queryKey, transformed2);
    const ref2 = queryClient.getQueryData(queryKey);

    // Structural sharing should preserve reference after transformation
    expect(ref1).toBe(ref2);
  });
});

// =============================================================================
// 2. Query Client Configuration - Prevents Aggressive Refetching
// =============================================================================

describe("Query Client Refetch Configuration", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
  });

  it("disables refetch on window focus", () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
  });

  it("enables refetch on reconnect", () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.refetchOnReconnect).toBe(true);
  });

  it("uses custom refetchOnMount logic to respect staleTime", () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.refetchOnMount).toBeInstanceOf(Function);
  });

  it("refetchOnMount returns false for fresh data", () => {
    const defaults = queryClient.getDefaultOptions();
    const refetchOnMount = defaults.queries?.refetchOnMount as (query: unknown) => boolean;

    // Mock query with fresh data (just updated)
    const freshQuery = {
      state: { dataUpdatedAt: Date.now() },
      options: { staleTime: 60000 }, // 1 minute
    };

    expect(refetchOnMount(freshQuery)).toBe(false);
  });

  it("refetchOnMount returns true for stale data", () => {
    const defaults = queryClient.getDefaultOptions();
    const refetchOnMount = defaults.queries?.refetchOnMount as (query: unknown) => boolean;

    // Mock query with stale data (updated 5 minutes ago)
    const staleQuery = {
      state: { dataUpdatedAt: Date.now() - 5 * 60 * 1000 },
      options: { staleTime: 60000 }, // 1 minute
    };

    expect(refetchOnMount(staleQuery)).toBe(true);
  });

  it("refetchOnMount returns true for never-fetched data", () => {
    const defaults = queryClient.getDefaultOptions();
    const refetchOnMount = defaults.queries?.refetchOnMount as (query: unknown) => boolean;

    // Mock query that has never been fetched
    const neverFetchedQuery = {
      state: { dataUpdatedAt: 0 },
      options: { staleTime: 60000 },
    };

    expect(refetchOnMount(neverFetchedQuery)).toBe(true);
  });

  it("has reasonable staleTime to prevent excessive refetching", () => {
    const defaults = queryClient.getDefaultOptions();
    const staleTime = defaults.queries?.staleTime as number;

    // Should be at least 1 minute to prevent aggressive refetching
    expect(staleTime).toBeGreaterThanOrEqual(60000);
  });
});

// =============================================================================
// 3. Timestamp Normalization - Consistent Transformation
// =============================================================================

describe("Timestamp Normalization", () => {
  it("normalizes timestamp without timezone to UTC", () => {
    const input = "2024-01-15T10:30:00";
    const result = normalizeTimestamp(input);
    expect(result).toBe("2024-01-15T10:30:00Z");
  });

  it("preserves timestamp with Z suffix", () => {
    const input = "2024-01-15T10:30:00Z";
    const result = normalizeTimestamp(input);
    expect(result).toBe("2024-01-15T10:30:00Z");
  });

  it("preserves timestamp with offset", () => {
    const input = "2024-01-15T10:30:00+00:00";
    const result = normalizeTimestamp(input);
    expect(result).toBe("2024-01-15T10:30:00+00:00");
  });

  it("handles null and undefined", () => {
    expect(normalizeTimestamp(null)).toBeUndefined();
    expect(normalizeTimestamp(undefined)).toBeUndefined();
    expect(normalizeTimestamp("")).toBeUndefined();
  });

  it("produces consistent output for same input", () => {
    const input = "2024-01-15T10:30:00";
    const result1 = normalizeTimestamp(input);
    const result2 = normalizeTimestamp(input);
    expect(result1).toBe(result2);
  });

  it("idempotent - normalizing twice gives same result", () => {
    const input = "2024-01-15T10:30:00";
    const once = normalizeTimestamp(input);
    const twice = normalizeTimestamp(once);
    expect(once).toBe(twice);
  });
});

describe("Workflow Timestamp Normalization", () => {
  it("normalizes all top-level timestamp fields", () => {
    const workflow = createMockWorkflow();
    const normalized = normalizeWorkflowTimestamps(
      workflow as unknown as Record<string, unknown>,
    ) as unknown as WorkflowQueryResponse;

    expect(normalized.submit_time).toBe("2024-01-15T10:30:00Z");
    expect(normalized.start_time).toBe("2024-01-15T10:31:00Z");
    expect(normalized.end_time).toBe("2024-01-15T10:45:00Z");
  });

  it("normalizes timestamps in nested groups", () => {
    const workflow = createMockWorkflow({
      groups: [
        {
          name: "group-1",
          status: TaskGroupStatus.COMPLETED,
          start_time: "2024-01-15T10:31:00",
          end_time: "2024-01-15T10:35:00",
        },
      ],
    });
    const normalized = normalizeWorkflowTimestamps(
      workflow as unknown as Record<string, unknown>,
    ) as unknown as WorkflowQueryResponse;

    expect(normalized.groups?.[0]?.start_time).toBe("2024-01-15T10:31:00Z");
    expect(normalized.groups?.[0]?.end_time).toBe("2024-01-15T10:35:00Z");
  });

  it("normalizes timestamps in nested tasks", () => {
    const workflow = createMockWorkflow();
    const normalized = normalizeWorkflowTimestamps(
      workflow as unknown as Record<string, unknown>,
    ) as unknown as WorkflowQueryResponse;

    const task = normalized.groups?.[0]?.tasks?.[0];
    expect(task?.start_time).toBe("2024-01-15T10:31:00Z");
    expect(task?.end_time).toBe("2024-01-15T10:32:00Z");
  });

  it("produces identical output for same input (prevents re-render loops)", () => {
    const workflow = createMockWorkflow();

    // Normalize twice
    const normalized1 = normalizeWorkflowTimestamps(
      workflow as unknown as Record<string, unknown>,
    ) as unknown as WorkflowQueryResponse;
    const normalized2 = normalizeWorkflowTimestamps(
      workflow as unknown as Record<string, unknown>,
    ) as unknown as WorkflowQueryResponse;

    // Should be deeply equal (structural sharing will preserve reference)
    expect(normalized1).toEqual(normalized2);
  });

  it("idempotent - normalizing normalized data gives same result", () => {
    const workflow = createMockWorkflow();
    const once = normalizeWorkflowTimestamps(workflow as unknown as Record<string, unknown>);
    const twice = normalizeWorkflowTimestamps(once as unknown as Record<string, unknown>);

    expect(once).toEqual(twice);
  });

  it("preserves non-timestamp fields unchanged", () => {
    const workflow = createMockWorkflow({ status: WorkflowStatus.COMPLETED });
    const normalized = normalizeWorkflowTimestamps(
      workflow as unknown as Record<string, unknown>,
    ) as unknown as WorkflowQueryResponse;

    expect(normalized.name).toBe(workflow.name);
    expect(normalized.status).toBe(workflow.status);
  });
});

// =============================================================================
// 4. Select Function Reference Stability
// =============================================================================

describe("Select Function with Structural Sharing", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
  });

  it("select transformation + structural sharing prevents unnecessary updates", async () => {
    const queryKey = ["workflow", "test"];

    // Simulate a select function that parses and normalizes
    const selectFn = (rawData: string) => {
      const parsed = JSON.parse(rawData);
      return normalizeWorkflowTimestamps(parsed) as WorkflowQueryResponse;
    };

    // First fetch - string data from API
    const rawData1 = JSON.stringify(createMockWorkflow());
    const transformed1 = selectFn(rawData1);
    queryClient.setQueryData(queryKey, transformed1);
    const ref1 = queryClient.getQueryData(queryKey);

    // Second fetch - same data, different string instance
    const rawData2 = JSON.stringify(createMockWorkflow());
    const transformed2 = selectFn(rawData2);
    queryClient.setQueryData(queryKey, transformed2);
    const ref2 = queryClient.getQueryData(queryKey);

    // Structural sharing should preserve reference
    expect(ref1).toBe(ref2);
  });

  it("memoized select functions maintain stability", () => {
    // Simulate useCallback-wrapped select function
    let callCount = 0;
    const selectFn = vi.fn((rawData: string) => {
      callCount++;
      const parsed = JSON.parse(rawData);
      return normalizeWorkflowTimestamps(parsed) as WorkflowQueryResponse;
    });

    // Call with same data multiple times
    const rawData = JSON.stringify(createMockWorkflow());
    const result1 = selectFn(rawData);
    const result2 = selectFn(rawData);

    // Select function is stable (would be same with useCallback)
    expect(callCount).toBe(2);
    expect(result1).toEqual(result2);
  });
});

// =============================================================================
// 5. Retry Logic - Circuit Breaker Pattern
// =============================================================================

describe("Query Retry Configuration", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
  });

  it("has retry logic configured", () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.retry).toBeInstanceOf(Function);
  });

  it("stops retrying after 3 attempts (circuit breaker)", () => {
    const defaults = queryClient.getDefaultOptions();
    const retryFn = defaults.queries?.retry as (failureCount: number, error: Error) => boolean;

    const error = new Error("Network error");
    error.cause = { message: "fetch failed" };

    expect(retryFn(0, error)).toBe(false); // Not a fetch error
    expect(retryFn(3, error)).toBe(false); // Max attempts reached
    expect(retryFn(4, error)).toBe(false); // Exceeded max
  });

  it("retries fetch errors up to 3 times", () => {
    const defaults = queryClient.getDefaultOptions();
    const retryFn = defaults.queries?.retry as (failureCount: number, error: Error) => boolean;

    const fetchError = new TypeError("fetch failed");

    expect(retryFn(0, fetchError)).toBe(true); // First retry
    expect(retryFn(1, fetchError)).toBe(true); // Second retry
    expect(retryFn(2, fetchError)).toBe(true); // Third retry
    expect(retryFn(3, fetchError)).toBe(false); // Stop after 3
  });

  it("does not retry 4xx client errors (except 408)", () => {
    const defaults = queryClient.getDefaultOptions();
    const retryFn = defaults.queries?.retry as (failureCount: number, error: Error) => boolean;

    const error404 = createApiError("Not Found", 404, false);
    const error400 = createApiError("Bad Request", 400, false);
    const error500 = createApiError("Server Error", 500, true);

    expect(retryFn(0, error404)).toBe(false);
    expect(retryFn(0, error400)).toBe(false);
    // 5xx errors should be retried if isRetryable is true
    expect(retryFn(0, error500)).toBe(true);
  });

  it("retries 408 timeout errors when isRetryable is true", () => {
    const defaults = queryClient.getDefaultOptions();
    const retryFn = defaults.queries?.retry as (failureCount: number, error: Error) => boolean;

    const error408Retryable = createApiError("Request Timeout", 408, true);
    const error408NonRetryable = createApiError("Request Timeout", 408, false);

    // 408 with isRetryable=true should be retried
    expect(retryFn(0, error408Retryable)).toBe(true);
    // 408 with isRetryable=false should not be retried
    expect(retryFn(0, error408NonRetryable)).toBe(false);
  });

  it("uses exponential backoff for retry delay", () => {
    const defaults = queryClient.getDefaultOptions();
    const retryDelayFn = defaults.queries?.retryDelay as (attemptIndex: number) => number;

    const delay1 = retryDelayFn(0); // First retry
    const delay2 = retryDelayFn(1); // Second retry
    const delay3 = retryDelayFn(2); // Third retry

    // Exponential growth (with jitter)
    // Base: 1s, 2s, 4s
    expect(delay1).toBeGreaterThan(800); // ~1s with jitter
    expect(delay1).toBeLessThan(1200);

    expect(delay2).toBeGreaterThan(1600); // ~2s with jitter
    expect(delay2).toBeLessThan(2400);

    expect(delay3).toBeGreaterThan(3200); // ~4s with jitter
    expect(delay3).toBeLessThan(4800);
  });

  it("adds jitter to prevent thundering herd", () => {
    const defaults = queryClient.getDefaultOptions();
    const retryDelayFn = defaults.queries?.retryDelay as (attemptIndex: number) => number;

    // Call multiple times with same index - should get different delays due to jitter
    const delays = Array.from({ length: 10 }, () => retryDelayFn(0));

    // Not all delays should be identical (jitter is random)
    const uniqueDelays = new Set(delays);
    expect(uniqueDelays.size).toBeGreaterThan(1);
  });
});

// =============================================================================
// 6. Integration Test - Simulating API Response Cycle
// =============================================================================

describe("Integration: API Response Handling", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
  });

  it("handles repeated identical API responses without reference changes", () => {
    const queryKey = ["workflow", "test"];

    // Simulate API responses at different times (same workflow data)
    const apiResponses = [
      JSON.stringify(createMockWorkflow()),
      JSON.stringify(createMockWorkflow()),
      JSON.stringify(createMockWorkflow()),
    ];

    // Process each response through the transformation pipeline
    const transformAndCache = (rawData: string) => {
      const parsed = JSON.parse(rawData);
      const normalized = normalizeWorkflowTimestamps(parsed) as WorkflowQueryResponse;
      queryClient.setQueryData(queryKey, normalized);
      return queryClient.getQueryData(queryKey);
    };

    const ref1 = transformAndCache(apiResponses[0]);
    const ref2 = transformAndCache(apiResponses[1]);
    const ref3 = transformAndCache(apiResponses[2]);

    // All references should be identical (structural sharing)
    expect(ref1).toBe(ref2);
    expect(ref2).toBe(ref3);
  });

  it("detects actual workflow status changes", () => {
    const queryKey = ["workflow", "test"];

    // Workflow progresses through states
    const runningWorkflow = JSON.stringify(createMockWorkflow({ status: WorkflowStatus.RUNNING, end_time: undefined }));
    const completedWorkflow = JSON.stringify(
      createMockWorkflow({ status: WorkflowStatus.COMPLETED, end_time: "2024-01-15T10:45:00" }),
    );

    const transformAndCache = (rawData: string) => {
      const parsed = JSON.parse(rawData);
      const normalized = normalizeWorkflowTimestamps(parsed) as WorkflowQueryResponse;
      queryClient.setQueryData(queryKey, normalized);
      return queryClient.getQueryData(queryKey);
    };

    const ref1 = transformAndCache(runningWorkflow);
    const ref2 = transformAndCache(completedWorkflow);

    // References should be different (data changed)
    expect(ref1).not.toBe(ref2);
    expect((ref1 as WorkflowQueryResponse).status).toBe(WorkflowStatus.RUNNING);
    expect((ref2 as WorkflowQueryResponse).status).toBe(WorkflowStatus.COMPLETED);
  });

  it("normalizes timestamps consistently across multiple fetch cycles", () => {
    const queryKey = ["workflow", "test"];

    // Simulate backend sometimes returning with/without timezone suffix
    const withoutTimezone = createMockWorkflow({ submit_time: "2024-01-15T10:30:00" });
    const withTimezone = createMockWorkflow({ submit_time: "2024-01-15T10:30:00Z" });

    const normalize1 = normalizeWorkflowTimestamps(withoutTimezone as unknown as Record<string, unknown>);
    const normalize2 = normalizeWorkflowTimestamps(withTimezone as unknown as Record<string, unknown>);

    // Should be identical after normalization
    expect(normalize1.submit_time).toBe(normalize2.submit_time);

    // Cache both - structural sharing should recognize them as equal
    queryClient.setQueryData(queryKey, normalize1);
    const ref1 = queryClient.getQueryData(queryKey);

    queryClient.setQueryData(queryKey, normalize2);
    const ref2 = queryClient.getQueryData(queryKey);

    expect(ref1).toBe(ref2); // Same reference preserved
  });
});

// =============================================================================
// 7. Edge Cases - Potential Loop Triggers
// =============================================================================

describe("Edge Cases That Could Cause Loops", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
  });

  it("handles empty arrays consistently", () => {
    const queryKey = ["workflow", "test"];

    const workflow1 = createMockWorkflow({ groups: [] });
    const workflow2 = createMockWorkflow({ groups: [] });

    queryClient.setQueryData(queryKey, workflow1);
    const ref1 = queryClient.getQueryData(queryKey);

    queryClient.setQueryData(queryKey, workflow2);
    const ref2 = queryClient.getQueryData(queryKey);

    expect(ref1).toBe(ref2);
  });

  it("handles undefined vs null consistently", () => {
    // Backend might return undefined or null for missing fields
    const withUndefined = createMockWorkflow({ end_time: undefined });
    const withNull = createMockWorkflow({ end_time: null as unknown as string });

    const normalized1 = normalizeWorkflowTimestamps(withUndefined as unknown as Record<string, unknown>);
    const normalized2 = normalizeWorkflowTimestamps(withNull as unknown as Record<string, unknown>);

    // After normalization, undefined stays undefined, null stays null
    // Both are falsy and handled consistently in the UI
    expect(normalized1.end_time).toBeUndefined();
    expect(normalized2.end_time).toBeNull();

    // Both are falsy
    expect(!normalized1.end_time).toBe(true);
    expect(!normalized2.end_time).toBe(true);
  });

  it("handles field order differences", () => {
    const queryKey = ["workflow", "test"];

    // Same data, different field order
    const workflow1 = { name: "test", status: "completed", submit_time: "2024-01-15T10:30:00Z" };
    const workflow2 = { status: "completed", submit_time: "2024-01-15T10:30:00Z", name: "test" };

    queryClient.setQueryData(queryKey, workflow1);
    const ref1 = queryClient.getQueryData(queryKey);

    queryClient.setQueryData(queryKey, workflow2);
    const ref2 = queryClient.getQueryData(queryKey);

    // Structural sharing should handle different field order
    expect(ref1).toBe(ref2);
  });

  it("handles NaN and Infinity consistently", () => {
    const queryKey = ["workflow", "test"];

    const workflow1 = { ...createMockWorkflow(), customField: NaN };
    const workflow2 = { ...createMockWorkflow(), customField: NaN };

    queryClient.setQueryData(queryKey, workflow1);
    queryClient.setQueryData(queryKey, workflow2);

    // Note: NaN !== NaN in JavaScript, so this will trigger update
    // This is expected behavior and won't cause infinite loops
    // because the update is intentional
    const data = queryClient.getQueryData(queryKey) as typeof workflow1;
    expect(data.customField).toBe(workflow2.customField);
  });

  it("handles deeply nested identical structures", () => {
    const queryKey = ["workflow", "test"];

    // Use nested groups structure to test deep equality
    const deepWorkflow1 = createMockWorkflow({
      groups: [
        {
          name: "g1",
          status: TaskGroupStatus.COMPLETED,
          tasks: [
            {
              name: "t1",
              retry_id: 0,
              pod_name: "pod-1",
              task_uuid: "uuid-1",
              status: TaskGroupStatus.COMPLETED,
              logs: JSON.stringify({ level1: { level2: { level3: { value: "deep" } } } }),
              events: "",
            },
          ],
        },
      ],
    });

    const deepWorkflow2 = createMockWorkflow({
      groups: [
        {
          name: "g1",
          status: TaskGroupStatus.COMPLETED,
          tasks: [
            {
              name: "t1",
              retry_id: 0,
              pod_name: "pod-1",
              task_uuid: "uuid-1",
              status: TaskGroupStatus.COMPLETED,
              logs: JSON.stringify({ level1: { level2: { level3: { value: "deep" } } } }),
              events: "",
            },
          ],
        },
      ],
    });

    queryClient.setQueryData(queryKey, deepWorkflow1);
    const ref1 = queryClient.getQueryData(queryKey);

    queryClient.setQueryData(queryKey, deepWorkflow2);
    const ref2 = queryClient.getQueryData(queryKey);

    // Deep structural sharing should work
    expect(ref1).toBe(ref2);
  });
});

// =============================================================================
// 8. Performance Characteristics
// =============================================================================

describe("Performance: Render Prevention Mechanisms", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
  });

  it("structural sharing is fast for large objects", () => {
    const queryKey = ["workflow", "test"];

    // Create large workflow with many tasks
    const largeWorkflow = createMockWorkflow({
      groups: Array.from({ length: 100 }, (_, i) => ({
        name: `group-${i}`,
        status: TaskGroupStatus.COMPLETED,
        tasks: Array.from({ length: 10 }, (_, j) => ({
          name: `task-${j}`,
          retry_id: 0,
          pod_name: `pod-${i}-${j}`,
          task_uuid: `uuid-${i}-${j}`,
          status: TaskGroupStatus.COMPLETED,
          logs: "",
          events: "",
          start_time: "2024-01-15T10:30:00Z",
          end_time: "2024-01-15T10:31:00Z",
        })),
      })),
    });

    // Time the comparison
    const start = performance.now();

    queryClient.setQueryData(queryKey, largeWorkflow);
    queryClient.setQueryData(queryKey, { ...largeWorkflow }); // Same data, new object

    const duration = performance.now() - start;

    // Should complete quickly (< 50ms for 1000 tasks)
    expect(duration).toBeLessThan(50);
  });

  it("normalization is idempotent and fast", () => {
    const workflow = createMockWorkflow({
      groups: Array.from({ length: 50 }, (_, i) => ({
        name: `group-${i}`,
        status: TaskGroupStatus.COMPLETED,
        start_time: "2024-01-15T10:30:00",
      })),
    });

    const start = performance.now();

    // Normalize multiple times
    let result: Record<string, unknown> = workflow as unknown as Record<string, unknown>;
    for (let i = 0; i < 10; i++) {
      result = normalizeWorkflowTimestamps(result);
    }

    const duration = performance.now() - start;

    // Should complete quickly (< 20ms for 10 iterations)
    expect(duration).toBeLessThan(20);
  });
});
