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

/**
 * Explicit state machine for shell lifecycle. Pure transition function for
 * predictable, debuggable state management.
 */

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { WebglAddon } from "@xterm/addon-webgl";

/** Discriminated union of all shell states */
export type ShellState =
  | { phase: "idle" }
  | {
      phase: "connecting";
      workflowName: string;
      taskName: string;
      shell: string;
      terminal?: Terminal; // Optional - present when reconnecting
      startedAt: number;
    }
  | {
      phase: "opening";
      workflowName: string;
      taskName: string;
      terminal: Terminal;
      wsUrl: string;
      startedAt: number;
    }
  | {
      phase: "initializing";
      workflowName: string;
      taskName: string;
      terminal: Terminal;
      ws: WebSocket;
      startedAt: number;
    }
  | {
      phase: "ready";
      workflowName: string;
      taskName: string;
      terminal: Terminal;
      ws: WebSocket;
      connectedAt: number;
    }
  | {
      phase: "disconnected";
      workflowName: string;
      taskName: string;
      terminal: Terminal;
      reason?: string;
    }
  | {
      phase: "error";
      error: string;
    };

export interface TerminalAddons {
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  webglAddon: WebglAddon | null;
}

export type ShellEvent =
  | {
      type: "CONNECT";
      workflowName: string;
      taskName: string;
      shell: string;
    }
  | {
      type: "API_SUCCESS";
      terminal: Terminal;
      wsUrl: string;
    }
  | {
      type: "API_ERROR";
      error: string;
    }
  | {
      type: "WS_OPENED";
      ws: WebSocket;
    }
  | {
      type: "WS_ERROR";
      error: string;
    }
  | {
      type: "WS_CLOSED";
      reason?: string;
    }
  | { type: "FIRST_DATA" }
  | { type: "TIMEOUT" }
  | { type: "DISCONNECT" };

/** Pure transition function. Returns new state given current state and event. */
export function transition(state: ShellState, event: ShellEvent): ShellState {
  const eventType = event.type;

  if (state.phase === "idle" && eventType === "CONNECT") {
    return {
      phase: "connecting",
      workflowName: event.workflowName,
      taskName: event.taskName,
      shell: event.shell,
      startedAt: Date.now(),
    };
  }

  if (state.phase === "disconnected" && eventType === "CONNECT") {
    return {
      phase: "connecting",
      workflowName: state.workflowName,
      taskName: state.taskName,
      shell: event.shell,
      terminal: state.terminal, // ✅ Preserve terminal for reuse
      startedAt: Date.now(),
    };
  }

  if (state.phase === "error" && eventType === "CONNECT") {
    return {
      phase: "connecting",
      workflowName: event.workflowName,
      taskName: event.taskName,
      shell: event.shell,
      startedAt: Date.now(),
    };
  }

  if (state.phase === "connecting" && eventType === "API_SUCCESS") {
    return {
      phase: "opening",
      workflowName: state.workflowName,
      taskName: state.taskName,
      terminal: state.terminal ?? event.terminal, // Prefer existing terminal (reconnect) or use new one
      wsUrl: event.wsUrl,
      startedAt: state.startedAt,
    };
  }

  if (state.phase === "connecting" && eventType === "API_ERROR") {
    return {
      phase: "error",
      error: event.error,
    };
  }

  if (state.phase === "opening" && eventType === "WS_OPENED") {
    return {
      phase: "initializing",
      workflowName: state.workflowName,
      taskName: state.taskName,
      terminal: state.terminal,
      ws: event.ws,
      startedAt: state.startedAt,
    };
  }

  if (state.phase === "opening" && eventType === "WS_ERROR") {
    return {
      phase: "error",
      error: event.error,
    };
  }

  if (state.phase === "initializing" && eventType === "FIRST_DATA") {
    return {
      phase: "ready",
      workflowName: state.workflowName,
      taskName: state.taskName,
      terminal: state.terminal,
      ws: state.ws,
      connectedAt: Date.now(),
    };
  }

  if (state.phase === "initializing" && eventType === "TIMEOUT") {
    return {
      phase: "disconnected",
      workflowName: state.workflowName,
      taskName: state.taskName,
      terminal: state.terminal,
      reason: "Backend failed to initialize (timeout after 5s)",
    };
  }

  if (state.phase === "ready" && eventType === "WS_CLOSED") {
    return {
      phase: "disconnected",
      workflowName: state.workflowName,
      taskName: state.taskName,
      terminal: state.terminal,
      reason: event.reason,
    };
  }

  if (state.phase === "ready" && eventType === "DISCONNECT") {
    return {
      phase: "disconnected",
      workflowName: state.workflowName,
      taskName: state.taskName,
      terminal: state.terminal,
      reason: "User disconnected",
    };
  }

  if ((state.phase === "initializing" || state.phase === "ready") && eventType === "WS_ERROR") {
    return {
      phase: "error",
      error: event.error,
    };
  }

  console.warn(`[Shell] Invalid transition: ${state.phase} + ${eventType}`);
  return state;
}

export function canSendData(state: ShellState): boolean {
  return state.phase === "ready";
}

export function isConnecting(state: ShellState): boolean {
  return state.phase === "connecting" || state.phase === "opening" || state.phase === "initializing";
}

export function isReady(state: ShellState): boolean {
  return state.phase === "ready";
}

export function hasTerminal(state: ShellState): state is Extract<ShellState, { terminal: Terminal }> {
  return "terminal" in state && state.terminal !== undefined;
}

export function hasWebSocket(state: ShellState): state is Extract<ShellState, { ws: WebSocket }> {
  return "ws" in state && state.ws !== undefined;
}

export function getDisplayStatus(state: ShellState): string {
  switch (state.phase) {
    case "idle":
      return "Not connected";
    case "connecting":
      return "Creating session...";
    case "opening":
      return "Opening connection...";
    case "initializing":
      return "Waiting for backend...";
    case "ready":
      return "Connected";
    case "disconnected":
      return state.reason || "Disconnected";
    case "error":
      return state.error;
  }
}
