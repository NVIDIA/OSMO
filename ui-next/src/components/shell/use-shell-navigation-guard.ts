// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * useShellNavigationGuard Hook
 *
 * Warns users before leaving the page when shell sessions are active.
 * Uses the beforeunload event to show a browser confirmation dialog.
 *
 * Usage:
 * ```tsx
 * // In a parent component that manages shell sessions
 * useShellNavigationGuard();
 * ```
 */

"use client";

import { useEffect } from "react";
import { useShellSessions } from "./use-shell-sessions";

/**
 * Hook that warns users before navigating away when shell sessions are active.
 *
 * Shows a browser confirmation dialog when:
 * - User tries to close the tab
 * - User tries to refresh the page
 * - User navigates away using browser controls
 *
 * Note: Modern browsers don't allow custom messages in beforeunload dialogs
 * for security reasons. The browser shows its own generic message.
 */
export function useShellNavigationGuard() {
  const { hasActiveSessions, activeSessionCount } = useShellSessions();

  useEffect(() => {
    if (!hasActiveSessions) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Standard way to trigger the browser's confirmation dialog
      e.preventDefault();
      // Legacy browsers require returnValue to be set
      e.returnValue = `You have ${activeSessionCount} active shell session(s). Are you sure you want to leave?`;
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasActiveSessions, activeSessionCount]);
}
