// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Terminal Instance Cache
 *
 * Stores xterm.js Terminal instances outside of React's lifecycle to enable
 * shell persistence when navigating within a workflow page. Terminals are
 * stored by a unique key (typically taskName) and can be detached/reattached
 * to different DOM containers without losing history.
 *
 * Important: Terminal instances are NOT React state - they're mutable class
 * instances that must be managed imperatively. This cache lives at module
 * scope to survive React re-renders and navigation.
 *
 * Lifecycle:
 * 1. User opens shell for task → getOrCreate() creates Terminal, stores in cache
 * 2. User navigates away → detach() removes Terminal from DOM (keeps instance)
 * 3. User returns → attach() reattaches Terminal to new container
 * 4. User closes shell / session ends → dispose() removes from cache and cleans up
 */

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { WebglAddon } from "@xterm/addon-webgl";

// =============================================================================
// Types
// =============================================================================

export interface CachedTerminal {
  /** The xterm.js Terminal instance */
  terminal: Terminal;
  /** Fit addon for auto-resize */
  fitAddon: FitAddon;
  /** Search addon for Ctrl+Shift+F */
  searchAddon: SearchAddon;
  /** WebGL addon (optional, may be null if not supported) */
  webglAddon: WebglAddon | null;
  /** The container the terminal is currently attached to (null if detached) */
  container: HTMLElement | null;
  /** Timestamp when the terminal was created */
  createdAt: number;
}

// =============================================================================
// Cache Store (Module Scope)
// =============================================================================

/** Map of terminalKey -> CachedTerminal */
const terminalCache = new Map<string, CachedTerminal>();

// =============================================================================
// Cache Operations
// =============================================================================

/**
 * Get an existing terminal from the cache.
 */
export function getTerminal(key: string): CachedTerminal | undefined {
  return terminalCache.get(key);
}

/**
 * Check if a terminal exists in the cache.
 */
export function hasTerminal(key: string): boolean {
  return terminalCache.has(key);
}

/**
 * Store a terminal in the cache.
 * Used by useShell when creating a new terminal.
 */
export function storeTerminal(key: string, cached: CachedTerminal): void {
  terminalCache.set(key, cached);
}

/**
 * Update the container reference for a cached terminal.
 * Called when attaching to a new container or detaching.
 */
export function updateContainer(key: string, container: HTMLElement | null): void {
  const cached = terminalCache.get(key);
  if (cached) {
    cached.container = container;
  }
}

/**
 * Dispose a terminal and remove it from the cache.
 * Cleans up all resources (addons, WebGL context, etc.).
 */
export function disposeTerminal(key: string): void {
  const cached = terminalCache.get(key);
  if (!cached) return;

  // Dispose addons first
  try {
    cached.webglAddon?.dispose();
  } catch {
    // WebGL may already be disposed
  }

  try {
    cached.searchAddon.dispose();
  } catch {
    // Addon may already be disposed
  }

  try {
    cached.fitAddon.dispose();
  } catch {
    // Addon may already be disposed
  }

  // Dispose terminal
  try {
    cached.terminal.dispose();
  } catch {
    // Terminal may already be disposed
  }

  // Remove from cache
  terminalCache.delete(key);
}

/**
 * Dispose all terminals in the cache.
 * Called when leaving the workflow page.
 */
export function disposeAllTerminals(): void {
  for (const key of terminalCache.keys()) {
    disposeTerminal(key);
  }
}

/**
 * Get the count of cached terminals.
 * Useful for debugging.
 */
export function getTerminalCount(): number {
  return terminalCache.size;
}

/**
 * Get all terminal keys.
 * Useful for debugging.
 */
export function getTerminalKeys(): string[] {
  return Array.from(terminalCache.keys());
}
