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
 * - Cleanup on unmount
 *
 * Usage:
 * ```tsx
 * const { containerRef, isReady, fit } = useShell();
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

// Import xterm CSS
import "@xterm/xterm/css/xterm.css";

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
}

export function useShell(options: UseShellOptions = {}): UseShellReturn {
  const { onData, onResize, onLinkClick } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);

  const [isReady, setIsReady] = useState(false);

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

  // Initialize xterm on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create xterm instance
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: SHELL_CONFIG.FONT_SIZE,
      fontFamily: 'var(--font-geist-mono), "SF Mono", Consolas, monospace',
      lineHeight: 1.5,
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
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        // WebGL context lost - dispose and fall back to canvas
        webglAddon.dispose();
        webglAddonRef.current = null;
      });
      terminal.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
    } catch {
      // WebGL not available, canvas renderer is used automatically
      console.debug("[Shell] WebGL not available, using canvas renderer");
    }

    // Initial fit
    fitAddon.fit();

    // Set up data handler
    if (onData) {
      terminal.onData(onData);
    }

    // Store refs
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Use startTransition to avoid cascading renders
    startTransition(() => {
      setIsReady(true);
    });

    // Cleanup
    return () => {
      startTransition(() => {
        setIsReady(false);
      });
      webglAddonRef.current?.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      webglAddonRef.current = null;
    };
  }, [onData, onLinkClick]);

  // Focus the shell
  const focus = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  // Write data to shell
  const write = useCallback((data: string | Uint8Array) => {
    terminalRef.current?.write(data);
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
