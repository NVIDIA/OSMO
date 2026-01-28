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
 * Shell Module Public API
 *
 * This module provides terminal/shell functionality for executing commands
 * in workflow tasks via PTY sessions over WebSockets.
 *
 * **Primary Entry Point:**
 * - `useShell()` - Main hook for managing shell sessions
 * - `<ShellTerminal />` - React component for rendering terminal UI
 *
 * **Observing Sessions (Read-Only):**
 * - `useShellSession(key)` - React hook to observe a specific session
 * - `useShellSessions()` - React hook to observe all sessions
 * - `getAllSessions()` - Get all sessions (non-React)
 * - `hasSession(key)` - Check if session exists
 *
 * **Session Mutations:**
 * All session mutations (create, update, delete) should go through `useShell()`
 * methods. Direct cache manipulation is an anti-pattern.
 *
 * ❌ DON'T:
 * ```ts
 * import { _createSession } from '@/components/shell';
 * _createSession(...); // Violates encapsulation!
 * ```
 *
 * ✅ DO:
 * ```ts
 * const shell = useShell({ sessionKey, workflowName, taskName, shell });
 * shell.connect(); // Proper API usage
 * ```
 */

// ============================================================================
// Components
// ============================================================================

export { ShellTerminal } from "./components/ShellTerminal";
export { ShellSessionIcon } from "./components/ShellSessionIcon";
export { StatusDot, STATUS_DOT_STYLES, STATUS_LABELS, type StatusDotProps } from "./components/StatusDot";

// ============================================================================
// Primary Hook
// ============================================================================

export { useShell, type UseShellOptions, type UseShellReturn } from "./hooks/use-shell";

// ============================================================================
// Session Observation (Read-Only)
// ============================================================================

export { useShellSession, useShellSessions, getAllSessions, hasSession, type CachedSession } from "./lib/shell-cache";

// ============================================================================
// State Machine
// ============================================================================

export {
  transition,
  canSendData,
  isConnecting,
  isReady,
  hasTerminal,
  hasWebSocket,
  getDisplayStatus,
  type ShellState,
  type ShellEvent,
  type TerminalAddons,
} from "./lib/shell-state";

// ============================================================================
// Types & Constants
// ============================================================================

export type { ShellTerminalProps, ShellTerminalRef, ConnectionStatus } from "./lib/types";
export { SHELL_OPTIONS, SHELL_CONFIG, SHELL_THEME, ANSI } from "./lib/types";
