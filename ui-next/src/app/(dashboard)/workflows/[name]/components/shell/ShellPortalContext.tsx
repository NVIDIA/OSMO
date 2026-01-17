// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellPortalContext
 *
 * Provides a portal target for shell terminal rendering.
 * This allows ShellContainer (rendered at workflow level for persistence)
 * to portal into the correct position within TaskDetails' tab content area.
 *
 * Flow:
 * 1. WorkflowDetailContent wraps content with ShellPortalProvider
 * 2. TaskDetails sets the portal target when shell tab is rendered
 * 3. ShellContainer portals into the target, respecting tab boundaries
 */

"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

// =============================================================================
// Types
// =============================================================================

interface ShellPortalContextValue {
  /** The current portal target element (set by TaskDetails) */
  portalTarget: HTMLElement | null;
  /** Register a portal target (called by TaskDetails when shell tab renders) */
  setPortalTarget: (element: HTMLElement | null) => void;
}

// =============================================================================
// Context
// =============================================================================

const ShellPortalContext = createContext<ShellPortalContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export function ShellPortalProvider({ children }: { children: ReactNode }) {
  const [portalTarget, setPortalTargetState] = useState<HTMLElement | null>(null);

  const setPortalTarget = useCallback((element: HTMLElement | null) => {
    setPortalTargetState(element);
  }, []);

  return (
    <ShellPortalContext.Provider value={{ portalTarget, setPortalTarget }}>{children}</ShellPortalContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useShellPortal(): ShellPortalContextValue {
  const context = useContext(ShellPortalContext);
  if (!context) {
    throw new Error("useShellPortal must be used within a ShellPortalProvider");
  }
  return context;
}
