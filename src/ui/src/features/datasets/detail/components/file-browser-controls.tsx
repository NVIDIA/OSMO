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
 * FileBrowserControls — Version switcher + Details toggle for the dataset file browser.
 *
 * Rendered via usePage({ headerActions }) so it appears in the chrome header on the right
 * side of the breadcrumb nav, adjacent to the theme toggle and user menu.
 */

"use client";

import { memo } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { VersionSwitcher } from "@/features/datasets/detail/components/version-switcher";
import type { DatasetVersion } from "@/lib/api/adapter/datasets";

interface FileBrowserControlsProps {
  /** All available versions */
  versions: DatasetVersion[];
  /** Currently selected version (null = latest) */
  selectedVersion: string | null;
  /** Called when the version is changed */
  onVersionChange: (version: string) => void;
  /** Whether the details panel is open */
  detailsOpen: boolean;
  /** Called to toggle the details panel */
  onToggleDetails: () => void;
}

export const FileBrowserControls = memo(function FileBrowserControls({
  versions,
  selectedVersion,
  onVersionChange,
  detailsOpen,
  onToggleDetails,
}: FileBrowserControlsProps) {
  return (
    <div className="flex items-center gap-2">
      {versions.length > 0 && (
        <VersionSwitcher
          versions={versions}
          selectedVersion={selectedVersion}
          onVersionChange={onVersionChange}
        />
      )}
      <Button
        variant={detailsOpen ? "secondary" : "ghost"}
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={onToggleDetails}
        aria-label={detailsOpen ? "Close details panel" : "Open details panel"}
        aria-pressed={detailsOpen}
      >
        <Info
          className="size-3.5"
          aria-hidden="true"
        />
        Details
      </Button>
    </div>
  );
});
