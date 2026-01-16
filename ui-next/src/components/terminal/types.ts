// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Terminal Component Types
 *
 * Type definitions for the shell terminal feature.
 * Used by ShellTerminal, shell store, and integration components.
 */

import type { Terminal } from "@xterm/xterm";

// =============================================================================
// Connection Status
// =============================================================================

/**
 * Terminal connection status states.
 */
export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

// =============================================================================
// Shell Session
// =============================================================================

/**
 * Shell session state tracked in the store.
 */
export interface ShellSession {
  /** Task name this session is connected to */
  taskName: string;
  /** Shell executable (e.g., /bin/bash, /bin/sh) */
  shell: string;
  /** Workflow name for the session */
  workflowName: string;
  /** Current connection status */
  status: ConnectionStatus;
  /** Error message if status is 'error' */
  error?: string;
  /** Timestamp when session was created */
  createdAt: number;
  /** Timestamp when session connected */
  connectedAt?: number;
}

/**
 * Persisted session info for sessionStorage.
 * Minimal data needed for reconnection.
 */
export interface PersistedSession {
  taskName: string;
  shell: string;
  workflowName: string;
}

// =============================================================================
// Terminal Props
// =============================================================================

/**
 * Props for the ShellTerminal component.
 */
export interface ShellTerminalProps {
  /** Workflow name for the exec API */
  workflowName: string;
  /** Task name to exec into */
  taskName: string;
  /** Shell to use (default: /bin/bash) */
  shell?: string;
  /** Called when terminal connects successfully */
  onConnected?: () => void;
  /** Called when terminal disconnects */
  onDisconnected?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Called when user exits the shell (types exit or Ctrl+D) */
  onSessionEnded?: () => void;
  /** Additional className for the container */
  className?: string;
}

/**
 * Props for the ConnectionStatus indicator.
 */
export interface ConnectionStatusProps {
  /** Current status */
  status: ConnectionStatus;
  /** Size variant */
  size?: "sm" | "md";
  /** Show label text */
  showLabel?: boolean;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Terminal Hook Returns
// =============================================================================

/**
 * Return type for useTerminal hook.
 */
export interface UseTerminalReturn {
  /** Ref to attach to terminal container div */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The xterm Terminal instance (null - use getTerminal() in effects) */
  terminal: Terminal | null;
  /** Get terminal instance (for use in effects only) */
  getTerminal: () => Terminal | null;
  /** Whether terminal is ready for input */
  isReady: boolean;
  /** Focus the terminal */
  focus: () => void;
  /** Write data to terminal */
  write: (data: string | Uint8Array) => void;
  /** Clear terminal screen */
  clear: () => void;
  /** Get current dimensions */
  getDimensions: () => { rows: number; cols: number } | null;
  /** Trigger fit to container */
  fit: () => void;
}

/**
 * Return type for useWebSocketTerminal hook.
 */
export interface UseWebSocketTerminalReturn {
  /** Current connection status */
  status: ConnectionStatus;
  /** Error message if any */
  error: string | null;
  /** Connect to the terminal */
  connect: () => Promise<void>;
  /** Disconnect from the terminal */
  disconnect: () => void;
  /** Send data to the terminal */
  send: (data: string | Uint8Array) => void;
  /** Send resize event */
  resize: (rows: number, cols: number) => void;
}

// =============================================================================
// xterm.js Theme
// =============================================================================

/**
 * Terminal theme configuration.
 * Based on DESIGN.md specifications with NVIDIA green accent.
 */
export const TERMINAL_THEME = {
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
// Terminal Constants
// =============================================================================

/**
 * Terminal configuration constants.
 */
export const TERMINAL_CONFIG = {
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
 */
export const SHELL_OPTIONS = [
  { value: "/bin/bash", label: "bash" },
  { value: "/bin/sh", label: "sh" },
  { value: "/bin/zsh", label: "zsh" },
] as const;
