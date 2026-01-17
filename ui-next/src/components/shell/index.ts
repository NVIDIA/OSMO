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
export { ShellConnectCard } from "./ShellConnectCard";
export { ShellConnecting } from "./ShellConnecting";
export { ShellReconnectButton } from "./ShellReconnectButton";
export { ShellSearch } from "./ShellSearch";

// Activity Components
export { ShellActivityStrip } from "./ShellActivityStrip";
export { ShellSessionIcon } from "./ShellSessionIcon";
export { ConnectionStatus } from "./ConnectionStatus";

// Hooks
export { useShell, useShellSearch } from "./use-shell";
export { useWebSocketShell } from "./use-websocket-shell";
export { useShellNavigationGuard, useNavigateWithShellWarning } from "./use-shell-navigation-guard";

// Terminal Cache (for managing persistent terminal instances)
export { disposeTerminal, disposeAllTerminals, hasTerminal, getTerminalCount } from "./terminal-cache";

// Types
export type {
  ConnectionStatus as ConnectionStatusType,
  ShellSession,
  PersistedSession,
  ShellTerminalProps,
  ShellTerminalRef,
  ConnectionStatusProps,
  UseShellReturn,
  UseWebSocketShellReturn,
} from "./types";

// Constants
export { SHELL_THEME, SHELL_CONFIG, SHELL_OPTIONS } from "./types";
