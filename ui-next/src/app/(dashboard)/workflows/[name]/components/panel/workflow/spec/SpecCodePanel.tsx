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
 * SpecCodePanel - CodeMirror-based code viewer
 *
 * Displays YAML/template content with syntax highlighting, line numbers,
 * and code folding. Theme-aware (respects light/dark mode).
 *
 * Features:
 * - YAML syntax highlighting
 * - Line numbers
 * - Code folding
 * - Read-only mode
 * - Accessible (ARIA labels)
 * - Virtualized rendering (handled by CodeMirror)
 */

"use client";

import { memo, useMemo, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { foldGutter } from "@codemirror/language";
import { search, searchKeymap, closeSearchPanel } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { createSpecViewerExtension } from "./lib/theme";
import { createSearchPanel } from "./lib/search-panel";
import { useMounted } from "@/hooks/use-mounted";
import type { SpecView } from "./hooks/useSpecData";
import "./spec-search.css";

// =============================================================================
// Types
// =============================================================================

export interface SpecCodePanelProps {
  /** Content to display */
  content: string;
  /** Language mode (yaml or template - both use YAML highlighting for MVP) */
  language: SpecView;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Accessible label for the editor */
  "aria-label"?: string;
  /** Additional class name */
  className?: string;
}

// =============================================================================
// Extensions
// =============================================================================

/**
 * Creates a native SVG chevron icon for fold markers.
 * Using native SVG avoids React root creation/cleanup overhead and memory leaks.
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
 * Create CodeMirror extensions for the spec viewer.
 * Memoized per language and theme to avoid recreating on every render.
 */
function createExtensions(language: SpecView, readOnly: boolean, isDark: boolean) {
  const extensions = [
    // Theme and syntax highlighting
    ...createSpecViewerExtension(isDark),

    // Language support (YAML for both - template mixed mode is Phase 2)
    yaml(),

    // Indentation markers (VS Code-style vertical guides)
    indentationMarkers({
      highlightActiveBlock: false, // Disable for performance
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
    foldGutter({
      markerDOM: (open) => createChevronMarker(open),
    }),

    // Search support with custom panel (icon-based, theme-aware)
    search({
      createPanel: createSearchPanel(isDark),
    }),

    // Search keymaps
    keymap.of(searchKeymap),

    // Read-only state
    EditorState.readOnly.of(readOnly),

    // Accessibility
    EditorView.contentAttributes.of({
      "aria-label": language === "yaml" ? "YAML workflow specification" : "Workflow template",
    }),

    // Scroll margin for virtualization
    EditorView.scrollMargins.of(() => ({ top: 50, bottom: 50 })), // px values are OK here (not CSS)
  ];

  return extensions;
}

// =============================================================================
// Component
// =============================================================================

export const SpecCodePanel = memo(function SpecCodePanel({
  content,
  language,
  readOnly = true,
  "aria-label": ariaLabel,
  className,
}: SpecCodePanelProps) {
  // Wait for hydration to get accurate theme
  const mounted = useMounted();
  const { theme, resolvedTheme } = useTheme();

  // Store editor view reference to close search panel when view changes
  const viewRef = useRef<EditorView | null>(null);

  // Default to dark during SSR, then use actual theme after hydration
  // This prevents hydration mismatch and ensures consistent rendering
  const isDark = !mounted ? true : (resolvedTheme ?? theme ?? "dark") === "dark";

  // Memoize extensions to prevent unnecessary CodeMirror re-renders
  const extensions = useMemo(() => createExtensions(language, readOnly, isDark), [language, readOnly, isDark]);

  // Close search panel when switching between YAML/Template views
  useEffect(() => {
    if (viewRef.current) {
      closeSearchPanel(viewRef.current);
    }
  }, [language]);

  return (
    <div
      className={className}
      role="region"
      aria-label={ariaLabel ?? `${language.toUpperCase()} specification`}
    >
      <CodeMirror
        value={content}
        theme={isDark ? "dark" : "light"}
        extensions={extensions}
        readOnly={readOnly}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: false,
          highlightActiveLine: true,
          foldGutter: false, // We use our own fold gutter
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: false,
          bracketMatching: true,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          crosshairCursor: false,
          highlightSelectionMatches: true,
          closeBracketsKeymap: false,
          searchKeymap: true,
          foldKeymap: true,
          completionKeymap: false,
          lintKeymap: false,
        }}
        // Fill available space
        height="100%"
        style={{ height: "100%" }}
      />
    </div>
  );
});
