// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import type { Terminal } from "@xterm/xterm";

/** ANSI escape codes for terminal styling */
export const ANSI = {
  RESET: "\x1b[0m",
  DIM: "\x1b[2m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
} as const;

/** Shell connection status (matches state machine phases) */
export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "opening"
  | "initializing"
  | "ready"
  | "disconnected"
  | "error";

export interface ShellTerminalProps {
  taskId: string;
  workflowName: string;
  taskName: string;
  shell?: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  className?: string;
}

export interface ShellTerminalRef {
  connect: () => void;
  disconnect: () => void;
  focus: () => void;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

export interface SearchResultInfo {
  resultIndex: number;
  resultCount: number;
}

export interface UseShellReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  terminal: Terminal | null;
  getTerminal: () => Terminal | null;
  isReady: boolean;
  focus: () => void;
  write: (data: string | Uint8Array) => void;
  clear: () => void;
  getDimensions: () => { rows: number; cols: number } | null;
  fit: () => void;
  setActive: (active: boolean) => void;
  /** Call when session explicitly ends (user types exit, Ctrl+D, etc.) */
  dispose: () => void;
  findNext: (query: string, options?: SearchOptions) => boolean;
  findPrevious: (query: string, options?: SearchOptions) => boolean;
  clearSearch: () => void;
  searchResults: SearchResultInfo | null;
}

export interface UseWebSocketShellReturn {
  status: ConnectionStatus;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  send: (data: string | Uint8Array) => void;
  resize: (rows: number, cols: number) => void;
}

/** Shell theme with NVIDIA green accent */
export const SHELL_THEME = {
  background: "#09090b",
  foreground: "#e4e4e7",
  cursor: "#76b900",
  cursorAccent: "#09090b",
  selectionBackground: "#3f3f4680",
  selectionForeground: undefined,
  selectionInactiveBackground: "#27272a80",
  black: "#18181b",
  red: "#f87171",
  green: "#76b900",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e4e4e7",
  brightBlack: "#3f3f46",
  brightRed: "#fca5a5",
  brightGreen: "#9ed439",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
} as const;

export const SHELL_CONFIG = {
  DEFAULT_SHELL: "/bin/bash",
  SCROLLBACK: 10000,
  FONT_SIZE: 13,
  MIN_COLS: 40,
  MIN_ROWS: 5,
  CURSOR_BLINK_RATE: 600,
  RESIZE_DEBOUNCE_MS: 100,
  /** 55s timeout (5s before router's 60s) for better error messages */
  BACKEND_INIT_TIMEOUT_MS: 55000,
} as const;

export const SHELL_OPTIONS = [
  { value: "/bin/bash", label: "/bin/bash" },
  { value: "/bin/zsh", label: "/bin/zsh" },
  { value: "/bin/sh", label: "/bin/sh" },
] as const;
