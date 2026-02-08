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

import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import { useRafCallback } from "@react-hookz/web";

import type { LogEntry, TailStatus } from "@/lib/api/log-adapter/types";
import { parseLogLine } from "@/lib/api/log-adapter/adapters/log-parser";
import { handleRedirectResponse } from "@/lib/api/handle-redirect";

export interface UseLogTailParams {
  workflowId: string;
  groupId?: string;
  taskId?: string;
  enabled?: boolean;
  baseUrl?: string;
  onEntries?: (entries: LogEntry[]) => void;
  maxBufferSize?: number;
}

export interface UseLogTailReturn {
  entries: LogEntry[];
  status: TailStatus;
  error: Error | null;
  start: () => void;
  stop: () => void;
  clearEntries: () => void;
}

const DEFAULT_MAX_BUFFER_SIZE = 10_000;

/**
 * Live log tailing via HTTP streaming with RAF batching for 60fps updates.
 */
export function useLogTail(params: UseLogTailParams): UseLogTailReturn {
  const {
    workflowId,
    groupId,
    taskId,
    enabled = true,
    baseUrl = "",
    onEntries,
    maxBufferSize = DEFAULT_MAX_BUFFER_SIZE,
  } = params;

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<TailStatus>("disconnected");
  const [error, setError] = useState<Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingEntriesRef = useRef<LogEntry[]>([]);
  const onEntriesCallbackRef = useRef(onEntries);
  onEntriesCallbackRef.current = onEntries;

  // RAF-batched state update for consistent 60fps
  const [flushPendingEntries] = useRafCallback(() => {
    const pending = pendingEntriesRef.current;
    if (pending.length === 0) return;

    pendingEntriesRef.current = [];

    startTransition(() => {
      setEntries((prev) => {
        const combined = [...prev, ...pending];
        return combined.length > maxBufferSize ? combined.slice(-maxBufferSize) : combined;
      });
    });

    onEntriesCallbackRef.current?.(pending);
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
        pendingEntriesRef.current.push(...newEntries);
        if (pendingEntriesRef.current.length > maxBufferSize) {
          pendingEntriesRef.current = pendingEntriesRef.current.slice(-maxBufferSize);
        }
        flushPendingEntries();
      }
    },
    [workflowId, maxBufferSize, flushPendingEntries],
  );

  const startStreaming = useCallback(async () => {
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus("connecting");
    setError(null);

    try {
      const urlObj = new URL(`${baseUrl}/api/workflow/${encodeURIComponent(workflowId)}/logs`, window.location.origin);
      urlObj.searchParams.set("tail", "true");
      if (groupId) urlObj.searchParams.set("group_id", groupId);
      if (taskId) urlObj.searchParams.set("task_id", taskId);

      const response = await fetch(urlObj.toString(), {
        method: "GET",
        headers: { Accept: "text/plain" },
        signal: controller.signal,
        credentials: "include", // Forward cookies (Envoy session) for authentication
        redirect: "manual", // Prevent automatic redirect following (prevents CORS errors on auth expiry)
      });

      // Check for redirect responses and throw appropriate error
      handleRedirectResponse(response, "log streaming");

      if (!response.ok) {
        throw new Error(`Stream failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is not readable");
      }

      if (controller.signal.aborted) return;

      setStatus("streaming");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            if (buffer.trim()) processChunk(buffer);
            setStatus("disconnected");
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
        setStatus("disconnected");
      } else {
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus("error");
      }
    }
  }, [baseUrl, workflowId, groupId, taskId, processChunk]);

  const start = useCallback(() => startStreaming(), [startStreaming]);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStatus("disconnected");
  }, []);

  const clearEntries = useCallback(() => setEntries([]), []);

  useEffect(() => {
    if (enabled && workflowId) {
      start();
    } else {
      stop();
    }
    return stop;
  }, [enabled, workflowId, start, stop]);

  return { entries, status, error, start, stop, clearEntries };
}
