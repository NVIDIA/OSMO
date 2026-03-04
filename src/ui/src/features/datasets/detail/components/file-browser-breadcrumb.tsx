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
 * FileBrowserBreadcrumb — In-browser path navigation for the dataset file browser.
 *
 * Renders: datasetName > segment > segment > ...
 *
 * Intended to be placed in FileBrowserControlStrip's breadcrumb slot.
 * The separator between the VersionPicker (datasets only) and this breadcrumb
 * is owned by FileBrowserControlStrip — this component renders no leading chevron.
 *
 * - Dataset name links to file browser root (path="")
 * - Each path segment opens a popover listing sibling folders (when rawFiles provided)
 * - Deep paths (> 2 segments) collapse to: datasetName > … > parent > current
 *   The ellipsis is non-interactive; the immediate parent is always shown.
 */

"use client";

import { memo, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { ChevronRight, Folder, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildDirectoryListing } from "@/lib/api/adapter/datasets";
import type { RawFileItem } from "@/lib/api/adapter/datasets";

/**
 * How many trailing segments are always visible (parent + current folder).
 * Collapse triggers when the non-pinned segment count exceeds this.
 */
const COLLAPSE_THRESHOLD = 2;

// =============================================================================
// SiblingPopover — popover trigger + folder list for one breadcrumb segment
// =============================================================================

interface SiblingPopoverProps {
  /** The name of the current (last) segment */
  segment: string;
  /** The parent directory path used to compute siblings */
  parentPath: string;
  /** Full flat file manifest */
  rawFiles: RawFileItem[];
  /** Called to navigate to a sibling folder */
  onNavigate: (path: string) => void;
}

function SiblingPopover({ segment, parentPath, rawFiles, onNavigate }: SiblingPopoverProps) {
  const siblings = useMemo(
    () => buildDirectoryListing(rawFiles, parentPath).filter((f) => f.type === "folder"),
    [rawFiles, parentPath],
  );

  // Fall back to plain text when no siblings exist
  if (siblings.length === 0) {
    return (
      <span
        className="min-w-0 truncate px-2 py-1 font-medium text-zinc-900 dark:text-zinc-100"
        aria-current="page"
      >
        {segment}
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Plain <button> so flex-shrink works — shadcn Button hardcodes shrink-0 */}
        <button
          type="button"
          className="hover:bg-accent dark:hover:bg-accent/50 h-7 max-w-[12rem] min-w-0 truncate rounded-md px-1 text-sm font-medium text-zinc-900 dark:text-zinc-100"
          aria-current="page"
          aria-haspopup="listbox"
        >
          {segment}
        </button>
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
  /** Optional display labels for path segments (e.g., member ID → "imagenet-1k v2") */
  segmentLabels?: Record<string, string>;
  /**
   * Number of leading path segments to pin (always show even when collapsed).
   * Default 0 (datasets). Use 1 for collections so the member dataset name stays visible:
   *   Collection + 1 level:  collectionName > datasetName > folder
   *   Collection + 2+ levels: collectionName > datasetName > … > folder
   */
  pinnedPrefixCount?: number;
}

/**
 * Renders the dataset name + path segments as inline breadcrumb items.
 * Includes a leading ChevronRight separator so it flows after the preceding chrome breadcrumbs.
 * Intended to be placed in the `trailingBreadcrumbs` slot of `usePage()`.
 */
type SegmentItem = { kind: "segment"; segment: string; absoluteIndex: number };
type EllipsisItem = { kind: "ellipsis" };
type BreadcrumbItem = SegmentItem | EllipsisItem;

export const FileBrowserBreadcrumb = memo(function FileBrowserBreadcrumb({
  datasetName,
  path,
  onNavigate,
  rawFiles,
  segmentLabels,
  pinnedPrefixCount = 0,
}: FileBrowserBreadcrumbProps) {
  const segments = path ? path.split("/").filter(Boolean) : [];

  // Collapse when non-prefix segments exceed the threshold.
  // pinnedPrefixCount=0 (dataset):    collapse at depth > 2  →  name > … > parent > folder
  // pinnedPrefixCount=1 (collection): collapse at depth > 3  →  name > member > … > parent > folder
  const collapsed = segments.length > pinnedPrefixCount + COLLAPSE_THRESHOLD;

  const pinnedSegments = segments.slice(0, pinnedPrefixCount);

  // Build the ordered list of items to render. When collapsed, the ellipsis sentinel is
  // inserted AFTER the pinned prefix and BEFORE the two trailing segments — preserving correct order:
  //   dataset:    name > [ellipsis] > parent > folder
  //   collection: name > member > [ellipsis] > parent > folder
  const items: BreadcrumbItem[] = collapsed
    ? [
        ...pinnedSegments.map((seg, i): SegmentItem => ({ kind: "segment", segment: seg, absoluteIndex: i })),
        { kind: "ellipsis" },
        { kind: "segment", segment: segments[segments.length - 2], absoluteIndex: segments.length - 2 },
        { kind: "segment", segment: segments[segments.length - 1], absoluteIndex: segments.length - 1 },
      ]
    : segments.map((seg, i): SegmentItem => ({ kind: "segment", segment: seg, absoluteIndex: i }));

  return (
    <>
      {/* Dataset/collection name — links to file browser root, or plain text if already at root */}
      {segments.length === 0 ? (
        <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{datasetName}</span>
      ) : (
        <button
          type="button"
          onClick={() => onNavigate("")}
          className="truncate text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {datasetName}
        </button>
      )}

      {/* Ordered items: pinned segments, optional ellipsis, trailing segment */}
      {items.map((item) => {
        if (item.kind === "ellipsis") {
          return (
            <span
              key="ellipsis"
              className="flex min-w-0 items-center gap-1.5"
            >
              <span
                className="shrink-0 text-sm text-zinc-300 select-none dark:text-zinc-600"
                aria-hidden="true"
              >
                /
              </span>
              <span
                className="px-0.5 text-sm text-zinc-400 select-none dark:text-zinc-600"
                aria-hidden="true"
              >
                …
              </span>
            </span>
          );
        }

        const { segment, absoluteIndex } = item;
        const isLast = absoluteIndex === segments.length - 1;
        const segmentPath = segments.slice(0, absoluteIndex + 1).join("/");
        const parentPath = segments.slice(0, absoluteIndex).join("/");
        const displaySegment = segmentLabels?.[segment] ?? segment;

        return (
          <span
            key={segmentPath}
            className="flex min-w-0 items-center gap-1.5"
          >
            {absoluteIndex < pinnedPrefixCount ? (
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600"
                aria-hidden="true"
              />
            ) : (
              <span
                className="shrink-0 text-sm text-zinc-300 select-none dark:text-zinc-600"
                aria-hidden="true"
              >
                /
              </span>
            )}
            {rawFiles && isLast ? (
              <SiblingPopover
                segment={segment}
                parentPath={parentPath}
                rawFiles={rawFiles}
                onNavigate={onNavigate}
              />
            ) : isLast ? (
              <span
                className="min-w-0 truncate px-1 text-sm font-medium text-zinc-900 dark:text-zinc-100"
                aria-current="page"
              >
                {displaySegment}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(segmentPath)}
                className="truncate px-1 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                {displaySegment}
              </button>
            )}
          </span>
        );
      })}
    </>
  );
});
