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
 * CodeViewer - Read-only code viewing component
 *
 * Language-agnostic CodeMirror-based viewer with syntax highlighting,
 * search (Cmd+F), code folding, line numbers, indentation guides,
 * and theme-aware light/dark mode.
 *
 * The `language` prop must be a referentially stable object (module-level
 * constant or useMemo'd) to avoid unnecessary CodeMirror re-renders.
 *
 * @example YAML viewer
 * ```tsx
 * import { CodeViewer } from "@/components/code-viewer/CodeViewer";
 * import { YAML_LANGUAGE } from "@/components/code-viewer/lib/extensions";
 *
 * <CodeViewer
 *   content={yamlContent}
 *   language={YAML_LANGUAGE}
 *   aria-label="YAML configuration"
 * />
 * ```
 *
 * @example JSON viewer (define constant at module level)
 * ```tsx
 * import { CodeViewer } from "@/components/code-viewer/CodeViewer";
 * import { json } from "@codemirror/lang-json";
 *
 * const JSON_LANGUAGE = { name: "JSON", extension: json() };
 *
 * <CodeViewer content={jsonContent} language={JSON_LANGUAGE} />
 * ```
 */

"use client";

import { memo, useMemo, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { closeSearchPanel } from "@codemirror/search";
import { createExtensions } from "./lib/extensions";
import { useMounted } from "@/hooks/use-mounted";
import type { CodeViewerProps } from "./types";
import "./code-viewer-search.css";

export const CodeViewer = memo(function CodeViewer({
  content,
  language,
  "aria-label": ariaLabel,
  className,
}: CodeViewerProps) {
  const mounted = useMounted();
  const { theme, resolvedTheme } = useTheme();
  const viewRef = useRef<EditorView | null>(null);

  // Default to dark during SSR to prevent hydration mismatch
  const isDark = !mounted ? true : (resolvedTheme ?? theme ?? "dark") === "dark";

  const extensions = useMemo(
    () => createExtensions(language.extension, ariaLabel ?? language.name, isDark),
    [language.extension, language.name, ariaLabel, isDark],
  );

  useEffect(() => {
    if (viewRef.current) {
      closeSearchPanel(viewRef.current);
    }
  }, [language]);

  return (
    <div
      className={className}
      role="region"
      aria-label={ariaLabel ?? language.name}
    >
      <CodeMirror
        value={content}
        theme={isDark ? "dark" : "light"}
        extensions={extensions}
        readOnly
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
          searchKeymap: false, // Provided by createExtensions with custom search panel
          foldKeymap: true,
          completionKeymap: false,
          lintKeymap: false,
        }}
        height="100%"
        style={{ height: "100%" }}
      />
    </div>
  );
});
