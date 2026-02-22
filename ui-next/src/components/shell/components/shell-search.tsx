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

"use client";

import { memo, useRef, useEffect, useId } from "react";
import { useEventCallback } from "usehooks-ts";
import { ChevronUp, ChevronDown, X, CaseSensitive, WholeWord, Regex } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import type { SearchResultInfo } from "@/components/shell/lib/types";

export interface ShellSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClose: () => void;
  caseSensitive: boolean;
  onCaseSensitiveChange: (value: boolean) => void;
  wholeWord: boolean;
  onWholeWordChange: (value: boolean) => void;
  regex: boolean;
  onRegexChange: (value: boolean) => void;
  searchResults: SearchResultInfo | null;
  className?: string;
}

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
  const searchInputId = useId();

  const matchInfo = (() => {
    if (!query) return null;
    if (!searchResults) return null;
    if (searchResults.resultCount === 0) return "No results";
    const displayIndex = searchResults.resultIndex < 0 ? 1 : searchResults.resultIndex + 1;
    return `${displayIndex} of ${searchResults.resultCount}`;
  })();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useEventCallback((e: React.KeyboardEvent) => {
    // Prevent browser find when search is already open
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

  const handleChange = useEventCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onQueryChange(e.target.value);
  });

  return (
    <div className={cn("shell-search", className)}>
      <label
        htmlFor={searchInputId}
        className="sr-only"
      >
        Search shell
      </label>
      <div className="shell-search-input-wrapper">
        <input
          ref={inputRef}
          id={searchInputId}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search..."
          className="shell-search-input"
          aria-label="Search shell"
        />
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

      {matchInfo && <span className="shell-search-count">{matchInfo}</span>}

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
