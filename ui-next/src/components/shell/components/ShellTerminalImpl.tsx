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

import {
  memo,
  forwardRef,
  useImperativeHandle,
  useState,
  useEffect,
  useCallback,
  useDeferredValue,
  useRef,
  useMemo,
} from "react";
import { cn } from "@/lib/utils";
import { useAnnouncer } from "@/hooks/use-announcer";
import { useCopy } from "@/hooks/use-copy";
import { useFocusReturn } from "@/components/panel/hooks/useFocusReturn";

import { useShell } from "../hooks/use-shell";
import { getDisplayStatus } from "../lib/shell-state";
import { useShellSession } from "../lib/shell-cache";
import { shellKeyboardManager, type ShellKeyboardHandlers } from "../lib/shell-keyboard-manager";
import { ShellConnecting } from "./ShellConnecting";
import { ShellSearch } from "./ShellSearch";
import { ANSI } from "../lib/types";
import type { ShellTerminalProps, ShellTerminalRef } from "../lib/types";

import "../styles/shell.css";

const ANSI_DIVIDER = `${ANSI.DIM}${"─".repeat(80)}${ANSI.RESET}`;

function getDisconnectMessage(isError: boolean, errorMessage?: string): string {
  let message = "\r\n\r\n";
  message += `${ANSI_DIVIDER}\r\n`;

  if (isError) {
    message += `${ANSI.RED}✗ Shell session ended with error${ANSI.RESET}\r\n`;
  } else {
    message += `${ANSI.GREEN}✓ Shell session ended${ANSI.RESET}\r\n`;
  }

  if (isError && errorMessage) {
    message += `  ${ANSI.DIM}${errorMessage}${ANSI.RESET}\r\n`;
  }

  message += `${ANSI_DIVIDER}\r\n`;

  return message;
}

export const ShellTerminalImpl = memo(
  forwardRef<ShellTerminalRef, ShellTerminalProps>(function ShellTerminalImpl(
    {
      taskId,
      workflowName,
      taskName,
      shell = "/bin/bash",
      onConnected,
      onDisconnected,
      onError,
      onStatusChange,
      className,
    },
    ref,
  ) {
    const announce = useAnnouncer();
    const { copy } = useCopy();

    const {
      containerRef,
      state,
      connect,
      disconnect,
      focus,
      fit,
      write,
      findNext,
      findPrevious,
      clearSearch,
      scrollToBottom,
    } = useShell({
      sessionKey: taskId,
      workflowName,
      taskName,
      shell,
      autoConnect: true,
    });

    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [regex, setRegex] = useState(false);
    const [searchResults, setSearchResults] = useState<{ resultIndex: number; resultCount: number } | null>(null);
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const prevPhaseRef = useRef<string>(state.phase);
    const session = useShellSession(taskId);

    // Focus restoration: capture trigger when search opens, restore when it closes
    // Note: handleCloseSearch also calls focus(), but useFocusReturn provides
    // a fallback in case focus moved elsewhere during search interaction
    useFocusReturn({ open: isSearchOpen });

    useImperativeHandle(ref, () => ({
      connect,
      disconnect,
      focus,
      fit,
      write,
    }));

    useEffect(() => {
      onStatusChange?.(state.phase);
    }, [state.phase, onStatusChange]);

    useEffect(() => {
      const prevPhase = prevPhaseRef.current;
      prevPhaseRef.current = state.phase;

      if (state.phase === "ready") {
        onConnected?.();
        announce("Shell connected", "polite");
        focus();
        shellKeyboardManager.markFocused(taskId);
        // Scroll after PTY welcome message has been written
        setTimeout(() => scrollToBottom(), 100);
      } else if (state.phase === "disconnected") {
        if (prevPhase !== "disconnected") {
          const isError = !!state.reason?.includes("error");
          write(getDisconnectMessage(isError, state.reason));
        }
        onDisconnected?.();
        announce("Shell disconnected", "polite");
      } else if (state.phase === "error") {
        onError?.(new Error(state.error));
        announce(`Shell error: ${state.error}`, "assertive");
      }
    }, [state, onConnected, onDisconnected, onError, announce, write, focus, scrollToBottom, taskId]);

    const searchOptions = useMemo(() => ({ caseSensitive, wholeWord, regex }), [caseSensitive, wholeWord, regex]);

    const handleFindNext = useCallback(() => {
      if (deferredSearchQuery) {
        findNext(deferredSearchQuery, searchOptions);
      }
    }, [deferredSearchQuery, searchOptions, findNext]);

    const handleFindPrevious = useCallback(() => {
      if (deferredSearchQuery) {
        findPrevious(deferredSearchQuery, searchOptions);
      }
    }, [deferredSearchQuery, searchOptions, findPrevious]);

    const handleCloseSearch = useCallback(() => {
      setIsSearchOpen(false);
      clearSearch();
      focus();
    }, [clearSearch, focus]);

    // Refs for latest values (avoid re-registering keyboard handlers on every state change)
    const stateRef = useRef(state);
    const isSearchOpenRef = useRef(isSearchOpen);
    const copyRef = useRef(copy);
    const handleCloseSearchRef = useRef(handleCloseSearch);

    useEffect(() => {
      stateRef.current = state;
      isSearchOpenRef.current = isSearchOpen;
      copyRef.current = copy;
      handleCloseSearchRef.current = handleCloseSearch;
    }, [state, isSearchOpen, copy, handleCloseSearch]);

    useEffect(() => {
      if (deferredSearchQuery) {
        clearSearch();
        findNext(deferredSearchQuery, searchOptions);
      } else {
        clearSearch();
      }
    }, [deferredSearchQuery, searchOptions, findNext, clearSearch]);

    // Register keyboard handlers with centralized manager (uses refs to avoid re-registration)
    useEffect(() => {
      const handlers: ShellKeyboardHandlers = {
        onToggleSearch: () => {
          setIsSearchOpen((prev) => !prev);
        },
        onCopySelection: () => {
          const currentState = stateRef.current;
          if (currentState.phase === "ready") {
            const text = currentState.terminal.getSelection();
            copyRef.current(text).catch(console.error);
          }
        },
        onCloseSearch: () => {
          handleCloseSearchRef.current();
        },
        shouldHandleCopy: () => {
          const currentState = stateRef.current;
          return currentState.phase === "ready" && currentState.terminal.hasSelection();
        },
        shouldHandleEscape: () => {
          return isSearchOpenRef.current;
        },
      };

      const unregister = shellKeyboardManager.register(taskId, handlers);
      return unregister;
    }, [taskId]);

    useEffect(() => {
      if (!session?.addons?.searchAddon) return;

      const disposable = session.addons.searchAddon.onDidChangeResults(
        (results: { resultIndex: number; resultCount: number } | null) => {
          if (results) {
            setSearchResults({
              resultIndex: results.resultIndex,
              resultCount: results.resultCount,
            });
          } else {
            setSearchResults(null);
          }
        },
      );

      return () => disposable.dispose();
    }, [session?.addons?.searchAddon]);

    const isIdle = state.phase === "idle";
    const isConnecting = state.phase === "connecting" || state.phase === "opening" || state.phase === "initializing";
    const isError = state.phase === "error";
    const displayStatus = getDisplayStatus(state);

    // Show overlays for non-ready states
    const showOverlay = isIdle || isConnecting || isError;

    return (
      <div className={cn("shell-wrapper", className)}>
        {/* Always render container visible so xterm.js can measure dimensions */}
        <div className="shell-body-wrapper">
          <div
            ref={containerRef}
            className="shell-body"
          />

          {/* Overlay for non-ready states */}
          {showOverlay && (
            <div className="shell-overlay">
              {isIdle && (
                <div className="shell-connecting">
                  <div className="shell-connecting-content">
                    <span className="shell-connecting-label">{displayStatus}</span>
                  </div>
                </div>
              )}

              {isConnecting && <ShellConnecting status={displayStatus} />}

              {isError && (
                <div className="shell-error">
                  <div className="text-destructive font-semibold">Shell Error</div>
                  <div className="text-muted-foreground text-sm">{displayStatus}</div>
                  <button
                    className="btn btn-secondary mt-4"
                    onClick={connect}
                  >
                    Reconnect
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Search UI */}
          {isSearchOpen && state.phase === "ready" && (
            <ShellSearch
              query={deferredSearchQuery}
              onQueryChange={setSearchQuery}
              onFindNext={handleFindNext}
              onFindPrevious={handleFindPrevious}
              onClose={handleCloseSearch}
              caseSensitive={caseSensitive}
              onCaseSensitiveChange={setCaseSensitive}
              wholeWord={wholeWord}
              onWholeWordChange={setWholeWord}
              regex={regex}
              onRegexChange={setRegex}
              searchResults={searchResults}
            />
          )}
        </div>

        {/* Reconnect button for disconnected state */}
        {state.phase === "disconnected" && (
          <div className="shell-disconnected-actions">
            <button
              className="btn btn-primary"
              onClick={connect}
            >
              Reconnect
            </button>
          </div>
        )}
      </div>
    );
  }),
);
