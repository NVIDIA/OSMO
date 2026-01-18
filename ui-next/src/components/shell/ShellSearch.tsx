// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellSearch Component
 *
 * Search bar for shell content using xterm.js SearchAddon.
 */

"use client";

import { memo, useRef, useEffect } from "react";
import { useEventCallback } from "usehooks-ts";
import { ChevronUp, ChevronDown, X, CaseSensitive, WholeWord, Regex } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import type { SearchResultInfo } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface ShellSearchProps {
  /** Current search query */
  query: string;
  /** Called when query changes */
  onQueryChange: (query: string) => void;
  /** Called to find next match */
  onFindNext: () => void;
  /** Called to find previous match */
  onFindPrevious: () => void;
  /** Called to close search */
  onClose: () => void;
  /** Whether search is case sensitive */
  caseSensitive: boolean;
  /** Called when case sensitivity changes */
  onCaseSensitiveChange: (value: boolean) => void;
  /** Whether to match whole words only */
  wholeWord: boolean;
  /** Called when whole word changes */
  onWholeWordChange: (value: boolean) => void;
  /** Whether to use regex */
  regex: boolean;
  /** Called when regex changes */
  onRegexChange: (value: boolean) => void;
  /** Search result info from xterm.js */
  searchResults: SearchResultInfo | null;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const ShellSearch = memo(function ShellSearch({
  query,
  onQueryChange,
  onFindNext,
  onFindPrevious,
  onClose,
  caseSensitive,
  onCaseSensitiveChange,
  wholeWord,
  onWholeWordChange,
  regex,
  onRegexChange,
  searchResults,
  className,
}: ShellSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Compute match info text
  const matchInfo = (() => {
    if (!query) return null;
    if (!searchResults) return null;
    if (searchResults.resultCount === 0) return "No results";
    // resultIndex is -1 when no match is focused yet, treat as first match
    const displayIndex = searchResults.resultIndex < 0 ? 1 : searchResults.resultIndex + 1;
    return `${displayIndex} of ${searchResults.resultCount}`;
  })();

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle keyboard shortcuts
  // useEventCallback: stable ref, always accesses latest props
  const handleKeyDown = useEventCallback((e: React.KeyboardEvent) => {
    // Prevent Ctrl/Cmd+F from triggering browser find when search is already open
    if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      inputRef.current?.select();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onFindPrevious();
      } else {
        onFindNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  });

  // useEventCallback: stable ref for input onChange
  const handleChange = useEventCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onQueryChange(e.target.value);
  });

  return (
    <div className={cn("shell-search", className)}>
      {/* Input with inline filter buttons */}
      <div className="shell-search-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search..."
          className="shell-search-input"
          aria-label="Search shell"
        />
        {/* Search options - inside input */}
        <div className="shell-search-options">
          <button
            type="button"
            className={cn("shell-search-option", caseSensitive && "active")}
            onClick={() => onCaseSensitiveChange(!caseSensitive)}
            title="Match case (Aa)"
            aria-pressed={caseSensitive}
          >
            <CaseSensitive className="size-3.5" />
          </button>
          <button
            type="button"
            className={cn("shell-search-option", wholeWord && "active")}
            onClick={() => onWholeWordChange(!wholeWord)}
            title="Match whole word"
            aria-pressed={wholeWord}
          >
            <WholeWord className="size-3.5" />
          </button>
          <button
            type="button"
            className={cn("shell-search-option", regex && "active")}
            onClick={() => onRegexChange(!regex)}
            title="Use regular expression"
            aria-pressed={regex}
          >
            <Regex className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="shell-search-buttons flex gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="size-6 p-0 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
          onClick={onFindPrevious}
          title="Previous match (Shift+Enter)"
          disabled={!query}
        >
          <ChevronUp className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="size-6 p-0 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
          onClick={onFindNext}
          title="Next match (Enter)"
          disabled={!query}
        >
          <ChevronDown className="size-3" />
        </Button>
      </div>

      {/* Match info */}
      {matchInfo && <span className="shell-search-count">{matchInfo}</span>}

      {/* Close button */}
      <Button
        variant="ghost"
        size="sm"
        className="size-6 p-0 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
        onClick={onClose}
        title="Close (Escape)"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
});
