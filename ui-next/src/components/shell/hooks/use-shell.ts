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
 * useShell Hook
 *
 * Main hook for managing persistent shell sessions. This hook provides:
 * - Session lifecycle management (create, connect, disconnect, dispose)
 * - Terminal creation and rendering
 * - WebSocket connection handling
 * - State machine integration
 *
 * **Architecture:**
 * - Sessions persist in cache across component mount/unmount
 * - Hook provides methods to interact with session
 * - Single source of truth: session state in cache
 * - Components observe state via useShellSession()
 *
 * **Usage:**
 * ```tsx
 * const shell = useShell({
 *   sessionKey: taskId,
 *   workflowName, taskName, shell: "/bin/bash",
 *   autoConnect: true,
 * });
 *
 * return <div ref={shell.containerRef} />;
 * ```
 */

import { useRef, useCallback, useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { useDebounceCallback, useResizeObserver } from "usehooks-ts";

import { useExecIntoTask } from "@/lib/api/adapter";
import { updateALBCookies } from "@/lib/auth/cookies";
import {
  type ShellState,
  type ShellEvent,
  type TerminalAddons,
  transition,
  hasTerminal,
  hasWebSocket,
} from "../lib/shell-state";
import { _getSession, _createSession, _updateSession, _deleteSession, useShellSession } from "../lib/shell-cache";
import { SHELL_CONFIG, SHELL_THEME } from "../lib/types";

import "@xterm/xterm/css/xterm.css";

export interface UseShellOptions {
  /** Unique session identifier (typically taskId). Required for persistent sessions. */
  sessionKey: string;
  /** Workflow name */
  workflowName: string;
  /** Task name */
  taskName: string;
  /** Shell command (e.g., "/bin/bash"). Defaults to /bin/bash. */
  shell?: string;
  /** Callback when terminal receives data from PTY */
  onData?: (data: string) => void;
  /** Callback when terminal dimensions change */
  onResize?: (cols: number, rows: number) => void;
  /** Auto-connect when container is ready (default: false) */
  autoConnect?: boolean;
}

export interface UseShellReturn {
  /** Ref callback to attach to the container element - updates cache immediately on attach */
  containerRef: (node: HTMLDivElement | null) => void;
  /** Traditional ref object for reading the current container (used by resize observer) */
  containerRefObject: React.RefObject<HTMLDivElement | null>;
  /** Current session state (from cache, single source of truth) */
  state: ShellState;
  /** Initiate connection to shell */
  connect: () => Promise<void>;
  /** Disconnect from shell (keeps session, allows reconnect) */
  disconnect: () => void;
  /** Send data to shell (user input) */
  send: (data: string) => void;
  /** Write data to terminal (bypasses WebSocket, writes directly to xterm) */
  write: (data: string | Uint8Array) => void;
  /** Focus the terminal */
  focus: () => void;
  /** Fit terminal to container */
  fit: () => void;
  /** Clear terminal output */
  clear: () => void;
  /** Scroll terminal to bottom */
  scrollToBottom: () => void;
  /** Get terminal dimensions */
  getDimensions: () => { rows: number; cols: number } | null;
  /** Find next occurrence of search term */
  findNext: (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) => boolean;
  /** Find previous occurrence of search term */
  findPrevious: (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) => boolean;
  /** Clear search highlighting */
  clearSearch: () => void;
  /** Dispose session and clean up resources */
  dispose: () => void;
}

const sharedEncoder = new TextEncoder();

export function useShell(options: UseShellOptions): UseShellReturn {
  const {
    sessionKey,
    workflowName,
    taskName,
    shell = SHELL_CONFIG.DEFAULT_SHELL,
    onData,
    onResize,
    autoConnect = false,
  } = options;

  // Stable refs for callbacks (avoid re-creating functions on every render)
  const workflowNameRef = useRef(workflowName);
  const taskNameRef = useRef(taskName);
  const shellRef = useRef(shell);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);

  // Update refs on every render (latest props)
  useEffect(() => {
    workflowNameRef.current = workflowName;
    taskNameRef.current = taskName;
    shellRef.current = shell;
    onDataRef.current = onData;
    onResizeRef.current = onResize;
  }, [workflowName, taskName, shell, onData, onResize]);

  // Traditional ref object for reading current container (used by resize observer)
  const containerRefObject = useRef<HTMLDivElement>(null);

  // Observe session from cache (single source of truth)
  const cachedSession = useShellSession(sessionKey);
  const state = cachedSession?.state ?? { phase: "idle" };

  const execMutation = useExecIntoTask();

  /**
   * Dispatch state machine event.
   * Reads current state from cache to avoid stale closures.
   */
  const dispatch = useCallback(
    (event: ShellEvent) => {
      const session = _getSession(sessionKey);
      if (!session) {
        console.warn(`[Shell] ⚠️ Cannot dispatch ${event.type}: session not found`);
        return;
      }

      const currentState = session.state;
      const nextState = transition(currentState, event);
      console.debug(`[Shell] 🔀 STATE TRANSITION: ${currentState.phase} + ${event.type} → ${nextState.phase}`, {
        sessionKey,
        event,
        currentState,
        nextState,
      });

      _updateSession(sessionKey, { state: nextState });
    },
    [sessionKey],
  );

  /**
   * Create terminal instance with all addons.
   */
  const createTerminal = useCallback((container: HTMLElement): { terminal: Terminal; addons: TerminalAddons } => {
    const computedStyle = getComputedStyle(document.documentElement);
    const geistMono = computedStyle.getPropertyValue("--font-geist-mono").trim();
    const fontFamily = geistMono
      ? `${geistMono}, "SF Mono", "Monaco", "Menlo", "Consolas", monospace`
      : '"SF Mono", "Monaco", "Menlo", "Consolas", "Liberation Mono", "Courier New", monospace';

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

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon((event, url) => {
      event.preventDefault();
      window.open(url, "_blank", "noopener,noreferrer");
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(container);

    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      console.debug("[Shell] WebGL not available, using canvas renderer");
    }

    fitAddon.fit();

    // Attach onData handler if provided
    if (onDataRef.current) {
      terminal.onData(onDataRef.current);
    }

    return {
      terminal,
      addons: { fitAddon, searchAddon, webglAddon },
    };
  }, []);

  /**
   * Setup WebSocket event handlers.
   */
  const setupWebSocketHandlers = useCallback(
    (ws: WebSocket, terminal: Terminal) => {
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        console.debug("[Shell] 🔌 WebSocket opened", {
          sessionKey,
          readyState: ws.readyState,
        });
        dispatch({ type: "WS_OPENED", ws });

        requestAnimationFrame(() => {
          const session = _getSession(sessionKey);
          if (!session) return;

          // Only send resize if not already sent (backend bug workaround)
          if (!session.initialResizeSent) {
            const dims = { rows: terminal.rows, cols: terminal.cols };
            if (dims.rows >= SHELL_CONFIG.MIN_ROWS && dims.cols >= SHELL_CONFIG.MIN_COLS) {
              console.debug("[Shell] 📐 Sending initial resize", {
                sessionKey,
                rows: dims.rows,
                cols: dims.cols,
              });
              const msg = JSON.stringify({ Rows: dims.rows, Cols: dims.cols });
              ws.send(sharedEncoder.encode(msg));
              _updateSession(sessionKey, { initialResizeSent: true });
            }
          }
        });

        // Set backend initialization timeout (session-level state)
        const timeout = setTimeout(() => {
          dispatch({ type: "TIMEOUT" });
        }, SHELL_CONFIG.BACKEND_INIT_TIMEOUT_MS);
        _updateSession(sessionKey, { backendTimeout: timeout });
      };

      ws.onmessage = (event) => {
        // Clear backend timeout on first data (transition to ready)
        const session = _getSession(sessionKey);
        if (session?.backendTimeout) {
          console.debug("[Shell] 📥 FIRST DATA from PTY - transitioning to ready", { sessionKey });
          clearTimeout(session.backendTimeout);
          _updateSession(sessionKey, { backendTimeout: null });
          dispatch({ type: "FIRST_DATA" });
        }

        let data: Uint8Array;
        if (event.data instanceof ArrayBuffer) {
          data = new Uint8Array(event.data);
        } else if (typeof event.data === "string") {
          data = sharedEncoder.encode(event.data);
        } else {
          return;
        }

        const dataPreview = new TextDecoder().decode(data.slice(0, 50));
        console.debug("[Shell] 📥 PTY data received", {
          sessionKey,
          byteLength: data.length,
          preview: dataPreview.replace(/\r/g, "\\r").replace(/\n/g, "\\n"),
          scrollY: terminal.buffer.active.viewportY,
          baseY: terminal.buffer.active.baseY,
        });

        terminal.write(data);
      };

      ws.onclose = (event) => {
        console.debug("[Shell] 🔌 WebSocket closed", {
          sessionKey,
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
        const session = _getSession(sessionKey);
        if (session?.backendTimeout) {
          clearTimeout(session.backendTimeout);
          _updateSession(sessionKey, { backendTimeout: null });
        }
        dispatch({ type: "WS_CLOSED" });
      };

      ws.onerror = (event) => {
        console.error("[Shell] ❌ WebSocket error", {
          sessionKey,
          error: event,
        });
        const session = _getSession(sessionKey);
        if (session?.backendTimeout) {
          clearTimeout(session.backendTimeout);
          _updateSession(sessionKey, { backendTimeout: null });
        }
        dispatch({ type: "WS_ERROR", error: "WebSocket connection failed" });
      };
    },
    [dispatch, sessionKey],
  );

  /**
   * Connect to shell.
   * Initiates the connection flow: API call → terminal creation → WebSocket.
   */
  const connect = useCallback(async () => {
    console.debug("[Shell] 🚀 connect() called", { sessionKey });
    const session = _getSession(sessionKey);
    if (!session) {
      console.warn("[Shell] ⚠️ Cannot connect: session not found", { sessionKey });
      return;
    }

    console.debug("[Shell] 📊 Session state", {
      sessionKey,
      phase: session.state.phase,
      isConnecting: session.isConnecting,
      hasContainer: !!session.container,
      hasTerminal: hasTerminal(session.state),
      hasWebSocket: hasWebSocket(session.state),
    });

    // Guard against concurrent connection attempts
    if (session.isConnecting) {
      console.debug("[Shell] ⚠️ Session already connecting, skipping duplicate attempt", { sessionKey });
      return;
    }

    // Check container exists
    if (!session.container) {
      console.warn("[Shell] ⚠️ Container not ready, cannot connect", { sessionKey });
      return;
    }

    // Mark as connecting
    console.debug("[Shell] ✅ Marking as connecting", { sessionKey });
    _updateSession(sessionKey, { isConnecting: true });

    try {
      dispatch({
        type: "CONNECT",
        workflowName: workflowNameRef.current,
        taskName: taskNameRef.current,
        shell: shellRef.current,
      });

      // Reset initial resize flag for new connection
      _updateSession(sessionKey, { initialResizeSent: false });

      const response = await execMutation.mutateAsync({
        name: workflowNameRef.current,
        taskName: taskNameRef.current,
        params: { entry_command: shellRef.current },
      });

      // ALB cookies must be set before WebSocket connection
      if (response.cookie) {
        updateALBCookies(response.cookie);
      }

      // Read current container from session (might have updated if UI remounted)
      const currentSession = _getSession(sessionKey);
      if (!currentSession?.container) {
        dispatch({ type: "API_ERROR", error: "Container not found" });
        _updateSession(sessionKey, { isConnecting: false });
        return;
      }

      // Reuse existing terminal if available (reconnection scenario)
      let terminal: Terminal;
      let addons: TerminalAddons;

      const existingTerminal = hasTerminal(currentSession.state) ? currentSession.state.terminal : null;

      console.debug("[Shell] 🔍 Checking terminal reuse condition", {
        sessionKey,
        sessionStatePhase: currentSession.state.phase,
        hasTerminalInState: hasTerminal(currentSession.state),
        terminalInState: hasTerminal(currentSession.state) ? "yes - " + typeof currentSession.state.terminal : "no",
        existingTerminalActual: existingTerminal,
        hasExistingTerminal: !!existingTerminal,
        hasAddons: !!currentSession.addons,
        canReuse: !!existingTerminal,
        terminalRows: existingTerminal?.rows,
        terminalCols: existingTerminal?.cols,
        addonsStatus: currentSession.addons ? "present" : "missing",
      });

      if (existingTerminal) {
        // Reconnecting - reuse terminal and add separator
        terminal = existingTerminal;

        // Reuse addons if available, otherwise they'll be created below
        if (currentSession.addons) {
          addons = currentSession.addons;
          console.debug("[Shell] 🔄 RECONNECT: Reusing existing addons", { sessionKey });
        } else {
          // Addons missing - recreate them (shouldn't normally happen but be defensive)
          console.warn("[Shell] ⚠️ Addons missing - recreating", { sessionKey });
          const fitAddon = new FitAddon();
          const searchAddon = new SearchAddon();
          terminal.loadAddon(fitAddon);
          terminal.loadAddon(searchAddon);

          let webglAddon: WebglAddon | null = null;
          try {
            webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => {
              webglAddon?.dispose();
            });
            terminal.loadAddon(webglAddon);
          } catch {
            console.debug("[Shell] WebGL not available, using canvas renderer");
          }

          addons = { fitAddon, searchAddon, webglAddon };
          _updateSession(sessionKey, { addons });
        }

        console.debug("[Shell] 🔄 RECONNECT: Reusing existing terminal", {
          sessionKey,
          terminalRows: terminal.rows,
          terminalCols: terminal.cols,
          scrollY: terminal.buffer.active.viewportY,
          baseY: terminal.buffer.active.baseY,
        });

        // Write reconnection banner to show session boundary
        const ANSI_DIM = "\x1b[2m";
        const ANSI_GREEN = "\x1b[32m";
        const ANSI_RESET = "\x1b[0m";
        const separator = `${ANSI_DIM}${"─".repeat(80)}${ANSI_RESET}`;

        terminal.write(`\r\n\r\n${separator}\r\n`);
        terminal.write(`${ANSI_GREEN}Reconnecting...${ANSI_RESET}\r\n`);
        terminal.write(`${separator}\r\n\r\n`);

        console.debug("[Shell] 🔄 RECONNECT: Wrote reconnection banner", {
          sessionKey,
          scrollY: terminal.buffer.active.viewportY,
          baseY: terminal.buffer.active.baseY,
        });
      } else {
        // First connection - create new terminal
        const created = createTerminal(currentSession.container);
        terminal = created.terminal;
        addons = created.addons;
        _updateSession(sessionKey, { addons });

        console.debug("[Shell] ✨ Created new terminal for session", { sessionKey });
      }

      // Dispose old input handler if it exists (prevent duplicate listeners)
      if (currentSession.onDataDisposable) {
        console.debug("[Shell] 🧹 Disposing old onData handler", { sessionKey });
        currentSession.onDataDisposable.dispose();
      }

      // Connect terminal input to WebSocket output
      const onDataDisposable = terminal.onData((data) => {
        const session = _getSession(sessionKey);
        if (!session || !hasWebSocket(session.state) || session.state.ws.readyState !== WebSocket.OPEN) {
          console.debug("[Shell] ⚠️ Cannot send data - WebSocket not ready", {
            sessionKey,
            hasSession: !!session,
            hasWebSocket: session ? hasWebSocket(session.state) : false,
            wsReadyState: session && hasWebSocket(session.state) ? session.state.ws.readyState : null,
          });
          return;
        }
        console.debug("[Shell] 📤 Sending user input to PTY", { sessionKey, dataLength: data.length });
        session.state.ws.send(sharedEncoder.encode(data));
      });

      console.debug("[Shell] ✅ Attached new onData handler", { sessionKey });

      // Store disposable for cleanup
      _updateSession(sessionKey, { onDataDisposable });

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const routerAddress = response.router_address.replace(/^https?:/, wsProtocol);
      const wsUrl = `${routerAddress}/api/router/exec/${workflowNameRef.current}/client/${response.key}`;

      console.debug("[Shell] Connecting to PTY:", { wsUrl, sessionKey });
      dispatch({ type: "API_SUCCESS", terminal, wsUrl });

      const ws = new WebSocket(wsUrl);
      setupWebSocketHandlers(ws, terminal);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to create exec session";
      dispatch({ type: "API_ERROR", error });
      _updateSession(sessionKey, { isConnecting: false });
    } finally {
      // Connection attempt complete
      _updateSession(sessionKey, { isConnecting: false });
    }
  }, [dispatch, sessionKey, execMutation, createTerminal, setupWebSocketHandlers]);

  /**
   * Disconnect from shell (keeps session, allows reconnect).
   */
  const disconnect = useCallback(() => {
    console.debug("[Shell] 🔌 disconnect() called", { sessionKey });
    const session = _getSession(sessionKey);
    if (!session) {
      console.debug("[Shell] ⚠️ Cannot disconnect - no session", { sessionKey });
      return;
    }

    if (hasWebSocket(session.state)) {
      console.debug("[Shell] 🔌 Closing WebSocket", {
        sessionKey,
        wsReadyState: session.state.ws.readyState,
      });
      session.state.ws.close();
    }
    dispatch({ type: "DISCONNECT" });
  }, [sessionKey, dispatch]);

  /**
   * Send data to shell (user input).
   */
  const send = useCallback(
    (data: string) => {
      const session = _getSession(sessionKey);
      if (!session || !hasWebSocket(session.state) || session.state.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      session.state.ws.send(sharedEncoder.encode(data));
    },
    [sessionKey],
  );

  /**
   * Write data to terminal (bypasses WebSocket).
   */
  const write = useCallback(
    (data: string | Uint8Array) => {
      const session = _getSession(sessionKey);
      if (!session || !hasTerminal(session.state)) return;

      if (typeof data === "string") {
        session.state.terminal.write(data);
      } else {
        session.state.terminal.write(data);
      }
    },
    [sessionKey],
  );

  /**
   * Focus the terminal.
   */
  const focus = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session || !hasTerminal(session.state)) {
      console.debug("[Shell] ⚠️ Cannot focus - no terminal", { sessionKey });
      return;
    }
    console.debug("[Shell] 🎯 Focusing terminal", { sessionKey });
    session.state.terminal.focus();
  }, [sessionKey]);

  /**
   * Fit terminal to container.
   */
  const fit = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session?.addons?.fitAddon) return;

    try {
      const proposed = session.addons.fitAddon.proposeDimensions();
      if (!proposed || proposed.cols < SHELL_CONFIG.MIN_COLS || proposed.rows < SHELL_CONFIG.MIN_ROWS) {
        return;
      }
      session.addons.fitAddon.fit();
      onResizeRef.current?.(proposed.cols, proposed.rows);
    } catch {
      // Fit may fail if terminal is not visible
    }
  }, [sessionKey]);

  /**
   * Clear terminal output.
   */
  const clear = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session || !hasTerminal(session.state)) return;
    session.state.terminal.clear();
  }, [sessionKey]);

  /**
   * Scroll terminal to bottom.
   */
  const scrollToBottom = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session || !hasTerminal(session.state)) {
      console.debug("[Shell] ⚠️ Cannot scroll - no terminal", { sessionKey });
      return;
    }
    const terminal = session.state.terminal;
    console.debug("[Shell] 📜 Scrolling to bottom", {
      sessionKey,
      beforeScrollY: terminal.buffer.active.viewportY,
      baseY: terminal.buffer.active.baseY,
      totalLines: terminal.buffer.active.length,
    });
    terminal.scrollToBottom();
    console.debug("[Shell] 📜 After scroll", {
      sessionKey,
      afterScrollY: terminal.buffer.active.viewportY,
      baseY: terminal.buffer.active.baseY,
    });
  }, [sessionKey]);

  /**
   * Get terminal dimensions.
   */
  const getDimensions = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session || !hasTerminal(session.state)) return null;
    return {
      rows: session.state.terminal.rows,
      cols: session.state.terminal.cols,
    };
  }, [sessionKey]);

  /**
   * Find next occurrence.
   */
  const findNext = useCallback(
    (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) => {
      const session = _getSession(sessionKey);
      if (!session?.addons?.searchAddon) return false;
      // Enable decorations to trigger onDidChangeResults event
      const searchOptions = {
        ...options,
        decorations: {
          matchOverviewRuler: "#ffff0099",
          activeMatchColorOverviewRuler: "#ffa50099",
        },
      };
      return session.addons.searchAddon.findNext(query, searchOptions);
    },
    [sessionKey],
  );

  /**
   * Find previous occurrence.
   */
  const findPrevious = useCallback(
    (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) => {
      const session = _getSession(sessionKey);
      if (!session?.addons?.searchAddon) return false;
      // Enable decorations to trigger onDidChangeResults event
      const searchOptions = {
        ...options,
        decorations: {
          matchOverviewRuler: "#ffff0099",
          activeMatchColorOverviewRuler: "#ffa50099",
        },
      };
      return session.addons.searchAddon.findPrevious(query, searchOptions);
    },
    [sessionKey],
  );

  /**
   * Clear search highlighting.
   */
  const clearSearch = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session?.addons?.searchAddon) return;
    session.addons.searchAddon.clearDecorations();
  }, [sessionKey]);

  /**
   * Dispose session and clean up resources.
   */
  const dispose = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session) return;

    // Clean up resources
    if (session.backendTimeout) {
      clearTimeout(session.backendTimeout);
    }
    if (session.onDataDisposable) {
      session.onDataDisposable.dispose();
    }
    if (hasTerminal(session.state)) {
      session.state.terminal.dispose();
    }
    if (hasWebSocket(session.state)) {
      session.state.ws.close();
    }
    session.addons?.webglAddon?.dispose();

    _deleteSession(sessionKey);
  }, [sessionKey]);

  /**
   * Ref callback that creates/updates session when container attaches.
   */
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRefObject.current = node;

      if (node) {
        const existingSession = _getSession(sessionKey);
        if (existingSession) {
          // Session exists - just update container reference
          _updateSession(sessionKey, { container: node });
          console.debug("[Shell] UI component mounted, attaching to existing session:", sessionKey);
        } else {
          // First mount - create new session
          _createSession({
            key: sessionKey,
            workflowName: workflowNameRef.current,
            taskName: taskNameRef.current,
            shell: shellRef.current,
            state: { phase: "idle" },
            addons: null,
            container: node,
            isConnecting: false,
            backendTimeout: null,
            initialResizeSent: false,
            onDataDisposable: null,
          });
          console.debug("[Shell] New session created:", sessionKey);
        }
      }
    },
    [sessionKey],
  );

  /**
   * Auto-connect when container is ready and session is idle.
   */
  useEffect(() => {
    if (!autoConnect) return;

    const session = _getSession(sessionKey);
    if (!session) return;

    // Only auto-connect if idle and not already connecting
    const shouldConnect = session.container && session.state.phase === "idle" && !session.isConnecting;

    if (shouldConnect) {
      console.debug("[Shell] Auto-connecting session:", sessionKey);
      connect();
    }
  }, [autoConnect, sessionKey, connect, state.phase]);

  /**
   * UI component lifecycle logging.
   */
  useEffect(() => {
    console.debug("[Shell] UI component mounted for session:", sessionKey);
    return () => {
      console.debug("[Shell] UI component unmounting, session persists:", sessionKey);
    };
  }, [sessionKey]);

  /**
   * Fit terminal when it becomes visible (transitions to ready state).
   */
  useEffect(() => {
    if (state.phase === "ready") {
      const timer = setTimeout(() => {
        fit();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [state.phase, fit]);

  /**
   * Debounced resize handler.
   */
  const debouncedFit = useDebounceCallback(fit, SHELL_CONFIG.RESIZE_DEBOUNCE_MS);

  useResizeObserver({
    ref: containerRefObject as React.RefObject<HTMLElement>,
    onResize: debouncedFit,
  });

  return {
    containerRef,
    containerRefObject,
    state,
    connect,
    disconnect,
    send,
    write,
    focus,
    fit,
    clear,
    scrollToBottom,
    getDimensions,
    findNext,
    findPrevious,
    clearSearch,
    dispose,
  };
}
