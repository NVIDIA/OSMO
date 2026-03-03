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
 * VersionPicker — GitHub-style two-tab dropdown for selecting dataset version or tag.
 *
 * Versions tab: numeric IDs sorted newest first (v3, v2, v1)
 * Tags tab: named strings with "latest" pinned first, then alphabetical
 *
 * Data comes entirely from the `versions` prop — no additional API calls.
 * Selecting "latest" tag calls onSelectionChange(null) to clear the URL param.
 */

"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Tag, ChevronDown, Check, Search, X } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { useMounted } from "@/hooks/use-mounted";
import { cn, naturalCompare } from "@/lib/utils";
import type { DatasetVersion } from "@/lib/api/adapter/datasets";

type Tab = "versions" | "tags";

interface Props {
  /** All dataset versions from detail.versions — no fetch needed */
  versions: DatasetVersion[];
  /** Current ?version= URL param, null = latest */
  selectedId: string | null;
  /** Called with version ID, tag name, or null (for latest) */
  onSelectionChange: (id: string | null) => void;
  /** When provided, renders "View all versions" footer and calls this on click */
  onViewAllVersions?: () => void;
}

export function VersionPicker({ versions, selectedId, onSelectionChange, onViewAllVersions }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("versions");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const mounted = useMounted();

  // Focus search input when popover opens
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);

  const versionItems = useMemo(() => [...versions].sort((a, b) => naturalCompare(b.version, a.version)), [versions]);

  const tagItems = useMemo(() => {
    // Keep the highest version for each unique named tag (non-numeric tags only)
    const bestVersion = new Map<string, string>();
    for (const v of versions) {
      for (const tag of v.tags) {
        if (!isNaN(Number(tag))) continue;
        const current = bestVersion.get(tag);
        if (!current || naturalCompare(v.version, current) > 0) {
          bestVersion.set(tag, v.version);
        }
      }
    }
    return [...bestVersion.entries()]
      .map(([tag, version]) => ({ tag, version }))
      .sort((a, b) => (a.tag === "latest" ? -1 : b.tag === "latest" ? 1 : a.tag.localeCompare(b.tag)));
  }, [versions]);

  const filteredVersions = useMemo(() => {
    if (!search) return versionItems;
    const q = search.toLowerCase();
    return versionItems.filter((v) => `v${v.version}`.includes(q) || v.tags.some((t) => t.toLowerCase().includes(q)));
  }, [versionItems, search]);

  const filteredTags = useMemo(() => {
    if (!search) return tagItems;
    const q = search.toLowerCase();
    return tagItems.filter(({ tag }) => tag.toLowerCase().includes(q));
  }, [tagItems, search]);

  const triggerLabel = useMemo(() => {
    if (selectedId === null) {
      const latestEntry = tagItems.find((t) => t.tag === "latest");
      return latestEntry ? `v${latestEntry.version}` : "latest";
    }
    if (!isNaN(Number(selectedId))) return `v${selectedId}`;
    return selectedId;
  }, [selectedId, tagItems]);

  function handleOpenChange(value: boolean) {
    setOpen(value);
    if (!value) setSearch("");
  }

  function handleTabChange(value: Tab) {
    setTab(value);
    setSearch("");
  }

  function handleSelect(id: string | null) {
    onSelectionChange(id);
    setOpen(false);
  }

  function handleViewAll() {
    setOpen(false);
    onViewAllVersions?.();
  }

  const triggerContent = (
    <>
      <Tag
        className="size-3 shrink-0 opacity-60"
        aria-hidden="true"
      />
      <span className="font-mono">{triggerLabel}</span>
      <ChevronDown
        className="size-3 shrink-0 opacity-60"
        aria-hidden="true"
      />
    </>
  );

  // useMounted guard — Popover (Radix) generates IDs/ARIA differently on server vs client
  if (!mounted) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        disabled
      >
        {triggerContent}
      </Button>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          aria-label={`Version: ${triggerLabel}. Click to change`}
          aria-expanded={open}
        >
          {triggerContent}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-64 p-0 shadow-md"
        align="start"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-700">
          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Switch versions / tags</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Close"
          >
            <X
              className="size-3.5"
              aria-hidden="true"
            />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-zinc-200 px-2 py-2 dark:border-zinc-700">
          <div className="relative">
            <Search
              className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "versions" ? "Find a version…" : "Find a tag…"}
              className="h-7 pl-6 text-xs"
            />
          </div>
        </div>

        {/* Tabs — underline indicator style */}
        <div
          className="flex border-b border-zinc-200 dark:border-zinc-700"
          role="tablist"
          aria-label="Switch between versions and tags"
        >
          {(["versions", "tags"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => handleTabChange(t)}
              className={cn(
                "relative flex-1 py-2 text-xs font-medium capitalize transition-colors",
                tab === t
                  ? "text-zinc-900 after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:bg-zinc-900 dark:text-zinc-100 dark:after:bg-zinc-100"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300",
              )}
            >
              {t === "versions" ? "Versions" : "Tags"}
            </button>
          ))}
        </div>

        {/* List */}
        {tab === "versions" ? (
          <ul
            className="max-h-52 overflow-y-auto py-1"
            role="listbox"
            aria-label="Versions"
          >
            {filteredVersions.length === 0 ? (
              <li className="px-4 py-3 text-xs text-zinc-400 dark:text-zinc-500">No versions found</li>
            ) : (
              filteredVersions.map((v) => {
                const isSelected = selectedId === v.version;
                const isLatest = v.tags.includes("latest");
                return (
                  <li
                    key={v.version}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      onClick={() => handleSelect(v.version)}
                    >
                      <Check
                        className={cn("size-3 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                        aria-hidden="true"
                      />
                      <span className="font-mono">v{v.version}</span>
                      {isLatest && <span className="ml-auto text-zinc-400 dark:text-zinc-500">latest</span>}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        ) : (
          <ul
            className="max-h-52 overflow-y-auto py-1"
            role="listbox"
            aria-label="Tags"
          >
            {filteredTags.length === 0 ? (
              <li className="px-4 py-3 text-xs text-zinc-400 dark:text-zinc-500">No tags found</li>
            ) : (
              filteredTags.map(({ tag, version }) => {
                const isSelected = tag === "latest" ? selectedId === null : selectedId === tag;
                return (
                  <li
                    key={tag}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      onClick={() => handleSelect(tag === "latest" ? null : tag)}
                    >
                      <Check
                        className={cn("size-3 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                        aria-hidden="true"
                      />
                      <Tag
                        className="size-3 shrink-0 text-zinc-400"
                        aria-hidden="true"
                      />
                      <span>{tag}</span>
                      <span className="ml-auto font-mono text-zinc-400 dark:text-zinc-500">v{version}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}

        {/* Footer */}
        {onViewAllVersions && (
          <div className="border-t border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={handleViewAll}
              className="w-full px-3 py-2 text-left text-xs text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              View all versions & tags
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
