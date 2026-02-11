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

"use client";

import { useCallback, useEffect, useRef, useState, startTransition, useMemo } from "react";
import { useRafCallback } from "@react-hookz/web";

import type { LogEntry } from "@/lib/api/log-adapter/types";
import { parseLogLine } from "@/lib/api/log-adapter/adapters/log-parser";
import { handleRedirectResponse } from "@/lib/api/handle-redirect";
import { LOG_QUERY_DEFAULTS } from "@/lib/api/log-adapter/constants";

export type StreamPhase =
  | "idle" // Not started (enabled=false or no workflowId)
  | "connecting" // Fetch in flight, no data yet
  | "streaming" // Reader active, entries accumulating
  | "complete" // Stream ended normally (done=true from reader)
  | "error"; // Stream failed

export interface UseLogStreamParams {
  /** Workflow ID (required) */
  workflowId: string;
  /** Group ID for group-scoped queries */
  groupId?: string;
  /** Task ID for task-scoped queries */
  taskId?: string;
  /** Enable/disable the stream */
  enabled?: boolean;
  /** Base URL for API endpoint (default: "") */
  baseUrl?: string;
  /** Maximum entries to retain in memory (default: from LOG_QUERY_DEFAULTS) */
  maxEntries?: number;
}

export interface UseLogStreamReturn {
  /** All accumulated raw entries (unfiltered, chronological) */
  entries: LogEntry[];
  /** Current stream phase */
  phase: StreamPhase;
  /** Error if phase === "error" */
  error: Error | null;
  /** Whether the stream is actively receiving data */
  isStreaming: boolean;
  /** Whether data has been received (entries.length > 0) */
  hasData: boolean;
  /** Progress indicator: number of entries received so far */
  entryCount: number;
  /** Manually restart the stream */
  restart: () => void;
}

/**
 * Unified log streaming hook that fetches all logs progressively.
 *
 * Combines the patterns from useLogData (React Query-based) and useLogTail (streaming)
 * into a single hook that always uses true streaming for optimal progressive rendering.
 *
 * Key characteristics:
 * - No last_n_lines limit - always fetches ALL logs from the workflow
 * - Progressive rendering - entries appear as they arrive (RAF-batched)
 * - Single source of truth - one hook, one implementation
 * - Returns raw unfiltered entries - consumers apply filters via useMemo
 * - Phase-based state machine - clear lifecycle states
 *
 * Performance:
 * - RAF batching coalesces high-frequency updates to 60fps
 * - startTransition marks updates as non-urgent
 * - Memory-capped at maxEntries (default 100K) to prevent unbounded growth
 */
export function useLogStream(params: UseLogStreamParams): UseLogStreamReturn {
  const {
    workflowId,
    groupId,
    taskId,
    enabled = true,
    baseUrl = "",
    maxEntries = LOG_QUERY_DEFAULTS.MAX_ENTRIES_LIMIT,
  } = params;

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [error, setError] = useState<Error | null>(null);

  const entriesRef = useRef<LogEntry[]>([]);
  const pendingRef = useRef<LogEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // RAF-batched flush (max 60fps updates)
  const [flushPending] = useRafCallback(() => {
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    pendingRef.current = [];

    startTransition(() => {
      const next = [...entriesRef.current, ...pending];
      const capped = next.length > maxEntries ? next.slice(-maxEntries) : next;
      entriesRef.current = capped;
      setEntries(capped);
    });
  });

  const processChunk = useCallback(
    (text: string) => {
      const lines = text.split("\n");
      const newEntries: LogEntry[] = [];

      for (const line of lines) {
        if (line.trim()) {
          const entry = parseLogLine(line, workflowId);
          if (entry) newEntries.push(entry);
        }
      }

      if (newEntries.length > 0) {
        pendingRef.current.push(...newEntries);
        // Apply backpressure: cap pending buffer to prevent memory explosion
        if (pendingRef.current.length > maxEntries) {
          pendingRef.current = pendingRef.current.slice(-maxEntries);
        }
        flushPending();
      }
    },
    [workflowId, maxEntries, flushPending],
  );

  const startStream = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Reset state for new stream
    entriesRef.current = [];
    pendingRef.current = [];
    setEntries([]);
    setPhase("connecting");
    setError(null);

    try {
      const url = new URL(`${baseUrl}/api/workflow/${encodeURIComponent(workflowId)}/logs`, window.location.origin);
      if (groupId) url.searchParams.set("group_id", groupId);
      if (taskId) url.searchParams.set("task_id", taskId);
      // No last_n_lines, no tail=true -- fetch ALL logs as a stream

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "text/plain" },
        signal: controller.signal,
        credentials: "include",
        redirect: "manual",
      });

      handleRedirectResponse(response, "log streaming");

      if (!response.ok) {
        throw new Error(`Stream failed: ${response.status} ${response.statusText}`);
      }
      if (!response.body) {
        throw new Error("Response body is not readable");
      }
      if (controller.signal.aborted) return;

      setPhase("streaming");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            if (buffer.trim()) processChunk(buffer);
            setPhase("complete");
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lastNewline = buffer.lastIndexOf("\n");
          if (lastNewline !== -1) {
            processChunk(buffer.slice(0, lastNewline));
            buffer = buffer.slice(lastNewline + 1);
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || controller.signal.aborted)) {
        setPhase("idle");
      } else {
        setError(err instanceof Error ? err : new Error(String(err)));
        setPhase("error");
      }
    }
  }, [baseUrl, workflowId, groupId, taskId, processChunk]);

  // Lifecycle effect
  useEffect(() => {
    if (enabled && workflowId) {
      startStream();
    } else {
      abortRef.current?.abort();
      abortRef.current = null;
      setPhase("idle");
    }
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [enabled, workflowId, startStream]);

  return useMemo(
    () => ({
      entries,
      phase,
      error,
      isStreaming: phase === "streaming",
      hasData: entries.length > 0,
      entryCount: entries.length,
      restart: startStream,
    }),
    [entries, phase, error, startStream],
  );
}
