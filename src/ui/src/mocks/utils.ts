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
 * Mock Handler Utilities
 *
 * Common utilities for MSW request handlers to reduce duplication.
 * These follow MSW 2.0 patterns and provide type-safe parsing.
 */

import { faker } from "@faker-js/faker";
import { HttpResponse } from "msw";

// ============================================================================
// Pagination
// ============================================================================

export interface PaginationParams {
  offset: number;
  limit: number;
}

/**
 * Parse pagination parameters from URL search params.
 * Returns sensible defaults if not provided.
 */
export function parsePagination(url: URL, defaults?: Partial<PaginationParams>): PaginationParams {
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const limit = parseInt(url.searchParams.get("limit") || String(defaults?.limit ?? 20), 10);

  return {
    offset: isNaN(offset) ? 0 : Math.max(0, offset),
    limit: isNaN(limit) ? (defaults?.limit ?? 20) : Math.max(1, Math.min(limit, 1000)),
  };
}

// ============================================================================
// Filter Parsing
// ============================================================================

export interface WorkflowFilters {
  statuses: string[];
  pools: string[];
  users: string[];
}

/**
 * Parse workflow filter parameters from URL search params.
 */
export function parseWorkflowFilters(url: URL): WorkflowFilters {
  return {
    statuses: url.searchParams.getAll("statuses"),
    pools: url.searchParams.getAll("pools"),
    users: url.searchParams.getAll("users"),
  };
}

/**
 * Check if any filters are active.
 */
export function hasActiveFilters(filters: WorkflowFilters): boolean {
  return filters.statuses.length > 0 || filters.pools.length > 0 || filters.users.length > 0;
}

// ============================================================================
// Mock Delay
// ============================================================================

/**
 * Get the appropriate mock delay for the current environment.
 * Minimal in development for fast iteration, larger in test/CI.
 */
export function getMockDelay(): number {
  return process.env.NODE_ENV === "development" ? 5 : 50;
}

// ============================================================================
// Hash Utility
// ============================================================================

/**
 * Simple string hash for deterministic seeding.
 * Used across generators for consistent random data.
 */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash;
}

// ============================================================================
// Abort-Aware Delay
// ============================================================================

/**
 * setTimeout that resolves immediately when an AbortSignal fires.
 * Prevents dangling timers from keeping async generators alive after
 * the consumer disconnects.
 *
 * Shared by LogGenerator and EventGenerator for streaming mock data.
 */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ============================================================================
// Stream Management
// ============================================================================

/**
 * Tracks active streams to prevent concurrent streams for the same key.
 * Prevents MaxListenersExceededWarning during HMR or rapid navigation.
 */
export const activeStreams = new Map<string, AbortController>();

/**
 * Abort and remove any existing stream registered under the given key.
 */
export function abortExistingStream(key: string): void {
  const existing = activeStreams.get(key);
  if (existing) {
    existing.abort();
    activeStreams.delete(key);
  }
}

/**
 * Wrap a text string in a ReadableStream that yields ~64KB chunks.
 * Simulates reading completed workflow data from object storage.
 */
export function buildChunkedStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const CHUNK_SIZE = 65536;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        controller.enqueue(encoder.encode(text.slice(i, i + CHUNK_SIZE)));
      }
      controller.close();
    },
  });
}

// ============================================================================
// Distribution Sampling
// ============================================================================

/**
 * Sample a key from a weighted distribution using cumulative probability.
 * Used by log and resource generators to pick levels, IO types, and statuses.
 */
export function pickFromDistribution<T extends string>(distribution: Record<T, number>, defaultValue: T): T {
  const rand = faker.number.float();
  let cumulative = 0;
  for (const [key, prob] of Object.entries(distribution) as [T, number][]) {
    cumulative += prob;
    if (rand <= cumulative) return key;
  }
  return defaultValue;
}

// ============================================================================
// Streaming Response Builder
// ============================================================================

const STREAM_ENCODER = new TextEncoder();

/**
 * Build a streaming HttpResponse from an async generator.
 * Handles AbortController lifecycle, stream cleanup, and optional prefix lines.
 *
 * Used by log and event handlers for running workflows.
 */
export function createStreamingResponse(options: {
  streamKey: string;
  headers: Record<string, string>;
  makeGenerator: (signal: AbortSignal) => AsyncGenerator<string>;
  prefixLines?: string[];
}): Response {
  const { streamKey, headers, makeGenerator, prefixLines } = options;
  const abortController = new AbortController();
  activeStreams.set(streamKey, abortController);

  const streamGen = makeGenerator(abortController.signal);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (prefixLines) {
          for (const line of prefixLines) controller.enqueue(STREAM_ENCODER.encode(line + "\n"));
        }
        for await (const line of streamGen) controller.enqueue(STREAM_ENCODER.encode(line));
      } catch {
        // Stream closed or aborted
      } finally {
        activeStreams.delete(streamKey);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abortController.abort();
      activeStreams.delete(streamKey);
    },
  });

  return new HttpResponse(stream, { headers });
}
