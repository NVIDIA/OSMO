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
 * Port Forward Generator
 *
 * Generates port forwarding session data for remote access features.
 */

import { faker } from "@faker-js/faker";
import { hashString } from "@/mocks/utils";

// ============================================================================
// Types
// ============================================================================

export interface GeneratedPortForwardSession {
  session_id: string;
  workflow_name: string;
  task_name: string;
  local_port: number;
  remote_port: number;
  target_host: string;
  router_address: string;
  status: "CONNECTING" | "ACTIVE" | "DISCONNECTED" | "FAILED";
  created_at: string;
  expires_at: string;
  access_url: string;
}

export interface GeneratedPortForwardRequest {
  workflow_name: string;
  task_name: string;
  remote_port: number;
}

export interface GeneratedPortForwardResponse {
  success: boolean;
  session_id?: string;
  router_address?: string;
  access_url?: string;
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const PORT_FORWARD_PATTERNS = {
  commonPorts: [
    { port: 8080, service: "HTTP Server" },
    { port: 8888, service: "Jupyter Lab" },
    { port: 6006, service: "TensorBoard" },
    { port: 5000, service: "Flask App" },
    { port: 3000, service: "React Dev Server" },
    { port: 8000, service: "FastAPI" },
    { port: 7860, service: "Gradio" },
  ],
  routerDomains: ["pf.osmo.nvidia.com", "tunnel.osmo.nvidia.com", "access.osmo.nvidia.com"],
};

// ============================================================================
// Generator Class
// ============================================================================

export class PortForwardGenerator {
  private baseSeed: number;
  private activeSessions: Map<string, GeneratedPortForwardSession> = new Map();

  constructor(baseSeed: number = 77777) {
    this.baseSeed = baseSeed;
  }

  /**
   * Create a new port forward session
   */
  createSession(workflowName: string, taskName: string, remotePort: number): GeneratedPortForwardResponse {
    faker.seed(this.baseSeed + hashString(workflowName + taskName + remotePort));

    // Simulate occasional failures
    if (faker.datatype.boolean({ probability: 0.1 })) {
      return {
        success: false,
        error: faker.helpers.arrayElement([
          "Task is not running",
          "Port already in use",
          "Connection timeout",
          "Insufficient permissions",
        ]),
      };
    }

    const sessionId = faker.string.uuid();
    const routerDomain = faker.helpers.arrayElement(PORT_FORWARD_PATTERNS.routerDomains);
    const sessionPath = faker.string.alphanumeric(16).toLowerCase();

    const session: GeneratedPortForwardSession = {
      session_id: sessionId,
      workflow_name: workflowName,
      task_name: taskName,
      local_port: faker.number.int({ min: 10000, max: 60000 }),
      remote_port: remotePort,
      target_host: `${workflowName}-${taskName}.default.svc.cluster.local`,
      router_address: `${routerDomain}/${sessionPath}`,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      access_url: `https://${routerDomain}/${sessionPath}`,
    };

    this.activeSessions.set(sessionId, session);

    return {
      success: true,
      session_id: sessionId,
      router_address: session.router_address,
      access_url: session.access_url,
    };
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): GeneratedPortForwardSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  /**
   * Get active sessions for a workflow
   */
  getWorkflowSessions(workflowName: string): GeneratedPortForwardSession[] {
    return Array.from(this.activeSessions.values()).filter((s) => s.workflow_name === workflowName);
  }

  /**
   * Close a session
   */
  closeSession(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.status = "DISCONNECTED";
      this.activeSessions.delete(sessionId);
      return true;
    }
    return false;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

export const portForwardGenerator = new PortForwardGenerator();
