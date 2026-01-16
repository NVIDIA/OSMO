// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * useWebSocketTerminal Hook
 *
 * Manages the WebSocket connection to the backend PTY:
 * - Creates exec session via API
 * - Establishes WebSocket connection
 * - Handles send/receive of terminal data
 * - Manages connection lifecycle and reconnection
 *
 * Usage:
 * ```tsx
 * const { status, connect, disconnect, send, resize } = useWebSocketTerminal({
 *   workflowName: "my-workflow",
 *   taskName: "train-model",
 *   onData: (data) => terminal.write(data),
 * });
 * ```
 */

"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useExecIntoTaskApiWorkflowNameExecTaskTaskNamePost } from "@/lib/api/generated";
import type { ConnectionStatus, UseWebSocketTerminalReturn } from "./types";
import { TERMINAL_CONFIG } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface UseWebSocketTerminalOptions {
  /** Workflow name for the exec API */
  workflowName: string;
  /** Task name to exec into */
  taskName: string;
  /** Shell to use */
  shell?: string;
  /** Called when data is received from the terminal */
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

export function useWebSocketTerminal(options: UseWebSocketTerminalOptions): UseWebSocketTerminalReturn {
  const {
    workflowName,
    taskName,
    shell = TERMINAL_CONFIG.DEFAULT_SHELL,
    onData,
    onStatusChange,
    onConnected,
    onDisconnected,
    onError,
    onSessionEnded,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const encoderRef = useRef(new TextEncoder());

  // Track if first message (size) has been sent
  const sizeSentRef = useRef(false);

  // API mutation for creating exec session
  const execMutation = useExecIntoTaskApiWorkflowNameExecTaskTaskNamePost();

  // Update status helper
  const updateStatus = useCallback(
    (newStatus: ConnectionStatus, errorMsg?: string) => {
      setStatus(newStatus);
      setError(errorMsg ?? null);
      onStatusChange?.(newStatus);
    },
    [onStatusChange],
  );

  // Connect to terminal
  const connect = useCallback(async () => {
    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    sizeSentRef.current = false;
    updateStatus("connecting");

    try {
      // Create exec session via API
      const response = await execMutation.mutateAsync({
        name: workflowName,
        taskName: taskName,
        params: { entry_command: shell },
      });

      // Build WebSocket URL
      // Response contains: router_address, key, cookie
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const routerAddress = response.router_address.replace(/^https?:/, wsProtocol);
      const wsUrl = `${routerAddress}/api/router/exec/${workflowName}/client/${response.key}`;

      // Create WebSocket connection
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        wsRef.current = ws;
        updateStatus("connected");
        onConnected?.();
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const data = new Uint8Array(event.data);
          onData?.(data);
        } else if (typeof event.data === "string") {
          // Handle string data (shouldn't happen with binaryType = arraybuffer)
          const data = encoderRef.current.encode(event.data);
          onData?.(data);
        }
      };

      ws.onclose = (event) => {
        wsRef.current = null;

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
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to create exec session");
      updateStatus("error", error.message);
      onError?.(error);
    }
  }, [
    workflowName,
    taskName,
    shell,
    execMutation,
    updateStatus,
    onData,
    onConnected,
    onDisconnected,
    onError,
    onSessionEnded,
  ]);

  // Disconnect from terminal
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    updateStatus("disconnected");
  }, [updateStatus]);

  // Send data to terminal
  const send = useCallback((data: string | Uint8Array) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    if (typeof data === "string") {
      wsRef.current.send(encoderRef.current.encode(data));
    } else {
      wsRef.current.send(data);
    }
  }, []);

  // Send resize event
  const resize = useCallback((rows: number, cols: number) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    // Send as JSON message
    const msg = JSON.stringify({ Rows: rows, Cols: cols });
    wsRef.current.send(msg);
    sizeSentRef.current = true;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return {
    status,
    error,
    connect,
    disconnect,
    send,
    resize,
  };
}
