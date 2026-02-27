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
 * - Each path segment opens a popover listing sibling folders (when rawFiles provided)
 * - Deep paths (> 2 segments) collapse to: datasetName > … > parent > current
 */

"use client";

import { memo, useMemo } from "react";
import { Button } from "@/components/shadcn/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { ChevronRight, Folder, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigationRouter } from "@/hooks/use-navigation-router";
import { buildDirectoryListing } from "@/lib/api/adapter/datasets";
import type { RawFileItem } from "@/lib/api/adapter/datasets";

/** Show all segments when depth ≤ this; collapse with ellipsis when deeper. */
const COLLAPSE_THRESHOLD = 2;

// =============================================================================
// SiblingPopover — popover trigger + folder list for one breadcrumb segment
// =============================================================================

interface SiblingPopoverProps {
  /** The name of the current segment (highlighted in the list) */
  segment: string;
  /** The parent directory path used to compute siblings */
  parentPath: string;
  /** Full flat file manifest */
  rawFiles: RawFileItem[];
  /** Whether this is the last (current) segment */
  isCurrent: boolean;
  /** Called to navigate to a sibling folder */
  onNavigate: (path: string) => void;
}

function SiblingPopover({ segment, parentPath, rawFiles, isCurrent, onNavigate }: SiblingPopoverProps) {
  const siblings = useMemo(
    () => buildDirectoryListing(rawFiles, parentPath).filter((f) => f.type === "folder"),
    [rawFiles, parentPath],
  );

  // Fall back to plain text for the current segment when no siblings exist
  if (siblings.length === 0) {
    return isCurrent ? (
      <span
        className="min-w-0 truncate px-2 py-1 font-medium text-zinc-900 dark:text-zinc-100"
        aria-current="page"
      >
        {segment}
      </span>
    ) : null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {isCurrent ? (
          // Plain <button> so flex-shrink works — shadcn Button hardcodes shrink-0
          <button
            type="button"
            className="hover:bg-accent dark:hover:bg-accent/50 h-7 max-w-[12rem] min-w-0 truncate rounded-md px-2 text-sm font-medium text-zinc-900 dark:text-zinc-100"
            aria-current="page"
            aria-haspopup="listbox"
          >
            {segment}
          </button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 max-w-[12rem] min-w-0 shrink-0 truncate px-2 text-zinc-600 dark:text-zinc-400"
            aria-haspopup="listbox"
          >
            {segment}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        className="w-52 p-1"
        align="start"
        sideOffset={4}
      >
        <div
          role="listbox"
          aria-label="Sibling folders"
          className="flex flex-col"
        >
          {siblings.map((sibling) => {
            const siblingPath = parentPath ? `${parentPath}/${sibling.name}` : sibling.name;
            const isActive = sibling.name === segment;
            return (
              <button
                key={sibling.name}
                role="option"
                type="button"
                aria-selected={isActive}
                onClick={() => onNavigate(siblingPath)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                  "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  isActive ? "font-medium text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400",
                )}
              >
                <Folder
                  className="size-3.5 shrink-0 text-amber-500"
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">{sibling.name}</span>
                {isActive && (
                  <Check
                    className="ml-auto size-3 shrink-0 text-zinc-400"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// =============================================================================
// FileBrowserBreadcrumb
// =============================================================================

interface FileBrowserBreadcrumbProps {
  /** Dataset name — links to file browser root (path="") */
  datasetName: string;
  /** Current path (e.g., "train/n00000001"), empty string = root */
  path: string;
  /** Called when a path segment or sibling is clicked with the target path */
  onNavigate: (path: string) => void;
  /** Full flat file manifest — enables sibling folder popovers when provided */
  rawFiles?: RawFileItem[];
}

export const FileBrowserBreadcrumb = memo(function FileBrowserBreadcrumb({
  datasetName,
  path,
  onNavigate,
  rawFiles,
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
        const parentPath = segments.slice(0, absoluteIndex).join("/");

        return (
          <span
            key={segmentPath}
            className="flex min-w-0 items-center gap-0.5"
          >
            <ChevronRight
              className="size-3.5 shrink-0 text-zinc-400 dark:text-zinc-600"
              aria-hidden="true"
            />
            {rawFiles && isLast ? (
              <SiblingPopover
                segment={segment}
                parentPath={parentPath}
                rawFiles={rawFiles}
                isCurrent={isLast}
                onNavigate={onNavigate}
              />
            ) : isLast ? (
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
