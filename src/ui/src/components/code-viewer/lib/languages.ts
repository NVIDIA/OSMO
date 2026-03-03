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
 * Language presets for CodeMirror.
 *
 * This file intentionally does NOT import from @codemirror/view or other heavy
 * CodeMirror packages so that language presets can be passed as props to the
 * lazily-loaded CodeMirror component without pulling the heavy bundle eagerly.
 */

import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import type { LanguageExtension } from "@/components/code-viewer/lib/types";

/** YAML language extension preset for specs, configs, and templates */
export const YAML_LANGUAGE: LanguageExtension = {
  name: "YAML",
  extension: yaml(),
};

export const JSON_LANGUAGE: LanguageExtension = {
  name: "JSON",
  extension: json(),
};

export const MARKDOWN_LANGUAGE: LanguageExtension = {
  name: "Markdown",
  extension: markdown(),
};

export const PYTHON_LANGUAGE: LanguageExtension = {
  name: "Python",
  extension: python(),
};

export const XML_LANGUAGE: LanguageExtension = {
  name: "XML",
  extension: xml(),
};

export const PLAIN_TEXT_LANGUAGE: LanguageExtension = {
  name: "Text",
  extension: [],
};

/**
 * Resolves a CodeMirror language preset from a MIME content type and file name.
 * Falls back to plain text when no specific language matches.
 */
export function getLanguageForContentType(contentType: string, fileName: string): LanguageExtension {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (contentType.includes("json") || ext === "json") return JSON_LANGUAGE;
  if (contentType.includes("yaml") || ext === "yaml" || ext === "yml") return YAML_LANGUAGE;
  if (contentType.includes("xml") || ext === "xml") return XML_LANGUAGE;
  if (contentType.startsWith("text/markdown") || ext === "md" || ext === "mdx") return MARKDOWN_LANGUAGE;
  if (contentType.startsWith("application/x-python") || contentType.startsWith("text/x-python") || ext === "py")
    return PYTHON_LANGUAGE;

  return PLAIN_TEXT_LANGUAGE;
}
