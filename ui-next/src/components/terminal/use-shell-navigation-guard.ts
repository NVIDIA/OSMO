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
import { useShellStore } from "@/app/(dashboard)/workflows/[name]/stores";

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
  const hasActiveSessions = useShellStore((s) => s.hasActiveSessions);
  const activeSessionCount = useShellStore((s) => s.activeSessionCount);

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

/**
 * Hook to get a navigation function that warns about active shells.
 *
 * Use this instead of direct navigation when you need to warn users
 * about active sessions before navigating within the app.
 *
 * Usage:
 * ```tsx
 * const { navigateWithWarning } = useNavigateWithShellWarning();
 *
 * // Instead of router.push('/other-page')
 * navigateWithWarning('/other-page');
 * ```
 */
export function useNavigateWithShellWarning() {
  const hasActiveSessions = useShellStore((s) => s.hasActiveSessions);
  const activeSessionCount = useShellStore((s) => s.activeSessionCount);
  const closeAllSessions = useShellStore((s) => s.closeAllSessions);

  const navigateWithWarning = (href: string, navigate: () => void) => {
    if (hasActiveSessions) {
      const confirmed = window.confirm(
        `You have ${activeSessionCount} active shell session(s). ` + `Navigating away will disconnect them. Continue?`,
      );
      if (!confirmed) return false;
      closeAllSessions();
    }
    navigate();
    return true;
  };

  return { navigateWithWarning, hasActiveSessions, activeSessionCount };
}
