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
 * Shared retry utilities for streaming hooks (useEventStream, useLogStream).
 *
 * Long-lived HTTP/2 streams can be interrupted by proxy GOAWAY frames,
 * connection resets, or network hiccups — especially when other requests
 * (like auto-refresh polling) share the same HTTP/2 connection.
 *
 * These utilities provide exponential backoff retry with jitter so that
 * transient disconnects are transparent to the user.
 */

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of automatic retries before surfacing the error to the user. */
export const MAX_AUTO_RETRIES = 5;

/** Base delay for the first retry (doubles each attempt). */
const BASE_RETRY_DELAY_MS = 1_000;

/** Maximum delay between retries (cap for exponential growth). */
const MAX_RETRY_DELAY_MS = 30_000;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Determine whether an error is transient and worth retrying.
 *
 * Retryable:
 * - TypeError (network errors from fetch / ReadableStream)
 * - HTTP 5xx server errors (thrown as "Stream failed: 5xx ...")
 * - Keyword matches: protocol, network, connection, etc.
 *
 * NOT retryable:
 * - AbortError (intentional cancellation)
 * - HTTP 4xx client errors
 * - Auth redirects (session expired)
 * - "Response body is not readable" (browser bug, not transient)
 */
export function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;

  // Network / protocol errors from fetch() or ReadableStream
  if (err instanceof TypeError) return true;

  const msg = err.message.toLowerCase();

  // Keyword-based matching for errors that surface differently across browsers
  if (
    msg.includes("network") ||
    msg.includes("protocol") ||
    msg.includes("failed to fetch") ||
    msg.includes("net::") ||
    msg.includes("connection") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up")
  ) {
    return true;
  }

  // HTTP 5xx responses (thrown as "Stream failed: 502 Bad Gateway", etc.)
  if (/stream failed: 5\d{2}/i.test(err.message)) return true;

  return false;
}

/**
 * Compute the retry delay with exponential backoff and jitter.
 *
 * Formula: min(BASE * 2^attempt, MAX) ± 25% jitter
 *
 * Example progression: ~1s, ~2s, ~4s, ~8s, ~16s (capped at 30s)
 */
export function getRetryDelay(attempt: number): number {
  const exponential = Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
  // ±25% jitter to avoid thundering herd when many tabs reconnect simultaneously
  const jitter = exponential * 0.25 * (Math.random() * 2 - 1);
  return Math.round(exponential + jitter);
}

/**
 * Promise-based delay that can be cancelled via an AbortSignal.
 *
 * Resolves after `ms` milliseconds, or rejects immediately with an
 * AbortError if the signal fires before the timer completes.
 */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const onTimer = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    const timer = setTimeout(onTimer, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
