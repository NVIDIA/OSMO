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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MAX_AUTO_RETRIES, isTransientError, getRetryDelay, abortableDelay } from "@/lib/api/stream-retry";

// =============================================================================
// MAX_AUTO_RETRIES constant
// =============================================================================

describe("MAX_AUTO_RETRIES", () => {
  it("is set to 5", () => {
    expect(MAX_AUTO_RETRIES).toBe(5);
  });
});

// =============================================================================
// isTransientError - Non-Error values
// =============================================================================

describe("isTransientError - non-Error values", () => {
  it("returns false for null", () => {
    expect(isTransientError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isTransientError(undefined)).toBe(false);
  });

  it("returns false for string", () => {
    expect(isTransientError("network error")).toBe(false);
  });

  it("returns false for number", () => {
    expect(isTransientError(500)).toBe(false);
  });

  it("returns false for plain object", () => {
    expect(isTransientError({ message: "network error" })).toBe(false);
  });
});

// =============================================================================
// isTransientError - AbortError
// =============================================================================

describe("isTransientError - AbortError", () => {
  it("returns false for AbortError", () => {
    const abortError = new DOMException("Aborted", "AbortError");

    expect(isTransientError(abortError)).toBe(false);
  });

  it("returns false for Error with AbortError name", () => {
    const error = new Error("Operation aborted");
    error.name = "AbortError";

    expect(isTransientError(error)).toBe(false);
  });
});

// =============================================================================
// isTransientError - TypeError (network errors)
// =============================================================================

describe("isTransientError - TypeError", () => {
  it("returns true for TypeError", () => {
    const typeError = new TypeError("Failed to fetch");

    expect(isTransientError(typeError)).toBe(true);
  });

  it("returns true for TypeError with network message", () => {
    const typeError = new TypeError("NetworkError when attempting to fetch resource");

    expect(isTransientError(typeError)).toBe(true);
  });
});

// =============================================================================
// isTransientError - Keyword matching
// =============================================================================

describe("isTransientError - keyword matching", () => {
  it("returns true for error with 'network' in message", () => {
    const error = new Error("Network request failed");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for error with 'NETWORK' (case insensitive)", () => {
    const error = new Error("NETWORK ERROR");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for error with 'protocol' in message", () => {
    const error = new Error("Protocol error: connection reset");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for error with 'failed to fetch'", () => {
    const error = new Error("failed to fetch");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for error with 'net::'", () => {
    const error = new Error("net::ERR_CONNECTION_RESET");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for error with 'connection'", () => {
    const error = new Error("connection refused");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for error with 'econnreset'", () => {
    const error = new Error("read ECONNRESET");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for error with 'socket hang up'", () => {
    const error = new Error("socket hang up");

    expect(isTransientError(error)).toBe(true);
  });
});

// =============================================================================
// isTransientError - HTTP/2 protocol errors (mentioned in call site comments)
// =============================================================================

describe("isTransientError - HTTP/2 protocol errors", () => {
  it("returns true for ERR_HTTP2_PROTOCOL_ERROR", () => {
    const error = new Error("net::ERR_HTTP2_PROTOCOL_ERROR");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for ERR_HTTP2_PING_FAILED", () => {
    const error = new Error("net::ERR_HTTP2_PING_FAILED");

    expect(isTransientError(error)).toBe(true);
  });
});

// =============================================================================
// isTransientError - HTTP 5xx errors
// =============================================================================

describe("isTransientError - HTTP 5xx errors", () => {
  it("returns true for 'Stream failed: 500'", () => {
    const error = new Error("Stream failed: 500 Internal Server Error");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for 'Stream failed: 502'", () => {
    const error = new Error("Stream failed: 502 Bad Gateway");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for 'Stream failed: 503'", () => {
    const error = new Error("Stream failed: 503 Service Unavailable");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns true for 'stream failed: 504' (lowercase)", () => {
    const error = new Error("stream failed: 504 Gateway Timeout");

    expect(isTransientError(error)).toBe(true);
  });

  it("returns false for 'Stream failed: 400' (4xx not retryable)", () => {
    const error = new Error("Stream failed: 400 Bad Request");

    expect(isTransientError(error)).toBe(false);
  });

  it("returns false for 'Stream failed: 404'", () => {
    const error = new Error("Stream failed: 404 Not Found");

    expect(isTransientError(error)).toBe(false);
  });
});

// =============================================================================
// isTransientError - HTTP 4xx auth errors (should NOT retry)
// =============================================================================

describe("isTransientError - HTTP 4xx auth errors", () => {
  it("returns false for 'Stream failed: 401'", () => {
    const error = new Error("Stream failed: 401 Unauthorized");

    expect(isTransientError(error)).toBe(false);
  });

  it("returns false for 'Stream failed: 403'", () => {
    const error = new Error("Stream failed: 403 Forbidden");

    expect(isTransientError(error)).toBe(false);
  });
});

// =============================================================================
// isTransientError - Non-transient errors
// =============================================================================

describe("isTransientError - non-transient errors", () => {
  it("returns false for generic error without keywords", () => {
    const error = new Error("Something went wrong");

    expect(isTransientError(error)).toBe(false);
  });

  it("returns false for validation error", () => {
    const error = new Error("Invalid input: email format is incorrect");

    expect(isTransientError(error)).toBe(false);
  });

  it("returns false for auth error", () => {
    const error = new Error("Unauthorized: token expired");

    expect(isTransientError(error)).toBe(false);
  });

  it("returns false for 'Response body is not readable'", () => {
    const error = new Error("Response body is not readable");

    expect(isTransientError(error)).toBe(false);
  });

  it("returns false for empty error message", () => {
    const error = new Error("");

    expect(isTransientError(error)).toBe(false);
  });
});

// =============================================================================
// getRetryDelay - Exponential backoff
// =============================================================================

describe("getRetryDelay - exponential backoff", () => {
  beforeEach(() => {
    // Mock Math.random to return 0.5 for predictable jitter (0 jitter when random = 0.5)
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns approximately 1000ms for attempt 0", () => {
    const delay = getRetryDelay(0);

    // With random = 0.5, jitter = exponential * 0.25 * (0.5 * 2 - 1) = exponential * 0.25 * 0 = 0
    expect(delay).toBe(1000);
  });

  it("returns approximately 2000ms for attempt 1", () => {
    const delay = getRetryDelay(1);

    expect(delay).toBe(2000);
  });

  it("returns approximately 4000ms for attempt 2", () => {
    const delay = getRetryDelay(2);

    expect(delay).toBe(4000);
  });

  it("returns approximately 8000ms for attempt 3", () => {
    const delay = getRetryDelay(3);

    expect(delay).toBe(8000);
  });

  it("returns approximately 16000ms for attempt 4", () => {
    const delay = getRetryDelay(4);

    expect(delay).toBe(16000);
  });
});

describe("getRetryDelay - maximum cap", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caps delay at 30000ms for attempt 5", () => {
    const delay = getRetryDelay(5);

    // 1000 * 2^5 = 32000, but capped at 30000
    expect(delay).toBe(30000);
  });

  it("caps delay at 30000ms for attempt 10", () => {
    const delay = getRetryDelay(10);

    expect(delay).toBe(30000);
  });
});

describe("getRetryDelay - jitter range", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies negative jitter when random is 0", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const delay = getRetryDelay(0);

    // jitter = 1000 * 0.25 * (0 * 2 - 1) = 1000 * 0.25 * -1 = -250
    // delay = 1000 + (-250) = 750
    expect(delay).toBe(750);
  });

  it("applies positive jitter when random is 1", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);

    const delay = getRetryDelay(0);

    // jitter = 1000 * 0.25 * (1 * 2 - 1) = 1000 * 0.25 * 1 = 250
    // delay = 1000 + 250 = 1250
    expect(delay).toBe(1250);
  });

  it("returns rounded integer value", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.3);

    const delay = getRetryDelay(0);

    expect(Number.isInteger(delay)).toBe(true);
  });
});

describe("getRetryDelay - edge cases", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles negative attempt by returning small positive delay", () => {
    const delay = getRetryDelay(-1);

    // 1000 * 2^-1 = 500ms with no jitter
    expect(delay).toBe(500);
  });

  it("handles very large attempt by capping at max", () => {
    const delay = getRetryDelay(100);

    // Would overflow without cap, but capped at 30000
    expect(delay).toBe(30000);
  });
});

// =============================================================================
// abortableDelay - Immediate abort
// =============================================================================

describe("abortableDelay - immediate abort", () => {
  it("rejects immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(abortableDelay(1000, controller.signal)).rejects.toThrow("Aborted");
  });

  it("rejects with AbortError name when pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    try {
      await abortableDelay(1000, controller.signal);
      expect.fail("Should have thrown");
    } catch (error) {
      expect((error as DOMException).name).toBe("AbortError");
    }
  });
});

// =============================================================================
// abortableDelay - Successful completion
// =============================================================================

describe("abortableDelay - successful completion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after specified delay", async () => {
    const controller = new AbortController();
    const delayPromise = abortableDelay(1000, controller.signal);

    vi.advanceTimersByTime(1000);

    await expect(delayPromise).resolves.toBeUndefined();
  });

  it("does not resolve before delay completes", async () => {
    const controller = new AbortController();
    let resolved = false;

    abortableDelay(1000, controller.signal).then(() => {
      resolved = true;
    });

    vi.advanceTimersByTime(999);
    await Promise.resolve();

    expect(resolved).toBe(false);

    vi.advanceTimersByTime(1);
    await Promise.resolve();

    expect(resolved).toBe(true);
  });
});

// =============================================================================
// abortableDelay - Abort during wait
// =============================================================================

describe("abortableDelay - abort during wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects when aborted during wait", async () => {
    const controller = new AbortController();
    const delayPromise = abortableDelay(1000, controller.signal);

    vi.advanceTimersByTime(500);
    controller.abort();

    await expect(delayPromise).rejects.toThrow("Aborted");
  });

  it("rejects with AbortError name when aborted during wait", async () => {
    const controller = new AbortController();
    const delayPromise = abortableDelay(1000, controller.signal);

    vi.advanceTimersByTime(500);
    controller.abort();

    try {
      await delayPromise;
      expect.fail("Should have thrown");
    } catch (error) {
      expect((error as DOMException).name).toBe("AbortError");
    }
  });

  it("clears timer when aborted", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const controller = new AbortController();
    const delayPromise = abortableDelay(1000, controller.signal);

    controller.abort();

    try {
      await delayPromise;
    } catch {
      // Expected
    }

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});

// =============================================================================
// abortableDelay - Event listener cleanup
// =============================================================================

describe("abortableDelay - event listener cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes abort listener after successful completion", async () => {
    const controller = new AbortController();
    const removeEventListenerSpy = vi.spyOn(controller.signal, "removeEventListener");

    const delayPromise = abortableDelay(1000, controller.signal);
    vi.advanceTimersByTime(1000);
    await delayPromise;

    expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

// =============================================================================
// abortableDelay - Edge cases
// =============================================================================

describe("abortableDelay - edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately with 0ms delay", async () => {
    const controller = new AbortController();
    const delayPromise = abortableDelay(0, controller.signal);

    vi.advanceTimersByTime(0);

    await expect(delayPromise).resolves.toBeUndefined();
  });

  it("handles very small positive delay", async () => {
    const controller = new AbortController();
    const delayPromise = abortableDelay(1, controller.signal);

    vi.advanceTimersByTime(1);

    await expect(delayPromise).resolves.toBeUndefined();
  });
});
