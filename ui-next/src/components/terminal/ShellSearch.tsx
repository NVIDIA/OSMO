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

import { memo, useCallback, useRef, useEffect } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";

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
  /** Match count info */
  matchInfo?: string;
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
  matchInfo,
  className,
}: ShellSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    },
    [onFindNext, onFindPrevious, onClose],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onQueryChange(e.target.value);
    },
    [onQueryChange],
  );

  return (
    <div className={cn("shell-search", className)}>
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

      {/* Navigation buttons */}
      <div className="shell-search-buttons flex gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="size-6 p-0 text-zinc-400 hover:text-zinc-200"
          onClick={onFindPrevious}
          title="Previous match (Shift+Enter)"
          disabled={!query}
        >
          <ChevronUp className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="size-6 p-0 text-zinc-400 hover:text-zinc-200"
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
        className="size-6 p-0 text-zinc-400 hover:text-zinc-200"
        onClick={onClose}
        title="Close (Escape)"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
});
