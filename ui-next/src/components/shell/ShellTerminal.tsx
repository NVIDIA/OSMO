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
 * - Search with Ctrl+Shift+F
 * - Copy/paste support
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

import { memo, useEffect, useCallback, useState, useRef, forwardRef, useImperativeHandle } from "react";
import { useDebounceValue } from "usehooks-ts";
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

/**
 * Generate an inline disconnect message for the terminal buffer.
 * Uses ANSI escape codes for styling.
 */
function getDisconnectMessage(isError: boolean, errorMessage?: string | null): string {
  const divider = `${ANSI.GRAY}${"─".repeat(40)}${ANSI.RESET}`;
  const icon = isError ? `${ANSI.RED}✗${ANSI.RESET}` : `${ANSI.GRAY}○${ANSI.RESET}`;
  const label = isError ? `${ANSI.RED}Connection lost${ANSI.RESET}` : `${ANSI.GRAY}Session ended${ANSI.RESET}`;

  let message = `\r\n\r\n${divider}\r\n  ${icon} ${label}\r\n`;

  if (isError && errorMessage) {
    message += `  ${ANSI.DIM}${errorMessage}${ANSI.RESET}\r\n`;
  }

  message += `${divider}\r\n`;

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
      onSessionEnded,
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
    // Debounce search query to reduce SearchAddon calls (150ms is responsive yet efficient)
    const [debouncedSearchQuery] = useDebounceValue(searchQuery, 150);

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
      onSessionEnded: () => {
        announce("Shell session ended", "polite");
        // Let parent handle session state (marks as disconnected, keeps terminal in cache)
        onSessionEnded?.();
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

    // Handle keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Ctrl+Shift+F - Toggle search
        if (e.ctrlKey && e.shiftKey && e.key === "F") {
          e.preventDefault();
          setIsSearchOpen((prev) => !prev);
          return;
        }

        // Ctrl+Shift+C - Copy selection
        if (e.ctrlKey && e.shiftKey && e.key === "C") {
          e.preventDefault();
          const terminal = getTerminal();
          if (terminal) {
            const selection = terminal.getSelection();
            if (selection) {
              copy(selection);
              announce("Copied to clipboard", "polite");
            }
          }
          return;
        }

        // Ctrl+Shift+V - Paste
        if (e.ctrlKey && e.shiftKey && e.key === "V") {
          e.preventDefault();
          navigator.clipboard.readText().then((text) => {
            send(text);
          });
          return;
        }
      };

      const container = containerRef.current;
      if (container) {
        container.addEventListener("keydown", handleKeyDown);
        return () => container.removeEventListener("keydown", handleKeyDown);
      }
    }, [getTerminal, containerRef, copy, announce, send]);

    // Handle focus/blur for active state
    const handleFocus = useCallback(() => {
      setIsActive(true);
    }, []);

    const handleBlur = useCallback(() => {
      setIsActive(false);
    }, []);

    // Handle search close
    const handleCloseSearch = useCallback(() => {
      setIsSearchOpen(false);
      setSearchQuery("");
      clearSearch();
      focus();
    }, [focus, clearSearch]);

    // Handle find next - uses search methods from useShell
    const handleFindNext = useCallback(() => {
      if (searchQuery) {
        findNext(searchQuery);
      }
    }, [searchQuery, findNext]);

    // Handle find previous - uses search methods from useShell
    const handleFindPrevious = useCallback(() => {
      if (searchQuery) {
        findPrevious(searchQuery);
      }
    }, [searchQuery, findPrevious]);

    // Search when debounced query changes (avoids excessive SearchAddon calls)
    useEffect(() => {
      if (debouncedSearchQuery) {
        findNext(debouncedSearchQuery);
      } else {
        clearSearch();
      }
    }, [debouncedSearchQuery, findNext, clearSearch]);

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
          />
        )}
      </div>
    );
  }),
);
