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
 * Dev Auth Helpers
 *
 * Console utilities for managing the _osmo_session cookie in local development.
 * Auth is handled by Envoy + OAuth2 Proxy in production. For local dev against
 * a real backend, copy the encrypted session cookie from production.
 *
 * Console API:
 *   devAuth.status()  - Check if session cookie is present
 *   devAuth.clear()   - Clear session cookies
 *   devAuth.help()    - Show setup instructions
 */

export function hasSessionCookie(): boolean {
  return document.cookie.split(";").some((c) => c.trim().startsWith("_osmo_session"));
}

export function clearSessionCookies(): void {
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const name = cookie.trim().split("=")[0];
    if (name && name.startsWith("_osmo_session")) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC`;
    }
  }
  console.log("Session cookies cleared");
}

export function printHelp(): void {
  console.log("%c Local Dev Auth", "color: #3b82f6; font-weight: bold; font-size: 14px;");
  console.log("");
  console.log("%cTo authenticate local dev against production:", "font-weight: bold;");
  console.log("");
  console.log("%c1. Open production app in browser console and run:", "color: #64748b;");
  console.log("");
  console.log(
    `%c${COPY_COOKIES_SNIPPET}`,
    "background: #1e293b; color: #22d3ee; padding: 8px; border-radius: 4px; font-family: monospace;",
  );
  console.log("");
  console.log("%c2. Come back here and paste the result into this console.", "color: #64748b;");
  console.log("");
  console.log(
    "%cAlternatively, use mock mode: %cpnpm dev:mock",
    "color: #64748b;",
    "color: #22d3ee; font-family: monospace;",
  );
}

const COPY_COOKIES_SNIPPET = `copy(document.cookie.split(";").filter(c=>c.trim().startsWith("_osmo_session")).map(c=>{const[k,v]=c.trim().split("=");return\`document.cookie="\${k}=\${v};path=/;max-age=604800";\`}).join("\\n"))`;

export function printStatus(): void {
  const hasSession = hasSessionCookie();
  console.log(`Session cookie present: ${hasSession}`);
  if (!hasSession) {
    console.log("No _osmo_session cookie. Run devAuth.help() for setup instructions.");
  }
}

declare global {
  interface Window {
    devAuth?: {
      status: typeof printStatus;
      clear: typeof clearSessionCookies;
      help: typeof printHelp;
    };
  }
}

export function initDevAuth(showInstructions: boolean): void {
  if (typeof window === "undefined") return;

  window.devAuth = {
    status: printStatus,
    clear: clearSessionCookies,
    help: printHelp,
  };

  if (showInstructions) {
    setTimeout(printHelp, 1000);
  }
}
