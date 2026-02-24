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
 * Server-side JWT refresh endpoint.
 *
 * Uses the RefreshToken cookie (set by Envoy) to exchange for fresh tokens
 * from Keycloak, with explicit scope=openid to ensure id_token is included.
 *
 * This solves the problem where Envoy's automatic refresh doesn't pass scope,
 * causing Keycloak to return tokens without the id_token.
 *
 * Flow:
 * 1. Client detects 401 → POST /api/auth/refresh
 * 2. Read RefreshToken from cookies
 * 3. Exchange with Keycloak: grant_type=refresh_token, scope=openid
 * 4. Set fresh IdToken, OauthHMAC, OauthExpires cookies
 * 5. Return 200 (client retries original request)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerOAuthConfig } from "@/lib/config/oauth-config";
import { FALLBACK_TOKEN_LIFETIME_SECONDS, decodeJwtPayload } from "@/lib/auth/jwt-utils";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  const requestHost = request.headers.get("host") || "unknown";
  const { clientId, clientSecret, tokenEndpoint, hostname: configHostname, scope, hmacSecret } = getServerOAuthConfig();

  // Read RefreshToken from cookies (set by Envoy during initial login)
  const refreshToken = request.cookies.get("RefreshToken")?.value;

  if (!refreshToken) {
    console.error("[Server Refresh] No RefreshToken cookie found - user must re-authenticate");
    return NextResponse.json({ error: "No refresh token available" }, { status: 401 });
  }

  // Exchange refresh token for new tokens with explicit scope
  const tokenParams = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret, // Required for confidential clients
    scope, // CRITICAL: Explicitly pass scope=openid to get id_token
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenParams.toString(),
    });
  } catch (error) {
    console.error("[Server Refresh] Token exchange network error:", error);
    return NextResponse.json({ error: "Token exchange failed" }, { status: 500 });
  }

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("[Server Refresh] Token exchange failed:", {
      status: tokenResponse.status,
      body: errorText,
    });
    return NextResponse.json({ error: "Token exchange failed", details: errorText }, { status: tokenResponse.status });
  }

  const tokenData = (await tokenResponse.json()) as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const { id_token: idToken, refresh_token: newRefreshToken } = tokenData;

  if (!idToken) {
    console.error("[Server Refresh] No id_token in response - Keycloak didn't return id_token despite scope=openid");
    return NextResponse.json({ error: "No id_token in token response" }, { status: 500 });
  }

  // Decode token to get expiration
  const payload = decodeJwtPayload(idToken);
  const exp = payload?.exp;
  const iat = payload?.iat;
  const tokenLifetimeSeconds =
    typeof exp === "number" && typeof iat === "number" ? exp - iat : FALLBACK_TOKEN_LIFETIME_SECONDS;

  // Determine hostname for cookie domain (strip port from request host)
  const hostname = configHostname || requestHost.split(":")[0];

  // Build response with cookies
  const response = NextResponse.json({ success: true });

  // Set IdToken cookie (used by JWT validation)
  response.cookies.set("IdToken", idToken, {
    maxAge: tokenLifetimeSeconds,
    path: "/", // CRITICAL: Must be "/" not basePath to match Envoy's cookies
    domain: hostname,
    secure: true,
    sameSite: "lax",
    httpOnly: false, // Client needs to read for x-osmo-auth header
  });

  // Set OauthHMAC cookie (Envoy validation)
  // Generate HMAC of the id_token using the SAME secret as Envoy
  // CRITICAL: Must use the same HMAC secret that Envoy uses, otherwise validation fails
  if (!hmacSecret) {
    console.error("[Server Refresh] OAUTH_HMAC_SECRET not configured - must match Envoy's HMAC secret");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  const hmac = crypto.createHmac("sha256", hmacSecret).update(idToken).digest("hex");

  response.cookies.set("OauthHMAC", hmac, {
    maxAge: tokenLifetimeSeconds,
    path: "/",
    domain: hostname,
    secure: true,
    sameSite: "lax",
    httpOnly: true,
  });

  // Set OauthExpires cookie (expiration timestamp)
  const expiresAt = typeof exp === "number" ? exp * 1000 : Date.now() + tokenLifetimeSeconds * 1000;
  response.cookies.set("OauthExpires", String(expiresAt), {
    maxAge: tokenLifetimeSeconds,
    path: "/",
    domain: hostname,
    secure: true,
    sameSite: "lax",
    httpOnly: false,
  });

  // Update RefreshToken if a new one was provided
  if (newRefreshToken) {
    response.cookies.set("RefreshToken", newRefreshToken, {
      maxAge: 60 * 60 * 24 * 7, // 7 days (matches Envoy's refresh token lifetime)
      path: "/",
      domain: hostname,
      secure: true,
      sameSite: "lax",
      httpOnly: true,
    });
  }

  return response;
}
