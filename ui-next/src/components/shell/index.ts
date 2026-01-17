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
 * Usage:
 * ```tsx
 * import { ShellTerminal } from "@/components/shell";
 *
 * <ShellTerminal
 *   workflowName="my-workflow"
 *   taskName="train-model"
 * />
 * ```
 */

// Main Component
export { ShellTerminal } from "./ShellTerminal";

// Overlay Components
export { ShellConnecting } from "./ShellConnecting";
export { ShellSearch } from "./ShellSearch";

// Activity Components
export { ShellActivityStrip } from "./ShellActivityStrip";
export { ShellSessionIcon } from "./ShellSessionIcon";
export { StatusDot, STATUS_DOT_STYLES, STATUS_LABELS, type StatusDotProps } from "./StatusDot";

// Hooks
export { useShell } from "./use-shell";
export { useWebSocketShell } from "./use-websocket-shell";
export { useShellNavigationGuard } from "./use-shell-navigation-guard";
export { useShellSessions, useShellSession } from "./use-shell-sessions";

// Session Cache (for managing persistent shell sessions)
export {
  disposeSession,
  hasSession,
  hasActiveConnection,
  hadPreviousConnection,
  getSessionStatus,
  getSessionError,
  updateSessionStatus,
} from "./shell-session-cache";

// Types
export type {
  ConnectionStatus as ConnectionStatusType,
  ShellTerminalProps,
  ShellTerminalRef,
  UseShellReturn,
  UseWebSocketShellReturn,
} from "./types";

export type { ShellSessionSnapshot } from "./shell-session-cache";

// Constants
export { SHELL_THEME, SHELL_CONFIG, SHELL_OPTIONS } from "./types";
