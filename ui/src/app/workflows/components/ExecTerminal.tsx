//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
"use client";

import React, { type FC, useCallback, useEffect, useRef, useState } from "react";

import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useWindowSize } from "usehooks-ts";

import { PageError } from "~/components/PageError";
import { TextInput } from "~/components/TextInput";
import { ExecWorkflowResponseSchema, OSMOErrorResponseSchema } from "~/models/workflows-model";
import { api } from "~/trpc/react";
import { updateALBCookies } from "~/utils/auth";

export interface ExecTerminalProps {
  workflowName?: string;
  task?: string;
  entryCommand?: string;
  onClose?: () => void;
}

interface TerminalKeyEvent {
  key: string;
  domEvent: KeyboardEvent;
}

interface Size {
  rows: number;
  cols: number;
}

const ExecTerminal: FC<ExecTerminalProps> = ({
  workflowName,
  task,
  entryCommand = "/bin/bash",
  onClose,
}: ExecTerminalProps) => {
  const mutation = api.workflows.exec.useMutation();
  const windowSize = useWindowSize();
  const divRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const prevWebSocket = useRef<WebSocket | undefined>(undefined);
  const [webSocket, setWebSocket] = useState<WebSocket | null>(null);
  const [terminalSize, setTerminalSize] = useState<Size | undefined>(undefined);
  const [terminal, setTerminal] = useState<Terminal | undefined>(undefined);
  const encoder = useRef(new TextEncoder());
  const searchAddOn = useRef(new SearchAddon());
  const [searchText, setSearchText] = useState("");
  const [socketUrl, setSocketUrl] = useState<string | undefined>(undefined);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);

  useEffect(() => {
    const loadExecMeta = async () => {
      if (workflowName && task) {
        await mutation.mutateAsync(
          {
            name: workflowName,
            task,
            entry_command: entryCommand,
          },
          {
            onSuccess: (response) => {
              try {
                const meta = ExecWorkflowResponseSchema.parse(response);

                setSocketUrl(`${meta.router_address}/api/router/exec/${workflowName}/client/${meta.key}`);
                setErrorText(undefined);

                updateALBCookies(meta.cookie);
              } catch {
                const parsedResponse = OSMOErrorResponseSchema.parse(response);
                setErrorText(parsedResponse.message ?? undefined);
              }
            },
          },
        );
      } else {
        setSocketUrl(undefined);
      }
    };

    void loadExecMeta();
    // If I add mutation to the dep array, I get an infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowName, task, entryCommand]);

  const sendMessage = useCallback(
    (message: string) => {
      if (webSocket?.readyState === 1) {
        webSocket?.send(encoder.current.encode(message));
      }
    },
    [webSocket],
  );

  const handleHotkeys = useCallback(
    (key: TerminalKeyEvent) => {
      if (key.domEvent.ctrlKey) {
        if (key.domEvent.key.toLocaleLowerCase() === "v") {
          navigator.clipboard
            .readText()
            .then((text) => {
              sendMessage(text);
            })
            .catch((err) => {
              console.error("Failed to read clipboard", err);
            });
        }
      }
    },
    [sendMessage],
  );

  useEffect(() => {
    if (containerRef.current && windowSize.height) {
      // React in local dev env will call useEffects twice - this will break the socket as it cannot be closed and reopened
      if (firstRender.current) {
        // Based on 14px monospace font
        const lineHeight = 14.3;
        const charWidth = 7.3;

        firstRender.current = false;

        const rect = containerRef.current.getBoundingClientRect();
        let verticalSpace = windowSize.height - 84 - rect.top;

        // If the screen is too small for the terminal, we'll make an 8 row terminal anyway and the user will have to scroll the screen
        if (verticalSpace < lineHeight * 8) {
          verticalSpace = lineHeight * 8;
        }

        setTerminalSize({
          rows: Math.floor(verticalSpace / lineHeight),
          cols: Math.floor((containerRef.current.clientWidth - 10) / charWidth),
        });
      }
    }
  }, [windowSize]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (socketUrl) {
      const socket = new WebSocket(socketUrl);
      socket.binaryType = "arraybuffer";

      socket.onopen = () => {
        // Don't set it until it's open otherwise attempts to write to it will fail
        setWebSocket(socket);

        terminal?.clear();
        timeout = setTimeout(() => {
          // Give it a bit of time to focus
          terminal?.focus();
        }, 500);
      };
    }

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [socketUrl, terminal]);

  useEffect(() => {
    if (terminalSize) {
      const localTerminal = new Terminal({
        rows: terminalSize.rows,
        cols: terminalSize.cols,
      });

      localTerminal.open(divRef.current!);
      localTerminal.options = {
        cursorBlink: true,
        fontSize: 12,
        theme: {
          background: "#000",
          foreground: "#fff",
        },
        minimumContrastRatio: 4.5,
        rightClickSelectsWord: true,
        screenReaderMode: true,
      };

      localTerminal.loadAddon(searchAddOn.current);

      setTerminal(localTerminal);
    }
  }, [terminalSize]);

  useEffect(() => {
    if (webSocket && terminal) {
      if (prevWebSocket.current) {
        prevWebSocket.current.close();
      }
      prevWebSocket.current = webSocket;

      const decoder = new TextDecoder();

      sendMessage(JSON.stringify({ Rows: terminalSize!.rows, Cols: terminalSize!.cols }));

      terminal.onData((key: string) => {
        sendMessage(key);
      });

      terminal.onKey((key: TerminalKeyEvent) => {
        handleHotkeys(key);
      });

      webSocket.onclose = () => {
        if (webSocket.url === socketUrl && onClose) {
          onClose();
        }
      };

      webSocket.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      webSocket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          terminal.write(decoder.decode(event.data));
        } else {
          terminal.write(String(event.data));
        }
      };
    }
  }, [handleHotkeys, onClose, sendMessage, socketUrl, terminal, terminalSize, webSocket]);

  const onSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    searchAddOn.current.findNext(searchText);
  };

  const findPrevious = () => {
    searchAddOn.current.findPrevious(searchText);
  };

  return (
    <div className="flex flex-col h-full w-full">
      {errorText ? (
        <PageError
          title="Error"
          errorMessage={errorText}
        />
      ) : (
        <>
          <div
            ref={containerRef}
            className="term-container w-full"
          >
            <div ref={divRef} />
          </div>
          <form onSubmit={onSearch}>
            <div className="grid grid-cols-[1fr_auto] p-3 gap-3">
              <TextInput
                id="terminal-search"
                autoFocus
                value={searchText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value)}
                aria-label="Search"
                placeholder="Search"
                className="w-full flex-1"
                type="search"
              />
              <div className="flex flex-row gap-3">
                <button
                  className="btn btn-primary"
                  type="submit"
                >
                  Find
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={findPrevious}
                >
                  Previous
                </button>
              </div>
            </div>
          </form>
        </>
      )}
    </div>
  );
};

export default React.memo(ExecTerminal);
