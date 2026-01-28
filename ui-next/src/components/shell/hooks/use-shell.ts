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

import { useRef, useState, useCallback, useEffect } from "react";
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
import {
  getSession,
  createSession,
  updateState,
  updateAddons,
  updateContainer,
  deleteSession,
} from "../lib/shell-cache";
import { SHELL_CONFIG, SHELL_THEME } from "../lib/types";

import "@xterm/xterm/css/xterm.css";

export interface UseShellOptions {
  sessionKey?: string;
  workflowName: string;
  taskName: string;
  shell?: string;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export interface UseShellReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  state: ShellState;
  connect: () => Promise<void>;
  disconnect: () => void;
  send: (data: string) => void;
  write: (data: string | Uint8Array) => void;
  focus: () => void;
  fit: () => void;
  clear: () => void;
  getDimensions: () => { rows: number; cols: number } | null;
  findNext: (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) => boolean;
  findPrevious: (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) => boolean;
  clearSearch: () => void;
  dispose: () => void;
}

const sharedEncoder = new TextEncoder();

export function useShell(options: UseShellOptions): UseShellReturn {
  const { sessionKey, workflowName, taskName, shell = SHELL_CONFIG.DEFAULT_SHELL, onData, onResize } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const cachedSession = sessionKey ? getSession(sessionKey) : undefined;
  const [localState, setLocalState] = useState<ShellState>({ phase: "idle" });
  const state = cachedSession?.state ?? localState;

  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  useEffect(() => {
    onDataRef.current = onData;
    onResizeRef.current = onResize;
  });

  // Backend bug workaround: track if initial resize was sent
  const initialResizeSentRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const execMutation = useExecIntoTask();

  const dispatch = useCallback(
    (event: ShellEvent) => {
      const currentState = cachedSession?.state ?? localState;
      const nextState = transition(currentState, event);
      console.debug(`[Shell] ${currentState.phase} + ${event.type} → ${nextState.phase}`, nextState);

      if (sessionKey && cachedSession) {
        updateState(sessionKey, nextState);
      } else {
        setLocalState(nextState);
      }
    },
    [sessionKey, cachedSession, localState],
  );

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

    if (onDataRef.current) {
      terminal.onData(onDataRef.current);
    }

    return {
      terminal,
      addons: { fitAddon, searchAddon, webglAddon },
    };
  }, []);

  const setupWebSocketHandlers = useCallback(
    (ws: WebSocket, terminal: Terminal) => {
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        dispatch({ type: "WS_OPENED", ws });

        requestAnimationFrame(() => {
          const dims = { rows: terminal.rows, cols: terminal.cols };
          if (dims.rows >= SHELL_CONFIG.MIN_ROWS && dims.cols >= SHELL_CONFIG.MIN_COLS) {
            const msg = JSON.stringify({ Rows: dims.rows, Cols: dims.cols });
            ws.send(sharedEncoder.encode(msg));
            initialResizeSentRef.current = true;
          }
        });

        timeoutRef.current = setTimeout(() => {
          dispatch({ type: "TIMEOUT" });
        }, SHELL_CONFIG.BACKEND_INIT_TIMEOUT_MS);
      };

      ws.onmessage = (event) => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
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
        terminal.write(data);
      };

      ws.onclose = () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        dispatch({ type: "WS_CLOSED" });
      };

      ws.onerror = () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        dispatch({ type: "WS_ERROR", error: "WebSocket connection failed" });
      };
    },
    [dispatch],
  );

  const connect = useCallback(async () => {
    if (state.phase !== "idle") {
      console.warn("[Shell] Cannot connect: already connecting or connected");
      return;
    }

    dispatch({ type: "CONNECT", workflowName, taskName, shell });

    try {
      initialResizeSentRef.current = false;

      const response = await execMutation.mutateAsync({
        name: workflowName,
        taskName: taskName,
        params: { entry_command: shell },
      });

      // ALB cookies must be set before WebSocket connection
      if (response.cookie) {
        updateALBCookies(response.cookie);
      }

      const container = containerRef.current;
      if (!container) {
        dispatch({ type: "API_ERROR", error: "Container not found" });
        return;
      }

      const { terminal, addons } = createTerminal(container);

      if (sessionKey) {
        updateAddons(sessionKey, addons);
        updateContainer(sessionKey, container);
      }

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const routerAddress = response.router_address.replace(/^https?:/, wsProtocol);
      const wsUrl = `${routerAddress}/api/router/exec/${workflowName}/client/${response.key}`;

      console.debug("[Shell] Connecting to PTY:", { wsUrl, sessionKey });
      dispatch({ type: "API_SUCCESS", terminal, wsUrl });

      const ws = new WebSocket(wsUrl);
      setupWebSocketHandlers(ws, terminal);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to create exec session";
      dispatch({ type: "API_ERROR", error });
    }
  }, [
    state.phase,
    dispatch,
    workflowName,
    taskName,
    shell,
    execMutation,
    sessionKey,
    createTerminal,
    setupWebSocketHandlers,
  ]);

  const disconnect = useCallback(() => {
    if (hasWebSocket(state)) {
      state.ws.close();
    }
    dispatch({ type: "DISCONNECT" });
  }, [state, dispatch]);

  const send = useCallback(
    (data: string) => {
      if (!hasWebSocket(state) || state.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      state.ws.send(sharedEncoder.encode(data));
    },
    [state],
  );

  const write = useCallback(
    (data: string | Uint8Array) => {
      if (hasTerminal(state)) {
        state.terminal.write(data);
      }
    },
    [state],
  );

  const focus = useCallback(() => {
    if (hasTerminal(state)) {
      state.terminal.focus();
    }
  }, [state]);

  const clear = useCallback(() => {
    if (hasTerminal(state)) {
      state.terminal.clear();
    }
  }, [state]);

  const getDimensions = useCallback(() => {
    if (!hasTerminal(state)) return null;
    return { rows: state.terminal.rows, cols: state.terminal.cols };
  }, [state]);

  const fit = useCallback(() => {
    if (!sessionKey) return;
    const session = getSession(sessionKey);
    if (!session?.addons) return;

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

  const debouncedFit = useDebounceCallback(fit, SHELL_CONFIG.RESIZE_DEBOUNCE_MS);

  useResizeObserver({
    ref: containerRef as React.RefObject<HTMLElement>,
    onResize: debouncedFit,
  });

  const findNext = useCallback(
    (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) => {
      if (!sessionKey) return false;
      const session = getSession(sessionKey);
      if (!session?.addons) return false;

      return session.addons.searchAddon.findNext(query, {
        caseSensitive: options?.caseSensitive,
        wholeWord: options?.wholeWord,
        regex: options?.regex,
      });
    },
    [sessionKey],
  );

  const findPrevious = useCallback(
    (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) => {
      if (!sessionKey) return false;
      const session = getSession(sessionKey);
      if (!session?.addons) return false;

      return session.addons.searchAddon.findPrevious(query, {
        caseSensitive: options?.caseSensitive,
        wholeWord: options?.wholeWord,
        regex: options?.regex,
      });
    },
    [sessionKey],
  );

  const clearSearch = useCallback(() => {
    if (!sessionKey) return;
    const session = getSession(sessionKey);
    if (!session?.addons) return;

    session.addons.searchAddon.clearDecorations();
  }, [sessionKey]);

  const dispose = useCallback(() => {
    if (sessionKey) {
      deleteSession(sessionKey);
    }
  }, [sessionKey]);

  // Initialize session in cache
  useEffect(() => {
    if (!sessionKey || cachedSession) return;

    createSession({
      key: sessionKey,
      workflowName,
      taskName,
      shell,
      state: { phase: "idle" },
      addons: null,
      container: containerRef.current,
    });
  }, [sessionKey, cachedSession, workflowName, taskName, shell]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    containerRef,
    state,
    connect,
    disconnect,
    send,
    write,
    focus,
    fit,
    clear,
    getDimensions,
    findNext,
    findPrevious,
    clearSearch,
    dispose,
  };
}
