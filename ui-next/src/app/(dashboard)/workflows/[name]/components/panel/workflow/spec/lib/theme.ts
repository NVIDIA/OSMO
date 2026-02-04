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

// =============================================================================
// Theme Colors
// =============================================================================

const darkColors = {
  // Backgrounds
  bg: "#1e1e1e",
  gutterBg: "#252526",
  activeLineBg: "rgba(255, 255, 255, 0.05)",
  selectionBg: "rgba(118, 185, 0, 0.2)", // NVIDIA green

  // Text
  text: "#d4d4d4",
  lineNumber: "#858585",
  lineNumberActive: "#c6c6c6",

  // Cursor
  cursor: "#aeafad",
  matchingBracket: "rgba(255, 255, 255, 0.1)",

  // Syntax (VS Code Dark+)
  keyword: "#569cd6",
  string: "#ce9178",
  number: "#b5cea8",
  boolean: "#569cd6",
  property: "#9cdcfe",
  comment: "#6a9955",
  operator: "#d4d4d4",
  punctuation: "#d4d4d4",
  function: "#dcdcaa",
  variable: "#9cdcfe",
  tag: "#569cd6",
};

const lightColors = {
  // Backgrounds
  bg: "#ffffff",
  gutterBg: "#f5f5f5",
  activeLineBg: "rgba(0, 0, 0, 0.03)",
  selectionBg: "rgba(118, 185, 0, 0.15)", // NVIDIA green

  // Text
  text: "#000000",
  lineNumber: "#6e7681",
  lineNumberActive: "#24292f",

  // Cursor
  cursor: "#24292f",
  matchingBracket: "rgba(0, 0, 0, 0.1)",

  // Syntax (VS Code Light+)
  keyword: "#0000ff",
  string: "#a31515",
  number: "#098658",
  boolean: "#0000ff",
  property: "#001080",
  comment: "#008000",
  operator: "#000000",
  punctuation: "#000000",
  function: "#795e26",
  variable: "#001080",
  tag: "#0000ff",
};

// =============================================================================
// Theme Functions
// =============================================================================

/**
 * Creates a theme-aware CodeMirror theme.
 * @param isDark - Whether to use dark mode colors
 */
export function createSpecViewerTheme(isDark: boolean) {
  const colors = isDark ? darkColors : lightColors;
  const borderColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)";
  const outlineColor = isDark ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.2)";

  return EditorView.theme(
    {
      // Main editor container
      "&": {
        backgroundColor: colors.bg,
        color: colors.text,
        fontSize: "13px",
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      },

      // Content area
      ".cm-content": {
        caretColor: colors.cursor,
        padding: "8px 0",
      },

      // Cursor
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: colors.cursor,
        borderLeftWidth: "2px",
      },

      // Selection
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: colors.selectionBg,
      },

      // Active line
      ".cm-activeLine": {
        backgroundColor: colors.activeLineBg,
      },

      // Gutter
      ".cm-gutters": {
        backgroundColor: colors.gutterBg,
        color: colors.lineNumber,
        border: "none",
        borderRight: `1px solid ${borderColor}`,
      },

      // Line numbers
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 12px 0 8px",
        minWidth: "40px",
      },

      // Active line number
      ".cm-activeLineGutter": {
        backgroundColor: colors.activeLineBg,
        color: colors.lineNumberActive,
      },

      // Fold gutter
      ".cm-foldGutter .cm-gutterElement": {
        padding: "0 4px",
        cursor: "pointer",
      },

      // Matching bracket
      "&.cm-focused .cm-matchingBracket": {
        backgroundColor: colors.matchingBracket,
        outline: `1px solid ${outlineColor}`,
      },

      // Scrollbar
      ".cm-scroller": {
        overflow: "auto",
      },

      // Fold placeholder
      ".cm-foldPlaceholder": {
        backgroundColor: borderColor,
        border: "none",
        color: colors.lineNumber,
        padding: "0 4px",
        borderRadius: "2px",
      },
    },
    { dark: isDark },
  );
}

/**
 * Creates syntax highlighting for the spec viewer.
 * @param isDark - Whether to use dark mode colors
 */
export function createSpecHighlightStyle(isDark: boolean) {
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
 * Creates the combined theme extension for the spec viewer.
 * @param isDark - Whether to use dark mode colors
 */
export function createSpecViewerExtension(isDark: boolean) {
  return [createSpecViewerTheme(isDark), syntaxHighlighting(createSpecHighlightStyle(isDark))];
}
