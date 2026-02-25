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
 * Dev Auth Transfer Helper
 *
 * Helps copy the _osmo_session cookie from a production browser to local dev.
 * The cookie is encrypted and validated by OAuth2 Proxy on the production Envoy.
 * Local dev proxies requests to prod Envoy, forwarding this cookie for auth.
 *
 * Only loaded in development mode.
 */

declare global {
  interface Window {
    copyAuthFromProduction?: () => void;
  }
}

function printAuthInstructions() {
  console.log("%c Local Dev Auth Helper", "color: #3b82f6; font-weight: bold; font-size: 14px;");
  console.log("");
  console.log("%cTo authenticate local dev against production:", "font-weight: bold;");
  console.log("");
  console.log("%c1. Open production app in browser", "color: #64748b;");
  console.log("%c2. DevTools > Application > Cookies", "color: #64748b;");
  console.log("%c3. Copy the _osmo_session cookie value", "color: #64748b;");
  console.log("%c   (If split: also copy _osmo_session_0, _osmo_session_1, etc.)", "color: #94a3b8;");
  console.log("%c4. Come back here and run:", "color: #64748b;");
  console.log(
    '%cdocument.cookie = "_osmo_session=<value>; path=/; max-age=604800";',
    "background: #1e293b; color: #22d3ee; padding: 8px; border-radius: 4px; font-family: monospace;",
  );
  console.log("");
  console.log(
    "%cAlternatively, use mock mode: %cpnpm dev:mock",
    "color: #64748b;",
    "color: #22d3ee; font-family: monospace;",
  );
}

export function initAuthTransferHelper() {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") {
    return;
  }

  window.copyAuthFromProduction = printAuthInstructions;

  setTimeout(printAuthInstructions, 1000);
}
