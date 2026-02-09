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
 * Dev Auth Transfer Helper
 *
 * Provides console helpers for copying authentication from production to local dev.
 * Only loaded in development mode - tree-shaken in production.
 */

/**
 * Command that extracts auth cookies and copies a paste-ready command to clipboard.
 * User runs this in production console, then pastes the result in dev console.
 */
const EXTRACT_AUTH_COMMAND = `(() => { const tokens = document.cookie.split(';').map(c => c.trim()).filter(c => c.startsWith('IdToken=') || c.startsWith('BearerToken=')); if (tokens.length === 0) { console.error('❌ No auth tokens found'); return; } const commands = tokens.map(token => { const [name, value] = token.split('='); return \`document.cookie = "\${name}=\${value}; path=/; max-age=28800";\`; }).join(' '); copy(commands + ' location.reload();'); console.log('✅ Auth command copied! Paste in dev console.'); })();`;

/**
 * Expose helper to window for easier access
 */
declare global {
  interface Window {
    copyAuthFromProduction?: () => void;
  }
}

/**
 * Print auth transfer instructions to console.
 */
function printAuthInstructions() {
  console.log(
    "%c┌─────────────────────────────────────────────────────────────┐",
    "color: #3b82f6; font-weight: bold;",
  );
  console.log(
    "%c│  🔐 Local Dev Auth Helper                                   │",
    "color: #3b82f6; font-weight: bold;",
  );
  console.log(
    "%c└─────────────────────────────────────────────────────────────┘",
    "color: #3b82f6; font-weight: bold;",
  );
  console.log("");
  console.log("%cTo copy auth from production:", "font-weight: bold;");
  console.log("");
  console.log("%c1. Copy this command:", "color: #64748b;");
  console.log(
    "%c" + EXTRACT_AUTH_COMMAND,
    "background: #1e293b; color: #22d3ee; padding: 8px; border-radius: 4px; font-family: monospace;",
  );
  console.log("");
  console.log("%c2. Open production app console", "color: #64748b;");
  console.log("%c3. Paste and run the command", "color: #64748b;");
  console.log("%c4. Come back here and paste the result", "color: #64748b;");
  console.log("");
  console.log(
    "%cAlternatively, use mock mode: %cpnpm dev:mock",
    "color: #64748b;",
    "color: #22d3ee; font-family: monospace;",
  );
  console.log("");
  console.log("%cRun %ccopyAuthFromProduction()%c to see these instructions again", "color: #64748b;", "color: #22d3ee; font-family: monospace;", "color: #64748b;");
  console.log("");
}

/**
 * Initialize auth transfer helper in dev mode.
 * Prints instructions to console on app load.
 */
export function initAuthTransferHelper() {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") {
    return;
  }

  // Expose helper to window for easy access
  window.copyAuthFromProduction = printAuthInstructions;

  // Wait for console to be ready, then print instructions
  setTimeout(printAuthInstructions, 1000);
}
