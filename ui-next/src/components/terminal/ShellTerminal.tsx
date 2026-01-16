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
 * Interactive terminal for exec into running task containers.
 * Combines xterm.js terminal with WebSocket connection to backend PTY.
 *
 * Features:
 * - WebGL-accelerated rendering
 * - Auto-resize to container
 * - NVIDIA-themed dark colors
 * - Screen reader support
 * - Search with Ctrl+Shift+F
 * - Copy/paste support
 * - Shell selector
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

import { memo, useEffect, useCallback, useState, useRef } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnnouncer, useCopy } from "@/hooks";
import { useShellStore } from "@/app/(dashboard)/workflows/[name]/stores";

import { useTerminal } from "./use-terminal";
import { useWebSocketTerminal } from "./use-websocket-terminal";
import { ShellToolbar } from "./ShellToolbar";
import { TerminalSearch } from "./TerminalSearch";
import type { ShellTerminalProps } from "./types";
import { TERMINAL_CONFIG } from "./types";

import "./terminal.css";

// =============================================================================
// Component
// =============================================================================

export const ShellTerminal = memo(function ShellTerminal({
  workflowName,
  taskName,
  shell: initialShell = TERMINAL_CONFIG.DEFAULT_SHELL,
  onConnected,
  onDisconnected,
  onError,
  onSessionEnded,
  className,
}: ShellTerminalProps) {
  const announce = useAnnouncer();
  const { copy } = useCopy();

  // Local state
  const [isActive, setIsActive] = useState(false);
  const [shell, setShell] = useState(initialShell);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Refs for search addon
  const searchAddonRef = useRef<{ findNext: (q: string) => boolean; findPrevious: (q: string) => boolean } | null>(
    null,
  );

  // Shell store for session tracking
  const openSession = useShellStore((s) => s.openSession);
  const updateStatus = useShellStore((s) => s.updateStatus);
  const closeSession = useShellStore((s) => s.closeSession);

  // Terminal hook - manages xterm.js instance
  const {
    containerRef,
    getTerminal,
    isReady: isTerminalReady,
    write,
    focus,
    getDimensions,
    fit,
  } = useTerminal({
    onData: (data) => {
      // Send user input to backend
      send(data);
    },
    onResize: (cols, rows) => {
      // Notify backend of terminal size change
      resize(rows, cols);
    },
  });

  // WebSocket hook - manages connection to backend PTY
  const { status, error, connect, disconnect, send, resize } = useWebSocketTerminal({
    workflowName,
    taskName,
    shell,
    onData: (data) => {
      // Write received data to terminal
      write(data);
    },
    onStatusChange: (newStatus) => {
      updateStatus(taskName, newStatus);
    },
    onConnected: () => {
      // Send initial terminal size
      const dims = getDimensions();
      if (dims) {
        resize(dims.rows, dims.cols);
      }
      focus();
      announce("Terminal connected", "polite");
      onConnected?.();
    },
    onDisconnected: () => {
      announce("Terminal disconnected", "polite");
      onDisconnected?.();
    },
    onError: (err) => {
      announce(`Terminal error: ${err.message}`, "assertive");
      onError?.(err);
    },
    onSessionEnded: () => {
      announce("Shell session ended", "polite");
      closeSession(taskName);
      onSessionEnded?.();
    },
  });

  // Register session on mount
  useEffect(() => {
    openSession(workflowName, taskName, shell);
    return () => {
      // Don't close session on unmount - keep it for reconnection
    };
  }, [workflowName, taskName, shell, openSession]);

  // Auto-connect when terminal is ready
  useEffect(() => {
    if (isTerminalReady && status === "idle") {
      connect();
    }
  }, [isTerminalReady, status, connect]);

  // Re-fit terminal when container might have changed
  useEffect(() => {
    if (isTerminalReady) {
      fit();
    }
  }, [isTerminalReady, fit]);

  // Set up search addon when terminal is ready
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
  }, [isTerminalReady, getTerminal]);

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

  // Handle reconnect
  const handleReconnect = useCallback(() => {
    connect();
  }, [connect]);

  // Handle disconnect
  const handleDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  // Handle focus/blur for active state
  const handleFocus = useCallback(() => {
    setIsActive(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsActive(false);
  }, []);

  // Handle shell change
  const handleShellChange = useCallback((newShell: string) => {
    setShell(newShell);
  }, []);

  // Handle search toggle
  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => !prev);
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

  return (
    <div
      className={cn("terminal-container", className)}
      data-active={isActive}
      data-animate="true"
      onFocus={handleFocus}
      onBlur={handleBlur}
      role="application"
      aria-label={`Terminal for ${taskName}`}
    >
      {/* Header */}
      <div className="terminal-header">
        <div className="terminal-header-left">
          <TerminalIcon
            className="size-4 text-zinc-400"
            aria-hidden="true"
          />
          <span className="terminal-task-name">{taskName}</span>
        </div>
        <div className="terminal-header-right">
          <span className="text-xs text-zinc-500">Ctrl+Shift+F: Search</span>
        </div>
      </div>

      {/* Terminal Body */}
      <div
        ref={containerRef}
        className="terminal-body"
        tabIndex={0}
      />

      {/* Search Bar (when open) */}
      {isSearchOpen && (
        <TerminalSearch
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onFindNext={handleFindNext}
          onFindPrevious={handleFindPrevious}
          onClose={handleCloseSearch}
        />
      )}

      {/* Status Bar / Toolbar */}
      <ShellToolbar
        shell={shell}
        onShellChange={handleShellChange}
        status={status}
        error={error}
        onReconnect={handleReconnect}
        onDisconnect={handleDisconnect}
        onToggleSearch={handleToggleSearch}
        isSearchActive={isSearchOpen}
        canChangeShell={status === "idle" || status === "disconnected"}
      />
    </div>
  );
});
