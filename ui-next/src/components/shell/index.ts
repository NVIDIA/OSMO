// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Shell Components
 *
 * Interactive shell for exec into running task containers.
 * Zero-chrome design with contextual overlays.
 *
 * Public API:
 * - ShellTerminal: Main terminal component (wraps xterm.js + WebSocket)
 * - ShellSessionIcon: Individual session icon with status
 * - StatusDot: Connection status indicator
 * - useShellSessions: React hook for session state
 * - Session cache utilities for managing connections
 *
 * Usage:
 * ```tsx
 * import { ShellTerminal } from "@/components/shell";
 *
 * <ShellTerminal
 *   taskId={task.task_uuid}
 *   workflowName="my-workflow"
 *   taskName="train-model"
 * />
 * ```
 */

// =============================================================================
// Components
// =============================================================================

/**
 * Main terminal component - LAZY LOADED (~480KB code-split).
 * xterm.js only loads when the shell is actually rendered.
 */
export { ShellTerminal } from "./ShellTerminal";

/** Individual session icon with status indicator and context menu */
export { ShellSessionIcon } from "./ShellSessionIcon";

/** Connection status dot indicator */
export { StatusDot, STATUS_DOT_STYLES, STATUS_LABELS, type StatusDotProps } from "./StatusDot";

// =============================================================================
// Hooks
// =============================================================================

/** React hook for accessing shell session state */
export { useShellSessions, useShellSession } from "./use-shell-sessions";

// =============================================================================
// Session Cache API
// =============================================================================

export {
  // Intent management (Phase 1: what to render)
  openShellIntent,
  hasShellIntent,
  getShellIntent,
  // Connection management
  disconnectSession,
  disposeSession,
  reconnectSession,
  // Status queries
  hasSession,
  hasActiveConnection,
  hadPreviousConnection,
  getSessionStatus,
  getSessionError,
  // Status updates
  updateSessionStatus,
  // Reconnect handler registration
  registerReconnectHandler,
  unregisterReconnectHandler,
} from "./shell-session-cache";

export type { ShellIntent } from "./shell-session-cache";

// =============================================================================
// Types
// =============================================================================

export type { ConnectionStatus as ConnectionStatusType, ShellTerminalProps, ShellTerminalRef } from "./types";

export type { ShellSessionSnapshot } from "./shell-session-cache";

// =============================================================================
// Constants
// =============================================================================

export { SHELL_OPTIONS } from "./types";
