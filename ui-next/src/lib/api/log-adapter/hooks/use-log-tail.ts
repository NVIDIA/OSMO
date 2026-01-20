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
 * useLogTail Hook
 *
 * Provides live log tailing via HTTP streaming.
 * Uses ReadableStream for efficient streaming without WebSocket overhead.
 */

"use client";

import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import { useRafCallback } from "@react-hookz/web";

import type { LogEntry, TailStatus } from "../types";
import { parseLogLine } from "../adapters/log-parser";

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for the useLogTail hook.
 */
export interface UseLogTailParams {
  /** Workflow ID to tail logs for */
  workflowId: string;
  /** Whether tailing is enabled */
  enabled?: boolean;
  /** Base URL for API requests */
  baseUrl?: string;
  /** Callback when new entries arrive */
  onEntries?: (entries: LogEntry[]) => void;
  /** Maximum entries to buffer */
  maxBufferSize?: number;
  /** Optional URL params to append to requests */
  devParams?: Record<string, string>;
}

/**
 * Return value from useLogTail.
 */
export interface UseLogTailReturn {
  /** Buffered entries from tailing */
  entries: LogEntry[];
  /** Current tail status */
  status: TailStatus;
  /** Error if tailing failed */
  error: Error | null;
  /** Start tailing */
  start: () => void;
  /** Pause tailing (keeps connection, buffers entries) */
  pause: () => void;
  /** Resume tailing */
  resume: () => void;
  /** Stop tailing and close connection */
  stop: () => void;
  /** Clear buffered entries */
  clearBuffer: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_BUFFER_SIZE = 10_000;

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for live log tailing via HTTP streaming.
 *
 * Features:
 * - Uses fetch with ReadableStream for efficient streaming
 * - Automatic reconnection on disconnect
 * - Pause/resume support with entry buffering
 * - Non-blocking updates via startTransition
 *
 * @param params - Tail parameters
 * @returns Tail state and control functions
 */
export function useLogTail(params: UseLogTailParams): UseLogTailReturn {
  const {
    workflowId,
    enabled = true,
    baseUrl = "",
    onEntries,
    maxBufferSize = DEFAULT_MAX_BUFFER_SIZE,
    devParams,
  } = params;

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<TailStatus>("disconnected");
  const [error, setError] = useState<Error | null>(null);

  // Use refs to track state without re-renders
  const abortControllerRef = useRef<AbortController | null>(null);
  const isPausedRef = useRef(false);
  const bufferRef = useRef<LogEntry[]>([]);

  // RAF batching: Accumulate entries between frames for consistent 60fps updates
  const pendingEntriesRef = useRef<LogEntry[]>([]);
  const onEntriesCallbackRef = useRef(onEntries);
  onEntriesCallbackRef.current = onEntries;

  // RAF-batched state update - runs at most once per animation frame
  const [flushPendingEntries] = useRafCallback(() => {
    const pending = pendingEntriesRef.current;
    if (pending.length === 0) return;

    // Clear pending before processing to avoid races
    pendingEntriesRef.current = [];

    startTransition(() => {
      setEntries((prev) => {
        const combined = [...prev, ...pending];
        // Keep buffer within limits
        return combined.length > maxBufferSize ? combined.slice(-maxBufferSize) : combined;
      });
    });

    // Notify callback with all batched entries
    onEntriesCallbackRef.current?.(pending);
  });

  /**
   * Processes incoming text chunk into log entries.
   * Uses RAF batching for consistent 60fps updates during high-throughput streaming.
   */
  const processChunk = useCallback(
    (text: string) => {
      const lines = text.split("\n");
      const newEntries: LogEntry[] = [];

      for (const line of lines) {
        if (line.trim()) {
          const entry = parseLogLine(line, workflowId);
          if (entry) {
            newEntries.push(entry);
          }
        }
      }

      if (newEntries.length > 0) {
        if (isPausedRef.current) {
          // Buffer entries while paused
          bufferRef.current.push(...newEntries);
          // Trim buffer if too large
          if (bufferRef.current.length > maxBufferSize) {
            bufferRef.current = bufferRef.current.slice(-maxBufferSize);
          }
        } else {
          // Add to pending buffer and schedule RAF flush
          // This batches rapid updates to run at 60fps max
          for (const entry of newEntries) {
            pendingEntriesRef.current.push(entry);
          }
          // Trim pending if too large (should rarely happen at 60fps)
          if (pendingEntriesRef.current.length > maxBufferSize) {
            pendingEntriesRef.current = pendingEntriesRef.current.slice(-maxBufferSize);
          }
          flushPendingEntries();
        }
      }
    },
    [workflowId, maxBufferSize, flushPendingEntries],
  );

  /**
   * Starts the streaming connection.
   * Uses the regular /logs endpoint with Transfer-Encoding: chunked.
   * The backend streams logs as they arrive for running workflows.
   */
  const startStreaming = useCallback(async () => {
    // Abort any existing connection
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus("connecting");
    setError(null);

    try {
      // Use the regular logs endpoint - backend streams via Transfer-Encoding: chunked
      const urlObj = new URL(`${baseUrl}/api/workflow/${encodeURIComponent(workflowId)}/logs`, window.location.origin);

      // Mark this as a tailing request (for MSW to know to stream infinitely)
      urlObj.searchParams.set("tail", "true");

      // Apply optional URL params (used by experimental playground for mock scenarios)
      if (devParams) {
        for (const [key, value] of Object.entries(devParams)) {
          urlObj.searchParams.set(key, value);
        }
      }

      const response = await fetch(urlObj.toString(), {
        method: "GET",
        headers: {
          Accept: "text/plain",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Stream failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is not readable");
      }

      setStatus("streaming");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Read stream
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining buffer
          if (buffer.trim()) {
            processChunk(buffer);
          }
          setStatus("disconnected");
          break;
        }

        // Decode and process
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lastNewline = buffer.lastIndexOf("\n");
        if (lastNewline !== -1) {
          const complete = buffer.slice(0, lastNewline);
          buffer = buffer.slice(lastNewline + 1);
          processChunk(complete);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Intentional abort, not an error
        setStatus("disconnected");
      } else {
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus("error");
      }
    }
  }, [baseUrl, workflowId, processChunk, devParams]);

  /**
   * Starts tailing.
   */
  const start = useCallback(() => {
    isPausedRef.current = false;
    startStreaming();
  }, [startStreaming]);

  /**
   * Pauses tailing (keeps connection, buffers entries).
   */
  const pause = useCallback(() => {
    isPausedRef.current = true;
    setStatus("paused");
  }, []);

  /**
   * Resumes tailing.
   */
  const resume = useCallback(() => {
    isPausedRef.current = false;

    // Flush buffered entries via RAF batching
    if (bufferRef.current.length > 0) {
      const buffered = bufferRef.current;
      bufferRef.current = [];

      // Add to pending and flush via RAF for consistency
      for (const entry of buffered) {
        pendingEntriesRef.current.push(entry);
      }
      flushPendingEntries();
    }

    setStatus("streaming");
  }, [flushPendingEntries]);

  /**
   * Stops tailing and closes connection.
   */
  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isPausedRef.current = false;
    bufferRef.current = [];
    setStatus("disconnected");
  }, []);

  /**
   * Clears buffered entries.
   */
  const clearBuffer = useCallback(() => {
    bufferRef.current = [];
    setEntries([]);
  }, []);

  // Start/stop based on enabled prop
  useEffect(() => {
    if (enabled && workflowId) {
      start();
    } else {
      stop();
    }

    return () => {
      stop();
    };
  }, [enabled, workflowId, start, stop]);

  return {
    entries,
    status,
    error,
    start,
    pause,
    resume,
    stop,
    clearBuffer,
  };
}
