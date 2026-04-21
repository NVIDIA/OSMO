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

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { handleRedirectResponse } from "@/lib/api/handle-redirect";

function createMockResponse(status: number, locationHeader: string | null): Response {
  const headers = new Headers();
  if (locationHeader !== null) {
    headers.set("Location", locationHeader);
  }

  return {
    status,
    headers,
  } as Response;
}

// =============================================================================
// handleRedirectResponse - Non-redirect status codes
// =============================================================================

describe("handleRedirectResponse - non-redirect status codes", () => {
  it("does nothing for status 200", () => {
    const response = createMockResponse(200, null);

    expect(() => handleRedirectResponse(response)).not.toThrow();
  });

  it("does nothing for status 299", () => {
    const response = createMockResponse(299, null);

    expect(() => handleRedirectResponse(response)).not.toThrow();
  });

  it("does nothing for status 400", () => {
    const response = createMockResponse(400, null);

    expect(() => handleRedirectResponse(response)).not.toThrow();
  });

  it("does nothing for status 500", () => {
    const response = createMockResponse(500, null);

    expect(() => handleRedirectResponse(response)).not.toThrow();
  });
});

// =============================================================================
// handleRedirectResponse - Missing Location header
// =============================================================================

describe("handleRedirectResponse - missing Location header", () => {
  it("throws error when redirect has no Location header", () => {
    const response = createMockResponse(302, null);

    expect(() => handleRedirectResponse(response)).toThrow("Server returned redirect (302) with no Location header");
  });

  it("includes status code 301 in error message", () => {
    const response = createMockResponse(301, null);

    expect(() => handleRedirectResponse(response)).toThrow("Server returned redirect (301) with no Location header");
  });

  it("includes status code 307 in error message", () => {
    const response = createMockResponse(307, null);

    expect(() => handleRedirectResponse(response)).toThrow("Server returned redirect (307) with no Location header");
  });
});

// =============================================================================
// handleRedirectResponse - Same-origin redirect (server-side)
// =============================================================================

describe("handleRedirectResponse - same-origin redirect (server-side)", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // Simulate server-side environment by removing window
    // @ts-expect-error - intentionally setting window to undefined for SSR test
    globalThis.window = undefined;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("throws error for same-origin redirect without context", () => {
    const response = createMockResponse(302, "/api/redirect-target");

    expect(() => handleRedirectResponse(response)).toThrow(
      "API endpoint unexpectedly redirected to /api/redirect-target. This may indicate a misconfiguration.",
    );
  });

  it("includes context in error message when provided", () => {
    const response = createMockResponse(302, "/api/redirect-target");

    expect(() => handleRedirectResponse(response, "log streaming")).toThrow(
      "API endpoint unexpectedly redirected to /api/redirect-target (log streaming). This may indicate a misconfiguration.",
    );
  });

  it("handles absolute URL on server-side as same-origin", () => {
    const response = createMockResponse(302, "http://localhost/api/redirect-target");

    expect(() => handleRedirectResponse(response)).toThrow(
      "API endpoint unexpectedly redirected to http://localhost/api/redirect-target. This may indicate a misconfiguration.",
    );
  });
});

// =============================================================================
// handleRedirectResponse - Cross-origin redirect (client-side)
// =============================================================================

describe("handleRedirectResponse - cross-origin redirect (client-side)", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // Simulate client-side environment with mock window
    globalThis.window = {
      location: {
        origin: "https://app.example.com",
      },
    } as Window & typeof globalThis;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("throws session expired error for cross-origin redirect", () => {
    const response = createMockResponse(302, "https://sso.example.com/login");

    expect(() => handleRedirectResponse(response)).toThrow(
      "Your session has expired. Please refresh the page to log in again. (Cannot follow redirect to https://sso.example.com)",
    );
  });

  it("includes cross-origin host in error message", () => {
    const response = createMockResponse(302, "https://auth.different-domain.com/oauth");

    expect(() => handleRedirectResponse(response)).toThrow(
      "Cannot follow redirect to https://auth.different-domain.com",
    );
  });
});

// =============================================================================
// handleRedirectResponse - Same-origin redirect (client-side)
// =============================================================================

describe("handleRedirectResponse - same-origin redirect (client-side)", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    globalThis.window = {
      location: {
        origin: "https://app.example.com",
      },
    } as Window & typeof globalThis;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("throws misconfiguration error for same-origin redirect", () => {
    const response = createMockResponse(302, "https://app.example.com/api/other-endpoint");

    expect(() => handleRedirectResponse(response)).toThrow(
      "API endpoint unexpectedly redirected to https://app.example.com/api/other-endpoint. This may indicate a misconfiguration.",
    );
  });

  it("treats relative URL as same-origin on client", () => {
    const response = createMockResponse(302, "/api/redirect-target");

    expect(() => handleRedirectResponse(response)).toThrow(
      "API endpoint unexpectedly redirected to /api/redirect-target. This may indicate a misconfiguration.",
    );
  });

  it("includes context in client-side same-origin error", () => {
    const response = createMockResponse(302, "/api/redirect-target");

    expect(() => handleRedirectResponse(response, "fetching user data")).toThrow(
      "API endpoint unexpectedly redirected to /api/redirect-target (fetching user data). This may indicate a misconfiguration.",
    );
  });
});

// =============================================================================
// handleRedirectResponse - Invalid URL format
// =============================================================================

describe("handleRedirectResponse - invalid URL format", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // Simulate server-side environment
    // @ts-expect-error - intentionally setting window to undefined for SSR test
    globalThis.window = undefined;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("throws error for URL with invalid port number", () => {
    // URLs with non-numeric ports throw TypeError in the URL constructor
    const response = createMockResponse(302, "http://example.com:invalid-port/path");

    expect(() => handleRedirectResponse(response)).toThrow(
      "Invalid redirect location: http://example.com:invalid-port/path",
    );
  });
});
