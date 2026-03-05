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

export interface LocalpathWarnings {
  hasFileLocalpath: boolean;
  hasDatasetLocalpath: boolean;
}

interface ParsedKey {
  name: string;
  isBlock: boolean;
}

/** Count leading whitespace characters (spaces and tabs). Returns `line.length` for blank lines. */
function leadingWhitespace(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== " " && line[i] !== "\t") return i;
  }
  return line.length;
}

function isOnlyWhitespaceAfter(line: string, from: number): boolean {
  for (let i = from; i < line.length; i++) {
    if (line[i] !== " " && line[i] !== "\t") return false;
  }
  return true;
}

/**
 * Lines deeper than the block are inside. Lines at the same level are inside
 * only if they are list continuations (start with "-").
 */
function isInsideBlock(lineIndent: number, blockIndent: number, line: string): boolean {
  if (lineIndent > blockIndent) return true;
  return lineIndent === blockIndent && line[lineIndent] === "-";
}

/** Strips an optional leading list marker ("- ") before extracting the key. */
function parseYamlKey(line: string, indent: number): ParsedKey | null {
  let keyStart = indent;

  if (line[keyStart] === "-" && keyStart + 1 < line.length && line[keyStart + 1] === " ") {
    for (keyStart += 2; keyStart < line.length && line[keyStart] === " "; keyStart++) {}
  }

  const colonPos = line.indexOf(":", keyStart);
  if (colonPos === -1) return null;

  return {
    name: line.substring(keyStart, colonPos),
    isBlock: isOnlyWhitespaceAfter(line, colonPos + 1),
  };
}

/**
 * Detect `localpath:` usage in a YAML workflow spec.
 *
 * - `hasFileLocalpath`: `localpath:` inside a `files:` block (browser cannot read local files).
 * - `hasDatasetLocalpath`: `localpath:` inside a `dataset:` block (browser cannot rsync).
 */
export function detectLocalpathUsage(spec: string): LocalpathWarnings {
  if (!spec.includes("localpath:")) {
    return { hasFileLocalpath: false, hasDatasetLocalpath: false };
  }

  let hasFileLocalpath = false;
  let hasDatasetLocalpath = false;
  let context: "files" | "dataset" | null = null;
  let contextIndent = 0;

  for (const line of spec.split("\n")) {
    const indent = leadingWhitespace(line);
    if (indent === line.length) continue;

    if (context !== null && !isInsideBlock(indent, contextIndent, line)) {
      context = null;
    }

    if (line.indexOf(":", indent) === -1) continue; // fast path: no key on this line
    const parsed = parseYamlKey(line, indent);
    if (parsed === null) continue;

    // files: must be nested (indent > 0) to exclude top-level `files:` keys that are
    // not task file lists. dataset: is valid at any indent level, including root.
    if (parsed.name === "files" && indent > 0 && parsed.isBlock) {
      context = "files";
      contextIndent = indent;
    } else if (parsed.name === "dataset" && parsed.isBlock) {
      context = "dataset";
      contextIndent = indent;
    } else if (parsed.name === "localpath" && context !== null) {
      if (context === "files") hasFileLocalpath = true;
      else hasDatasetLocalpath = true;
      if (hasFileLocalpath && hasDatasetLocalpath) break;
    }
  }

  return { hasFileLocalpath, hasDatasetLocalpath };
}
