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

import { faker } from "@faker-js/faker";
import { hashString } from "@/mocks/utils";

export interface GeneratedPortForwardResponse {
  success: boolean;
  session_id?: string;
  router_address?: string;
  access_url?: string;
  error?: string;
}

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
  routerDomains: ["pf.osmo.example.com", "tunnel.osmo.example.com", "access.osmo.example.com"],
};

export class PortForwardGenerator {
  private baseSeed: number;

  constructor(baseSeed: number = 77777) {
    this.baseSeed = baseSeed;
  }

  createSession(workflowName: string, taskName: string, remotePort: number): GeneratedPortForwardResponse {
    faker.seed(this.baseSeed + hashString(workflowName + taskName + remotePort));

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

    return {
      success: true,
      session_id: sessionId,
      router_address: `${routerDomain}/${sessionPath}`,
      access_url: `https://${routerDomain}/${sessionPath}`,
    };
  }
}

export const portForwardGenerator = new PortForwardGenerator();
