// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * useShell Hook
 *
 * Manages xterm.js instance lifecycle including:
 * - Initialization with WebGL addon
 * - Fit addon for auto-resize
 * - Search addon for Ctrl+Shift+F
 * - Web links addon for clickable URLs
 * - Terminal persistence via terminalKey
 *
 * Terminal Persistence:
 * When `terminalKey` is provided, the terminal instance is stored in a cache
 * and persists across component unmount/remount. This allows shell history
 * to be preserved when navigating within a workflow page.
 *
 * Usage:
 * ```tsx
 * // Without persistence (disposes on unmount)
 * const { containerRef, isReady, fit } = useShell();
 *
 * // With persistence (survives navigation)
 * const { containerRef, isReady, fit } = useShell({ terminalKey: taskName });
 *
 * return <div ref={containerRef} className="shell-body" />;
 * ```
 */

"use client";

import React, { useRef, useState, useEffect, useCallback, startTransition } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { useDebounceCallback, useResizeObserver } from "usehooks-ts";

import { SHELL_THEME, SHELL_CONFIG } from "./types";
import type { UseShellReturn } from "./types";
import {
  getTerminal as getCachedTerminal,
  storeTerminal,
  updateContainer,
  disposeTerminal,
  type CachedTerminal,
} from "./terminal-cache";

// Import xterm CSS
import "@xterm/xterm/css/xterm.css";

// =============================================================================
// Terminal Creation Helpers
// =============================================================================

/**
 * Create a new xterm.js Terminal instance with all addons configured.
 */
function createTerminal(
  container: HTMLElement,
  onData?: (data: string) => void,
  onLinkClick?: (url: string) => void,
): {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  webglAddon: WebglAddon | null;
} {
  // Get the actual font family from CSS variable (Next.js generates unique names)
  // Fallback to common monospace fonts if CSS variable isn't available
  const computedStyle = getComputedStyle(document.documentElement);
  const geistMono = computedStyle.getPropertyValue("--font-geist-mono").trim();
  const fontFamily = geistMono
    ? `${geistMono}, "SF Mono", "Monaco", "Menlo", "Consolas", monospace`
    : '"SF Mono", "Monaco", "Menlo", "Consolas", "Liberation Mono", "Courier New", monospace';

  // Create xterm instance
  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    fontSize: SHELL_CONFIG.FONT_SIZE,
    fontFamily,
    lineHeight: 1.2,
    letterSpacing: 0,
    scrollback: SHELL_CONFIG.SCROLLBACK,
    theme: SHELL_THEME,
    allowProposedApi: true,
    screenReaderMode: true,
    rightClickSelectsWord: true,
  });

  // Create addons
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const webLinksAddon = new WebLinksAddon((event, url) => {
    event.preventDefault();
    if (onLinkClick) {
      onLinkClick(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  });

  // Load addons
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(webLinksAddon);

  // Open terminal in container
  terminal.open(container);

  // Try to load WebGL addon (graceful fallback to canvas)
  let webglAddon: WebglAddon | null = null;
  try {
    webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      // WebGL context lost - dispose and fall back to canvas
      webglAddon?.dispose();
    });
    terminal.loadAddon(webglAddon);
  } catch {
    // WebGL not available, canvas renderer is used automatically
    console.debug("[Shell] WebGL not available, using canvas renderer");
    webglAddon = null;
  }

  // Initial fit
  fitAddon.fit();

  // Set up data handler
  if (onData) {
    terminal.onData(onData);
  }

  return { terminal, fitAddon, searchAddon, webglAddon };
}

/**
 * Reattach a cached terminal to a new container.
 * This is called when navigating back to a shell that was previously detached.
 */
function reattachTerminal(cached: CachedTerminal, container: HTMLElement, onData?: (data: string) => void): void {
  const { terminal } = cached;

  // Clear the container and append the terminal element
  // xterm.js doesn't have a built-in "reattach" method, so we move the element
  const terminalElement = terminal.element;
  if (terminalElement && terminalElement.parentElement !== container) {
    // Move terminal element to new container
    container.innerHTML = "";
    container.appendChild(terminalElement);
  }

  // Re-register data handler (previous one was on old mount)
  if (onData) {
    terminal.onData(onData);
  }

  // Scroll to bottom to show latest content
  terminal.scrollToBottom();
}

// =============================================================================
// Hook
// =============================================================================

export interface UseShellOptions {
  /** Callback when shell receives data from user input */
  onData?: (data: string) => void;
  /** Callback when shell is resized */
  onResize?: (cols: number, rows: number) => void;
  /** Callback when a link is clicked */
  onLinkClick?: (url: string) => void;
  /**
   * Unique key for terminal persistence. When provided, the terminal instance
   * is cached and survives component unmount/remount. This preserves shell
   * history when navigating within the workflow page.
   *
   * Typically set to the taskName for workflow shells.
   */
  terminalKey?: string;
}

export function useShell(options: UseShellOptions = {}): UseShellReturn {
  const { onData, onResize, onLinkClick, terminalKey } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  // Track the key used for this instance to handle cleanup correctly
  const terminalKeyRef = useRef<string | undefined>(terminalKey);

  const [isReady, setIsReady] = useState(false);

  // Keep terminalKeyRef in sync
  useEffect(() => {
    terminalKeyRef.current = terminalKey;
  }, [terminalKey]);

  // Debounced resize handler
  const debouncedFit = useDebounceCallback(() => {
    if (fitAddonRef.current && terminalRef.current) {
      try {
        fitAddonRef.current.fit();
        const dimensions = fitAddonRef.current.proposeDimensions();
        if (dimensions && onResize) {
          onResize(dimensions.cols, dimensions.rows);
        }
      } catch {
        // Fit may fail if shell is not visible
      }
    }
  }, SHELL_CONFIG.RESIZE_DEBOUNCE_MS);

  // Resize observer callback
  const handleResize = useCallback(() => {
    debouncedFit();
  }, [debouncedFit]);

  // Watch container for resize
  useResizeObserver({
    ref: containerRef as React.RefObject<HTMLElement>,
    onResize: handleResize,
  });

  // Initialize xterm on mount (or reattach if cached)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Check if we have a cached terminal for this key
    const cached = terminalKey ? getCachedTerminal(terminalKey) : undefined;

    if (cached) {
      // Reattach cached terminal to new container
      reattachTerminal(cached, container, onData);

      // Store refs
      terminalRef.current = cached.terminal;
      fitAddonRef.current = cached.fitAddon;
      searchAddonRef.current = cached.searchAddon;
      webglAddonRef.current = cached.webglAddon;

      // Update container reference in cache
      updateContainer(terminalKey!, container);

      // Fit to new container size
      try {
        cached.fitAddon.fit();
      } catch {
        // Fit may fail if container is not visible
      }

      // Use startTransition to avoid cascading renders
      startTransition(() => {
        setIsReady(true);
      });

      // Cleanup: detach but don't dispose
      return () => {
        startTransition(() => {
          setIsReady(false);
        });
        // Update cache to mark as detached
        if (terminalKeyRef.current) {
          updateContainer(terminalKeyRef.current, null);
        }
        // Clear local refs but don't dispose
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
        webglAddonRef.current = null;
      };
    }

    // No cached terminal - create new one
    const { terminal, fitAddon, searchAddon, webglAddon } = createTerminal(container, onData, onLinkClick);

    // Store refs
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    webglAddonRef.current = webglAddon;

    // If terminalKey is provided, store in cache for persistence
    if (terminalKey) {
      storeTerminal(terminalKey, {
        terminal,
        fitAddon,
        searchAddon,
        webglAddon,
        container,
        createdAt: Date.now(),
      });
    }

    // Use startTransition to avoid cascading renders
    startTransition(() => {
      setIsReady(true);
    });

    // Cleanup
    return () => {
      startTransition(() => {
        setIsReady(false);
      });

      // If terminalKey is set, detach but don't dispose (persist for reattachment)
      if (terminalKeyRef.current) {
        updateContainer(terminalKeyRef.current, null);
        // Clear local refs but don't dispose
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
        webglAddonRef.current = null;
      } else {
        // No terminalKey - dispose immediately
        webglAddonRef.current?.dispose();
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
        webglAddonRef.current = null;
      }
    };
    // Note: onData and onLinkClick are intentionally excluded from deps when
    // using cached terminals to avoid recreating on callback changes.
    // For non-cached terminals, changing these would require remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalKey]);

  // Focus the shell
  const focus = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  // Set active state (controls cursor blink and interactivity)
  const setActive = useCallback((active: boolean) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.cursorBlink = active;
    // When inactive, hide the cursor by making it transparent
    // When active, restore the NVIDIA green cursor
    terminal.options.cursorStyle = active ? "block" : "underline";
  }, []);

  // Write data to shell
  const write = useCallback((data: string | Uint8Array) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.write(data, () => {
      // After write completes, scroll to bottom to ensure visibility
      // This fixes clipping when receiving rapid output
      terminal.scrollToBottom();
    });
  }, []);

  // Clear shell screen
  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  // Get current dimensions
  const getDimensions = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return null;
    return { rows: terminal.rows, cols: terminal.cols };
  }, []);

  // Trigger fit to container
  const fit = useCallback(() => {
    debouncedFit();
  }, [debouncedFit]);

  // Get xterm instance (for use in effects only, not render)
  const getTerminal = useCallback(() => terminalRef.current, []);

  // Dispose the terminal (removes from cache if using terminalKey)
  // Call this when the session explicitly ends (user types exit, Ctrl+D, etc.)
  const dispose = useCallback(() => {
    if (terminalKeyRef.current) {
      disposeTerminal(terminalKeyRef.current);
    } else {
      // No terminalKey - dispose local refs
      webglAddonRef.current?.dispose();
      terminalRef.current?.dispose();
    }
    terminalRef.current = null;
    fitAddonRef.current = null;
    searchAddonRef.current = null;
    webglAddonRef.current = null;
    startTransition(() => {
      setIsReady(false);
    });
  }, []);

  return {
    containerRef,
    // Note: Direct xterm access is through getTerminal() in effects
    // This avoids React's rule about not accessing refs during render
    terminal: null as Terminal | null,
    getTerminal,
    isReady,
    focus,
    write,
    clear,
    getDimensions,
    fit,
    setActive,
    dispose,
  };
}

// =============================================================================
// Search Hook (companion to useShell)
// =============================================================================

export interface UseShellSearchOptions {
  /** The xterm instance from useShell */
  terminal: Terminal | null;
}

export interface UseShellSearchReturn {
  /** Current search query */
  query: string;
  /** Set search query */
  setQuery: (query: string) => void;
  /** Find next match */
  findNext: () => boolean;
  /** Find previous match */
  findPrevious: () => boolean;
  /** Clear search */
  clearSearch: () => void;
}

/**
 * Hook for shell search functionality.
 * Must be used with a shell that has the SearchAddon loaded.
 */
export function useShellSearch(terminal: Terminal | null): UseShellSearchReturn {
  const [query, setQuery] = useState("");
  const searchAddonRef = useRef<SearchAddon | null>(null);

  // Get search addon from xterm
  useEffect(() => {
    if (!terminal) {
      searchAddonRef.current = null;
      return;
    }

    // Create a new search addon if needed
    // Note: This assumes the terminal already has a SearchAddon loaded
    // In practice, the addon is shared with useShell
    const addon = new SearchAddon();
    terminal.loadAddon(addon);
    searchAddonRef.current = addon;

    return () => {
      addon.dispose();
      searchAddonRef.current = null;
    };
  }, [terminal]);

  const findNext = useCallback(() => {
    if (!searchAddonRef.current || !query) return false;
    return searchAddonRef.current.findNext(query);
  }, [query]);

  const findPrevious = useCallback(() => {
    if (!searchAddonRef.current || !query) return false;
    return searchAddonRef.current.findPrevious(query);
  }, [query]);

  const clearSearch = useCallback(() => {
    setQuery("");
    searchAddonRef.current?.clearDecorations();
  }, []);

  return {
    query,
    setQuery,
    findNext,
    findPrevious,
    clearSearch,
  };
}
