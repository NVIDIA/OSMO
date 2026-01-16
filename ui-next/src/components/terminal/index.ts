// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Terminal Components
 *
 * Interactive terminal for exec into running task containers.
 *
 * Usage:
 * ```tsx
 * import { ShellTerminal } from "@/components/terminal";
 *
 * <ShellTerminal
 *   workflowName="my-workflow"
 *   taskName="train-model"
 * />
 * ```
 */

// Main Component
export { ShellTerminal } from "./ShellTerminal";

// Sub-components
export { ConnectionStatus } from "./ConnectionStatus";
export { ShellToolbar } from "./ShellToolbar";
export { TerminalSearch } from "./TerminalSearch";
export { ShellActivityStrip } from "./ShellActivityStrip";
export { ShellSessionIcon } from "./ShellSessionIcon";

// Hooks
export { useTerminal, useTerminalSearch } from "./use-terminal";
export { useWebSocketTerminal } from "./use-websocket-terminal";
export { useShellNavigationGuard, useNavigateWithShellWarning } from "./use-shell-navigation-guard";

// Types
export type {
  ConnectionStatus as ConnectionStatusType,
  ShellSession,
  PersistedSession,
  ShellTerminalProps,
  ConnectionStatusProps,
  UseTerminalReturn,
  UseWebSocketTerminalReturn,
} from "./types";

// Constants
export { TERMINAL_THEME, TERMINAL_CONFIG, SHELL_OPTIONS } from "./types";
