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

import { faker } from "@faker-js/faker";
import { HttpResponse } from "msw";

export interface PaginationParams {
  offset: number;
  limit: number;
}

export function parsePagination(url: URL, defaults?: Partial<PaginationParams>): PaginationParams {
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const limit = parseInt(url.searchParams.get("limit") || String(defaults?.limit ?? 20), 10);

  return {
    offset: isNaN(offset) ? 0 : Math.max(0, offset),
    limit: isNaN(limit) ? (defaults?.limit ?? 20) : Math.max(1, Math.min(limit, 1000)),
  };
}

export interface WorkflowFilters {
  statuses: string[];
  pools: string[];
  users: string[];
}

export function parseWorkflowFilters(url: URL): WorkflowFilters {
  return {
    statuses: url.searchParams.getAll("statuses"),
    pools: url.searchParams.getAll("pools"),
    users: url.searchParams.getAll("users"),
  };
}

export function hasActiveFilters(filters: WorkflowFilters): boolean {
  return filters.statuses.length > 0 || filters.pools.length > 0 || filters.users.length > 0;
}

export function getMockDelay(): number {
  return process.env.NODE_ENV === "development" ? 5 : 50;
}

export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash;
}

/**
 * setTimeout that resolves immediately when an AbortSignal fires.
 * Prevents dangling timers from keeping async generators alive after
 * the consumer disconnects.
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

// Tracks active streams to prevent concurrent streams for the same key.
// Prevents MaxListenersExceededWarning during HMR or rapid navigation.
export const activeStreams = new Map<string, AbortController>();

export function abortExistingStream(key: string): void {
  const existing = activeStreams.get(key);
  if (existing) {
    existing.abort();
    activeStreams.delete(key);
  }
}

/** Wrap text in a ReadableStream that yields ~64KB chunks. */
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

/** Sample a key from a weighted distribution using cumulative probability. */
export function pickFromDistribution<T extends string>(distribution: Record<T, number>, defaultValue: T): T {
  const rand = faker.number.float();
  let cumulative = 0;
  for (const [key, prob] of Object.entries(distribution) as [T, number][]) {
    cumulative += prob;
    if (rand <= cumulative) return key;
  }
  return defaultValue;
}

const STREAM_ENCODER = new TextEncoder();

/** Build a streaming HttpResponse from an async generator with optional prefix lines. */
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
        if (activeStreams.get(streamKey) === abortController) {
          activeStreams.delete(streamKey);
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abortController.abort();
      if (activeStreams.get(streamKey) === abortController) {
        activeStreams.delete(streamKey);
      }
    },
  });

  return new HttpResponse(stream, { headers });
}
