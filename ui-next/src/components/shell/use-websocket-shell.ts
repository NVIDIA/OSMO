// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * useWebSocketShell Hook
 *
 * Manages the WebSocket connection to the backend PTY:
 * - Creates exec session via API
 * - Establishes WebSocket connection
 * - Handles send/receive of shell data
 * - Manages connection lifecycle
 *
 * Connection Persistence:
 * When `sessionKey` is provided, the WebSocket connection is stored in the
 * session cache and persists across component unmount/remount. This prevents
 * creating a new PTY session when navigating within a workflow page.
 *
 * The WebSocket is only closed when:
 * - `disconnect()` is called explicitly
 * - The user ends the session (exit, Ctrl+D)
 * - The connection errors or times out
 *
 * Future: Half-Open Connection Support
 * - `releaseConnection()` will close WebSocket but keep PTY alive
 * - `reconnect(token)` will reattach to existing PTY
 *
 * Usage:
 * ```tsx
 * const { status, connect, disconnect, send, resize } = useWebSocketShell({
 *   sessionKey: taskName,
 *   workflowName: "my-workflow",
 *   taskName: "train-model",
 *   onData: (data) => shell.write(data),
 * });
 * ```
 */

"use client";

import { useRef, useState, useCallback, useEffect, startTransition } from "react";
import { useExecIntoTaskApiWorkflowNameExecTaskTaskNamePost } from "@/lib/api/generated";
import type { ConnectionStatus, UseWebSocketShellReturn } from "./types";
import { SHELL_CONFIG } from "./types";
import {
  getSession,
  hasActiveConnection,
  getSessionStatus,
  updateSessionWebSocket,
  updateSessionStatus,
  sendData,
  sendResize,
} from "./shell-session-cache";

// =============================================================================
// Shared Encoder (Module Scope)
// =============================================================================

/**
 * Shared TextEncoder instance for encoding string data.
 * TextEncoder is stateless, so a single instance can be safely reused.
 */
const sharedEncoder = new TextEncoder();

// =============================================================================
// Types
// =============================================================================

export interface UseWebSocketShellOptions {
  /**
   * Session key for connection persistence.
   * When provided, the WebSocket connection is stored in the session cache
   * and persists across component unmount/remount.
   */
  sessionKey?: string;
  /** Workflow name for the exec API */
  workflowName: string;
  /** Task name to exec into */
  taskName: string;
  /** Shell to use */
  shell?: string;
  /** Called when data is received from the shell */
  onData?: (data: Uint8Array) => void;
  /** Called when connection status changes */
  onStatusChange?: (status: ConnectionStatus) => void;
  /** Called when connection is established */
  onConnected?: () => void;
  /** Called when connection is closed */
  onDisconnected?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Called when the session ends cleanly (user typed exit) */
  onSessionEnded?: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useWebSocketShell(options: UseWebSocketShellOptions): UseWebSocketShellReturn {
  const {
    sessionKey,
    workflowName,
    taskName,
    shell = SHELL_CONFIG.DEFAULT_SHELL,
    onData,
    onStatusChange,
    onConnected,
    onDisconnected,
    onError,
    onSessionEnded,
  } = options;

  // Initialize state from session cache if available
  // Priority: active connection → cached status → idle
  const hasConnection = sessionKey ? hasActiveConnection(sessionKey) : false;
  const cachedStatus = sessionKey ? getSessionStatus(sessionKey) : undefined;
  const initialStatus: ConnectionStatus = hasConnection ? "connected" : (cachedStatus ?? "idle");
  const [status, setStatus] = useState<ConnectionStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);

  // Local WebSocket ref for non-persisted connections
  const localWsRef = useRef<WebSocket | null>(null);

  // Track if we're using cached connection
  const usingCachedConnectionRef = useRef(false);

  // API mutation for creating exec session
  const execMutation = useExecIntoTaskApiWorkflowNameExecTaskTaskNamePost();

  // Get the WebSocket (from cache or local)
  const getWebSocket = useCallback((): WebSocket | null => {
    if (sessionKey) {
      const session = getSession(sessionKey);
      return session?.connection.webSocket ?? null;
    }
    return localWsRef.current;
  }, [sessionKey]);

  // Update status helper
  const updateStatus = useCallback(
    (newStatus: ConnectionStatus, errorMsg?: string) => {
      setStatus(newStatus);
      setError(errorMsg ?? null);

      // Update session cache if using persistence
      if (sessionKey) {
        updateSessionStatus(sessionKey, newStatus, errorMsg);
      }

      onStatusChange?.(newStatus);
    },
    [sessionKey, onStatusChange],
  );

  // Attach callbacks to an existing WebSocket
  const attachCallbacks = useCallback(
    (ws: WebSocket) => {
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const data = new Uint8Array(event.data);
          onData?.(data);
        } else if (typeof event.data === "string") {
          const data = sharedEncoder.encode(event.data);
          onData?.(data);
        }
      };

      ws.onclose = (event) => {
        // Clear from cache/local
        if (sessionKey) {
          updateSessionWebSocket(sessionKey, null);
        } else {
          localWsRef.current = null;
        }

        // Check if this was a clean close (user typed exit)
        if (event.wasClean && event.code === 1000) {
          updateStatus("disconnected");
          onSessionEnded?.();
        } else {
          updateStatus("disconnected");
          onDisconnected?.();
        }
      };

      ws.onerror = () => {
        const err = new Error("WebSocket connection failed");
        updateStatus("error", err.message);
        onError?.(err);
      };
    },
    [sessionKey, onData, onDisconnected, onError, onSessionEnded, updateStatus],
  );

  // Connect to shell
  const connect = useCallback(async () => {
    // Check if we already have an active connection in the cache
    if (sessionKey && hasActiveConnection(sessionKey)) {
      const session = getSession(sessionKey);
      if (session?.connection.webSocket) {
        // Reattach callbacks to existing WebSocket
        attachCallbacks(session.connection.webSocket);
        usingCachedConnectionRef.current = true;
        updateStatus("connected");
        onConnected?.();
        return;
      }
    }

    // Clean up any existing local connection
    if (localWsRef.current) {
      localWsRef.current.close();
      localWsRef.current = null;
    }

    usingCachedConnectionRef.current = false;
    updateStatus("connecting");

    try {
      // Create exec session via API
      const response = await execMutation.mutateAsync({
        name: workflowName,
        taskName: taskName,
        params: { entry_command: shell },
      });

      // Build WebSocket URL
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const routerAddress = response.router_address.replace(/^https?:/, wsProtocol);
      const wsUrl = `${routerAddress}/api/router/exec/${workflowName}/client/${response.key}`;

      // Debug: log connection details
      console.debug("[Shell] Connecting to PTY:", {
        router_address: response.router_address,
        key: response.key,
        wsUrl,
        sessionKey,
      });

      // Create WebSocket connection
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        // Store in cache or local ref
        if (sessionKey) {
          updateSessionWebSocket(sessionKey, ws);
        } else {
          localWsRef.current = ws;
        }

        updateStatus("connected");
        onConnected?.();
      };

      // Attach other callbacks
      attachCallbacks(ws);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to create exec session");
      updateStatus("error", error.message);
      onError?.(error);
    }
  }, [sessionKey, workflowName, taskName, shell, execMutation, updateStatus, attachCallbacks, onConnected, onError]);

  // Disconnect from shell (explicitly close connection)
  const disconnect = useCallback(() => {
    const ws = getWebSocket();
    if (ws) {
      ws.close();
    }

    if (sessionKey) {
      updateSessionWebSocket(sessionKey, null);
    } else {
      localWsRef.current = null;
    }

    updateStatus("disconnected");
  }, [sessionKey, getWebSocket, updateStatus]);

  // Send data to shell
  const send = useCallback(
    (data: string | Uint8Array) => {
      // Use session cache helper if available
      if (sessionKey) {
        sendData(sessionKey, data);
        return;
      }

      // Otherwise use local ref
      const ws = localWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      if (typeof data === "string") {
        ws.send(sharedEncoder.encode(data));
      } else {
        ws.send(data);
      }
    },
    [sessionKey],
  );

  // Send resize event
  const resize = useCallback(
    (rows: number, cols: number) => {
      // Use session cache helper if available
      if (sessionKey) {
        sendResize(sessionKey, rows, cols);
        return;
      }

      // Otherwise use local ref
      const ws = localWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const msg = JSON.stringify({ Rows: rows, Cols: cols });
      ws.send(msg);
    },
    [sessionKey],
  );

  // On mount: Check for existing connection and sync state
  useEffect(() => {
    if (sessionKey && hasActiveConnection(sessionKey)) {
      const session = getSession(sessionKey);
      if (session?.connection.webSocket) {
        // Reattach callbacks to existing WebSocket
        attachCallbacks(session.connection.webSocket);
        usingCachedConnectionRef.current = true;
        // Use startTransition to avoid cascading renders
        startTransition(() => {
          setStatus("connected");
        });
      }
    }
  }, [sessionKey, attachCallbacks]);

  // Cleanup on unmount
  // IMPORTANT: We DON'T close the WebSocket if using session cache
  // This preserves the connection when navigating away
  useEffect(() => {
    return () => {
      // Only close if NOT using session cache
      if (!sessionKey && localWsRef.current) {
        localWsRef.current.close();
        localWsRef.current = null;
      }
      // If using session cache, WebSocket stays open
      // Callbacks will be reattached when component remounts
    };
  }, [sessionKey]);

  return {
    status,
    error,
    connect,
    disconnect,
    send,
    resize,
  };
}
