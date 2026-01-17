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
import { cn } from "@/lib/utils";
import { useAnnouncer, useCopy } from "@/hooks";
import { useShellStore } from "@/app/(dashboard)/workflows/[name]/stores";

import { useShell } from "./use-shell";
import { useWebSocketShell } from "./use-websocket-shell";
import { ShellConnectCard } from "./ShellConnectCard";
import { ShellConnecting } from "./ShellConnecting";
import { ShellSearch } from "./ShellSearch";
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
      workflowName,
      taskName,
      shell: initialShell = SHELL_CONFIG.DEFAULT_SHELL,
      autoConnect = true,
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
    const [shell, setShell] = useState(initialShell);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    // Track if we've written the disconnect message to avoid duplicates
    const hasWrittenDisconnectRef = useRef(false);

    // Refs for search addon
    const searchAddonRef = useRef<{ findNext: (q: string) => boolean; findPrevious: (q: string) => boolean } | null>(
      null,
    );

    // Shell store for session tracking
    const openSession = useShellStore((s) => s.openSession);
    const updateStatus = useShellStore((s) => s.updateStatus);
    const closeSession = useShellStore((s) => s.closeSession);

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

    // Shell hook - manages xterm.js instance
    // Pass taskName as terminalKey to enable persistence across navigation
    const {
      containerRef,
      getTerminal,
      isReady: isShellReady,
      write,
      focus,
      getDimensions,
      fit,
      setActive: setTerminalActive,
    } = useShell({
      onData: handleShellData,
      onResize: handleShellResize,
      terminalKey: taskName,
    });

    // WebSocket hook - manages connection to backend PTY
    const { status, connect, disconnect, send, resize } = useWebSocketShell({
      workflowName,
      taskName,
      shell,
      onData: (data) => {
        // Write received data to shell
        write(data);
      },
      onStatusChange: (newStatus) => {
        updateStatus(taskName, newStatus);
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
        // Keep terminal in cache for history viewing - only closeSession from store
        closeSession(taskName);
        onSessionEnded?.();
      },
    });

    // Handle connect with shell selection
    const handleConnect = useCallback((selectedShell: string) => {
      setShell(selectedShell);
      // Connect will be triggered by effect when shell is set
    }, []);

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

    // Register session on mount
    useEffect(() => {
      openSession(workflowName, taskName, shell);
      return () => {
        // Don't close session on unmount - keep it for reconnection
      };
    }, [workflowName, taskName, shell, openSession]);

    // Connect when shell is selected (from connect card)
    useEffect(() => {
      if (isShellReady && status === "idle" && shell !== initialShell) {
        // Shell was changed via connect card, initiate connection
        connect();
      }
    }, [isShellReady, status, shell, initialShell, connect]);

    // Auto-connect when shell is ready (only if autoConnect is true)
    useEffect(() => {
      if (autoConnect && isShellReady && status === "idle") {
        connect();
      }
    }, [autoConnect, isShellReady, status, connect]);

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

    // Set up search addon when shell is ready
    useEffect(() => {
      const terminal = getTerminal();
      if (!terminal) return;

      // Import SearchAddon dynamically to avoid SSR issues
      import("@xterm/addon-search").then(({ SearchAddon }) => {
        const addon = new SearchAddon();
        terminal.loadAddon(addon);
        searchAddonRef.current = {
          findNext: (q: string) => addon.findNext(q),
          findPrevious: (q: string) => addon.findPrevious(q),
        };
      });
    }, [isShellReady, getTerminal]);

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
      focus();
    }, [focus]);

    // Handle find next
    const handleFindNext = useCallback(() => {
      if (searchAddonRef.current && searchQuery) {
        searchAddonRef.current.findNext(searchQuery);
      }
    }, [searchQuery]);

    // Handle find previous
    const handleFindPrevious = useCallback(() => {
      if (searchAddonRef.current && searchQuery) {
        searchAddonRef.current.findPrevious(searchQuery);
      }
    }, [searchQuery]);

    // Search when query changes
    useEffect(() => {
      if (searchQuery && searchAddonRef.current) {
        searchAddonRef.current.findNext(searchQuery);
      }
    }, [searchQuery]);

    // Determine UI state
    const isConnected = status === "connected";
    const isConnecting = status === "connecting";
    const showConnectCard = status === "idle" && !autoConnect;

    return (
      <div
        className={cn("shell-container", className)}
        data-active={isActive}
        data-connected={isConnected}
        onFocus={handleFocus}
        onBlur={handleBlur}
        role="application"
        aria-label={`Shell for ${taskName}`}
      >
        {/* Terminal Body - always mounted to preserve history */}
        <div
          ref={containerRef}
          className="shell-body"
          tabIndex={0}
        />

        {/* Connect Card - shown on idle (when autoConnect is false) */}
        {showConnectCard && <ShellConnectCard onConnect={handleConnect} />}

        {/* Connecting Spinner */}
        {isConnecting && <ShellConnecting />}

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
