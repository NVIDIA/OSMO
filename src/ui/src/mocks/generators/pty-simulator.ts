// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * PTY Session Manager for Terminal Mock
 *
 * Manages PTY session state for MSW HTTP handlers.
 * The actual PTY simulation (I/O, ANSI, streaming) happens in mock-ws-server.mjs.
 *
 * This module handles:
 * - Session creation (returns router_address, key for WebSocket connection)
 * - Session listing and lookup
 * - Session cleanup
 */

import { faker } from "@faker-js/faker";

// ============================================================================
// Types
// ============================================================================

export type PTYScenario =
  | "normal" // Normal interactive session
  | "nvidia-smi" // GPU monitoring output
  | "training" // ML training with progress
  | "fast-output" // High-speed log streaming
  | "colors" // Demonstrate all ANSI colors
  | "top" // Simulated top command (full-screen)
  | "disconnect"; // Simulates mid-session disconnect

export interface PTYSession {
  id: string;
  workflowName: string;
  taskName: string;
  shell: string;
  rows: number;
  cols: number;
  createdAt: Date;
  scenario: PTYScenario;
  isConnected: boolean;
}

// ============================================================================
// PTY Session Manager
// ============================================================================

export class PTYSimulator {
  private sessions: Map<string, PTYSession> = new Map();

  /**
   * Create a new PTY session
   * Returns session info for WebSocket connection
   */
  createSession(
    workflowName: string,
    taskName: string,
    shell: string = "/bin/bash",
    scenario: PTYScenario = "normal",
  ): PTYSession {
    const id = faker.string.uuid();

    const session: PTYSession = {
      id,
      workflowName,
      taskName,
      shell,
      rows: 24,
      cols: 80,
      createdAt: new Date(),
      scenario,
      isConnected: false, // Will be true when WebSocket connects
    };

    this.sessions.set(id, session);
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): PTYSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions for a workflow
   */
  getWorkflowSessions(workflowName: string): PTYSession[] {
    const sessions: PTYSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.workflowName === workflowName) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): PTYSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Mark session as connected (called when WebSocket connects)
   */
  markConnected(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.isConnected = true;
    return true;
  }

  /**
   * Mark session as disconnected
   */
  markDisconnected(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.isConnected = false;
    return true;
  }

  /**
   * Update session size
   */
  updateSize(sessionId: string, rows: number, cols: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.rows = rows;
    session.cols = cols;
    return true;
  }

  /**
   * Close and remove session
   */
  closeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Close all sessions for a workflow
   */
  closeWorkflowSessions(workflowName: string): number {
    let closed = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.workflowName === workflowName) {
        this.sessions.delete(id);
        closed++;
      }
    }
    return closed;
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const ptySimulator = new PTYSimulator();
