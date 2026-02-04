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
 * Displays YAML/Jinja content with syntax highlighting, line numbers,
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

import { memo, useMemo } from "react";
import { useTheme } from "next-themes";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { foldGutter } from "@codemirror/language";
import { search } from "@codemirror/search";
import { createSpecViewerExtension } from "./lib/theme";
import { useMounted } from "@/hooks";
import type { SpecView } from "./hooks/useSpecData";

// =============================================================================
// Types
// =============================================================================

export interface SpecCodePanelProps {
  /** Content to display */
  content: string;
  /** Language mode (yaml or jinja - both use YAML highlighting for MVP) */
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
 * Create CodeMirror extensions for the spec viewer.
 * Memoized per language and theme to avoid recreating on every render.
 */
function createExtensions(language: SpecView, readOnly: boolean, isDark: boolean) {
  const extensions = [
    // Theme and syntax highlighting
    ...createSpecViewerExtension(isDark),

    // Language support (YAML for both - Jinja mixed mode is Phase 2)
    yaml(),

    // Code folding
    foldGutter({
      openText: "\u25BC", // Down arrow
      closedText: "\u25B6", // Right arrow
    }),

    // Search support (Cmd+F)
    search(),

    // Read-only state
    EditorState.readOnly.of(readOnly),

    // Accessibility
    EditorView.contentAttributes.of({
      "aria-label": language === "yaml" ? "YAML workflow specification" : "Jinja workflow template",
    }),

    // Scroll margin for virtualization
    EditorView.scrollMargins.of(() => ({ top: 50, bottom: 50 })),
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

  // Default to dark during SSR, then use actual theme after hydration
  // This prevents hydration mismatch and ensures consistent rendering
  const isDark = !mounted ? true : (resolvedTheme ?? theme ?? "dark") === "dark";

  // Memoize extensions to prevent unnecessary CodeMirror re-renders
  const extensions = useMemo(() => createExtensions(language, readOnly, isDark), [language, readOnly, isDark]);

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
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
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
