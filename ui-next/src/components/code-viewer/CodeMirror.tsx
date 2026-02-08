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
 * CodeMirror - Unified code viewer/editor component
 *
 * Language-agnostic CodeMirror-based component with syntax highlighting,
 * search (Cmd+F), code folding, line numbers, indentation guides,
 * and theme-aware light/dark mode.
 *
 * Supports both read-only viewing and editing modes via the readOnly prop.
 * TypeScript enforces that onChange is required when readOnly is false/omitted.
 *
 * The `language` prop must be a referentially stable object (module-level
 * constant or useMemo'd) to avoid unnecessary CodeMirror re-renders.
 *
 * @example Read-only viewer
 * ```tsx
 * import { CodeMirror } from "@/components/code-viewer/CodeMirror";
 * import { YAML_LANGUAGE } from "@/components/code-viewer/lib/extensions";
 *
 * <CodeMirror
 *   value={yamlContent}
 *   language={YAML_LANGUAGE}
 *   readOnly
 * />
 * ```
 *
 * @example Editable editor
 * ```tsx
 * import { CodeMirror } from "@/components/code-viewer/CodeMirror";
 * import { YAML_LANGUAGE } from "@/components/code-viewer/lib/extensions";
 *
 * <CodeMirror
 *   value={yamlContent}
 *   onChange={setYamlContent}
 *   language={YAML_LANGUAGE}
 * />
 * ```
 */

"use client";

import { memo, useMemo, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import CodeMirrorLib from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { closeSearchPanel } from "@codemirror/search";
import { createExtensions } from "./lib/extensions";
import { useMounted } from "@/hooks/use-mounted";
import type { CodeMirrorProps } from "./types";
import "./code-viewer-search.css";

export const CodeMirror = memo(function CodeMirror({
  value,
  onChange,
  language,
  readOnly = false,
  "aria-label": ariaLabel,
  className,
}: CodeMirrorProps) {
  const mounted = useMounted();
  const { theme, resolvedTheme } = useTheme();
  const viewRef = useRef<EditorView | null>(null);

  // Default to dark during SSR to prevent hydration mismatch
  const isDark = !mounted ? true : (resolvedTheme ?? theme ?? "dark") === "dark";

  const extensions = useMemo(
    () => createExtensions(language.extension, ariaLabel ?? language.name, isDark, readOnly),
    [language.extension, language.name, ariaLabel, isDark, readOnly],
  );

  const basicSetup = useMemo(
    () => ({
      lineNumbers: true,
      highlightActiveLineGutter: !readOnly,
      highlightActiveLine: true,
      foldGutter: false, // We use our own fold gutter
      dropCursor: !readOnly,
      allowMultipleSelections: !readOnly,
      indentOnInput: !readOnly,
      bracketMatching: true,
      closeBrackets: !readOnly,
      autocompletion: !readOnly,
      rectangularSelection: !readOnly,
      crosshairCursor: false,
      highlightSelectionMatches: true,
      closeBracketsKeymap: !readOnly,
      searchKeymap: false, // Provided by createExtensions with custom search panel
      foldKeymap: true,
      completionKeymap: !readOnly,
      lintKeymap: false,
    }),
    [readOnly],
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
      <CodeMirrorLib
        value={value}
        onChange={onChange}
        theme={isDark ? "dark" : "light"}
        extensions={extensions}
        readOnly={readOnly}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
        basicSetup={basicSetup}
        height="100%"
        style={{ height: "100%" }}
      />
    </div>
  );
});
