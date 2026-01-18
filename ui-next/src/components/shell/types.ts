// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Shell Component Types
 *
 * Type definitions for the shell feature.
 * Used by ShellTerminal, shell store, and integration components.
 */

import type { Terminal } from "@xterm/xterm";

// =============================================================================
// Connection Status
// =============================================================================

/**
 * Shell connection status states.
 *
 * - mounting: Intent exists, TaskShell component is mounting
 * - idle: Terminal ready, no connection attempt yet
 * - connecting: WebSocket connection in progress
 * - connected: WebSocket open, shell is interactive
 * - disconnected: WebSocket closed, terminal preserved
 * - error: Connection failed, error message available
 */
export type ConnectionStatus = "mounting" | "idle" | "connecting" | "connected" | "disconnected" | "error";

// =============================================================================
// Shell Props
// =============================================================================

/**
 * Props for the ShellTerminal component.
 */
export interface ShellTerminalProps {
  /** Task UUID from backend - used as unique session key */
  taskId: string;
  /** Workflow name for the exec API */
  workflowName: string;
  /** Task name to exec into */
  taskName: string;
  /** Shell to use (default: /bin/bash) */
  shell?: string;
  /** Called when shell connects successfully */
  onConnected?: () => void;
  /** Called when shell disconnects */
  onDisconnected?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Called when connection status changes */
  onStatusChange?: (status: ConnectionStatus) => void;
  /** Additional className for the container */
  className?: string;
}

/**
 * Ref handle for ShellTerminal imperative methods.
 */
export interface ShellTerminalRef {
  /** Manually trigger connection */
  connect: () => void;
  /** Manually trigger disconnection */
  disconnect: () => void;
  /** Focus the terminal */
  focus: () => void;
}

// =============================================================================
// Search Options
// =============================================================================

/**
 * Options for shell search (xterm.js SearchAddon).
 */
export interface SearchOptions {
  /** Whether to match case (default: false - case insensitive) */
  caseSensitive?: boolean;
  /** Whether to match whole words only (default: false) */
  wholeWord?: boolean;
  /** Whether to treat search term as regex (default: false) */
  regex?: boolean;
}

/**
 * Search result info from xterm.js SearchAddon.
 */
export interface SearchResultInfo {
  /** Current match index (0-based, -1 if no results) */
  resultIndex: number;
  /** Total number of matches */
  resultCount: number;
}

// =============================================================================
// Shell Hook Returns
// =============================================================================

/**
 * Return type for useShell hook.
 */
export interface UseShellReturn {
  /** Ref to attach to shell container div */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The xterm instance (null - use getTerminal() in effects) */
  terminal: Terminal | null;
  /** Get xterm instance (for use in effects only) */
  getTerminal: () => Terminal | null;
  /** Whether shell is ready for input */
  isReady: boolean;
  /** Focus the shell */
  focus: () => void;
  /** Write data to shell */
  write: (data: string | Uint8Array) => void;
  /** Clear shell screen */
  clear: () => void;
  /** Get current dimensions */
  getDimensions: () => { rows: number; cols: number } | null;
  /** Trigger fit to container */
  fit: () => void;
  /** Set active state (controls cursor blink) */
  setActive: (active: boolean) => void;
  /**
   * Dispose the terminal and remove from cache.
   * Call this when the session explicitly ends (user types exit, Ctrl+D, etc.)
   */
  dispose: () => void;
  /** Search: find next occurrence of query */
  findNext: (query: string, options?: SearchOptions) => boolean;
  /** Search: find previous occurrence of query */
  findPrevious: (query: string, options?: SearchOptions) => boolean;
  /** Search: clear search decorations */
  clearSearch: () => void;
  /** Current search result info (null if no search active) */
  searchResults: SearchResultInfo | null;
}

/**
 * Return type for useWebSocketShell hook.
 */
export interface UseWebSocketShellReturn {
  /** Current connection status */
  status: ConnectionStatus;
  /** Error message if any */
  error: string | null;
  /** Connect to the shell */
  connect: () => Promise<void>;
  /** Disconnect from the shell */
  disconnect: () => void;
  /** Send data to the shell */
  send: (data: string | Uint8Array) => void;
  /** Send resize event */
  resize: (rows: number, cols: number) => void;
}

// =============================================================================
// xterm.js Theme
// =============================================================================

/**
 * Shell theme configuration.
 * Based on DESIGN.md specifications with NVIDIA green accent.
 */
export const SHELL_THEME = {
  // Background & Foreground
  background: "#09090b", // zinc-950
  foreground: "#e4e4e7", // zinc-200

  // Cursor
  cursor: "#76b900", // NVIDIA green
  cursorAccent: "#09090b",

  // Selection
  selectionBackground: "#3f3f4680", // zinc-700 at 50% opacity
  selectionForeground: undefined, // Keep text color
  selectionInactiveBackground: "#27272a80",

  // ANSI Colors (normal)
  black: "#18181b",
  red: "#f87171",
  green: "#76b900", // NVIDIA green
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e4e4e7",

  // ANSI Colors (bright)
  brightBlack: "#3f3f46",
  brightRed: "#fca5a5",
  brightGreen: "#9ed439", // NVIDIA green light
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
} as const;

// =============================================================================
// Shell Constants
// =============================================================================

/**
 * Shell configuration constants.
 */
export const SHELL_CONFIG = {
  /** Default shell if not specified */
  DEFAULT_SHELL: "/bin/bash",
  /** Scrollback buffer size (lines) */
  SCROLLBACK: 10000,
  /** Font size in pixels */
  FONT_SIZE: 13,
  /** Minimum columns */
  MIN_COLS: 40,
  /** Minimum rows */
  MIN_ROWS: 5,
  /** Cursor blink rate in ms */
  CURSOR_BLINK_RATE: 600,
  /** Debounce delay for resize events */
  RESIZE_DEBOUNCE_MS: 100,
} as const;

/**
 * Available shell options for the shell selector.
 * Labels use full paths for clarity in UI dropdowns.
 */
export const SHELL_OPTIONS = [
  { value: "/bin/bash", label: "/bin/bash" },
  { value: "/bin/zsh", label: "/bin/zsh" },
  { value: "/bin/sh", label: "/bin/sh" },
] as const;
