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

import type { Extension } from "@codemirror/state";

/**
 * Language extension configuration for CodeMirror
 *
 * Defines the syntax highlighting and language-specific behavior.
 */
export interface LanguageExtension {
  /** Display name for the language (e.g., "YAML", "JSON", "Python") */
  name: string;
  /** CodeMirror extension(s) for syntax highlighting and language features */
  extension: Extension | Extension[];
}

/**
 * Base props shared by both read-only and editable modes
 */
interface CodeMirrorSharedProps {
  /** Current value */
  value: string;
  /** Language extension for syntax highlighting */
  language: LanguageExtension;
  /** Accessible label for the editor */
  "aria-label"?: string;
  /** Additional class name */
  className?: string;
}

/**
 * Props for read-only mode
 */
interface CodeMirrorReadOnlyProps extends CodeMirrorSharedProps {
  /** Read-only mode (no editing) */
  readOnly: true;
  /** onChange not allowed in read-only mode */
  onChange?: never;
}

/**
 * Props for editable mode
 */
interface CodeMirrorEditableProps extends CodeMirrorSharedProps {
  /** Editable mode (default) */
  readOnly?: false;
  /** Callback when content changes (required in editable mode) */
  onChange: (value: string) => void;
}

/**
 * Props for the CodeMirror component
 *
 * Discriminated union based on readOnly flag:
 * - readOnly={true}: onChange not allowed
 * - readOnly={false} or omitted: onChange required
 */
export type CodeMirrorProps = CodeMirrorReadOnlyProps | CodeMirrorEditableProps;
