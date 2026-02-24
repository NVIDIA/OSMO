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
 * FileBrowserHeader — Sticky header row for the dataset file browser.
 *
 * Renders the path breadcrumb on the left and the version switcher on the right.
 * Sits above the file listing table.
 */

"use client";

import { memo } from "react";
import { FileBrowserBreadcrumb } from "@/features/datasets/detail/components/file-browser-breadcrumb";
import { VersionSwitcher } from "@/features/datasets/detail/components/version-switcher";
import type { DatasetVersion } from "@/lib/api/adapter/datasets";

interface FileBrowserHeaderProps {
  /** Dataset name — first breadcrumb segment */
  datasetName: string;
  /** Current directory path (empty = root) */
  path: string;
  /** All available versions */
  versions: DatasetVersion[];
  /** Currently selected version (null = latest) */
  selectedVersion: string | null;
  /** Called when a breadcrumb segment is clicked */
  onNavigate: (path: string) => void;
  /** Called when the version dropdown changes */
  onVersionChange: (version: string) => void;
}

export const FileBrowserHeader = memo(function FileBrowserHeader({
  datasetName,
  path,
  versions,
  selectedVersion,
  onNavigate,
  onVersionChange,
}: FileBrowserHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <FileBrowserBreadcrumb
        datasetName={datasetName}
        path={path}
        onNavigate={onNavigate}
      />
      {versions.length > 0 && (
        <VersionSwitcher
          versions={versions}
          selectedVersion={selectedVersion}
          onVersionChange={onVersionChange}
        />
      )}
    </div>
  );
});
