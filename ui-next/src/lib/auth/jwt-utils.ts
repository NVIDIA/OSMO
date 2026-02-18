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
 * JWT Utilities - Development Version
 *
 * Extends the production JWT utilities with cookie fallback for mock mode.
 * In production builds, this file is replaced with jwt-utils.ts via next.config.ts alias.
 *
 * DEVELOPMENT ONLY: Supports cookie fallback for local testing without Envoy.
 */

import { jwtDecode } from "jwt-decode";
import type { JwtClaims } from "@/lib/auth/jwt-utils.production";

// Re-export types, constants, and utilities that don't depend on extractToken
export type { JwtClaims };
export { FALLBACK_TOKEN_LIFETIME_SECONDS, decodeJwtPayload } from "@/lib/auth/jwt-utils.production";

/**
 * Extract JWT token from Authorization header or cookies.
 *
 * DEVELOPMENT: Supports cookie fallback for mock mode
 * PRODUCTION: This entire file is replaced with jwt-utils.ts
 *
 * @param request - The request object with headers
 * @returns The JWT token string or null if not found
 */
export function extractToken(request: Request): string | null {
  // Always check Authorization header first (production with Envoy)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7); // Remove "Bearer " prefix
  }

  // DEV ONLY: Check cookies for mock mode
  // This entire cookie parsing block will be removed in production builds
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").reduce(
      (acc, cookie) => {
        const [key, value] = cookie.trim().split("=");
        if (key) acc[key] = value;
        return acc;
      },
      {} as Record<string, string>,
    );

    // Check IdToken first (what Envoy sets), then BearerToken
    return cookies["IdToken"] || cookies["BearerToken"] || null;
  }

  return null;
}

/**
 * Decode and parse JWT claims using dev extractToken (with cookie fallback).
 */
export function getJwtClaims(request: Request): JwtClaims | null {
  const token = extractToken(request); // Uses dev version with cookie fallback
  if (!token) {
    return null;
  }

  try {
    return jwtDecode<JwtClaims>(token);
  } catch (error) {
    console.error("Failed to decode JWT:", error);
    return null;
  }
}

/**
 * Get the username from the JWT token (uses dev getJwtClaims).
 */
export function getUsername(request: Request): string | null {
  const claims = getJwtClaims(request);
  return claims?.preferred_username ?? null;
}
