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
import type { UseShellReturn, SearchOptions, SearchResultInfo } from "./types";
import {
  getSession,
  createSession,
  updateSessionContainer,
  updateSessionDataDisposable,
  disposeSession,
  type ShellSession,
} from "./shell-session-cache";

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
  dataDisposable: ReturnType<Terminal["onData"]> | null;
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

  // Set up data handler and store disposable to prevent duplicate handlers
  let dataDisposable: ReturnType<Terminal["onData"]> | null = null;
  if (onData) {
    dataDisposable = terminal.onData(onData);
  }

  return { terminal, fitAddon, searchAddon, webglAddon, dataDisposable };
}

/**
 * Reattach a cached terminal to a new container.
 * This is called when navigating back to a shell that was previously detached.
 * Returns the new data disposable so it can be stored in the session.
 */
function reattachTerminal(
  session: ShellSession,
  container: HTMLElement,
  onData?: (data: string) => void,
): ReturnType<Terminal["onData"]> | null {
  const { terminal } = session;

  // Clear the container and append the terminal element
  // xterm.js doesn't have a built-in "reattach" method, so we move the element
  const terminalElement = terminal.instance.element;
  if (terminalElement && terminalElement.parentElement !== container) {
    // Move terminal element to new container
    container.innerHTML = "";
    container.appendChild(terminalElement);
  }

  // Dispose previous data handler to prevent duplicate keystrokes
  if (terminal.dataDisposable) {
    terminal.dataDisposable.dispose();
    terminal.dataDisposable = null;
  }

  // Re-register data handler
  let dataDisposable: ReturnType<Terminal["onData"]> | null = null;
  if (onData) {
    dataDisposable = terminal.instance.onData(onData);
  }

  // Scroll to bottom to show latest content
  terminal.instance.scrollToBottom();

  return dataDisposable;
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
   * Session key for terminal and connection persistence.
   * When provided, the session (terminal + WebSocket) is cached and survives
   * component unmount/remount. This preserves shell state when navigating.
   *
   * Typically set to the taskName for workflow shells.
   */
  sessionKey?: string;
  /**
   * Workflow name (required when sessionKey is provided).
   * Used for creating the session and reconnection.
   */
  workflowName?: string;
  /**
   * Task name (required when sessionKey is provided).
   * Used for creating the session and reconnection.
   */
  taskName?: string;
  /**
   * Shell executable (default: /bin/bash).
   * Used for creating the session.
   */
  shell?: string;
}

export function useShell(options: UseShellOptions = {}): UseShellReturn {
  const {
    onData,
    onResize,
    onLinkClick,
    sessionKey,
    workflowName = "",
    taskName = "",
    shell = SHELL_CONFIG.DEFAULT_SHELL,
  } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const searchResultsDisposableRef = useRef<ReturnType<SearchAddon["onDidChangeResults"]> | null>(null);
  // Track the key used for this instance to handle cleanup correctly
  const sessionKeyRef = useRef<string | undefined>(sessionKey);
  const [isReady, setIsReady] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultInfo | null>(null);

  // Keep sessionKeyRef in sync
  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  // Track last resize dimensions to prevent duplicate events
  const lastDimensionsRef = useRef<{ cols: number; rows: number } | null>(null);

  // Debounced resize handler with dimension guard to prevent buffer corruption.
  // When panel collapses or shell moves to hidden container, fitting to small
  // dimensions corrupts the terminal buffer. We check BEFORE fitting.
  const debouncedFit = useDebounceCallback(() => {
    if (fitAddonRef.current && terminalRef.current) {
      try {
        // Check what dimensions we WOULD get before actually fitting.
        // This prevents corruption during panel transitions where container
        // passes through intermediate sizes (e.g., 800px → 400px → 0px).
        const proposed = fitAddonRef.current.proposeDimensions();
        if (!proposed || proposed.cols < SHELL_CONFIG.MIN_COLS || proposed.rows < SHELL_CONFIG.MIN_ROWS) {
          return; // Skip fit - dimensions too small
        }

        fitAddonRef.current.fit();

        // Only call onResize if dimensions actually changed (prevent duplicates)
        if (onResize) {
          const last = lastDimensionsRef.current;
          if (!last || last.cols !== proposed.cols || last.rows !== proposed.rows) {
            lastDimensionsRef.current = { cols: proposed.cols, rows: proposed.rows };
            onResize(proposed.cols, proposed.rows);
          }
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

    // Check if we have a cached session for this key
    const session = sessionKey ? getSession(sessionKey) : undefined;

    if (session) {
      // Reattach cached terminal to new container
      const dataDisposable = reattachTerminal(session, container, onData);

      // Store the new data disposable in the session
      updateSessionDataDisposable(sessionKey!, dataDisposable);

      // Store refs
      terminalRef.current = session.terminal.instance;
      fitAddonRef.current = session.terminal.fitAddon;
      searchAddonRef.current = session.terminal.searchAddon;
      webglAddonRef.current = session.terminal.webglAddon;

      // Update container reference in session
      updateSessionContainer(sessionKey!, container);

      // Wait for container to have non-zero dimensions before fitting.
      // This handles cases where the container is inside an animating panel.
      // Only set isReady after fit, so WebSocket connect gets correct dimensions.
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          observer.disconnect();

          try {
            session.terminal.fitAddon.fit();
          } catch {
            // Fit may fail if container is not visible
          }

          // Now safe to mark as ready - dimensions are correct
          startTransition(() => {
            setIsReady(true);
          });
        }
      });
      observer.observe(container);

      // Cleanup: detach but don't dispose
      return () => {
        observer.disconnect();
        startTransition(() => {
          setIsReady(false);
        });
        // Update session to mark as detached
        if (sessionKeyRef.current) {
          updateSessionContainer(sessionKeyRef.current, null);
        }
        // Clear local refs but don't dispose
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
        webglAddonRef.current = null;
      };
    }

    // No cached session - create new terminal and session
    const { terminal, fitAddon, searchAddon, webglAddon, dataDisposable } = createTerminal(
      container,
      onData,
      onLinkClick,
    );

    // Store refs
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    webglAddonRef.current = webglAddon;

    // If sessionKey is provided, create session in cache for persistence
    if (sessionKey) {
      createSession({
        key: sessionKey,
        workflowName,
        taskName,
        shell,
        terminal: {
          instance: terminal,
          fitAddon,
          searchAddon,
          webglAddon,
          dataDisposable,
        },
        container,
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

      // If sessionKey is set, detach but don't dispose (persist for reattachment)
      if (sessionKeyRef.current) {
        updateSessionContainer(sessionKeyRef.current, null);
        // Clear local refs but don't dispose
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
        webglAddonRef.current = null;
      } else {
        // No sessionKey - dispose immediately
        webglAddonRef.current?.dispose();
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
        webglAddonRef.current = null;
      }
    };
    // Note: onData and onLinkClick are intentionally excluded from deps when
    // using cached sessions to avoid recreating on callback changes.
    // For non-cached terminals, changing these would require remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  // Set up search results listener when search addon is ready
  useEffect(() => {
    const searchAddon = searchAddonRef.current;
    if (!searchAddon) return;

    // Dispose previous listener if any
    searchResultsDisposableRef.current?.dispose();

    // Listen for search result changes
    searchResultsDisposableRef.current = searchAddon.onDidChangeResults((results) => {
      if (results) {
        setSearchResults({
          resultIndex: results.resultIndex,
          resultCount: results.resultCount,
        });
      } else {
        setSearchResults(null);
      }
    });

    return () => {
      searchResultsDisposableRef.current?.dispose();
      searchResultsDisposableRef.current = null;
    };
  }, [isReady]); // Re-run when terminal becomes ready

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

  const write = useCallback((data: string | Uint8Array) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.write(data, () => {
      // After write completes, scroll to bottom to ensure visibility
      terminal.scrollToBottom();
    });
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const getDimensions = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return null;
    return { rows: terminal.rows, cols: terminal.cols };
  }, []);

  const fit = useCallback(() => {
    debouncedFit();
  }, [debouncedFit]);

  // Get xterm instance (for use in effects only, not render)
  const getTerminal = useCallback(() => terminalRef.current, []);

  // Dispose the session (removes from cache if using sessionKey)
  // Call this when the session explicitly ends (user types exit, Ctrl+D, etc.)
  const dispose = useCallback(() => {
    if (sessionKeyRef.current) {
      disposeSession(sessionKeyRef.current);
    } else {
      // No sessionKey - dispose local refs
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

  // Search functionality - uses the SearchAddon created in createTerminal()
  // Active match gets prominent amber highlight with white border
  const findNext = useCallback((query: string, options?: SearchOptions): boolean => {
    if (!searchAddonRef.current || !query) return false;
    return searchAddonRef.current.findNext(query, {
      ...options,
      decorations: {
        matchOverviewRuler: "#f59e0b",
        // Active match - prominent
        activeMatchBackground: "#f59e0b60",
        activeMatchBorder: "#ffffff",
        activeMatchColorOverviewRuler: "#ffffff",
      },
    });
  }, []);

  const findPrevious = useCallback((query: string, options?: SearchOptions): boolean => {
    if (!searchAddonRef.current || !query) return false;
    return searchAddonRef.current.findPrevious(query, {
      ...options,
      decorations: {
        matchOverviewRuler: "#f59e0b",
        // Active match - prominent
        activeMatchBackground: "#f59e0b60",
        activeMatchBorder: "#ffffff",
        activeMatchColorOverviewRuler: "#ffffff",
      },
    });
  }, []);

  const clearSearch = useCallback(() => {
    searchAddonRef.current?.clearDecorations();
    setSearchResults(null);
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
    findNext,
    findPrevious,
    clearSearch,
    searchResults,
  };
}

// Note: useShellSearch has been removed. Search functionality is now built into useShell.
// Use findNext, findPrevious, and clearSearch methods from useShell directly.
