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

import { readFileSync } from "fs";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  hostname: string;
  scope: string;
  hmacSecret: string;
}

/**
 * Server-side only. Reads process.env at request time for Docker image portability.
 *
 * Scope defaults to "openid" to match Envoy's OAuth2 filter configuration.
 * This ensures token refresh requests the same scopes as initial login.
 *
 * HMAC Secret Sources (in order of precedence):
 * 1. OAUTH_HMAC_SECRET - Direct env var (Kubernetes secrets)
 * 2. OAUTH_HMAC_SECRET_FILE - File path (Vault-injected secrets)
 *
 * Note: In Keycloak, "Default" client scopes (profile, email, roles) are ALWAYS
 * applied regardless of the scope parameter. The scope parameter only controls
 * which "Optional" scopes are included.
 */
export function getServerOAuthConfig(): OAuthConfig {
  // Read client secret from env var or file
  let clientSecret = process.env.OAUTH_CLIENT_SECRET || "";
  if (!clientSecret && process.env.OAUTH_CLIENT_SECRET_FILE) {
    try {
      clientSecret = readFileSync(process.env.OAUTH_CLIENT_SECRET_FILE, "utf-8").trim();
    } catch (error) {
      console.error(
        `[OAuth Config] Failed to read client secret from file: ${process.env.OAUTH_CLIENT_SECRET_FILE}`,
        error,
      );
    }
  }

  // Read HMAC secret from env var or file
  let hmacSecret = process.env.OAUTH_HMAC_SECRET || "";
  if (!hmacSecret && process.env.OAUTH_HMAC_SECRET_FILE) {
    try {
      hmacSecret = readFileSync(process.env.OAUTH_HMAC_SECRET_FILE, "utf-8").trim();
    } catch (error) {
      console.error(
        `[OAuth Config] Failed to read HMAC secret from file: ${process.env.OAUTH_HMAC_SECRET_FILE}`,
        error,
      );
    }
  }

  return {
    clientId: process.env.OAUTH_CLIENT_ID || "",
    clientSecret,
    tokenEndpoint: process.env.OAUTH_TOKEN_ENDPOINT || "",
    hostname: process.env.OAUTH_HOSTNAME || "",
    scope: process.env.OAUTH_SCOPE || "openid",
    hmacSecret,
  };
}
