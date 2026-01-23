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
 * ShellNavigationGuard
 *
 * Prevents accidental navigation away from a workflow with active shell sessions.
 * Shows a confirmation dialog when the user tries to:
 * - Close the browser tab
 * - Refresh the page
 * - Navigate to a different page (via links or browser back/forward)
 *
 * On confirmation, all shell sessions for the current workflow are cleaned up.
 */

"use client";

import { useEffect, useCallback, useRef, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/shadcn/button";
import { useShellSessions } from "@/components/shell";
import { stripBasePath } from "@/lib/config";

// =============================================================================
// Types
// =============================================================================

interface ShellNavigationGuardProps {
  /** Current workflow name - used to filter sessions */
  workflowName: string;
  /** Callback to clean up sessions before navigation */
  onCleanup: () => void;
  /** Children to render */
  children: ReactNode;
}

interface PendingNavigation {
  /** The URL to navigate to */
  url: string;
  /** Whether this is a programmatic navigation (vs link click) */
  isProgrammatic: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a pathname is within the current workflow.
 * Handles URL encoding and prevents prefix matching issues.
 *
 * Examples (for workflowName = "my-workflow"):
 * - /workflows/my-workflow → true (same workflow)
 * - /workflows/my-workflow?task=abc → true (query params don't matter)
 * - /workflows/my-workflow-extended → false (different workflow!)
 * - /workflows/other → false (different workflow)
 * - /pools → false (different page)
 */
function isWithinWorkflow(pathname: string, workflowName: string): boolean {
  // Decode to handle URL-encoded characters (e.g., %20 → space)
  const decodedPathname = decodeURIComponent(pathname);
  const workflowPath = `/workflows/${workflowName}`;

  // Must exactly match OR be a sub-path (with trailing slash)
  // This prevents "workflow-a" matching "workflow-abc"
  return decodedPathname === workflowPath || decodedPathname.startsWith(`${workflowPath}/`);
}

/**
 * Extract just the pathname from an href (handles relative and absolute URLs).
 */
function getPathnameFromHref(href: string): string {
  try {
    const url = new URL(href, window.location.origin);
    return url.pathname;
  } catch {
    // If URL parsing fails, return as-is (shouldn't happen for valid hrefs)
    return href.split("?")[0].split("#")[0];
  }
}

// =============================================================================
// Component
// =============================================================================

export function ShellNavigationGuard({ workflowName, onCleanup, children }: ShellNavigationGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { sessions: allSessions } = useShellSessions();

  // Filter to sessions for this workflow that are truly active (connecting or connected)
  // We don't guard for disconnected, error, idle, or mounting sessions
  const activeSessions = allSessions.filter(
    (s) => s.workflowName === workflowName && (s.status === "connecting" || s.status === "connected"),
  );
  const hasActiveSessions = activeSessions.length > 0;

  // Track pending navigation for the confirmation dialog
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Track if we're in the process of navigating (after confirmation)
  const isNavigatingRef = useRef(false);

  // Track the current pathname to detect when we've actually navigated
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // ─────────────────────────────────────────────────────────────────────────
  // beforeunload: Browser tab close / refresh
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasActiveSessions) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Show browser's native confirmation dialog
      e.preventDefault();
      // Chrome requires returnValue to be set
      e.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasActiveSessions]);

  // ─────────────────────────────────────────────────────────────────────────
  // Link click interception: In-app navigation
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasActiveSessions) return;

    const handleClick = (e: MouseEvent) => {
      // Skip if we're already navigating after confirmation
      if (isNavigatingRef.current) return;

      // Find the closest anchor element
      const target = (e.target as Element).closest("a");
      if (!target) return;

      const href = target.getAttribute("href");
      if (!href) return;

      // Skip external links (absolute URLs to other domains)
      if (href.startsWith("http://") || href.startsWith("https://")) return;

      // Skip hash-only links (same page anchors)
      if (href.startsWith("#")) return;

      // Skip links that open in new tab
      if (target.getAttribute("target") === "_blank") return;

      // Extract the pathname from the href (removes query params and hash)
      const targetPathname = getPathnameFromHref(href);

      // Skip if staying on the same page (just query param changes, e.g., nuqs)
      if (targetPathname === pathname) return;

      // Check if this navigation leaves the current workflow
      const isLeavingWorkflow = !isWithinWorkflow(targetPathname, workflowName);

      if (isLeavingWorkflow) {
        // Prevent default navigation
        e.preventDefault();
        e.stopPropagation();

        // Store the pending navigation and show dialog
        setPendingNavigation({ url: href, isProgrammatic: false });
        setIsDialogOpen(true);
      }
    };

    // Use capture phase to intercept before Next.js handles the click
    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, [hasActiveSessions, pathname, workflowName]);

  // ─────────────────────────────────────────────────────────────────────────
  // Browser back/forward button: popstate
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasActiveSessions) return;

    const handlePopState = () => {
      // Skip if we're already navigating after confirmation
      if (isNavigatingRef.current) return;

      // The browser has already changed the URL, we need to push back
      // and show the confirmation dialog
      const currentPathname = window.location.pathname;

      // Skip if this is just a query param change (nuqs back/forward within workflow)
      // The pathname will still match the current workflow
      if (isWithinWorkflow(currentPathname, workflowName)) {
        // Allow navigation - it's within the same workflow (e.g., nuqs history)
        return;
      }

      // Navigation is leaving the workflow - block it and show confirmation
      // Push the current path back to prevent navigation
      window.history.pushState(null, "", pathnameRef.current);

      // Store the pending navigation and show dialog
      setPendingNavigation({ url: currentPathname, isProgrammatic: true });
      setIsDialogOpen(true);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [hasActiveSessions, workflowName]);

  // ─────────────────────────────────────────────────────────────────────────
  // Dialog handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleConfirmNavigation = useCallback(() => {
    if (!pendingNavigation) return;

    // Mark that we're navigating to bypass our guards
    isNavigatingRef.current = true;

    // Clean up all sessions for this workflow
    onCleanup();

    // Close dialog
    setIsDialogOpen(false);

    // Strip basePath before calling router.push() to avoid duplication
    // The href from the DOM already includes basePath (e.g., "/v2/pools")
    // but router.push() expects a path without basePath (e.g., "/pools")
    const targetUrl = stripBasePath(pendingNavigation.url);
    
    // Use client-side navigation for better performance
    router.push(targetUrl);

    // Reset state after a short delay (in case navigation fails)
    setTimeout(() => {
      isNavigatingRef.current = false;
      setPendingNavigation(null);
    }, 100);
  }, [pendingNavigation, onCleanup, router]);

  const handleCancelNavigation = useCallback(() => {
    setIsDialogOpen(false);
    setPendingNavigation(null);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const sessionCount = activeSessions.length;
  const sessionText = sessionCount === 1 ? "1 active shell session" : `${sessionCount} active shell sessions`;

  return (
    <>
      {children}

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCancelNavigation();
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Leave workflow?</DialogTitle>
            <DialogDescription>
              You have {sessionText} that will be disconnected if you leave this page. Are you sure you want to
              continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancelNavigation}
            >
              Stay on page
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmNavigation}
            >
              Leave and disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
