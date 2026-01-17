// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Shell Components - Route-Level Session Management
 *
 * This module provides persistent shell sessions across task/group navigation
 * within the workflow detail page. The architecture uses three layers:
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                            ARCHITECTURE                                     │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │                                                                             │
 * │  ┌─────────────────┐      ┌──────────────────┐      ┌──────────────────┐   │
 * │  │  ShellContext   │      │ ShellPortalCtx   │      │  Session Cache   │   │
 * │  │  (what to       │      │ (where to        │      │  (xterm + WS     │   │
 * │  │   render)       │      │  portal into)    │      │   instances)     │   │
 * │  └────────┬────────┘      └────────┬─────────┘      └────────┬─────────┘   │
 * │           │                        │                         │             │
 * │           ▼                        ▼                         ▼             │
 * │  ┌────────────────────────────────────────────────────────────────────┐   │
 * │  │                        ShellContainer                              │   │
 * │  │  - Renders TaskShell for each activeShell                          │   │
 * │  │  - Portals visible shell into TaskDetails' shell tab               │   │
 * │  │  - Keeps hidden shells mounted (preserves xterm instances)         │   │
 * │  └────────────────────────────────────────────────────────────────────┘   │
 * │                                                                             │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * DATA FLOW:
 * 1. User clicks "Connect" in TaskDetails → ShellContext.connectShell()
 * 2. ShellContainer sees new activeShell → renders TaskShell
 * 3. TaskShell mounts → useShell creates terminal, useWebSocketShell connects
 * 4. Session Cache stores xterm + WebSocket for persistence
 * 5. User navigates away → shell stays mounted (hidden), connection preserved
 * 6. User returns → shell portals back, same terminal instance
 *
 * KEY COMPONENTS:
 * - ShellProvider: Wraps workflow page, provides activeShells state
 * - ShellPortalProvider: Provides portal target for visible shell
 * - ShellContainer: Renders all shells, manages portal
 * - TaskShell: UI wrapper with connect prompt, reconnect bar
 * - ShellTerminal: xterm.js terminal component
 *
 * SESSION CACHE (@/components/shell/shell-session-cache.ts):
 * - Module-scope Map storing xterm Terminal + WebSocket per session
 * - Survives React unmount/remount during navigation
 * - Cleaned up on page leave or explicit disconnect
 */

export { ShellContainer, type ShellContainerProps } from "./ShellContainer";
export { ShellPortalProvider, useShellPortal } from "./ShellPortalContext";
export { ShellProvider, useShellContext, type ActiveShell } from "./ShellContext";
