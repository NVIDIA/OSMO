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
 * FileBrowserBreadcrumb — Full-path navigation breadcrumb for the dataset file browser.
 *
 * Renders: Home > Datasets > datasetName > segment > segment > ...
 *
 * - Home and Datasets are page-level links (router.push)
 * - Dataset name links to file browser root (path="")
 * - Each intermediate segment is clickable (navigate to that path level)
 * - Last segment is plain text (current location)
 * - Deep paths (> 2 segments) collapse to: datasetName > … > parent > current
 */

"use client";

import { memo } from "react";
import { Button } from "@/components/shadcn/button";
import { ChevronRight } from "lucide-react";
import { useNavigationRouter } from "@/hooks/use-navigation-router";

/** Show all segments when depth ≤ this; collapse with ellipsis when deeper. */
const COLLAPSE_THRESHOLD = 2;

interface FileBrowserBreadcrumbProps {
  /** Dataset name — links to file browser root (path="") */
  datasetName: string;
  /** Current path (e.g., "train/n00000001"), empty string = root */
  path: string;
  /** Called when a path segment is clicked with the target path */
  onNavigate: (path: string) => void;
}

export const FileBrowserBreadcrumb = memo(function FileBrowserBreadcrumb({
  datasetName,
  path,
  onNavigate,
}: FileBrowserBreadcrumbProps) {
  const router = useNavigationRouter();
  const segments = path ? path.split("/").filter(Boolean) : [];

  // When deeply nested, show only the last COLLAPSE_THRESHOLD segments
  const collapsed = segments.length > COLLAPSE_THRESHOLD;
  const visibleSegments = collapsed ? segments.slice(-COLLAPSE_THRESHOLD) : segments;
  const visibleOffset = collapsed ? segments.length - COLLAPSE_THRESHOLD : 0;

  return (
    <nav
      aria-label="File browser path"
      className="flex min-w-0 items-center gap-0.5 overflow-hidden text-sm"
    >
      {/* Home */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-zinc-500 dark:text-zinc-400"
        onClick={() => router.push("/")}
      >
        Home
      </Button>

      <ChevronRight
        className="size-3.5 shrink-0 text-zinc-400 dark:text-zinc-600"
        aria-hidden="true"
      />

      {/* Datasets page */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-zinc-500 dark:text-zinc-400"
        onClick={() => router.push("/datasets")}
      >
        Datasets
      </Button>

      <ChevronRight
        className="size-3.5 shrink-0 text-zinc-400 dark:text-zinc-600"
        aria-hidden="true"
      />

      {/* Dataset name — links to file browser root */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 font-medium text-zinc-900 dark:text-zinc-100"
        onClick={() => onNavigate("")}
        aria-current={segments.length === 0 ? "page" : undefined}
      >
        {datasetName}
      </Button>

      {/* Ellipsis when deep path is collapsed */}
      {collapsed && (
        <>
          <ChevronRight
            className="size-3.5 shrink-0 text-zinc-400 dark:text-zinc-600"
            aria-hidden="true"
          />
          <span
            className="shrink-0 px-1.5 text-zinc-400 dark:text-zinc-600"
            aria-label="collapsed path segments"
          >
            …
          </span>
        </>
      )}

      {/* Visible path segments */}
      {visibleSegments.map((segment, localIndex) => {
        const absoluteIndex = visibleOffset + localIndex;
        const isLast = absoluteIndex === segments.length - 1;
        const segmentPath = segments.slice(0, absoluteIndex + 1).join("/");

        return (
          <span
            key={segmentPath}
            className="flex min-w-0 items-center gap-0.5"
          >
            <ChevronRight
              className="size-3.5 shrink-0 text-zinc-400 dark:text-zinc-600"
              aria-hidden="true"
            />
            {isLast ? (
              <span
                className="truncate px-2 py-1 font-medium text-zinc-900 dark:text-zinc-100"
                aria-current="page"
              >
                {segment}
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 min-w-0 shrink-0 truncate px-2 text-zinc-600 dark:text-zinc-400"
                onClick={() => onNavigate(segmentPath)}
              >
                {segment}
              </Button>
            )}
          </span>
        );
      })}
    </nav>
  );
});
