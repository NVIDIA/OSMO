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
import { useExecIntoTask } from "@/lib/api/adapter";
import { updateALBCookies } from "@/lib/auth/cookies";
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
  registerReconnectHandler,
  unregisterReconnectHandler,
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
  /** Called when connection is closed (for any reason) */
  onDisconnected?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
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

  // Create a ref for the AbortController to allow cancellation of the API request
  const controllerRef = useRef<AbortController | null>(null);

  // Track if initial resize was sent (workaround for backend protocol bug)
  // Backend blindly copies resize JSON to PTY stdin, corrupting user input.
  // Only send resize ONCE at connection start to avoid corruption mid-session.
  // TODO: Remove when backend implements framed protocol (BACKEND_TODOS.md #22)
  const initialResizeSentRef = useRef(false);

  // API mutation for creating exec session
  // CRITICAL: Use adapter hook to prevent caching (single-use session tokens)
  const execMutation = useExecIntoTask();

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

  // Use refs for external callbacks to bridge to the WebSocket system.
  // This ensures the WebSocket handlers always have the latest callbacks
  // without triggering re-effects or violating useEffectEvent rules.
  const onDataRef = useRef(onData);
  const onStatusChangeRef = useRef(onStatusChange);
  const onConnectedRef = useRef(onConnected);
  const onDisconnectedRef = useRef(onDisconnected);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onDataRef.current = onData;
    onStatusChangeRef.current = onStatusChange;
    onConnectedRef.current = onConnected;
    onDisconnectedRef.current = onDisconnected;
    onErrorRef.current = onError;
  });

  const attachCallbacks = useCallback(
    (ws: WebSocket) => {
      ws.onmessage = (event) => {
        let data: Uint8Array;

        if (event.data instanceof ArrayBuffer) {
          data = new Uint8Array(event.data);
        } else if (typeof event.data === "string") {
          data = sharedEncoder.encode(event.data);
        } else {
          return; // Unknown data type
        }

        // Pass all data to terminal without filtering
        // Legacy UI (ExecTerminal.tsx) doesn't filter resize messages and works reliably
        // The backend router should not echo resize messages, but if it does, the terminal
        // will handle them gracefully (they just won't display as they're control sequences)
        onDataRef.current?.(data);
      };

      ws.onclose = () => {
        // Clear WebSocket from cache/local
        if (sessionKey) {
          updateSessionWebSocket(sessionKey, null);
        } else {
          localWsRef.current = null;
        }

        // Always just update status to disconnected - session stays in list
        // User must explicitly click "Remove" to remove from list
        updateStatus("disconnected");
        onDisconnectedRef.current?.();
      };

      ws.onerror = () => {
        const err = new Error("WebSocket connection failed");
        updateStatus("error", err.message);
        onErrorRef.current?.(err);
      };
    },
    [sessionKey, updateStatus],
  );

  const connect = useCallback(async () => {
    // Check if we already have an active connection in the cache
    if (sessionKey && hasActiveConnection(sessionKey)) {
      const session = getSession(sessionKey);
      if (session?.connection.webSocket) {
        const ws = session.connection.webSocket;

        // Verify WebSocket is truly functional before reusing
        // Fix #3: Prevent race condition where ws.readyState is OPEN but backend has closed PTY
        if (ws.readyState !== WebSocket.OPEN) {
          console.debug("[Shell] Cached WebSocket not OPEN (state: %d), creating new connection", ws.readyState);
          // Close stale connection and fall through to create new one
          ws.close();
          updateSessionWebSocket(sessionKey, null);
        } else {
          // WebSocket is OPEN - safe to reuse
          console.debug("[Shell] Reusing cached WebSocket connection");
          attachCallbacks(ws);
          usingCachedConnectionRef.current = true;
          updateStatus("connected");
          onConnectedRef.current?.();
          return;
        }
      }
    }

    // Clean up any existing local connection
    if (localWsRef.current) {
      localWsRef.current.close();
      localWsRef.current = null;
    }

    usingCachedConnectionRef.current = false;
    updateStatus("connecting");

    // Reset resize flag for new connection
    initialResizeSentRef.current = false;

    // Create a new AbortController for this connection attempt
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      // Create exec session via API
      // Note: We use @ts-expect-error because the generated hook's MutateOptions
      // doesn't explicitly include 'request' for our custom fetch, but the
      // underlying fetcher implementation does support 'signal' via this object.
      const response = await execMutation.mutateAsync(
        {
          name: workflowName,
          taskName: taskName,
          params: { entry_command: shell },
        },
        {
          // @ts-expect-error - 'request' is supported by the fetcher but not in generated types
          request: { signal: controller.signal },
        },
      );

      // If we were aborted during the async call, stop here
      if (controller.signal.aborted) return;

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

      // Fix #1 (CRITICAL): Set ALB sticky session cookies before WebSocket connection
      // This ensures the WebSocket routes to the same ALB backend node that created
      // the exec session. Without this, connection may timeout (60s) when routed to
      // a different node that doesn't have the session key.
      if (response.cookie) {
        updateALBCookies(response.cookie);
      }

      // Create WebSocket connection
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        // If we were aborted while the WebSocket was opening, close it
        if (controller.signal.aborted) {
          ws.close();
          return;
        }

        // Store in cache or local ref
        if (sessionKey) {
          updateSessionWebSocket(sessionKey, ws);
        } else {
          localWsRef.current = ws;
        }

        updateStatus("connected");
        onConnectedRef.current?.();
      };

      // Attach other callbacks
      attachCallbacks(ws);
    } catch (err) {
      // Don't update state if this was an intentional abort
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
        return;
      }

      const error = err instanceof Error ? err : new Error("Failed to create exec session");
      updateStatus("error", error.message);
      onErrorRef.current?.(error);
    }
  }, [sessionKey, workflowName, taskName, shell, execMutation, updateStatus, attachCallbacks]);

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
      // Fix #2 (CRITICAL WORKAROUND): Only send resize once at connection start
      //
      // Backend bug: resize JSON is blindly copied to PTY stdin, corrupting user commands.
      // Example: User types "ls" → backend has {"Rows":40,"Cols":120} in buffer
      // → bash tries to execute '{"Rows":40,"Cols":120}ls' → command not found
      //
      // This workaround prevents resize during session, sacrificing window resize
      // support to avoid command corruption. Terminal won't resize if user changes
      // window size, but at least commands work correctly.
      //
      // TODO: Remove when backend implements framed protocol (BACKEND_TODOS.md #22)
      if (initialResizeSentRef.current) {
        console.debug(
          "[Shell] Skipping resize to avoid backend protocol corruption (sent: %d)",
          initialResizeSentRef.current,
        );
        return;
      }

      initialResizeSentRef.current = true;

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
      ws.send(sharedEncoder.encode(msg));
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

  // Register reconnect handler so external code can trigger reconnection
  useEffect(() => {
    if (sessionKey) {
      registerReconnectHandler(sessionKey, connect);
      return () => unregisterReconnectHandler(sessionKey);
    }
  }, [sessionKey, connect]);

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
