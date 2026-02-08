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

import { useRef, useCallback, useEffect, startTransition } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { useDebounceCallback, useResizeObserver } from "usehooks-ts";

import { useExecIntoTask } from "@/lib/api/adapter/hooks";
import { updateALBCookies } from "@/lib/auth/cookies";
import {
  type ShellState,
  type ShellEvent,
  type TerminalAddons,
  transition,
  hasTerminal,
  hasWebSocket,
} from "@/components/shell/lib/shell-state";
import {
  _getSession,
  _createSession,
  _updateSession,
  _deleteSession,
  useShellSession,
} from "@/components/shell/lib/shell-cache";
import { shellKeyboardManager } from "@/components/shell/lib/shell-keyboard-manager";
import { SHELL_CONFIG, SHELL_THEME } from "@/components/shell/lib/types";

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

  const dispatch = useCallback(
    (event: ShellEvent) => {
      const session = _getSession(sessionKey);
      if (!session) return;

      const nextState = transition(session.state, event);
      _updateSession(sessionKey, { state: nextState });
    },
    [sessionKey],
  );

  // FitAddon.proposeDimensions() returns NaN until the render service has measured
  // character dimensions. We use onRender to detect when dimensions are valid.
  const createTerminal = useCallback(
    (container: HTMLElement): { terminal: Terminal; addons: TerminalAddons } => {
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
        // WebGL not available, using canvas renderer
      }

      // Wait for valid dimensions before marking terminal ready
      const onRenderDisposable = terminal.onRender(() => {
        const proposed = fitAddon.proposeDimensions();
        const isValid =
          proposed &&
          Number.isFinite(proposed.cols) &&
          Number.isFinite(proposed.rows) &&
          proposed.cols >= SHELL_CONFIG.MIN_COLS &&
          proposed.rows >= SHELL_CONFIG.MIN_ROWS;

        if (!isValid) return;

        onRenderDisposable.dispose();
        _updateSession(sessionKey, {
          terminalReady: true,
          onRenderDisposable: null,
        });

        try {
          fitAddon.fit();
        } catch {
          // Fit failed, will retry on next resize
        }
      });

      // Store the disposable so it can be cleaned up if session is disposed before render
      _updateSession(sessionKey, { onRenderDisposable });

      // Attach onData handler if provided
      if (onDataRef.current) {
        terminal.onData(onDataRef.current);
      }

      return {
        terminal,
        addons: { fitAddon, searchAddon, webglAddon },
      };
    },
    [sessionKey],
  );

  const setupWebSocketHandlers = useCallback(
    (ws: WebSocket, terminal: Terminal) => {
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        dispatch({ type: "WS_OPENED", ws });

        // Send initial resize after WebSocket opens (backend bug workaround)
        requestAnimationFrame(() => {
          const session = _getSession(sessionKey);
          if (!session || session.initialResizeSent) return;

          const dims = { rows: terminal.rows, cols: terminal.cols };
          if (dims.rows >= SHELL_CONFIG.MIN_ROWS && dims.cols >= SHELL_CONFIG.MIN_COLS) {
            const msg = JSON.stringify({ Rows: dims.rows, Cols: dims.cols });
            ws.send(sharedEncoder.encode(msg));
            _updateSession(sessionKey, { initialResizeSent: true });
          }
        });

        const timeout = setTimeout(() => {
          dispatch({ type: "TIMEOUT" });
        }, SHELL_CONFIG.BACKEND_INIT_TIMEOUT_MS);
        _updateSession(sessionKey, { backendTimeout: timeout });
      };

      ws.onmessage = (event) => {
        let data: Uint8Array;
        if (event.data instanceof ArrayBuffer) {
          data = new Uint8Array(event.data);
        } else if (typeof event.data === "string") {
          data = sharedEncoder.encode(event.data);
        } else {
          return;
        }

        terminal.write(data);

        const session = _getSession(sessionKey);
        if (session?.backendTimeout) {
          clearTimeout(session.backendTimeout);
          startTransition(() => {
            _updateSession(sessionKey, { backendTimeout: null });
            dispatch({ type: "FIRST_DATA" });
          });
        }
      };

      ws.onclose = () => {
        const session = _getSession(sessionKey);
        if (session?.backendTimeout) {
          clearTimeout(session.backendTimeout);
          _updateSession(sessionKey, { backendTimeout: null });
        }
        dispatch({ type: "WS_CLOSED" });
      };

      ws.onerror = () => {
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

  const connect = useCallback(async () => {
    const session = _getSession(sessionKey);
    if (!session) return;

    // Guard against concurrent connection attempts
    if (session.isConnecting || !session.container) return;

    _updateSession(sessionKey, { isConnecting: true });

    try {
      dispatch({
        type: "CONNECT",
        workflowName: workflowNameRef.current,
        taskName: taskNameRef.current,
        shell: shellRef.current,
      });

      _updateSession(sessionKey, { initialResizeSent: false });

      const response = await execMutation.mutateAsync({
        name: workflowNameRef.current,
        taskName: taskNameRef.current,
        params: { entry_command: shellRef.current },
      });

      if (response.cookie) {
        updateALBCookies(response.cookie);
      }

      const currentSession = _getSession(sessionKey);
      if (!currentSession?.container) {
        dispatch({ type: "API_ERROR", error: "Container not found" });
        _updateSession(sessionKey, { isConnecting: false });
        return;
      }

      let terminal: Terminal;
      let addons: TerminalAddons;

      const existingTerminal = hasTerminal(currentSession.state) ? currentSession.state.terminal : null;

      if (existingTerminal) {
        // Reconnecting - reuse terminal
        terminal = existingTerminal;

        if (currentSession.addons) {
          addons = currentSession.addons;
        } else {
          // Addons missing - recreate them
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
            // WebGL not available
          }

          addons = { fitAddon, searchAddon, webglAddon };
          _updateSession(sessionKey, { addons });
        }

        // Write reconnection banner
        const ANSI_DIM = "\x1b[2m";
        const ANSI_GREEN = "\x1b[32m";
        const ANSI_RESET = "\x1b[0m";
        const separator = `${ANSI_DIM}${"─".repeat(80)}${ANSI_RESET}`;

        terminal.write(`\r\n\r\n${separator}\r\n`);
        terminal.write(`${ANSI_GREEN}Reconnecting...${ANSI_RESET}\r\n`);
        terminal.write(`${separator}\r\n\r\n`);
      } else {
        // First connection - create new terminal
        const created = createTerminal(currentSession.container);
        terminal = created.terminal;
        addons = created.addons;
        _updateSession(sessionKey, { addons });
      }

      // Dispose old input handler if it exists
      if (currentSession.onDataDisposable) {
        currentSession.onDataDisposable.dispose();
      }

      // Connect terminal input to WebSocket output
      const onDataDisposable = terminal.onData((data) => {
        const session = _getSession(sessionKey);
        if (!session || !hasWebSocket(session.state) || session.state.ws.readyState !== WebSocket.OPEN) {
          return;
        }
        session.state.ws.send(sharedEncoder.encode(data));
      });

      _updateSession(sessionKey, { onDataDisposable });

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const routerAddress = response.router_address.replace(/^https?:/, wsProtocol);
      const wsUrl = `${routerAddress}/api/router/exec/${workflowNameRef.current}/client/${response.key}`;

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

  const disconnect = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session) return;

    if (hasWebSocket(session.state)) {
      session.state.ws.close();
    }
    dispatch({ type: "DISCONNECT" });
  }, [sessionKey, dispatch]);

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

  const write = useCallback(
    (data: string | Uint8Array) => {
      const session = _getSession(sessionKey);
      if (!session || !hasTerminal(session.state)) return;
      session.state.terminal.write(data);
    },
    [sessionKey],
  );

  const focus = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session || !hasTerminal(session.state)) return;
    session.state.terminal.focus();
    shellKeyboardManager.markFocused(sessionKey);
  }, [sessionKey]);

  // Guard against calling fit() before terminal has rendered (FitAddon.proposeDimensions() returns NaN)
  const fit = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session?.addons?.fitAddon || !session.container || !session.terminalReady) return;

    try {
      const proposed = session.addons.fitAddon.proposeDimensions();

      // Guard against invalid dimensions
      if (
        !proposed ||
        !Number.isFinite(proposed.cols) ||
        !Number.isFinite(proposed.rows) ||
        proposed.cols < SHELL_CONFIG.MIN_COLS ||
        proposed.rows < SHELL_CONFIG.MIN_ROWS
      ) {
        // Terminal got into bad state - reset ready flag and wait for next render
        if (!hasTerminal(session.state)) return;

        _updateSession(sessionKey, { terminalReady: false });

        const terminal = session.state.terminal;
        const onRenderDisposable = terminal.onRender(() => {
          const currentSession = _getSession(sessionKey);
          if (!currentSession?.addons?.fitAddon) return;

          const newProposed = currentSession.addons.fitAddon.proposeDimensions();
          const isValid =
            newProposed &&
            Number.isFinite(newProposed.cols) &&
            Number.isFinite(newProposed.rows) &&
            newProposed.cols >= SHELL_CONFIG.MIN_COLS &&
            newProposed.rows >= SHELL_CONFIG.MIN_ROWS;

          if (!isValid) return;

          _updateSession(sessionKey, {
            terminalReady: true,
            onRenderDisposable: null,
          });

          onRenderDisposable.dispose();

          try {
            currentSession.addons.fitAddon.fit();
            onResizeRef.current?.(newProposed.cols, newProposed.rows);
          } catch {
            // Fit failed
          }
        });

        _updateSession(sessionKey, { onRenderDisposable });
        return;
      }

      session.addons.fitAddon.fit();
      onResizeRef.current?.(proposed.cols, proposed.rows);
    } catch {
      // Fit failed
    }
  }, [sessionKey]);

  const clear = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session || !hasTerminal(session.state)) return;
    session.state.terminal.clear();
  }, [sessionKey]);

  const scrollToBottom = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session || !hasTerminal(session.state)) return;
    session.state.terminal.scrollToBottom();
  }, [sessionKey]);

  const getDimensions = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session || !hasTerminal(session.state)) return null;
    return {
      rows: session.state.terminal.rows,
      cols: session.state.terminal.cols,
    };
  }, [sessionKey]);

  const findNext = useCallback(
    (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) => {
      const session = _getSession(sessionKey);
      if (!session?.addons?.searchAddon) return false;
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

  const findPrevious = useCallback(
    (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) => {
      const session = _getSession(sessionKey);
      if (!session?.addons?.searchAddon) return false;
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

  const clearSearch = useCallback(() => {
    const session = _getSession(sessionKey);
    if (!session?.addons?.searchAddon) return;
    session.addons.searchAddon.clearDecorations();
  }, [sessionKey]);

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
    if (session.onRenderDisposable) {
      session.onRenderDisposable.dispose();
    }

    // Dispose terminal - check for terminal in all states that might have it
    if (hasTerminal(session.state)) {
      session.state.terminal.dispose();
    } else if (session.state.phase === "error" && session.state.terminal) {
      // ✅ Handle error state with terminal
      session.state.terminal.dispose();
    }

    if (hasWebSocket(session.state)) {
      session.state.ws.close();
    }
    session.addons?.webglAddon?.dispose();

    _deleteSession(sessionKey);
  }, [sessionKey]);

  // xterm.js terminals can't be "reopened" to a new container - they're permanently attached
  // to the element passed to terminal.open(). When React remounts, we move the terminal element.
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRefObject.current = node;

      if (node) {
        const existingSession = _getSession(sessionKey);
        if (existingSession) {
          _updateSession(sessionKey, { container: node });

          // Move terminal element to new container if needed
          if (hasTerminal(existingSession.state)) {
            const terminal = existingSession.state.terminal;
            if (terminal.element && terminal.element.parentElement !== node) {
              node.appendChild(terminal.element);

              _updateSession(sessionKey, { terminalReady: false });

              const onRenderDisposable = terminal.onRender(() => {
                const currentSession = _getSession(sessionKey);
                if (!currentSession?.addons?.fitAddon) return;

                const proposed = currentSession.addons.fitAddon.proposeDimensions();
                const isValid =
                  proposed &&
                  Number.isFinite(proposed.cols) &&
                  Number.isFinite(proposed.rows) &&
                  proposed.cols >= SHELL_CONFIG.MIN_COLS &&
                  proposed.rows >= SHELL_CONFIG.MIN_ROWS;

                if (!isValid) return;

                _updateSession(sessionKey, {
                  terminalReady: true,
                  onRenderDisposable: null,
                });

                onRenderDisposable.dispose();

                try {
                  currentSession.addons.fitAddon.fit();
                } catch {
                  // Fit failed
                }
              });

              _updateSession(sessionKey, { onRenderDisposable });

              if (typeof terminal.refresh === "function") {
                terminal.refresh(0, terminal.rows - 1);
              }
            }
          }
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
            reconnectCallback: null,
            terminalReady: false,
            onRenderDisposable: null,
          });
        }
      }
    },
    [sessionKey],
  );

  useEffect(() => {
    if (!autoConnect) return;

    const session = _getSession(sessionKey);
    if (!session) return;

    const shouldConnect = session.container && session.state.phase === "idle" && !session.isConnecting;
    if (shouldConnect) {
      connect();
    }
  }, [autoConnect, sessionKey, connect, state.phase]);

  // Fit terminal when it becomes ready
  useEffect(() => {
    if (state.phase === "ready") {
      const timer = setTimeout(() => {
        fit();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [state.phase, fit]);

  // Register reconnect callback for external triggers (use ref to avoid infinite loops)
  const connectRef = useRef(connect);
  connectRef.current = connect;

  useEffect(() => {
    const stableReconnect = () => connectRef.current();
    _updateSession(sessionKey, { reconnectCallback: stableReconnect });
    return () => {
      _updateSession(sessionKey, { reconnectCallback: null });
    };
  }, [sessionKey]);

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
