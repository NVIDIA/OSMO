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

import { memo, forwardRef, useImperativeHandle, useState, useEffect, useCallback, useDeferredValue } from "react";
import { cn } from "@/lib/utils";
import { useAnnouncer, useCopy } from "@/hooks";

import { useShell } from "../hooks/use-shell";
import { getSession } from "../lib/shell-cache";
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

    const shellHook = useShell({
      sessionKey: taskId,
      workflowName,
      taskName,
      shell,
    });

    const [hasWrittenDisconnect, setHasWrittenDisconnect] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [regex, setRegex] = useState(false);
    const [searchResults, setSearchResults] = useState<{ resultIndex: number; resultCount: number } | null>(null);
    const deferredSearchQuery = useDeferredValue(searchQuery);

    useImperativeHandle(ref, () => ({
      connect: shellHook.connect,
      disconnect: shellHook.disconnect,
      focus: shellHook.focus,
      fit: shellHook.fit,
      write: shellHook.write,
    }));

    useEffect(() => {
      onStatusChange?.(shellHook.state.phase);
    }, [shellHook.state, onStatusChange]);

    useEffect(() => {
      if (shellHook.state.phase === "ready") {
        onConnected?.();
        announce("Shell connected", "polite");
      } else if (shellHook.state.phase === "disconnected") {
        // Write disconnect message to terminal
        if (!hasWrittenDisconnect) {
          const isError = !!shellHook.state.reason?.includes("error");
          shellHook.write(getDisconnectMessage(isError, shellHook.state.reason));
          setHasWrittenDisconnect(true);
        }
        onDisconnected?.();
        announce("Shell disconnected", "polite");
      } else if (shellHook.state.phase === "error") {
        onError?.(new Error(shellHook.state.error));
        announce(`Shell error: ${shellHook.state.error}`, "assertive");
      }
    }, [shellHook.state, onConnected, onDisconnected, onError, announce, shellHook, hasWrittenDisconnect]);

    const handleFindNext = () => {
      if (deferredSearchQuery) {
        shellHook.findNext(deferredSearchQuery, { caseSensitive, wholeWord, regex });
      }
    };

    const handleFindPrevious = () => {
      if (deferredSearchQuery) {
        shellHook.findPrevious(deferredSearchQuery, { caseSensitive, wholeWord, regex });
      }
    };

    const handleCloseSearch = useCallback(() => {
      setIsSearchOpen(false);
      shellHook.clearSearch();
    }, [shellHook]);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Cmd/Ctrl+F: Toggle search
        if ((e.metaKey || e.ctrlKey) && e.key === "f") {
          e.preventDefault();
          setIsSearchOpen((prev) => !prev);
        }

        // Cmd/Ctrl+C: Copy selection
        if ((e.metaKey || e.ctrlKey) && e.key === "c") {
          if (shellHook.state.phase === "ready" && shellHook.state.terminal.hasSelection()) {
            e.preventDefault();
            const text = shellHook.state.terminal.getSelection();
            copy(text).catch(console.error);
          }
        }

        // Escape: Close search
        if (e.key === "Escape" && isSearchOpen) {
          handleCloseSearch();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [shellHook.state, isSearchOpen, copy, handleCloseSearch]);

    useEffect(() => {
      const session = getSession(taskId);
      if (!session?.addons) return;

      const disposable = session.addons.searchAddon.onDidChangeResults((results) => {
        if (results) {
          setSearchResults({
            resultIndex: results.resultIndex,
            resultCount: results.resultCount,
          });
        } else {
          setSearchResults(null);
        }
      });

      return () => disposable.dispose();
    }, [taskId]);

    useEffect(() => {
      if (shellHook.state.phase === "idle") {
        shellHook.connect();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (
      shellHook.state.phase === "connecting" ||
      shellHook.state.phase === "opening" ||
      shellHook.state.phase === "initializing"
    ) {
      return (
        <div className={cn("shell-wrapper", className)}>
          <ShellConnecting />
        </div>
      );
    }

    if (shellHook.state.phase === "error") {
      return (
        <div className={cn("shell-wrapper", className)}>
          <div className="shell-error">
            <div className="text-destructive font-semibold">Shell Error</div>
            <div className="text-muted-foreground text-sm">{shellHook.state.error}</div>
            <button
              className="btn btn-secondary mt-4"
              onClick={() => {
                setHasWrittenDisconnect(false);
                shellHook.connect();
              }}
            >
              Reconnect
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={cn("shell-wrapper", className)}>
        <div className="shell-body-wrapper">
          <div
            ref={shellHook.containerRef}
            className="shell-body"
          />

          {isSearchOpen && shellHook.state.phase === "ready" && (
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

        {shellHook.state.phase === "disconnected" && (
          <div className="shell-disconnected-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                setHasWrittenDisconnect(false);
                shellHook.connect();
              }}
            >
              Reconnect
            </button>
          </div>
        )}
      </div>
    );
  }),
);
