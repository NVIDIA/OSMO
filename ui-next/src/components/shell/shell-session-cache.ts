// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Shell Session Cache
 *
 * Manages shell sessions (terminal + connection) outside of React's lifecycle.
 * Sessions are stored by a unique key (typically taskId UUID) and persist when
 * navigating within a workflow page.
 *
 * Architecture:
 * - Each session bundles a Terminal instance with its WebSocket connection
 * - When navigating away, both terminal and WebSocket are preserved
 * - When returning, the same session is reattached without creating a new PTY
 *
 * Lifecycle:
 * 1. User opens shell → createSession() creates session with Terminal + WebSocket
 * 2. User navigates away → updateSessionContainer(null) detaches from DOM
 * 3. User returns → reattachTerminal() attaches Terminal to new container
 * 4. User closes shell / exit → disposeSession() cleans up everything
 */

import type { Terminal, IDisposable } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { WebglAddon } from "@xterm/addon-webgl";

import type { ConnectionStatus } from "./types";

// =============================================================================
// Shared Encoder (Module Scope)
// =============================================================================

/**
 * Shared TextEncoder instance for all sessions.
 * TextEncoder is stateless, so a single instance can be safely reused.
 */
const sharedEncoder = new TextEncoder();

// =============================================================================
// Types
// =============================================================================

/**
 * Terminal-related data in a session.
 */
export interface SessionTerminal {
  /** The xterm.js Terminal instance */
  instance: Terminal;
  /** Fit addon for auto-resize */
  fitAddon: FitAddon;
  /** Search addon for Ctrl+Shift+F */
  searchAddon: SearchAddon;
  /** WebGL addon (optional, may be null if not supported) */
  webglAddon: WebglAddon | null;
  /** Disposable for the current onData handler (prevents duplicate handlers) */
  dataDisposable: IDisposable | null;
}

/**
 * Connection-related data in a session.
 */
export interface SessionConnection {
  /** The WebSocket instance (null if not connected) */
  webSocket: WebSocket | null;
  /** Current connection status */
  status: ConnectionStatus;
  /** Error message if status is 'error' */
  error: string | null;
  /**
   * Whether this session has ever had a WebSocket connection.
   * Used to distinguish first connection from reconnection.
   * Set to true when first WebSocket connects, never reset.
   */
  hadConnection: boolean;
}

/**
 * A shell session bundles terminal, connection, and metadata.
 */
export interface ShellSession {
  /** Unique key for this session (typically taskName) */
  key: string;

  // ─────────────────────────────────────────────────────────────────────────
  // Session Metadata
  // ─────────────────────────────────────────────────────────────────────────

  /** Workflow name */
  workflowName: string;
  /** Task name */
  taskName: string;
  /** Shell executable (e.g., /bin/bash) */
  shell: string;
  /** Timestamp when session was created */
  createdAt: number;

  // ─────────────────────────────────────────────────────────────────────────
  // Terminal
  // ─────────────────────────────────────────────────────────────────────────

  /** Terminal instance and addons */
  terminal: SessionTerminal;
  /** The container the terminal is currently attached to (null if detached) */
  container: HTMLElement | null;

  // ─────────────────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────────────────

  /** WebSocket connection state */
  connection: SessionConnection;
}

// =============================================================================
// Cache Store (Module Scope)
// =============================================================================

/** Map of sessionKey -> ShellSession */
const sessionCache = new Map<string, ShellSession>();

/** Subscribers for cache changes (for React useSyncExternalStore) */
const subscribers = new Set<() => void>();

/** Cached snapshot for useSyncExternalStore */
let cachedSnapshot: ShellSessionSnapshot[] = [];

/**
 * Session snapshot for UI components (excludes non-serializable fields).
 */
export interface ShellSessionSnapshot {
  key: string;
  taskId: string;
  taskName: string;
  workflowName: string;
  shell: string;
  status: ConnectionStatus;
  error: string | null;
  createdAt: number;
}

/**
 * Notify all subscribers of cache changes.
 */
function notifySubscribers(): void {
  // Update cached snapshot
  cachedSnapshot = Array.from(sessionCache.values()).map((s) => ({
    key: s.key,
    taskId: s.key, // key is the taskId
    taskName: s.taskName,
    workflowName: s.workflowName,
    shell: s.shell,
    status: s.connection.status,
    error: s.connection.error,
    createdAt: s.createdAt,
  }));
  // Notify React
  for (const callback of subscribers) {
    callback();
  }
}

/**
 * Subscribe to cache changes (for useSyncExternalStore).
 */
export function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

/**
 * Get current snapshot of all sessions (for useSyncExternalStore).
 */
export function getSessionsSnapshot(): ShellSessionSnapshot[] {
  return cachedSnapshot;
}

// =============================================================================
// Session Retrieval
// =============================================================================

/**
 * Get an existing session from the cache.
 */
export function getSession(key: string): ShellSession | undefined {
  return sessionCache.get(key);
}

/**
 * Check if a session exists in the cache.
 */
export function hasSession(key: string): boolean {
  return sessionCache.has(key);
}

// =============================================================================
// Session Creation
// =============================================================================

/**
 * Create a new session with terminal instance.
 * Called by useShell when terminal is ready.
 * Sessions always have a terminal - no two-phase creation.
 */
export function createSession(params: {
  key: string;
  workflowName: string;
  taskName: string;
  shell: string;
  terminal: SessionTerminal;
  container: HTMLElement;
}): ShellSession {
  // If session already exists, just update terminal/container and return
  const existing = sessionCache.get(params.key);
  if (existing) {
    existing.terminal = params.terminal;
    existing.container = params.container;
    notifySubscribers();
    return existing;
  }

  // Create new session (direct creation without openSession)
  const session: ShellSession = {
    key: params.key,
    workflowName: params.workflowName,
    taskName: params.taskName,
    shell: params.shell,
    createdAt: Date.now(),
    terminal: params.terminal,
    container: params.container,
    connection: {
      webSocket: null,
      status: "idle",
      error: null,
      hadConnection: false,
    },
  };

  sessionCache.set(params.key, session);
  notifySubscribers();
  return session;
}

// =============================================================================
// Session Updates
// =============================================================================

/**
 * Update the container reference for a session.
 */
export function updateSessionContainer(key: string, container: HTMLElement | null): void {
  const session = sessionCache.get(key);
  if (session) {
    session.container = container;
  }
}

/**
 * Update the WebSocket for a session.
 */
export function updateSessionWebSocket(key: string, webSocket: WebSocket | null): void {
  const session = sessionCache.get(key);
  if (session) {
    session.connection.webSocket = webSocket;
    // Track that a connection was made (for distinguishing first connect vs reconnect)
    if (webSocket !== null) {
      session.connection.hadConnection = true;
    }
  }
}

/**
 * Update the connection status for a session.
 */
export function updateSessionStatus(key: string, status: ConnectionStatus, error?: string): void {
  const session = sessionCache.get(key);
  if (session) {
    session.connection.status = status;
    session.connection.error = error ?? null;
    notifySubscribers();
  }
}

/**
 * Update the terminal data disposable.
 */
export function updateSessionDataDisposable(key: string, disposable: IDisposable | null): void {
  const session = sessionCache.get(key);
  if (session) {
    session.terminal.dataDisposable = disposable;
  }
}

// =============================================================================
// Session Lifecycle
// =============================================================================

/**
 * Dispose a session and remove it from the cache.
 * Cleans up terminal, WebSocket, and all resources.
 */
export function disposeSession(key: string): void {
  const session = sessionCache.get(key);
  if (!session) return;

  // Close WebSocket if open
  if (session.connection.webSocket) {
    try {
      session.connection.webSocket.close();
    } catch {
      // WebSocket may already be closed
    }
    session.connection.webSocket = null;
  }

  // Dispose terminal addons
  try {
    session.terminal.webglAddon?.dispose();
  } catch {
    // Addon may already be disposed
  }

  try {
    session.terminal.searchAddon.dispose();
  } catch {
    // Addon may already be disposed
  }

  try {
    session.terminal.fitAddon.dispose();
  } catch {
    // Addon may already be disposed
  }

  // Dispose terminal
  try {
    session.terminal.instance.dispose();
  } catch {
    // Terminal may already be disposed
  }

  // Remove from cache
  sessionCache.delete(key);
  notifySubscribers();
}

// =============================================================================
// Connection Helpers
// =============================================================================

/**
 * Check if a session has an active WebSocket connection.
 */
export function hasActiveConnection(key: string): boolean {
  const session = sessionCache.get(key);
  if (!session) return false;

  const ws = session.connection.webSocket;
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

/**
 * Check if a session has ever had a WebSocket connection.
 * Used to distinguish first connection from reconnection.
 */
export function hadPreviousConnection(key: string): boolean {
  const session = sessionCache.get(key);
  if (!session) return false;
  return session.connection.hadConnection;
}

/**
 * Get the cached connection status for a session.
 * Returns undefined if no session exists.
 * Used to restore UI state on component remount.
 */
export function getSessionStatus(key: string): ConnectionStatus | undefined {
  const session = sessionCache.get(key);
  return session?.connection.status;
}

/**
 * Get the cached error message for a session.
 * Returns undefined if no session or no error.
 */
export function getSessionError(key: string): string | null | undefined {
  const session = sessionCache.get(key);
  return session?.connection.error;
}

/**
 * Send data through the session's WebSocket.
 * Uses shared TextEncoder for efficient string encoding.
 */
export function sendData(key: string, data: string | Uint8Array): boolean {
  const session = sessionCache.get(key);
  if (!session) return false;

  const ws = session.connection.webSocket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;

  if (typeof data === "string") {
    ws.send(sharedEncoder.encode(data));
  } else {
    ws.send(data);
  }
  return true;
}

/**
 * Send resize command through the session's WebSocket.
 */
export function sendResize(key: string, rows: number, cols: number): boolean {
  const session = sessionCache.get(key);
  if (!session) return false;

  const ws = session.connection.webSocket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;

  const msg = JSON.stringify({ Rows: rows, Cols: cols });
  ws.send(msg);
  return true;
}
