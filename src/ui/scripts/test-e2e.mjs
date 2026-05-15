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
 * Wrapper that resolves the dev-server port before spawning Playwright.
 *
 * Port resolution must happen outside the Playwright process — doing it inside
 * playwright.config.ts races with Playwright's own webServer lifecycle and
 * causes intermittent lock-file conflicts on Next.js.
 * See: https://github.com/microsoft/playwright/issues/31235
 *
 * Resolution order:
 *   1. $PORT env var — caller pins a specific port.
 *   2. localhost:3000 already responding — reuse the running dev server.
 *   3. Otherwise — ask the OS for any free port (bind to 0, read back).
 *
 * Usage (via package.json scripts):
 *   node scripts/test-e2e.mjs              # headless
 *   node scripts/test-e2e.mjs --ui         # interactive UI mode
 *   node scripts/test-e2e.mjs --headed     # headed
 */

import net from "net";
import http from "http";
import { spawn } from "child_process";

/** Ask the OS for a free port by binding to 0. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        server.close(() => reject(new Error("server.address() returned null or string")));
        return;
      }
      server.close(() => resolve(addr.port));
    });
    server.on("error", reject);
  });
}

/** Return true if an HTTP server is already responding on the given URL. */
function isResponding(url) {
  return new Promise((resolve) => {
    const req = http.get(url, () => {
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2_000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function resolvePort() {
  if (process.env.PORT) return parseInt(process.env.PORT, 10);
  if (await isResponding("http://localhost:3000")) return 3000;
  return findFreePort();
}

const port = await resolvePort();
// Strip the "--" separator that pnpm injects when forwarding extra args.
const extraArgs = process.argv.slice(2).filter((a) => a !== "--");

const child = spawn("pnpm", ["exec", "playwright", "test", ...extraArgs], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(port) },
});

child.on("exit", (code) => process.exit(code ?? 1));
