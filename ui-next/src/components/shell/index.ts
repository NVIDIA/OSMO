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

// Sub-components
export { ConnectionStatus } from "./ConnectionStatus";
export { ShellToolbar } from "./ShellToolbar";
export { ShellSearch } from "./ShellSearch";
export { ShellActivityStrip } from "./ShellActivityStrip";
export { ShellSessionIcon } from "./ShellSessionIcon";

// Hooks
export { useShell, useShellSearch } from "./use-shell";
export { useWebSocketShell } from "./use-websocket-shell";
export { useShellNavigationGuard, useNavigateWithShellWarning } from "./use-shell-navigation-guard";

// Types
export type {
  ConnectionStatus as ConnectionStatusType,
  ShellSession,
  PersistedSession,
  ShellTerminalProps,
  ConnectionStatusProps,
  UseShellReturn,
  UseWebSocketShellReturn,
} from "./types";

// Constants
export { SHELL_THEME, SHELL_CONFIG, SHELL_OPTIONS } from "./types";
