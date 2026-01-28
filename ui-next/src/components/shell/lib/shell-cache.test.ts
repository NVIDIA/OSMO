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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { _createSession, _updateSession, _getSession, _deleteSession, getAllSessions, hasSession } from "./shell-cache";
import type { CachedSession } from "./shell-cache";

describe("shell-cache", () => {
  // Create a test session factory
  const createTestSession = (key: string = "test-session"): CachedSession => ({
    key,
    workflowName: "test-workflow",
    taskName: "test-task",
    shell: "/bin/bash",
    state: { phase: "idle" },
    addons: null,
    container: null,
    isConnecting: false,
    backendTimeout: null,
    initialResizeSent: false,
    onDataDisposable: null,
  });

  beforeEach(() => {
    // Clear cache between tests
    getAllSessions().forEach((session) => _deleteSession(session.key));
  });

  describe("_createSession", () => {
    it("should create a new session", () => {
      const session = createTestSession();
      _createSession(session);

      expect(hasSession("test-session")).toBe(true);
      expect(_getSession("test-session")).toEqual(session);
    });

    it("should make session available in getAllSessions", () => {
      const session = createTestSession();
      _createSession(session);

      const allSessions = getAllSessions();
      expect(allSessions).toHaveLength(1);
      expect(allSessions[0]).toEqual(session);
    });

    it("should allow multiple sessions with different keys", () => {
      _createSession(createTestSession("session-1"));
      _createSession(createTestSession("session-2"));

      expect(hasSession("session-1")).toBe(true);
      expect(hasSession("session-2")).toBe(true);
      expect(getAllSessions()).toHaveLength(2);
    });
  });

  describe("_updateSession", () => {
    it("should update session immutably", () => {
      const session = createTestSession();
      _createSession(session);

      const originalSession = _getSession("test-session");

      _updateSession("test-session", { isConnecting: true });

      const updatedSession = _getSession("test-session");

      // Should be a different object (immutability)
      expect(updatedSession).not.toBe(originalSession);

      // Should have updated field
      expect(updatedSession?.isConnecting).toBe(true);

      // Should preserve other fields
      expect(updatedSession?.key).toBe("test-session");
      expect(updatedSession?.workflowName).toBe("test-workflow");
    });

    it("should update state immutably", () => {
      const session = createTestSession();
      _createSession(session);

      _updateSession("test-session", {
        state: {
          phase: "connecting",
          workflowName: "test-workflow",
          taskName: "test-task",
          shell: "/bin/bash",
          startedAt: Date.now(),
        },
      });

      const updated = _getSession("test-session");
      expect(updated?.state.phase).toBe("connecting");
    });

    it("should handle multiple field updates", () => {
      const session = createTestSession();
      _createSession(session);

      _updateSession("test-session", {
        isConnecting: true,
        initialResizeSent: true,
      });

      const updated = _getSession("test-session");
      expect(updated?.isConnecting).toBe(true);
      expect(updated?.initialResizeSent).toBe(true);
    });

    it("should warn when updating non-existent session", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      _updateSession("non-existent", { isConnecting: true });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cannot update non-existent session"));
      consoleSpy.mockRestore();
    });

    it("should not notify listeners if session doesn't exist", () => {
      // We can't directly test listeners without mocking, but we can test that
      // the session remains undefined
      _updateSession("non-existent", { isConnecting: true });
      expect(_getSession("non-existent")).toBeUndefined();
    });
  });

  describe("_deleteSession", () => {
    it("should remove session from cache", () => {
      const session = createTestSession();
      _createSession(session);

      expect(hasSession("test-session")).toBe(true);

      _deleteSession("test-session");

      expect(hasSession("test-session")).toBe(false);
      expect(_getSession("test-session")).toBeUndefined();
    });

    it("should remove from getAllSessions", () => {
      _createSession(createTestSession("session-1"));
      _createSession(createTestSession("session-2"));

      expect(getAllSessions()).toHaveLength(2);

      _deleteSession("session-1");

      const remaining = getAllSessions();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].key).toBe("session-2");
    });

    it("should be idempotent (no error if session doesn't exist)", () => {
      expect(() => _deleteSession("non-existent")).not.toThrow();
    });
  });

  describe("hasSession", () => {
    it("should return false for non-existent session", () => {
      expect(hasSession("non-existent")).toBe(false);
    });

    it("should return true for existing session", () => {
      _createSession(createTestSession());
      expect(hasSession("test-session")).toBe(true);
    });

    it("should return false after deletion", () => {
      _createSession(createTestSession());
      _deleteSession("test-session");
      expect(hasSession("test-session")).toBe(false);
    });
  });

  describe("getAllSessions", () => {
    it("should return empty array when no sessions", () => {
      expect(getAllSessions()).toEqual([]);
    });

    it("should return all sessions", () => {
      _createSession(createTestSession("session-1"));
      _createSession(createTestSession("session-2"));
      _createSession(createTestSession("session-3"));

      const allSessions = getAllSessions();
      expect(allSessions).toHaveLength(3);
      expect(allSessions.map((s) => s.key)).toEqual(expect.arrayContaining(["session-1", "session-2", "session-3"]));
    });

    it("should return a snapshot (mutations don't affect returned array)", () => {
      _createSession(createTestSession("session-1"));

      const snapshot1 = getAllSessions();
      expect(snapshot1).toHaveLength(1);

      _createSession(createTestSession("session-2"));

      // Original snapshot unchanged
      expect(snapshot1).toHaveLength(1);

      // New snapshot has both
      const snapshot2 = getAllSessions();
      expect(snapshot2).toHaveLength(2);
    });
  });

  describe("_getSession", () => {
    it("should return undefined for non-existent session", () => {
      expect(_getSession("non-existent")).toBeUndefined();
    });

    it("should return session for existing key", () => {
      const session = createTestSession();
      _createSession(session);

      expect(_getSession("test-session")).toEqual(session);
    });

    it("should return updated session after update", () => {
      const session = createTestSession();
      _createSession(session);

      _updateSession("test-session", { isConnecting: true });

      const retrieved = _getSession("test-session");
      expect(retrieved?.isConnecting).toBe(true);
    });
  });

  describe("immutability", () => {
    it("should create new objects on update", () => {
      const session = createTestSession();
      _createSession(session);

      const before = _getSession("test-session");
      _updateSession("test-session", { isConnecting: true });
      const after = _getSession("test-session");

      // Different object references
      expect(before).not.toBe(after);

      // Original unchanged
      expect(before?.isConnecting).toBe(false);

      // New object has update
      expect(after?.isConnecting).toBe(true);
    });
  });
});
