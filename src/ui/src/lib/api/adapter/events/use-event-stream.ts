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

"use client";

import { useCallback, useEffect, useRef, useState, startTransition, useMemo } from "react";
import { useRafCallback } from "@react-hookz/web";

import type { K8sEvent } from "@/lib/api/adapter/events/events-types";
import { parseEventChunk } from "@/lib/api/adapter/events/events-parser";
import { handleRedirectResponse } from "@/lib/api/handle-redirect";
import { isTransientError, getRetryDelay, abortableDelay, MAX_AUTO_RETRIES } from "@/lib/api/stream-retry";

// ============================================================================
// Types
// ============================================================================

export type EventStreamPhase =
  | "idle" // Not started (enabled=false or no url)
  | "connecting" // Fetch in flight, no data yet
  | "streaming" // Reader active, events accumulating
  | "reconnecting" // Stream dropped, auto-retrying with backoff
  | "complete" // Stream ended normally (done=true from reader)
  | "error"; // Stream failed (after retries exhausted)

export interface UseEventStreamParams {
  /** Events URL from workflow/task response (e.g., workflow.events or task.events) */
  url: string;
  /** Enable/disable the stream */
  enabled?: boolean;
  /** Maximum events to retain in memory (default: 50_000) */
  maxEvents?: number;
}

export interface UseEventStreamReturn {
  /** All accumulated events (arrival order) */
  events: K8sEvent[];
  /** Current stream phase */
  phase: EventStreamPhase;
  /** Error if phase === "error" */
  error: Error | null;
  /** Whether the stream is actively receiving data */
  isStreaming: boolean;
  /** Whether the stream is auto-retrying after a transient error */
  isReconnecting: boolean;
  /** Whether data has been received (events.length > 0) */
  hasData: boolean;
  /** Manually restart the stream (resets retry counter) */
  restart: () => void;
}

// ============================================================================
// Constants
// ============================================================================

/** Default max events to keep in memory. Events are lower volume than logs. */
const DEFAULT_MAX_EVENTS = 50_000;

// ============================================================================
// Hook
// ============================================================================

/**
 * Streaming hook for Kubernetes events.
 *
 * Uses `fetch()` + `ReadableStream` to progressively read events from the
 * backend, which serves them via Redis Streams (XREAD). For active workflows
 * the response never completes, so we must stream rather than await the body.
 *
 * **Automatic retry**: When the stream is interrupted by a transient error
 * (e.g., HTTP/2 GOAWAY from ALB, network hiccup), the hook automatically
 * reconnects with exponential backoff (up to {@link MAX_AUTO_RETRIES} attempts).
 * During reconnection, previously received events remain visible. The backend
 * sends full event history on each connection, so data is seamlessly replaced
 * once the new stream delivers its first chunk.
 *
 * For completed workflows the stream completes normally (phase → "complete"),
 * so this single hook handles both active and finished workflows.
 */
export function useEventStream(params: UseEventStreamParams): UseEventStreamReturn {
  const { url, enabled = true, maxEvents = DEFAULT_MAX_EVENTS } = params;

  const [events, setEvents] = useState<K8sEvent[]>([]);
  const [phase, setPhase] = useState<EventStreamPhase>("idle");
  const [error, setError] = useState<Error | null>(null);

  const eventsRef = useRef<K8sEvent[]>([]);
  const pendingRef = useRef<K8sEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // RAF-batched flush (max 60fps updates)
  const [flushPending] = useRafCallback(() => {
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    pendingRef.current = [];

    startTransition(() => {
      const next = [...eventsRef.current, ...pending];
      const capped = next.length > maxEvents ? next.slice(-maxEvents) : next;
      eventsRef.current = capped;
      setEvents(capped);
    });
  });

  const processChunk = useCallback(
    (text: string) => {
      const newEvents = parseEventChunk(text);

      if (newEvents.length > 0) {
        pendingRef.current.push(...newEvents);
        // Apply backpressure: cap pending buffer to prevent memory explosion
        if (pendingRef.current.length > maxEvents) {
          pendingRef.current = pendingRef.current.slice(-maxEvents);
        }
        flushPending();
      }
    },
    [maxEvents, flushPending],
  );

  // Store latest processChunk in a ref to avoid it being in useEffect deps
  const processChunkRef = useRef(processChunk);
  processChunkRef.current = processChunk;

  // Restart counter to trigger effect re-run
  const [restartCount, setRestartCount] = useState(0);
  const restart = useCallback(() => setRestartCount((c) => c + 1), []);

  // Lifecycle effect - contains the streaming logic with auto-retry
  useEffect(() => {
    if (!enabled || !url) {
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
    eventsRef.current = [];
    pendingRef.current = [];
    setEvents([]);
    setPhase("connecting");
    setError(null);

    const runStream = async () => {
      let retryCount = 0;

      // Build absolute URL once — it won't change across retries.
      const isAbsoluteUrl = url.startsWith("http://") || url.startsWith("https://");
      const fullUrl = isAbsoluteUrl
        ? new URL(url)
        : new URL(url.startsWith("/") ? url : `/${url}`, window.location.origin);

      // ----------------------------------------------------------------
      // Retry loop: reconnects automatically on transient errors
      // (e.g., ERR_HTTP2_PROTOCOL_ERROR from ALB GOAWAY frames).
      // ----------------------------------------------------------------
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(fullUrl.toString(), {
            method: "GET",
            headers: { Accept: "text/plain" },
            signal: controller.signal,
            redirect: "manual",
          });

          handleRedirectResponse(response, "event streaming");

          if (!response.ok) {
            throw new Error(`Stream failed: ${response.status} ${response.statusText}`);
          }
          if (!response.body) {
            throw new Error("Response body is not readable");
          }
          if (controller.signal.aborted) return;

          // Connection succeeded — reset retry counter.
          retryCount = 0;

          // Clear refs for fresh accumulation. We do NOT call setEvents([])
          // here so that previously received events remain visible during the
          // brief window before the first RAF flush delivers new data.
          // The next flushPending() will naturally replace React state.
          eventsRef.current = [];
          pendingRef.current = [];

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
                return; // Stream completed normally — exit retry loop
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
          // Intentional abort (unmount, disable, or manual restart)
          if (err instanceof Error && (err.name === "AbortError" || controller.signal.aborted)) {
            if (isActive()) setPhase("idle");
            return;
          }

          // Transient error — retry with exponential backoff
          if (isTransientError(err) && retryCount < MAX_AUTO_RETRIES && isActive()) {
            retryCount++;
            const delay = getRetryDelay(retryCount - 1);

            if (isActive()) setPhase("reconnecting");

            try {
              await abortableDelay(delay, controller.signal);
            } catch {
              // Aborted during delay (unmount or manual restart)
              if (isActive()) setPhase("idle");
              return;
            }

            // Loop continues → retry fetch
            continue;
          }

          // Terminal error (non-transient or retries exhausted)
          if (isActive()) {
            setError(err instanceof Error ? err : new Error(String(err)));
            setPhase("error");
          }
          return;
        }
      }
    };

    runStream();

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [enabled, url, restartCount]);

  return useMemo(
    () => ({
      events,
      phase,
      error,
      isStreaming: phase === "streaming",
      isReconnecting: phase === "reconnecting",
      hasData: events.length > 0,
      restart,
    }),
    [events, phase, error, restart],
  );
}
