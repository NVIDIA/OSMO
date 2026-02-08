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
 * Custom search panel for CodeMirror code viewer
 *
 * Floating overlay in top-right corner, matching ShellSearch design.
 * Icon-based controls for case sensitivity, whole word, and regex.
 */

import React, { useDeferredValue } from "react";
import { EditorView } from "@codemirror/view";
import {
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  closeSearchPanel,
} from "@codemirror/search";
import { createRoot, type Root } from "react-dom/client";
import { X, ChevronUp, ChevronDown, CaseSensitive, WholeWord, Regex } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { cn } from "@/lib/utils";

interface SearchPanelProps {
  view: EditorView;
  isDark: boolean;
}

function SearchPanel({ view, isDark }: SearchPanelProps) {
  const query = getSearchQuery(view.state);
  const [searchText, setSearchText] = React.useState(query.search);
  const [caseSensitive, setCaseSensitive] = React.useState(query.caseSensitive);
  const [wholeWord, setWholeWord] = React.useState(query.wholeWord);
  const [regexp, setRegexp] = React.useState(query.regexp);
  const [selectionPos, setSelectionPos] = React.useState(0); // Track selection for match navigation
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const updateSearch = React.useCallback(
    (text: string, cs: boolean, ww: boolean, re: boolean) => {
      view.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({
            search: text,
            caseSensitive: cs,
            wholeWord: ww,
            regexp: re,
          }),
        ),
      });
    },
    [view],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setSearchText(text);
    updateSearch(text, caseSensitive, wholeWord, regexp);
  };

  const toggleOption = React.useCallback(
    (option: "caseSensitive" | "wholeWord" | "regexp") => {
      const next = {
        caseSensitive: option === "caseSensitive" ? !caseSensitive : caseSensitive,
        wholeWord: option === "wholeWord" ? !wholeWord : wholeWord,
        regexp: option === "regexp" ? !regexp : regexp,
      };
      if (option === "caseSensitive") setCaseSensitive(next.caseSensitive);
      if (option === "wholeWord") setWholeWord(next.wholeWord);
      if (option === "regexp") setRegexp(next.regexp);
      updateSearch(searchText, next.caseSensitive, next.wholeWord, next.regexp);
      setSelectionPos(view.state.selection.main.from);
    },
    [caseSensitive, wholeWord, regexp, searchText, updateSearch, view],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Prevent browser find when search is already open
    if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      inputRef.current?.select();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      navigateMatch(e.shiftKey ? "previous" : "next");
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // Prevent closing the workflow panel
      closeSearchPanel(view);
    }
  };

  const handleClose = () => {
    closeSearchPanel(view);
  };

  /** Navigate to a match and update position tracking after CodeMirror state settles */
  const navigateMatch = React.useCallback(
    (direction: "next" | "previous") => {
      if (direction === "next") {
        findNext(view);
      } else {
        findPrevious(view);
      }
      requestAnimationFrame(() => {
        setSelectionPos(view.state.selection.main.from);
      });
    },
    [view],
  );

  // Handle keydown at panel level to catch Cmd+F even when input isn't focused
  const handlePanelKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    // Prevent Cmd+F from opening browser search or triggering other handlers
    if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, []);

  // Defer search text to avoid blocking typing
  const deferredSearchText = useDeferredValue(searchText);

  // Calculate match info (current match position and total count)
  const matchInfo = React.useMemo(() => {
    // Force recomputation when selection changes (used to track navigation)
    void selectionPos;

    if (!deferredSearchText) return null;

    try {
      const state = view.state;
      const query = getSearchQuery(state);

      if (!query.search) return null;

      // Count all matches
      const cursor = query.getCursor(state.doc);
      let totalMatches = 0;
      let currentMatch = -1;
      let matchIndex = 0;
      const selection = state.selection.main;
      const selStart = selection.from;
      const selEnd = selection.to;

      let result = cursor.next();
      while (!result.done) {
        totalMatches++;
        // Check if this match overlaps with or contains the selection
        if (
          currentMatch === -1 &&
          ((result.value.from >= selStart && result.value.from < selEnd) ||
            (result.value.to > selStart && result.value.to <= selEnd) ||
            (result.value.from <= selStart && result.value.to >= selEnd))
        ) {
          currentMatch = matchIndex;
        }
        matchIndex++;
        result = cursor.next();
      }

      if (totalMatches === 0) return "No results";

      // If no match contains cursor, show total only
      if (currentMatch === -1) {
        return `${totalMatches} result${totalMatches === 1 ? "" : "s"}`;
      }

      return `${currentMatch + 1} of ${totalMatches}`;
    } catch {
      return null;
    }
  }, [deferredSearchText, view, selectionPos]);

  return (
    <div
      className="code-viewer-search"
      data-theme={isDark ? "dark" : "light"}
      onKeyDown={handlePanelKeyDown}
    >
      <div className="code-viewer-search-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          value={searchText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Find..."
          className="code-viewer-search-input"
          aria-label="Search code"
        />
        <div className="code-viewer-search-options">
          <button
            type="button"
            className={cn("code-viewer-search-option", caseSensitive && "active")}
            onClick={() => toggleOption("caseSensitive")}
            title="Match case (Aa)"
            aria-pressed={caseSensitive}
          >
            <CaseSensitive className="size-3.5" />
          </button>
          <button
            type="button"
            className={cn("code-viewer-search-option", wholeWord && "active")}
            onClick={() => toggleOption("wholeWord")}
            title="Match whole word"
            aria-pressed={wholeWord}
          >
            <WholeWord className="size-3.5" />
          </button>
          <button
            type="button"
            className={cn("code-viewer-search-option", regexp && "active")}
            onClick={() => toggleOption("regexp")}
            title="Use regular expression"
            aria-pressed={regexp}
          >
            <Regex className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="code-viewer-search-buttons flex gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="code-viewer-search-nav-button size-6 p-0"
          onClick={() => navigateMatch("previous")}
          title="Previous match (Shift+Enter)"
          disabled={!searchText}
        >
          <ChevronUp className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="code-viewer-search-nav-button size-6 p-0"
          onClick={() => navigateMatch("next")}
          title="Next match (Enter)"
          disabled={!searchText}
        >
          <ChevronDown className="size-3" />
        </Button>
      </div>

      {matchInfo && <span className="code-viewer-search-count">{matchInfo}</span>}

      <Button
        variant="ghost"
        size="sm"
        className="code-viewer-search-close-button size-6 p-0"
        onClick={handleClose}
        title="Close (Escape)"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

/**
 * Creates a custom search panel for CodeMirror as a floating overlay
 */
export function createSearchPanel(isDark: boolean) {
  let root: Root | null = null;
  let previousFocus: HTMLElement | null = null;

  return (view: EditorView): { dom: HTMLElement; top: boolean; destroy?: () => void } => {
    const dom = document.createElement("div");
    dom.className = "code-viewer-search-panel-mount";

    // Capture current focus to restore when search closes
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      previousFocus = active;
    }

    root = createRoot(dom);
    root.render(
      <SearchPanel
        view={view}
        isDark={isDark}
      />,
    );

    return {
      dom,
      top: true, // Position at top of editor
      destroy: () => {
        if (root) {
          // Capture root value before nulling to avoid closure issue
          const r = root;
          root = null;
          // Defer unmount to avoid race condition when called during render
          queueMicrotask(() => {
            r.unmount();
          });
        }

        // Restore focus to the element that had focus before search opened
        // Check disabled state for consistency with useFocusReturn pattern
        if (
          previousFocus &&
          previousFocus.isConnected &&
          !previousFocus.hasAttribute("disabled") &&
          previousFocus.getAttribute("aria-disabled") !== "true"
        ) {
          queueMicrotask(() => {
            previousFocus?.focus();
            previousFocus = null;
          });
        }
      },
    };
  };
}
