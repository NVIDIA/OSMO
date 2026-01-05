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
import { parseJwtClaims, isTokenExpired, isTokenExpiringSoon } from "./token-utils";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a valid JWT token with the given payload.
 * JWT format: header.payload.signature (we use dummy header and signature)
 */
function createTestToken(payload: object): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const signature = "test-signature";
  return `${header}.${body}.${signature}`;
}

/**
 * Create a token with specific expiration time.
 * @param expiresInSeconds - seconds from now (negative for expired tokens)
 */
function createTokenWithExpiry(expiresInSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return createTestToken({ exp, email: "test@example.com" });
}

// =============================================================================
// parseJwtClaims Tests
// =============================================================================

describe("parseJwtClaims", () => {
  it("returns null for undefined token", () => {
    expect(parseJwtClaims(undefined)).toBeNull();
  });

  it("returns null for empty string token", () => {
    expect(parseJwtClaims("")).toBeNull();
  });

  it("returns null for token without payload part", () => {
    expect(parseJwtClaims("header-only")).toBeNull();
    expect(parseJwtClaims("header.")).toBeNull();
  });

  it("returns null for token with invalid base64 payload", () => {
    expect(parseJwtClaims("header.!!!invalid-base64!!!.signature")).toBeNull();
  });

  it("returns null for token with non-JSON payload", () => {
    const invalidPayload = btoa("not-json");
    expect(parseJwtClaims(`header.${invalidPayload}.signature`)).toBeNull();
  });

  it("parses valid JWT token claims", () => {
    const token = createTestToken({
      email: "user@example.com",
      preferred_username: "jdoe",
      exp: 1234567890,
      roles: ["osmo-user", "osmo-admin"],
    });

    const claims = parseJwtClaims(token);

    expect(claims).toEqual({
      email: "user@example.com",
      preferred_username: "jdoe",
      exp: 1234567890,
      roles: ["osmo-user", "osmo-admin"],
    });
  });

  it("handles tokens with minimal claims", () => {
    const token = createTestToken({ exp: 999 });
    const claims = parseJwtClaims(token);

    expect(claims).toEqual({ exp: 999 });
  });

  it("handles tokens with extra claims", () => {
    const token = createTestToken({
      email: "test@test.com",
      custom_claim: "some value",
      nested: { data: true },
    });
    const claims = parseJwtClaims(token);

    expect(claims?.email).toBe("test@test.com");
    // Extra claims are preserved
    expect((claims as Record<string, unknown>).custom_claim).toBe("some value");
  });
});

// =============================================================================
// isTokenExpired Tests
// =============================================================================

describe("isTokenExpired", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-05T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for null claims", () => {
    expect(isTokenExpired(null)).toBe(true);
  });

  it("returns true for claims without exp", () => {
    expect(isTokenExpired({ email: "test@test.com" })).toBe(true);
    expect(isTokenExpired({})).toBe(true);
  });

  it("returns true for expired token", () => {
    // Token expired 1 hour ago
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    expect(isTokenExpired({ exp: oneHourAgo })).toBe(true);
  });

  it("returns true for token expiring exactly now", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isTokenExpired({ exp: now })).toBe(true);
  });

  it("returns false for token expiring in the future", () => {
    // Token expires in 1 hour
    const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenExpired({ exp: oneHourFromNow })).toBe(false);
  });

  it("returns false for token expiring in 1 second", () => {
    const inOneSecond = Math.floor(Date.now() / 1000) + 1;
    expect(isTokenExpired({ exp: inOneSecond })).toBe(false);
  });
});

// =============================================================================
// isTokenExpiringSoon Tests
// =============================================================================

describe("isTokenExpiringSoon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-05T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for already expired token", () => {
    const expiredToken = createTokenWithExpiry(-60); // Expired 1 min ago
    expect(isTokenExpiringSoon(expiredToken, 300)).toBe(true); // 5 min threshold
  });

  it("returns true when token expires within threshold", () => {
    const token = createTokenWithExpiry(120); // Expires in 2 minutes
    expect(isTokenExpiringSoon(token, 300)).toBe(true); // 5 min threshold
  });

  it("returns false when token expires after threshold", () => {
    const token = createTokenWithExpiry(600); // Expires in 10 minutes
    expect(isTokenExpiringSoon(token, 300)).toBe(false); // 5 min threshold
  });

  it("returns false when token expires exactly at threshold", () => {
    const token = createTokenWithExpiry(300); // Expires in exactly 5 minutes
    // Boundary case: expiresIn < threshold is FALSE when equal, so NOT expiring soon
    expect(isTokenExpiringSoon(token, 300)).toBe(false);
  });

  it("returns false when token expires 1 second after threshold", () => {
    const token = createTokenWithExpiry(301); // Expires in 5 min + 1 sec
    expect(isTokenExpiringSoon(token, 300)).toBe(false);
  });

  it("returns true for invalid token (no exp)", () => {
    const tokenWithoutExp = createTestToken({ email: "test@test.com" });
    expect(isTokenExpiringSoon(tokenWithoutExp, 300)).toBe(true);
  });

  it("returns true for malformed token", () => {
    expect(isTokenExpiringSoon("not-a-valid-token", 300)).toBe(true);
  });

  it("handles zero threshold", () => {
    const token = createTokenWithExpiry(60); // Expires in 1 minute
    expect(isTokenExpiringSoon(token, 0)).toBe(false); // Not expiring within 0 seconds
  });

  it("handles large threshold", () => {
    const token = createTokenWithExpiry(3600); // Expires in 1 hour
    expect(isTokenExpiringSoon(token, 7200)).toBe(true); // 2 hour threshold
  });
});
