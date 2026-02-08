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
 * CodeMirror extensions for CodeViewer
 *
 * Provides generic extensions for code viewing:
 * - Syntax highlighting (via language extension)
 * - Indentation markers
 * - Code folding with custom markers
 * - Search panel
 * - Theme configuration
 */

import { yaml } from "@codemirror/lang-yaml";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { foldGutter } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { createCodeViewerExtension } from "./theme";
import { createSearchPanel } from "./search-panel";
import type { LanguageExtension } from "../types";

/** YAML language extension preset for specs, configs, and templates */
export const YAML_LANGUAGE: LanguageExtension = {
  name: "YAML",
  extension: yaml(),
};

/**
 * Creates a native SVG chevron for fold gutter markers.
 * Uses raw DOM instead of React to avoid root creation/cleanup overhead.
 */
function createChevronMarker(open: boolean): HTMLElement {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.justifyContent = "center";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", open ? "6 9 12 15 18 9" : "9 18 15 12 9 6");
  svg.appendChild(polyline);

  container.appendChild(svg);
  return container;
}

/**
 * Creates CodeMirror extensions for both viewer and editor modes.
 * Caller should memoize the result to avoid recreating on every render.
 *
 * @param languageExtension - Language-specific syntax highlighting
 * @param ariaLabel - Accessible label for the editor
 * @param isDark - Whether dark theme is active
 * @param readOnly - Whether the editor is read-only (viewer mode)
 */
export function createExtensions(
  languageExtension: Extension | Extension[],
  ariaLabel: string,
  isDark: boolean,
  readOnly: boolean,
): Extension[] {
  return [
    // Theme and syntax highlighting
    ...createCodeViewerExtension(isDark),

    // Language support (provided by caller)
    languageExtension,

    // Indentation markers (VS Code-style vertical guides)
    indentationMarkers({
      highlightActiveBlock: !readOnly, // Highlight active block only in edit mode
      hideFirstIndent: false,
      markerType: "fullScope",
      thickness: 1,
      colors: {
        light: "rgba(0, 0, 0, 0.08)",
        dark: "rgba(255, 255, 255, 0.08)",
        activeLight: "rgba(0, 0, 0, 0.12)",
        activeDark: "rgba(255, 255, 255, 0.12)",
      },
    }),

    // Code folding with SVG chevron markers
    foldGutter({ markerDOM: createChevronMarker }),

    // Search with custom panel (icon-based, theme-aware)
    search({ createPanel: createSearchPanel(isDark) }),
    keymap.of(searchKeymap),

    // Read-only state (only in viewer mode)
    ...(readOnly ? [EditorState.readOnly.of(true)] : []),

    // Show cursor in edit mode (theme hides it by default)
    ...(!readOnly
      ? [
          EditorView.theme({
            ".cm-cursor, .cm-dropCursor": { display: "block !important" },
            "&.cm-focused .cm-cursor": {
              display: "block !important",
              borderLeftColor: "hsl(var(--foreground))",
            },
            ".cm-cursorLayer": { display: "block !important" },
            ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.05)" },
          }),
        ]
      : []),

    // Accessibility
    EditorView.contentAttributes.of({ "aria-label": ariaLabel }),

    // Scroll margin for comfortable reading/editing
    EditorView.scrollMargins.of(() => ({ top: 50, bottom: 50 })),
  ];
}
