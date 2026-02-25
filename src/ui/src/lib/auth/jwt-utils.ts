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

/**
 * JWT Utilities - Development Version
 *
 * In production, this file is replaced with jwt-utils.production.ts
 * via next.config.ts alias.
 *
 * Development: Extracts token from Authorization header only.
 * When running locally against prod Envoy, the Authorization header
 * is not present on the Next.js inbound request (it's on the Envoy side).
 * The /api/me endpoint falls back to dev user info in this case.
 */

import { jwtDecode } from "jwt-decode";
import type { JwtClaims } from "@/lib/auth/jwt-utils.production";

export type { JwtClaims };
export { FALLBACK_TOKEN_LIFETIME_SECONDS, decodeJwtPayload } from "@/lib/auth/jwt-utils.production";

export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

export function getJwtClaims(request: Request): JwtClaims | null {
  const token = extractToken(request);
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

export function getUsername(request: Request): string | null {
  const claims = getJwtClaims(request);
  return claims?.preferred_username ?? null;
}
