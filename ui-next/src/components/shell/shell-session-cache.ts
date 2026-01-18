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
 * Central state management for shell sessions. All shell state is managed here,
 * and React components subscribe via useSyncExternalStore.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LIFECYCLE PHASES
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Phase 1: INTENT (user clicks Connect)
 *   → openShellIntent() adds entry to shellIntents Map
 *   → UI snapshot includes intent with status "mounting"
 *   → ShellContainer sees intent → renders TaskShell component
 *
 * Phase 2: SESSION (TaskShell mounts, terminal created)
 *   → createSession() moves metadata from intent to session
 *   → Terminal and WebSocket are now live
 *   → Intent is kept for reference (metadata source)
 *
 * Phase 3: NAVIGATION (user views different task)
 *   → updateSessionContainer(null) detaches terminal from DOM
 *   → Session persists in cache with terminal buffer intact
 *   → User returns → reattachTerminal() reattaches to new container
 *
 * Phase 4: DISPOSED (user removes session)
 *   → disposeShell() cleans up session + removes intent
 *   → Terminal, WebSocket, and all resources released
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DATA FLOW
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   ShellContext (thin wrapper)
 *         │
 *         ▼
 *   openShellIntent() ──────► shellIntents Map
 *         │                         │
 *         │                         ▼
 *         │               getShellsSnapshot()  ◄──── useShellSessions()
 *         │                         │
 *         ▼                         ▼
 *   ShellContainer ◄─────── sessions + intents merged
 *         │
 *         ▼
 *   TaskShell mounts
 *         │
 *         ▼
 *   createSession() ──────► sessionCache Map
 *
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

  // ─────────────────────────────────────────────────────────────────────────
  // Reconnect Handler
  // ─────────────────────────────────────────────────────────────────────────

  /** Function to trigger reconnection (registered by useWebSocketShell) */
  reconnect?: () => void;
}

// =============================================================================
// Cache Store (Module Scope)
// =============================================================================

/**
 * Shell intent - metadata for a shell the user wants to render.
 * Created when user clicks "Connect", before TaskShell component mounts.
 */
export interface ShellIntent {
  /** Task UUID - unique identifier */
  taskId: string;
  /** Task name for display */
  taskName: string;
  /** Workflow name for the exec API */
  workflowName: string;
  /** Shell executable (e.g., /bin/bash) */
  shell: string;
  /** Timestamp when intent was created */
  createdAt: number;
}

/** Map of taskId -> ShellIntent (what the UI wants to render) */
const shellIntents = new Map<string, ShellIntent>();

/** Map of sessionKey -> ShellSession (actual terminal instances) */
const sessionCache = new Map<string, ShellSession>();

/** Subscribers for cache changes (for React useSyncExternalStore) */
const subscribers = new Set<() => void>();

/** Cached snapshot for useSyncExternalStore */
let cachedSnapshot: ShellSessionSnapshot[] = [];

/**
 * Session snapshot for UI components (excludes non-serializable fields).
 * Merges both intents and sessions into a unified view.
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
  /** Whether this has a live terminal instance */
  hasTerminal: boolean;
}

/**
 * Rebuild and notify - called when intents or sessions change.
 */
function notifySubscribers(): void {
  // Build unified snapshot: sessions + intents (that don't have sessions yet)
  const snapshots: ShellSessionSnapshot[] = [];

  // Add all intents (as the source of what should be rendered)
  for (const [taskId, intent] of shellIntents) {
    const session = sessionCache.get(taskId);

    if (session) {
      // Intent has a session - use session's status
      snapshots.push({
        key: taskId,
        taskId,
        taskName: intent.taskName,
        workflowName: intent.workflowName,
        shell: intent.shell,
        status: session.connection.status,
        error: session.connection.error,
        createdAt: intent.createdAt,
        hasTerminal: true,
      });
    } else {
      // Intent doesn't have a session yet - it's mounting
      snapshots.push({
        key: taskId,
        taskId,
        taskName: intent.taskName,
        workflowName: intent.workflowName,
        shell: intent.shell,
        status: "mounting",
        error: null,
        createdAt: intent.createdAt,
        hasTerminal: false,
      });
    }
  }

  cachedSnapshot = snapshots;

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
 * Get current snapshot of all shells (for useSyncExternalStore).
 * Returns intents merged with session state.
 */
export function getSessionsSnapshot(): ShellSessionSnapshot[] {
  return cachedSnapshot;
}

// =============================================================================
// Shell Intents (Phase 1: User wants to render a shell)
// =============================================================================

/**
 * Open a shell intent. Called when user clicks "Connect".
 * This triggers ShellContainer to render TaskShell.
 */
export function openShellIntent(taskId: string, taskName: string, workflowName: string, shell: string): void {
  if (shellIntents.has(taskId)) {
    // Already have an intent for this task
    return;
  }

  shellIntents.set(taskId, {
    taskId,
    taskName,
    workflowName,
    shell,
    createdAt: Date.now(),
  });

  notifySubscribers();
}

/**
 * Check if an intent exists for a task.
 */
export function hasShellIntent(taskId: string): boolean {
  return shellIntents.has(taskId);
}

/**
 * Get the intent for a task.
 */
export function getShellIntent(taskId: string): ShellIntent | undefined {
  return shellIntents.get(taskId);
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
 * Custom WebSocket close code for user-initiated disconnect.
 * Used to distinguish from session ended (code 1000) in onclose handler.
 */
export const WS_CLOSE_USER_DISCONNECT = 4000;

/**
 * Disconnect a session's WebSocket but keep it in the cache.
 * The terminal and session remain available for reconnection.
 * Use this when the user wants to stop the connection but keep the session visible.
 *
 * Uses custom close code 4000 so the onclose handler knows not to remove the session.
 */
export function disconnectSession(key: string): void {
  const session = sessionCache.get(key);
  if (!session) return;

  // Close WebSocket if open - use custom code to indicate user disconnect
  if (session.connection.webSocket) {
    try {
      session.connection.webSocket.close(WS_CLOSE_USER_DISCONNECT, "user-disconnect");
    } catch {
      // WebSocket may already be closed
    }
    session.connection.webSocket = null;
  }

  // Update status to disconnected
  session.connection.status = "disconnected";
  session.connection.error = null;

  notifySubscribers();
}

/**
 * Dispose a session's resources (terminal, WebSocket, addons).
 * Internal helper - does not remove intent or notify.
 */
function disposeSessionResources(session: ShellSession): void {
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
}

/**
 * Dispose a session and remove it from the cache.
 * Also removes the corresponding intent.
 * This is the main cleanup function for removing a shell completely.
 */
export function disposeSession(key: string): void {
  const session = sessionCache.get(key);
  if (session) {
    disposeSessionResources(session);
    sessionCache.delete(key);
  }

  // Also remove the intent
  shellIntents.delete(key);

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

// =============================================================================
// Reconnect Handler
// =============================================================================

/**
 * Register a reconnect handler for a session.
 * Called by useWebSocketShell when it mounts.
 */
export function registerReconnectHandler(key: string, handler: () => void): void {
  const session = sessionCache.get(key);
  if (session) {
    session.reconnect = handler;
  }
}

/**
 * Unregister the reconnect handler for a session.
 * Called by useWebSocketShell when it unmounts.
 */
export function unregisterReconnectHandler(key: string): void {
  const session = sessionCache.get(key);
  if (session) {
    session.reconnect = undefined;
  }
}

/**
 * Trigger reconnection for a session.
 * Calls the registered reconnect handler directly.
 * Returns true if handler was called, false if no handler registered.
 */
export function reconnectSession(key: string): boolean {
  const session = sessionCache.get(key);
  if (session?.reconnect) {
    session.reconnect();
    return true;
  }
  return false;
}
