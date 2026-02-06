//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

"use client";

import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react";
import { useShellSessions, hasSession, disconnectSession, reconnectSession } from "@/components/shell/lib/shell-cache";
import { _createSession, _deleteSession } from "@/components/shell/lib/shell-cache";
import { ShellNavigationGuard } from "./ShellNavigationGuard";

interface ShellContextValue {
  /** Create a shell session (called by TaskDetails on Connect click) */
  connectShell: (taskId: string, taskName: string, workflowName: string, shell: string) => void;

  /** Reconnect a disconnected shell session */
  reconnectShell: (taskId: string) => Promise<void>;

  /** Disconnect only - closes WebSocket but keeps session in list for reconnect */
  disconnectOnly: (taskId: string) => void;

  /** Remove a shell from rendering and dispose its session */
  removeShell: (taskId: string) => void;

  /** Check if a shell session exists for a given task */
  hasActiveShell: (taskId: string) => boolean;

  /** Disconnect all shells for the current workflow (called on page leave) */
  disconnectAll: () => void;
}

interface ShellProviderProps {
  workflowName: string;
  children: ReactNode;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ workflowName, children }: ShellProviderProps) {
  const sessions = useShellSessions();

  const connectShell = useCallback((taskId: string, taskName: string, wfName: string, shell: string) => {
    // Don't create duplicate sessions
    if (hasSession(taskId)) return;

    // Create session in cache - useShell hook will handle actual connection
    // Container will be set by the ref callback when the component mounts
    _createSession({
      key: taskId,
      workflowName: wfName,
      taskName,
      shell,
      state: { phase: "idle" },
      addons: null,
      container: null,
      isConnecting: false,
      backendTimeout: null,
      initialResizeSent: false,
      onDataDisposable: null,
      reconnectCallback: null,
      terminalReady: false,
      onRenderDisposable: null,
    });
  }, []);

  const reconnectShell = useCallback(async (taskId: string) => {
    // Use the proper reconnect function that triggers the connect callback
    await reconnectSession(taskId);
  }, []);

  const disconnectOnly = useCallback((taskId: string) => {
    // Use the proper disconnect function that goes through the state machine
    disconnectSession(taskId);
  }, []);

  const removeShell = useCallback((taskId: string) => {
    _deleteSession(taskId);
  }, []);

  const hasActiveShell = useCallback((taskId: string) => {
    return hasSession(taskId);
  }, []);

  const disconnectAll = useCallback(() => {
    const workflowSessions = sessions.filter((s) => s.workflowName === workflowName);
    for (const session of workflowSessions) {
      // Use proper disconnect that goes through state machine
      disconnectSession(session.key);

      // Then dispose resources and delete session
      if (session.state.phase === "ready" || session.state.phase === "disconnected") {
        if ("terminal" in session.state && session.state.terminal) {
          session.state.terminal.dispose();
        }
      }
      if (session.addons) {
        session.addons.fitAddon.dispose();
        session.addons.searchAddon.dispose();
        if (session.addons.webglAddon) {
          session.addons.webglAddon.dispose();
        }
      }
      if (session.backendTimeout) {
        clearTimeout(session.backendTimeout);
      }
      if (session.onDataDisposable) {
        session.onDataDisposable.dispose();
      }
      if (session.onRenderDisposable) {
        session.onRenderDisposable.dispose();
      }
      _deleteSession(session.key);
    }
  }, [sessions, workflowName]);

  const value = useMemo<ShellContextValue>(
    () => ({
      connectShell,
      reconnectShell,
      disconnectOnly,
      removeShell,
      hasActiveShell,
      disconnectAll,
    }),
    [connectShell, reconnectShell, disconnectOnly, removeShell, hasActiveShell, disconnectAll],
  );

  return (
    <ShellContext.Provider value={value}>
      <ShellNavigationGuard
        workflowName={workflowName}
        onCleanup={disconnectAll}
      >
        {children}
      </ShellNavigationGuard>
    </ShellContext.Provider>
  );
}

export function useShellContext(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error("useShellContext must be used within a ShellProvider");
  }
  return context;
}
