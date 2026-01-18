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
 * Provides persistent shell sessions across task/group navigation
 * within the workflow detail page.
 *
 * ARCHITECTURE:
 * All shell state is managed in @/components/shell/shell-session-cache.ts.
 * This module provides React integration:
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  Session Cache (source of truth)                                           │
 * │  ├── shellIntents Map: what UI wants to render                             │
 * │  └── sessionCache Map: xterm + WebSocket instances                         │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │  ShellContext (thin wrapper)                                               │
 * │  └── Provides actions: connectShell, removeShell, disconnectOnly           │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │  ShellContainer (renderer)                                                 │
 * │  ├── Uses useShellSessions() to get shells to render                       │
 * │  ├── Portals visible shell into TaskDetails' shell tab                     │
 * │  └── Keeps hidden shells mounted (preserves xterm instances)               │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │  ShellPortalContext                                                        │
 * │  └── Provides portal target for visible shell                              │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * DATA FLOW:
 * 1. User clicks "Connect" → connectShell() → openShellIntent() in cache
 * 2. Cache notifies subscribers → ShellContainer re-renders
 * 3. ShellContainer renders TaskShell for new intent
 * 4. TaskShell mounts → useShell creates session in cache
 * 5. User navigates away → shell stays mounted (hidden), connection preserved
 * 6. User returns → shell portals back, same terminal instance
 *
 * @see @/components/shell/shell-session-cache.ts for lifecycle documentation
 */

export { ShellContainer, type ShellContainerProps } from "./ShellContainer";
export { ShellPortalProvider, useShellPortal } from "./ShellPortalContext";
export { ShellProvider, useShellContext } from "./ShellContext";
