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
 * useFileBrowserState — URL-driven state for the dataset file browser.
 *
 * Manages three URL params together via nuqs:
 *   ?path=   — current directory path (e.g., "train/n00000001")
 *   ?version= — selected version tag (e.g., "5")
 *   ?file=   — selected file path for preview panel
 *
 * navigateTo() clears ?file= when path changes (folder nav closes preview).
 * setVersion() preserves ?path= when switching versions.
 */

"use client";

import { useCallback, useMemo } from "react";
import { useQueryStates, parseAsString } from "nuqs";

export interface FileBrowserState {
  /** Current directory path (e.g., "train/n00000001"), empty string = root */
  path: string;
  /** Selected version tag (e.g., "5"), null = latest */
  version: string | null;
  /** Selected file path for preview panel, null = no file selected */
  selectedFile: string | null;
  /** Navigate to a directory path (clears file selection) */
  navigateTo: (path: string) => void;
  /** Switch version (preserves current path) */
  setVersion: (version: string) => void;
  /** Select a file to preview */
  selectFile: (filePath: string) => void;
  /** Clear file selection (close preview panel) */
  clearSelection: () => void;
}

export function useFileBrowserState(): FileBrowserState {
  const [params, setParams] = useQueryStates(
    {
      path: parseAsString.withDefault(""),
      version: parseAsString,
      file: parseAsString,
    },
    {
      shallow: true,
      history: "replace",
    },
  );

  const navigateTo = useCallback(
    (newPath: string) => {
      // Clear file selection when navigating to a new directory
      // Use push history so the back button works during directory traversal
      void setParams({ path: newPath, file: null }, { history: "push" });
    },
    [setParams],
  );

  const setVersion = useCallback(
    (newVersion: string) => {
      // Preserve path when switching versions
      void setParams({ version: newVersion });
    },
    [setParams],
  );

  const selectFile = useCallback(
    (filePath: string) => {
      void setParams({ file: filePath });
    },
    [setParams],
  );

  const clearSelection = useCallback(() => {
    void setParams({ file: null });
  }, [setParams]);

  return useMemo(
    () => ({
      path: params.path,
      version: params.version,
      selectedFile: params.file,
      navigateTo,
      setVersion,
      selectFile,
      clearSelection,
    }),
    [params.path, params.version, params.file, navigateTo, setVersion, selectFile, clearSelection],
  );
}
