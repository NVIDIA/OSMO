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
 * Console utilities for managing _osmo_session cookies in local development.
 * Auth is handled by Envoy + OAuth2 Proxy in production. For local dev against
 * a real backend, copy the encrypted session cookies from Chrome DevTools
 * (Application > Cookies) since they're HttpOnly and not accessible via JS.
 *
 * The session is split across chunked cookies (e.g. _osmo_session_0,
 * _osmo_session_1) when the encrypted payload exceeds the 4KB cookie limit.
 *
 * Console API:
 *   devAuth.set(name, value) - Set a session cookie by name and value
 *   devAuth.status()         - Check if session cookies are present
 *   devAuth.clear()          - Clear all session cookies
 *   devAuth.help()           - Show setup instructions
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

export function setSessionCookie(name: string, value: string): void {
  if (!name || !value) {
    console.error("Usage: devAuth.set('_osmo_session_0', 'value')");
    return;
  }
  document.cookie = `${name}=${value};path=/;max-age=604800`;
  console.log(`%c${name} set successfully.`, "color: #22c55e; font-weight: bold;");
}

export function printHelp(): void {
  console.log("%c Local Dev Auth", "color: #3b82f6; font-weight: bold; font-size: 14px;");
  console.log("");
  console.log("%cTo authenticate local dev against production:", "font-weight: bold;");
  console.log("");
  console.log("%c1. Open the production app in Chrome DevTools → Application → Cookies", "color: #64748b;");
  console.log(
    "%c2. Find the %c_osmo_session_*%c cookies and copy each name + value",
    "color: #64748b;",
    "color: #22d3ee; font-family: monospace;",
    "color: #64748b;",
  );
  console.log(
    "%c   (they're HttpOnly, so they won't appear via document.cookie)",
    "color: #94a3b8; font-style: italic;",
  );
  console.log("%c3. Come back here and run for each cookie:", "color: #64748b;");
  console.log("");
  console.log(
    "%cdevAuth.set('_osmo_session_0', 'value_from_devtools')\ndevAuth.set('_osmo_session_1', 'value_from_devtools')",
    "background: #1e293b; color: #22d3ee; padding: 8px; border-radius: 4px; font-family: monospace;",
  );
  console.log("");
  console.log("%c4. Reload the page.", "color: #64748b;");
  console.log("");
  console.log(
    "%cAlternatively, use mock mode: %cpnpm dev:mock",
    "color: #64748b;",
    "color: #22d3ee; font-family: monospace;",
  );
}

export function printStatus(): void {
  const hasSession = hasSessionCookie();
  console.log(`Session cookie present: ${hasSession}`);
  if (!hasSession) {
    console.log("No _osmo_session cookies found. Run devAuth.help() for setup instructions.");
  }
}

declare global {
  interface Window {
    devAuth?: {
      set: typeof setSessionCookie;
      status: typeof printStatus;
      clear: typeof clearSessionCookies;
      help: typeof printHelp;
    };
  }
}

export function initDevAuth(showInstructions: boolean): void {
  if (typeof window === "undefined") return;

  window.devAuth = {
    set: setSessionCookie,
    status: printStatus,
    clear: clearSessionCookies,
    help: printHelp,
  };

  if (showInstructions) {
    setTimeout(printHelp, 1000);
  }
}
