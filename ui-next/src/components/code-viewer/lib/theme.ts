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
 * CodeMirror Theme - Theme-Aware
 *
 * Supports both light and dark modes, matching the app theme.
 *
 * Color tokens:
 * - Dark mode: VS Code Dark+
 * - Light mode: VS Code Light+
 * - Selection: NVIDIA green at 20% opacity
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const darkColors = {
  // Backgrounds - use CSS variables from globals.css
  bg: "var(--table-header)", // #18181b (zinc-900) - matches activity strip
  gutterBg: "var(--table-header)",
  activeLineBg: "rgba(255, 255, 255, 0.05)",
  selectionBg: "var(--nvidia-green-bg-dark)", // NVIDIA green from globals.css

  // Text - use CSS variables
  text: "hsl(var(--foreground))",
  lineNumber: "hsl(var(--muted-foreground))",
  lineNumberActive: "hsl(var(--foreground))",

  // Cursor
  cursor: "hsl(var(--foreground))",
  matchingBracket: "rgba(255, 255, 255, 0.1)",

  // Syntax (VS Code Dark+)
  keyword: "#569cd6",
  string: "#ce9178",
  number: "#b5cea8",
  boolean: "#569cd6",
  property: "#9cdcfe",
  comment: "#6a9955",
  operator: "hsl(var(--foreground))",
  punctuation: "hsl(var(--foreground))",
  function: "#dcdcaa",
  variable: "#9cdcfe",
  tag: "#569cd6",
};

const lightColors = {
  // Backgrounds - use CSS variables from globals.css
  bg: "hsl(var(--background))", // Maps to white in light mode
  gutterBg: "hsl(var(--background))",
  activeLineBg: "rgba(0, 0, 0, 0.03)",
  selectionBg: "var(--nvidia-green-bg)", // NVIDIA green from globals.css

  // Text - use CSS variables
  text: "hsl(var(--foreground))",
  lineNumber: "hsl(var(--muted-foreground))",
  lineNumberActive: "hsl(var(--foreground))",

  // Cursor
  cursor: "hsl(var(--foreground))",
  matchingBracket: "rgba(0, 0, 0, 0.1)",

  // Syntax (VS Code Light+)
  keyword: "#0000ff",
  string: "#a31515",
  number: "#098658",
  boolean: "#0000ff",
  property: "#001080",
  comment: "#008000",
  operator: "hsl(var(--foreground))",
  punctuation: "hsl(var(--foreground))",
  function: "#795e26",
  variable: "#001080",
  tag: "#0000ff",
};

/**
 * Creates a minimal CodeMirror theme for base container initialization.
 * Structural and interactive styles are in code-viewer-theme.css.
 * @param isDark - Whether to use dark mode colors
 */
export function createCodeViewerTheme(isDark: boolean) {
  return EditorView.theme(
    {
      // Base container - minimal JS-side styles for CodeMirror initialization
      "&": {
        backgroundColor: "var(--cm-bg)",
        color: "hsl(var(--foreground))",
        fontSize: "0.8125rem", // 13px - use rem for scaling
        fontFamily: "var(--font-mono)",
      },

      // Editor wrapper
      ".cm-editor": {
        backgroundColor: "var(--cm-bg)",
      },

      // Content area
      ".cm-content": {
        caretColor: "hsl(var(--foreground))",
        padding: "0.5rem 0", // 8px in rem
      },
    },
    { dark: isDark },
  );
}

/**
 * Creates syntax highlighting for the code viewer.
 * @param isDark - Whether to use dark mode colors
 */
export function createCodeViewerHighlightStyle(isDark: boolean) {
  const colors = isDark ? darkColors : lightColors;

  return HighlightStyle.define([
    // Keywords and operators
    { tag: tags.keyword, color: colors.keyword },
    { tag: tags.operator, color: colors.operator },
    { tag: tags.punctuation, color: colors.punctuation },

    // Literals
    { tag: tags.string, color: colors.string },
    { tag: tags.number, color: colors.number },
    { tag: tags.bool, color: colors.boolean },
    { tag: tags.null, color: colors.keyword },

    // Properties and keys (important for YAML)
    { tag: tags.propertyName, color: colors.property },
    { tag: tags.definition(tags.propertyName), color: colors.property },

    // Comments
    { tag: tags.comment, color: colors.comment, fontStyle: "italic" },

    // Functions and variables
    { tag: tags.function(tags.variableName), color: colors.function },
    { tag: tags.variableName, color: colors.variable },

    // Tags (for YAML anchors/aliases)
    { tag: tags.tagName, color: colors.tag },
    { tag: tags.labelName, color: colors.tag },
  ]);
}

/**
 * Creates the combined theme extension for the code viewer.
 * Structural styles are in code-viewer-theme.css.
 * @param isDark - Whether to use dark mode colors
 */
export function createCodeViewerExtension(isDark: boolean) {
  return [createCodeViewerTheme(isDark), syntaxHighlighting(createCodeViewerHighlightStyle(isDark))];
}
