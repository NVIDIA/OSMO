// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellTerminal Component
 *
 * Interactive shell for exec into running task containers.
 * Combines xterm.js with WebSocket connection to backend PTY.
 *
 * Features:
 * - Zero permanent chrome - contextual overlays only
 * - WebGL-accelerated rendering
 * - Auto-resize to container
 * - NVIDIA-themed dark colors
 * - Screen reader support
 * - Search with Cmd+F (Mac) / Ctrl+F (Windows/Linux)
 * - Copy/paste with Cmd+C/V (Mac) or Ctrl+C/V (Windows/Linux)
 *
 * Usage:
 * ```tsx
 * <ShellTerminal
 *   workflowName="my-workflow"
 *   taskName="train-model"
 *   onConnected={() => console.log("Connected!")}
 * />
 * ```
 */

"use client";

import {
  memo,
  useEffect,
  useCallback,
  useState,
  useRef,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useDeferredValue,
} from "react";
import { useEventCallback } from "usehooks-ts";
import { cn } from "@/lib/utils";
import { useAnnouncer, useCopy } from "@/hooks";

import { useShell } from "./use-shell";
import { updateSessionStatus } from "./shell-session-cache";
import { useWebSocketShell } from "./use-websocket-shell";
import { ShellConnecting } from "./ShellConnecting";
import { ShellSearch } from "./ShellSearch";
import { hadPreviousConnection } from "./shell-session-cache";
import type { ShellTerminalProps, ShellTerminalRef } from "./types";
import { SHELL_CONFIG } from "./types";

import "./shell.css";

// =============================================================================
// ANSI Escape Codes for Terminal Messages
// =============================================================================

const ANSI = {
  RESET: "\x1b[0m",
  DIM: "\x1b[2m",
  RED: "\x1b[31m",
  YELLOW: "\x1b[33m",
  GRAY: "\x1b[90m",
} as const;

// Pre-computed constants at module load (avoids runtime computation)
const ANSI_DIVIDER = `${ANSI.GRAY}${"─".repeat(40)}${ANSI.RESET}`;
const ANSI_ICON_ERROR = `${ANSI.RED}✗${ANSI.RESET}`;
const ANSI_ICON_NORMAL = `${ANSI.GRAY}○${ANSI.RESET}`;
const ANSI_LABEL_ERROR = `${ANSI.RED}Connection lost${ANSI.RESET}`;
const ANSI_LABEL_NORMAL = `${ANSI.GRAY}Session ended${ANSI.RESET}`;

/**
 * Generate an inline disconnect message for the terminal buffer.
 * Uses pre-computed ANSI escape codes for styling.
 */
function getDisconnectMessage(isError: boolean, errorMessage?: string | null): string {
  const icon = isError ? ANSI_ICON_ERROR : ANSI_ICON_NORMAL;
  const label = isError ? ANSI_LABEL_ERROR : ANSI_LABEL_NORMAL;

  let message = `\r\n\r\n${ANSI_DIVIDER}\r\n  ${icon} ${label}\r\n`;

  if (isError && errorMessage) {
    message += `  ${ANSI.DIM}${errorMessage}${ANSI.RESET}\r\n`;
  }

  message += `${ANSI_DIVIDER}\r\n`;

  return message;
}

// =============================================================================
// Component
// =============================================================================

export const ShellTerminal = memo(
  forwardRef<ShellTerminalRef, ShellTerminalProps>(function ShellTerminal(
    {
      taskId,
      workflowName,
      taskName,
      shell: initialShell = SHELL_CONFIG.DEFAULT_SHELL,
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

    // Local state
    const [isActive, setIsActive] = useState(false);
    const shell = initialShell;
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [regex, setRegex] = useState(false);
    // Use React 19's useDeferredValue for concurrent rendering - keeps UI responsive
    // while deferring expensive search operations to lower priority updates
    const deferredSearchQuery = useDeferredValue(searchQuery);

    // Track if we've written the disconnect message to avoid duplicates
    const hasWrittenDisconnectRef = useRef(false);

    // Refs to hold latest send/resize functions to avoid recreating terminal on callback changes
    const sendRef = useRef<(data: string | Uint8Array) => void>(() => {});
    const resizeRef = useRef<(rows: number, cols: number) => void>(() => {});

    // Stable callbacks for useShell - these never change reference
    const handleShellData = useCallback((data: string) => {
      sendRef.current(data);
    }, []);

    const handleShellResize = useCallback((cols: number, rows: number) => {
      resizeRef.current(rows, cols);
    }, []);

    // Use taskId (UUID) as the session key for uniqueness
    const sessionKey = taskId;

    // Shell hook - manages xterm.js instance
    const {
      containerRef,
      getTerminal,
      isReady: isShellReady,
      write,
      focus,
      getDimensions,
      fit,
      setActive: setTerminalActive,
      findNext,
      findPrevious,
      clearSearch,
      searchResults,
    } = useShell({
      onData: handleShellData,
      onResize: handleShellResize,
      sessionKey,
      workflowName,
      taskName,
      shell,
    });

    // WebSocket hook - manages connection to backend PTY
    const { status, connect, disconnect, send, resize } = useWebSocketShell({
      sessionKey,
      workflowName,
      taskName,
      shell,
      onData: (data) => {
        // Write received data to shell
        write(data);
      },
      onStatusChange: (newStatus) => {
        updateSessionStatus(sessionKey, newStatus);
        onStatusChange?.(newStatus);

        // Reset disconnect message flag when connecting
        if (newStatus === "connecting" || newStatus === "connected") {
          hasWrittenDisconnectRef.current = false;
        }
      },
      onConnected: () => {
        // Send initial shell size
        const dims = getDimensions();
        if (dims) {
          resize(dims.rows, dims.cols);
        }
        focus();
        announce("Shell connected", "polite");
        onConnected?.();
      },
      onDisconnected: () => {
        // Write disconnect message to terminal buffer
        if (!hasWrittenDisconnectRef.current) {
          write(getDisconnectMessage(false));
          hasWrittenDisconnectRef.current = true;
        }
        announce("Shell disconnected", "polite");
        onDisconnected?.();
      },
      onError: (err) => {
        // Write error message to terminal buffer
        if (!hasWrittenDisconnectRef.current) {
          write(getDisconnectMessage(true, err.message));
          hasWrittenDisconnectRef.current = true;
        }
        announce(`Shell error: ${err.message}`, "assertive");
        onError?.(err);
      },
    });

    // Expose imperative methods via ref
    useImperativeHandle(
      ref,
      () => ({
        connect: () => {
          connect();
        },
        disconnect: () => {
          disconnect();
        },
        focus: () => {
          focus();
        },
      }),
      [connect, disconnect, focus],
    );

    // Sync refs with latest send/resize functions
    useEffect(() => {
      sendRef.current = send;
      resizeRef.current = resize;
    }, [send, resize]);

    // Session is already created by TaskDetails.handleConnectShell
    // before ShellTerminal mounts, so no registration needed here

    // Start session when shell is ready (only if no previous connection exists)
    // If a previous connection exists, its state is already restored
    useEffect(() => {
      if (isShellReady && status === "idle" && !hadPreviousConnection(sessionKey)) {
        connect();
      }
    }, [isShellReady, status, sessionKey, connect]);

    // Update terminal active state based on connection status
    useEffect(() => {
      const isConnected = status === "connected";
      setTerminalActive(isConnected);
    }, [status, setTerminalActive]);

    // Re-fit shell when container might have changed
    useEffect(() => {
      if (isShellReady) {
        fit();
      }
    }, [isShellReady, fit]);

    // Use refs for keyboard shortcut handlers to bridge to the DOM event system.
    // This ensures the event listener always has the latest callbacks without
    // triggering re-registration or violating useEffectEvent rules (which prohibit
    // passing Effect Events to external APIs like addEventListener).
    const keyboardHandlersRef = useRef({ setIsSearchOpen, getTerminal, copy, announce, send });
    useEffect(() => {
      keyboardHandlersRef.current = { setIsSearchOpen, getTerminal, copy, announce, send };
    }, [setIsSearchOpen, getTerminal, copy, announce, send]);

    // Handle keyboard shortcuts (scoped to terminal container)
    // Shortcuts defined in: ./hotkeys.ts (TERMINAL_HOTKEYS)
    useEffect(() => {
      const container = containerRef.current;
      const onKeyDown = (e: KeyboardEvent) => {
        const { setIsSearchOpen, getTerminal, copy, announce, send } = keyboardHandlersRef.current;

        // TERMINAL_HOTKEYS.shortcuts.TOGGLE_SEARCH
        // Cmd+F (Mac) / Ctrl+F (Windows/Linux) - Toggle search
        // Prevents browser's native find from kicking in when inside the terminal
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "f") {
          e.preventDefault();
          setIsSearchOpen((prev) => !prev);
          return;
        }

        // TERMINAL_HOTKEYS.shortcuts.COPY_SELECTION
        // Cmd+C (Mac) / Ctrl+C (Windows/Linux) - Copy selection
        // Only intercept if there's a selection, otherwise let terminal handle Ctrl+C (SIGINT)
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "c") {
          const terminal = getTerminal();
          if (terminal) {
            const selection = terminal.getSelection();
            if (selection) {
              e.preventDefault();
              copy(selection);
              announce("Copied to clipboard", "polite");
              return;
            }
          }
          // No selection - let the event propagate for Ctrl+C (SIGINT) to work
        }

        // TERMINAL_HOTKEYS.shortcuts.PASTE
        // Cmd+V (Mac) / Ctrl+V (Windows/Linux) - Paste
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "v") {
          e.preventDefault();
          // Use void operator to handle Promise without floating promise lint error
          void navigator.clipboard.readText().then(
            (text) => send(text),
            // Silently fail if clipboard access denied (user didn't grant permission)
            () => {},
          );
          return;
        }
      };

      if (container) {
        container.addEventListener("keydown", onKeyDown);
        return () => container.removeEventListener("keydown", onKeyDown);
      }
    }, [containerRef]);

    // Handle focus/blur for active state - stable refs via useEventCallback
    const handleFocus = useEventCallback(() => {
      setIsActive(true);
    });

    const handleBlur = useEventCallback(() => {
      setIsActive(false);
    });

    // Handle search close - stable ref via useEventCallback
    const handleCloseSearch = useEventCallback(() => {
      setIsSearchOpen(false);
      setSearchQuery("");
      clearSearch();
      focus();
    });

    // Memoize search options to avoid unnecessary effect triggers
    const searchOptions = useMemo(() => ({ caseSensitive, wholeWord, regex }), [caseSensitive, wholeWord, regex]);

    // Handle find next - stable ref via useEventCallback
    const handleFindNext = useEventCallback(() => {
      if (searchQuery) {
        findNext(searchQuery, searchOptions);
      }
    });

    // Handle find previous - stable ref via useEventCallback
    const handleFindPrevious = useEventCallback(() => {
      if (searchQuery) {
        findPrevious(searchQuery, searchOptions);
      }
    });

    // Search when deferred query changes or search options change
    // Clear old results first, then restart search with new options
    // useDeferredValue schedules this at lower priority, keeping input responsive
    useEffect(() => {
      if (deferredSearchQuery) {
        clearSearch(); // Clear old decorations before applying new options
        findNext(deferredSearchQuery, searchOptions);
      } else {
        clearSearch();
      }
    }, [deferredSearchQuery, searchOptions, findNext, clearSearch]);

    // Determine UI state
    const isConnected = status === "connected";
    const isConnecting = status === "connecting";

    // Check if this is a reconnection vs first connection:
    // - First connection: hadPreviousConnection = false → show full overlay
    // - Reattach: status is already "connected" → no overlay
    // - Reconnection: hadPreviousConnection = true but WebSocket closed → show minimal bar
    const isReconnecting = isConnecting && hadPreviousConnection(sessionKey);
    const showConnectingOverlay = isConnecting && !isReconnecting;

    return (
      <div
        className={cn("shell-container", className)}
        data-active={isActive}
        data-connected={isConnected}
        data-reconnecting={isReconnecting}
        onFocus={handleFocus}
        onBlur={handleBlur}
        role="application"
        aria-label={`Shell for ${taskName}`}
      >
        {/* Terminal Body - always mounted to preserve history */}
        {/* Outer shell-body has padding, inner wrapper is what FitAddon measures */}
        <div className="shell-body">
          <div
            ref={containerRef}
            className="shell-body-inner"
            tabIndex={0}
          />
        </div>

        {/* Connecting Overlay - only for first connection, not reconnection */}
        {showConnectingOverlay && <ShellConnecting />}

        {/* Reconnecting Indicator - minimal, non-blocking */}
        {isReconnecting && (
          <div className="shell-reconnecting">
            <span className="shell-reconnecting-dot" />
            <span className="shell-reconnecting-label">Reconnecting...</span>
          </div>
        )}

        {/* Search Bar - floating top-right when open */}
        {isSearchOpen && (
          <ShellSearch
            query={searchQuery}
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
    );
  }),
);
