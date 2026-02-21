/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CI license enforcement. Blocks unapproved licenses from being added.
 * Run via: pnpm licenses:check
 *
 * Exit codes:
 *   0 — all licenses approved (warnings may be printed)
 *   1 — one or more license violations found
 */

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ✅ Pass — permissive licenses compatible with Apache-2.0 distribution.
// CC-BY-4.0 is included for caniuse-lite (data/docs only, not code).
// MIT-0 is more permissive than MIT (removes attribution requirement).
const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "CC-BY-4.0",
  "WTFPL",
]);

// ⚠️  Warn — weak copyleft. Passes CI but requires legal review before shipping.
// LGPL-3.0-or-later covers @img/sharp-libvips-* (Next.js transitive, native lib,
// documented in NOTICE with LGPL compliance statement).
const WARNED = new Set([
  "LGPL-2.1",
  "LGPL-3.0",
  "LGPL-3.0-or-later",
  "MPL-2.0",
  "EPL-2.0",
]);

// ❌ Fail — strong copyleft, incompatible with proprietary Apache-2.0 distribution.
// (Anything not in ALLOWED or WARNED falls through to "deny".)
const _DENIED = new Set(["GPL-2.0", "GPL-3.0", "AGPL-3.0"]);

function getLicenseData() {
  const raw = execSync("pnpm licenses list --json --long --prod", {
    cwd: ROOT,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  }).toString();
  return JSON.parse(raw);
}

/**
 * Parse SPDX OR expressions like "(MIT OR CC0-1.0)" or "(WTFPL OR MIT)" and
 * return the constituent identifiers. Returns a single-element array for
 * plain identifiers (the common case).
 */
function parseSpdxOr(expression) {
  const stripped = expression.replace(/^\(|\)$/g, "");
  if (!stripped.includes(" OR ")) return [stripped];
  return stripped.split(" OR ").map((s) => s.trim());
}

/**
 * Classify a license expression as "allow", "warn", or "deny".
 * For OR expressions, the most permissive option governs.
 */
function classifyLicense(expression) {
  const parts = parseSpdxOr(expression);
  let result = "deny";
  for (const part of parts) {
    if (ALLOWED.has(part)) return "allow"; // short-circuit: any allowed part is enough
    if (WARNED.has(part) && result === "deny") result = "warn";
  }
  return result;
}

const licenseData = getLicenseData();

const warnings = [];
const violations = [];

for (const [license, packages] of Object.entries(licenseData)) {
  const verdict = classifyLicense(license);
  for (const pkg of packages) {
    const version = Array.isArray(pkg.versions)
      ? pkg.versions.join(", ")
      : (pkg.version ?? "unknown");
    const entry = { license, name: pkg.name, version };
    if (verdict === "allow") continue;
    if (verdict === "warn") {
      warnings.push(entry);
    } else {
      // DENIED or unrecognized → violation.
      violations.push(entry);
    }
  }
}

const total = Object.values(licenseData).reduce((s, p) => s + p.length, 0);

if (warnings.length > 0) {
  console.warn(
    "\n⚠️  License warnings — weak copyleft (review before distributing):",
  );
  for (const { license, name, version } of warnings) {
    console.warn(`   ${license.padEnd(22)} ${name}@${version}`);
  }
}

if (violations.length > 0) {
  console.error(
    "\n❌ License violations — incompatible with Apache-2.0 distribution:",
  );
  for (const { license, name, version } of violations) {
    console.error(`   ${license.padEnd(22)} ${name}@${version}`);
  }
  console.error(
    "\nFix: remove or replace the packages listed above before shipping.",
  );
  process.exit(1);
}

console.log(
  `✓ License check passed — ${total} packages, ${warnings.length} warning(s)`,
);
