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
  | "idle" // Not started (enabled=false or no logUrl)
  | "connecting" // Fetch in flight, no data yet
  | "streaming" // Reader active, entries accumulating
  | "complete" // Stream ended normally (done=true from reader)
  | "error"; // Stream failed

export interface UseLogStreamParams {
  /** Full log URL from backend (e.g., workflow.logs or task.logs) */
  logUrl: string;
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
  const { logUrl, enabled = true, baseUrl = "", maxEntries = LOG_QUERY_DEFAULTS.MAX_ENTRIES_LIMIT } = params;

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
          const entry = parseLogLine(line);
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
    [maxEntries, flushPending],
  );

  // Store latest processChunk in a ref to avoid it being in useEffect deps
  const processChunkRef = useRef(processChunk);
  processChunkRef.current = processChunk;

  // Restart counter to trigger effect re-run
  const [restartCount, setRestartCount] = useState(0);
  const restart = useCallback(() => setRestartCount((c) => c + 1), []);

  // Lifecycle effect - contains the streaming logic directly
  useEffect(() => {
    if (!enabled || !logUrl) {
      abortRef.current?.abort();
      abortRef.current = null;
      setPhase("idle");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // Helper: only update state if this stream is still the active one.
    const isActive = () => abortRef.current === controller;

    // Reset state for new stream
    entriesRef.current = [];
    pendingRef.current = [];
    setEntries([]);
    setPhase("connecting");
    setError(null);

    const runStream = async () => {
      try {
        // Build absolute URL from relative backend URL
        const url = new URL(logUrl.startsWith("/") ? logUrl : `/${logUrl}`, window.location.origin);

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

        if (isActive()) setPhase("streaming");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              if (buffer.trim()) processChunkRef.current(buffer);
              if (isActive()) setPhase("complete");
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lastNewline = buffer.lastIndexOf("\n");
            if (lastNewline !== -1) {
              processChunkRef.current(buffer.slice(0, lastNewline));
              buffer = buffer.slice(lastNewline + 1);
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch (err) {
        if (err instanceof Error && (err.name === "AbortError" || controller.signal.aborted)) {
          if (isActive()) setPhase("idle");
        } else if (isActive()) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setPhase("error");
        }
      }
    };

    runStream();

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [enabled, logUrl, baseUrl, restartCount]);

  return useMemo(
    () => ({
      entries,
      phase,
      error,
      isStreaming: phase === "streaming",
      hasData: entries.length > 0,
      entryCount: entries.length,
      restart,
    }),
    [entries, phase, error, restart],
  );
}
