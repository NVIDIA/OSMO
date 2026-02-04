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
 * CodeMirror Theme - VS Code Dark+ Compatible
 *
 * Dark theme for the spec viewer that matches VS Code's Dark+ theme.
 * Always dark regardless of app theme (code editors are expected to be dark).
 *
 * Color tokens from VS Code Dark+:
 * - Background: #1e1e1e
 * - Gutter: #252526
 * - Line numbers: #858585
 * - Selection: NVIDIA green at 20% opacity
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// =============================================================================
// Theme Colors (VS Code Dark+ compatible)
// =============================================================================

const colors = {
  // Backgrounds
  bg: "#1e1e1e",
  gutterBg: "#252526",
  activeLineBg: "rgba(255, 255, 255, 0.05)",
  selectionBg: "rgba(118, 185, 0, 0.2)", // NVIDIA green selection

  // Text
  text: "#d4d4d4",
  lineNumber: "#858585",
  lineNumberActive: "#c6c6c6",

  // Cursor and caret
  cursor: "#aeafad",
  matchingBracket: "rgba(255, 255, 255, 0.1)",

  // Syntax highlighting (VS Code Dark+ tokens)
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

  // Jinja-specific (for future mixed mode)
  jinjaDelim: "#d4d4d4",
  jinjaVariable: "#dcdcaa",
  jinjaKeyword: "#c586c0",
};

// =============================================================================
// Editor Theme
// =============================================================================

export const specViewerTheme = EditorView.theme(
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
      borderRight: "1px solid rgba(255, 255, 255, 0.1)",
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
      outline: "1px solid rgba(255, 255, 255, 0.2)",
    },

    // Scrollbar
    ".cm-scroller": {
      overflow: "auto",
    },

    // Fold placeholder
    ".cm-foldPlaceholder": {
      backgroundColor: "rgba(255, 255, 255, 0.1)",
      border: "none",
      color: colors.lineNumber,
      padding: "0 4px",
      borderRadius: "2px",
    },
  },
  { dark: true },
);

// =============================================================================
// Syntax Highlighting
// =============================================================================

export const specHighlightStyle = HighlightStyle.define([
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

// =============================================================================
// Combined Extension
// =============================================================================

/**
 * Combined theme extension for the spec viewer.
 * Includes both the editor theme and syntax highlighting.
 */
export const specViewerExtension = [specViewerTheme, syntaxHighlighting(specHighlightStyle)];
