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
 * Shell Session Isolation Tests
 *
 * This suite verifies that multiple shell sessions NEVER bleed data or state
 * across boundaries. Each session must be completely isolated with its own:
 * - Terminal instance and buffer
 * - WebSocket connection
 * - State machine state
 * - Event handlers
 * - Search addon state
 *
 * Critical requirement: Switching between shells should ONLY show that shell's
 * history, never another shell's data.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import {
  _createSession,
  _updateSession,
  _getSession,
  _deleteSession,
  getAllSessions,
  hasSession,
} from "@/components/shell/lib/shell-cache";
import type { CachedSession } from "@/components/shell/lib/shell-cache";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";

// Mock terminal type for testing
interface MockTerminal {
  id: string;
  write: Mock;
  clear: Mock;
  dispose: Mock;
  focus: Mock;
  rows: number;
  cols: number;
  hasSelection: Mock;
  getSelection: Mock;
  buffer: {
    active: {
      viewportY: number;
      baseY: number;
      length: number;
    };
  };
}

// Mock WebSocket type for testing
interface MockWebSocket {
  url: string;
  readyState: number;
  send: Mock;
  close: Mock;
}

// Mock addons type for testing
interface MockAddons {
  fitAddon: {
    fit: Mock;
    proposeDimensions: Mock;
  };
  searchAddon: {
    findNext: Mock;
    findPrevious: Mock;
    clearDecorations: Mock;
  };
  webglAddon: null;
}

describe("Shell Session Isolation", () => {
  // Mock terminal instances
  const createMockTerminal = (id: string): MockTerminal => ({
    id,
    write: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    focus: vi.fn(),
    hasSelection: vi.fn(),
    getSelection: vi.fn(),
    rows: 24,
    cols: 80,
    buffer: {
      active: {
        viewportY: 0,
        baseY: 0,
        length: 100,
      },
    },
  });

  // Mock WebSocket instances
  const createMockWebSocket = (url: string): MockWebSocket => ({
    url,
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
  });

  // Helper to cast mock types to real types for testing
  const asMockTerminal = (mock: MockTerminal): Terminal => mock as unknown as Terminal;
  const asMockWebSocket = (mock: MockWebSocket): WebSocket => mock as unknown as WebSocket;
  const asMockAddons = (mock: MockAddons) =>
    mock as unknown as { fitAddon: FitAddon; searchAddon: SearchAddon; webglAddon: null };

  // Helper to create test session
  const createTestSession = (taskId: string, taskName: string): CachedSession => ({
    key: taskId,
    workflowName: "test-workflow",
    taskName,
    shell: "/bin/bash",
    state: { phase: "idle" },
    addons: null,
    container: null,
    isConnecting: false,
    backendTimeout: null,
    initialResizeSent: false,
    onDataDisposable: null,
    reconnectCallback: null,
    terminalReady: false,
    onRenderDisposable: null,
  });

  beforeEach(() => {
    // Clear all sessions before each test
    getAllSessions().forEach((session) => _deleteSession(session.key));
  });

  describe("Session Key Uniqueness", () => {
    it("should maintain separate sessions with different taskIds", () => {
      const session1 = createTestSession("task-1", "task-one");
      const session2 = createTestSession("task-2", "task-two");

      _createSession(session1);
      _createSession(session2);

      expect(hasSession("task-1")).toBe(true);
      expect(hasSession("task-2")).toBe(true);

      const retrieved1 = _getSession("task-1");
      const retrieved2 = _getSession("task-2");

      expect(retrieved1?.taskName).toBe("task-one");
      expect(retrieved2?.taskName).toBe("task-two");
      expect(retrieved1).not.toBe(retrieved2);
    });

    it("should allow same taskName in different workflows with different taskIds", () => {
      const session1: CachedSession = {
        ...createTestSession("uuid-1", "worker-task"),
        workflowName: "workflow-A",
      };
      const session2: CachedSession = {
        ...createTestSession("uuid-2", "worker-task"),
        workflowName: "workflow-B",
      };

      _createSession(session1);
      _createSession(session2);

      const retrieved1 = _getSession("uuid-1");
      const retrieved2 = _getSession("uuid-2");

      expect(retrieved1?.workflowName).toBe("workflow-A");
      expect(retrieved2?.workflowName).toBe("workflow-B");
      expect(retrieved1?.taskName).toBe("worker-task");
      expect(retrieved2?.taskName).toBe("worker-task");
    });
  });

  describe("Terminal Instance Isolation", () => {
    it("should maintain separate terminal instances per session", () => {
      const terminal1 = createMockTerminal("term-1");
      const terminal2 = createMockTerminal("term-2");

      const session1 = createTestSession("task-1", "task-one");
      const session2 = createTestSession("task-2", "task-two");

      _createSession(session1);
      _createSession(session2);

      // Update sessions with different terminals
      _updateSession("task-1", {
        state: {
          phase: "ready",
          workflowName: "test-workflow",
          taskName: "task-one",
          terminal: asMockTerminal(terminal1),
          ws: asMockWebSocket(createMockWebSocket("ws://test-1")),
          connectedAt: Date.now(),
        },
      });

      _updateSession("task-2", {
        state: {
          phase: "ready",
          workflowName: "test-workflow",
          taskName: "task-two",
          terminal: asMockTerminal(terminal2),
          ws: asMockWebSocket(createMockWebSocket("ws://test-2")),
          connectedAt: Date.now(),
        },
      });

      const retrieved1 = _getSession("task-1");
      const retrieved2 = _getSession("task-2");

      expect(retrieved1?.state.phase).toBe("ready");
      expect(retrieved2?.state.phase).toBe("ready");

      if (retrieved1?.state.phase === "ready" && retrieved2?.state.phase === "ready") {
        // Verify terminals are different instances
        expect(retrieved1.state.terminal).not.toBe(retrieved2.state.terminal);
        expect((retrieved1.state.terminal as unknown as MockTerminal).id).toBe("term-1");
        expect((retrieved2.state.terminal as unknown as MockTerminal).id).toBe("term-2");

        // Verify writing to terminal1 doesn't affect terminal2
        (retrieved1.state.terminal as unknown as MockTerminal).write("session-1-data");
        expect((retrieved1.state.terminal as unknown as MockTerminal).write).toHaveBeenCalledWith("session-1-data");
        expect((retrieved2.state.terminal as unknown as MockTerminal).write).not.toHaveBeenCalled();
      }
    });

    it("should preserve terminal instance during reconnection (same session)", () => {
      const terminal = createMockTerminal("term-persistent");
      const session = createTestSession("task-1", "task-one");

      _createSession(session);

      // Initial connection
      _updateSession("task-1", {
        state: {
          phase: "ready",
          workflowName: "test-workflow",
          taskName: "task-one",
          terminal: asMockTerminal(terminal),
          ws: asMockWebSocket(createMockWebSocket("ws://test-1")),
          connectedAt: Date.now(),
        },
      });

      const afterConnect = _getSession("task-1");
      const terminalRef1 =
        afterConnect?.state.phase === "ready" ? (afterConnect.state.terminal as unknown as MockTerminal).id : null;

      // Disconnect
      _updateSession("task-1", {
        state: {
          phase: "disconnected",
          workflowName: "test-workflow",
          taskName: "task-one",
          terminal: asMockTerminal(terminal),
        },
      });

      // Reconnect
      _updateSession("task-1", {
        state: {
          phase: "ready",
          workflowName: "test-workflow",
          taskName: "task-one",
          terminal: asMockTerminal(terminal),
          ws: asMockWebSocket(createMockWebSocket("ws://test-reconnect")),
          connectedAt: Date.now(),
        },
      });

      const afterReconnect = _getSession("task-1");
      const terminalRef2 =
        afterReconnect?.state.phase === "ready" ? (afterReconnect.state.terminal as unknown as MockTerminal).id : null;

      // Terminal should be SAME instance (preserves history)
      expect(terminalRef1).toBe("term-persistent");
      expect(terminalRef2).toBe("term-persistent");
    });
  });

  describe("WebSocket Isolation", () => {
    it("should maintain separate WebSocket connections per session", () => {
      const ws1 = createMockWebSocket("ws://session-1");
      const ws2 = createMockWebSocket("ws://session-2");

      const session1 = createTestSession("task-1", "task-one");
      const session2 = createTestSession("task-2", "task-two");

      _createSession(session1);
      _createSession(session2);

      _updateSession("task-1", {
        state: {
          phase: "ready",
          workflowName: "test-workflow",
          taskName: "task-one",
          terminal: asMockTerminal(createMockTerminal("term-1")),
          ws: asMockWebSocket(ws1),
          connectedAt: Date.now(),
        },
      });

      _updateSession("task-2", {
        state: {
          phase: "ready",
          workflowName: "test-workflow",
          taskName: "task-two",
          terminal: asMockTerminal(createMockTerminal("term-2")),
          ws: asMockWebSocket(ws2),
          connectedAt: Date.now(),
        },
      });

      const retrieved1 = _getSession("task-1");
      const retrieved2 = _getSession("task-2");

      if (retrieved1?.state.phase === "ready" && retrieved2?.state.phase === "ready") {
        // Verify WebSockets are different instances
        expect(retrieved1.state.ws).not.toBe(retrieved2.state.ws);
        expect((retrieved1.state.ws as unknown as MockWebSocket).url).toBe("ws://session-1");
        expect((retrieved2.state.ws as unknown as MockWebSocket).url).toBe("ws://session-2");

        // Verify sending to ws1 doesn't affect ws2
        (retrieved1.state.ws as unknown as MockWebSocket).send("data-1");
        expect((retrieved1.state.ws as unknown as MockWebSocket).send).toHaveBeenCalledWith("data-1");
        expect((retrieved2.state.ws as unknown as MockWebSocket).send).not.toHaveBeenCalled();
      }
    });

    it("should allow closing one WebSocket without affecting others", () => {
      const ws1 = createMockWebSocket("ws://session-1");
      const ws2 = createMockWebSocket("ws://session-2");

      const session1 = createTestSession("task-1", "task-one");
      const session2 = createTestSession("task-2", "task-two");

      _createSession(session1);
      _createSession(session2);

      _updateSession("task-1", {
        state: {
          phase: "ready",
          workflowName: "test-workflow",
          taskName: "task-one",
          terminal: asMockTerminal(createMockTerminal("term-1")),
          ws: asMockWebSocket(ws1),
          connectedAt: Date.now(),
        },
      });

      _updateSession("task-2", {
        state: {
          phase: "ready",
          workflowName: "test-workflow",
          taskName: "task-two",
          terminal: asMockTerminal(createMockTerminal("term-2")),
          ws: asMockWebSocket(ws2),
          connectedAt: Date.now(),
        },
      });

      // Close ws1
      const session1Before = _getSession("task-1");
      if (session1Before?.state.phase === "ready") {
        (session1Before.state.ws as unknown as MockWebSocket).close();
      }

      _updateSession("task-1", {
        state: {
          phase: "disconnected",
          workflowName: "test-workflow",
          taskName: "task-one",
          terminal: asMockTerminal(createMockTerminal("term-1")),
        },
      });

      // Verify session1 is disconnected
      const session1After = _getSession("task-1");
      expect(session1After?.state.phase).toBe("disconnected");

      // Verify session2 is still connected
      const session2After = _getSession("task-2");
      expect(session2After?.state.phase).toBe("ready");
      if (session2After?.state.phase === "ready") {
        expect((session2After.state.ws as unknown as MockWebSocket).url).toBe("ws://session-2");
      }
    });
  });

  describe("State Machine Isolation", () => {
    it("should maintain independent state for each session", () => {
      const session1 = createTestSession("task-1", "task-one");
      const session2 = createTestSession("task-2", "task-two");

      _createSession(session1);
      _createSession(session2);

      // Transition session1 to connecting
      _updateSession("task-1", {
        state: {
          phase: "connecting",
          workflowName: "test-workflow",
          taskName: "task-one",
          shell: "/bin/bash",
          startedAt: Date.now(),
        },
      });

      // Transition session2 to ready
      _updateSession("task-2", {
        state: {
          phase: "ready",
          workflowName: "test-workflow",
          taskName: "task-two",
          terminal: asMockTerminal(createMockTerminal("term-2")),
          ws: asMockWebSocket(createMockWebSocket("ws://test-2")),
          connectedAt: Date.now(),
        },
      });

      const retrieved1 = _getSession("task-1");
      const retrieved2 = _getSession("task-2");

      // Verify independent states
      expect(retrieved1?.state.phase).toBe("connecting");
      expect(retrieved2?.state.phase).toBe("ready");
    });

    it("should handle errors in one session without affecting others", () => {
      const session1 = createTestSession("task-1", "task-one");
      const session2 = createTestSession("task-2", "task-two");

      _createSession(session1);
      _createSession(session2);

      // Session1 encounters error
      _updateSession("task-1", {
        state: {
          phase: "error",
          error: "Connection failed",
        },
      });

      // Session2 is ready
      _updateSession("task-2", {
        state: {
          phase: "ready",
          workflowName: "test-workflow",
          taskName: "task-two",
          terminal: asMockTerminal(createMockTerminal("term-2")),
          ws: asMockWebSocket(createMockWebSocket("ws://test-2")),
          connectedAt: Date.now(),
        },
      });

      const retrieved1 = _getSession("task-1");
      const retrieved2 = _getSession("task-2");

      expect(retrieved1?.state.phase).toBe("error");
      expect(retrieved2?.state.phase).toBe("ready");

      if (retrieved1?.state.phase === "error") {
        expect(retrieved1.state.error).toBe("Connection failed");
      }
    });
  });

  describe("Addon Isolation", () => {
    it("should maintain separate addons per session", () => {
      const addons1 = {
        fitAddon: { fit: vi.fn(), proposeDimensions: vi.fn() },
        searchAddon: {
          findNext: vi.fn(),
          findPrevious: vi.fn(),
          clearDecorations: vi.fn(),
        },
        webglAddon: null,
      };

      const addons2 = {
        fitAddon: { fit: vi.fn(), proposeDimensions: vi.fn() },
        searchAddon: {
          findNext: vi.fn(),
          findPrevious: vi.fn(),
          clearDecorations: vi.fn(),
        },
        webglAddon: null,
      };

      const session1 = createTestSession("task-1", "task-one");
      const session2 = createTestSession("task-2", "task-two");

      _createSession(session1);
      _createSession(session2);

      _updateSession("task-1", { addons: asMockAddons(addons1) });
      _updateSession("task-2", { addons: asMockAddons(addons2) });

      const retrieved1 = _getSession("task-1");
      const retrieved2 = _getSession("task-2");

      // Verify addons are different instances
      expect(retrieved1?.addons).not.toBe(retrieved2?.addons);
      expect(retrieved1?.addons?.fitAddon).not.toBe(retrieved2?.addons?.fitAddon);
      expect(retrieved1?.addons?.searchAddon).not.toBe(retrieved2?.addons?.searchAddon);

      // Verify calling addon methods doesn't cross sessions
      retrieved1?.addons?.searchAddon.findNext("query-1");
      expect(retrieved1?.addons?.searchAddon.findNext).toHaveBeenCalledWith("query-1");
      expect(retrieved2?.addons?.searchAddon.findNext).not.toHaveBeenCalled();
    });
  });

  describe("Container Isolation", () => {
    it("should allow different containers per session", () => {
      const container1 = document.createElement("div");
      container1.id = "container-1";
      const container2 = document.createElement("div");
      container2.id = "container-2";

      const session1 = createTestSession("task-1", "task-one");
      const session2 = createTestSession("task-2", "task-two");

      _createSession(session1);
      _createSession(session2);

      _updateSession("task-1", { container: container1 });
      _updateSession("task-2", { container: container2 });

      const retrieved1 = _getSession("task-1");
      const retrieved2 = _getSession("task-2");

      expect(retrieved1?.container).not.toBe(retrieved2?.container);
      expect((retrieved1?.container as HTMLDivElement)?.id).toBe("container-1");
      expect((retrieved2?.container as HTMLDivElement)?.id).toBe("container-2");
    });
  });

  describe("Cleanup Isolation", () => {
    it("should allow deleting one session without affecting others", () => {
      const session1 = createTestSession("task-1", "task-one");
      const session2 = createTestSession("task-2", "task-two");
      const session3 = createTestSession("task-3", "task-three");

      _createSession(session1);
      _createSession(session2);
      _createSession(session3);

      expect(getAllSessions()).toHaveLength(3);

      // Delete session2
      _deleteSession("task-2");

      expect(hasSession("task-1")).toBe(true);
      expect(hasSession("task-2")).toBe(false);
      expect(hasSession("task-3")).toBe(true);
      expect(getAllSessions()).toHaveLength(2);
    });

    it("should allow cleaning up session resources independently", () => {
      const timeout1 = setTimeout(() => {}, 1000);
      const timeout2 = setTimeout(() => {}, 1000);
      const disposable1 = { dispose: vi.fn() };
      const disposable2 = { dispose: vi.fn() };

      const session1 = createTestSession("task-1", "task-one");
      const session2 = createTestSession("task-2", "task-two");

      _createSession(session1);
      _createSession(session2);

      _updateSession("task-1", {
        backendTimeout: timeout1,
        onDataDisposable: disposable1,
      });

      _updateSession("task-2", {
        backendTimeout: timeout2,
        onDataDisposable: disposable2,
      });

      // Clean up session1
      const s1 = _getSession("task-1");
      if (s1?.backendTimeout) clearTimeout(s1.backendTimeout);
      if (s1?.onDataDisposable) s1.onDataDisposable.dispose();
      _deleteSession("task-1");

      // Verify session1 cleanup was called
      expect(disposable1.dispose).toHaveBeenCalled();

      // Verify session2 still exists and wasn't cleaned up
      const s2 = _getSession("task-2");
      expect(s2).toBeDefined();
      expect(disposable2.dispose).not.toHaveBeenCalled();

      // Cleanup
      clearTimeout(timeout2);
    });
  });

  describe("Immutability Guarantees", () => {
    it("should not share object references between sessions", () => {
      const session1 = createTestSession("task-1", "task-one");
      const session2 = createTestSession("task-2", "task-two");

      _createSession(session1);
      _createSession(session2);

      const retrieved1 = _getSession("task-1");
      const retrieved2 = _getSession("task-2");

      // Sessions should be completely separate objects
      expect(retrieved1).not.toBe(retrieved2);
      expect(retrieved1?.state).not.toBe(retrieved2?.state);

      // Mutating one session's state shouldn't affect the other
      _updateSession("task-1", { isConnecting: true });
      const updated1 = _getSession("task-1");
      const updated2 = _getSession("task-2");

      expect(updated1?.isConnecting).toBe(true);
      expect(updated2?.isConnecting).toBe(false);
    });

    it("should create new objects on update (immutable updates)", () => {
      const session = createTestSession("task-1", "task-one");
      _createSession(session);

      const before = _getSession("task-1");
      _updateSession("task-1", { isConnecting: true });
      const after = _getSession("task-1");

      // Should be different object references (immutable update)
      expect(before).not.toBe(after);

      // Original should be unchanged
      expect(before?.isConnecting).toBe(false);

      // New object should have update
      expect(after?.isConnecting).toBe(true);
    });
  });

  describe("Real-World Scenario: Multiple Active Shells", () => {
    it("should handle 3 concurrent shell sessions without cross-contamination", () => {
      // Scenario: User has 3 shells open for different tasks in same workflow
      const terminal1 = createMockTerminal("term-1");
      const terminal2 = createMockTerminal("term-2");
      const terminal3 = createMockTerminal("term-3");

      const ws1 = createMockWebSocket("ws://task-1");
      const ws2 = createMockWebSocket("ws://task-2");
      const ws3 = createMockWebSocket("ws://task-3");

      // Create sessions
      _createSession(createTestSession("task-1", "preprocessing"));
      _createSession(createTestSession("task-2", "training"));
      _createSession(createTestSession("task-3", "evaluation"));

      // Connect all three
      _updateSession("task-1", {
        state: {
          phase: "ready",
          workflowName: "ml-pipeline",
          taskName: "preprocessing",
          terminal: asMockTerminal(terminal1),
          ws: asMockWebSocket(ws1),
          connectedAt: Date.now(),
        },
      });

      _updateSession("task-2", {
        state: {
          phase: "ready",
          workflowName: "ml-pipeline",
          taskName: "training",
          terminal: asMockTerminal(terminal2),
          ws: asMockWebSocket(ws2),
          connectedAt: Date.now(),
        },
      });

      _updateSession("task-3", {
        state: {
          phase: "ready",
          workflowName: "ml-pipeline",
          taskName: "evaluation",
          terminal: asMockTerminal(terminal3),
          ws: asMockWebSocket(ws3),
          connectedAt: Date.now(),
        },
      });

      // Simulate user interacting with each shell
      const s1 = _getSession("task-1");
      const s2 = _getSession("task-2");
      const s3 = _getSession("task-3");

      // Write to each terminal
      if (s1?.state.phase === "ready") {
        (s1.state.terminal as unknown as MockTerminal).write("preprocessing output\n");
      }
      if (s2?.state.phase === "ready") {
        (s2.state.terminal as unknown as MockTerminal).write("training output\n");
      }
      if (s3?.state.phase === "ready") {
        (s3.state.terminal as unknown as MockTerminal).write("evaluation output\n");
      }

      // Verify each terminal got its own data
      expect(terminal1.write).toHaveBeenCalledWith("preprocessing output\n");
      expect(terminal1.write).not.toHaveBeenCalledWith("training output\n");
      expect(terminal1.write).not.toHaveBeenCalledWith("evaluation output\n");

      expect(terminal2.write).toHaveBeenCalledWith("training output\n");
      expect(terminal2.write).not.toHaveBeenCalledWith("preprocessing output\n");
      expect(terminal2.write).not.toHaveBeenCalledWith("evaluation output\n");

      expect(terminal3.write).toHaveBeenCalledWith("evaluation output\n");
      expect(terminal3.write).not.toHaveBeenCalledWith("preprocessing output\n");
      expect(terminal3.write).not.toHaveBeenCalledWith("training output\n");

      // Disconnect one shell, verify others unaffected
      if (s2?.state.phase === "ready") {
        (s2.state.ws as unknown as MockWebSocket).close();
      }

      _updateSession("task-2", {
        state: {
          phase: "disconnected",
          workflowName: "ml-pipeline",
          taskName: "training",
          terminal: asMockTerminal(terminal2),
        },
      });

      const s1After = _getSession("task-1");
      const s2After = _getSession("task-2");
      const s3After = _getSession("task-3");

      expect(s1After?.state.phase).toBe("ready");
      expect(s2After?.state.phase).toBe("disconnected");
      expect(s3After?.state.phase).toBe("ready");
    });
  });
});
