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
 * Cross-platform dev server startup for Playwright's webServer.
 *
 * 1. Removes stale .next/dev/lock (Next.js doesn't clean up after crashes).
 * 2. Spawns `pnpm dev` with PORT from the environment.
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockFile = path.join(projectRoot, ".next", "dev", "lock");

// Remove stale lock file — ignore if it doesn't exist.
try {
  fs.unlinkSync(lockFile);
} catch {
  // ENOENT is expected when no stale lock exists.
}

const child = spawn("pnpm", ["dev"], {
  stdio: "inherit",
  cwd: projectRoot,
  env: { ...process.env },
});

child.on("exit", (code) => process.exit(code ?? 1));
