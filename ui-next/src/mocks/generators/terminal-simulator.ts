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
 * Terminal Simulator
 *
 * Simulates an interactive shell session for the exec/shell feature.
 */

import { faker } from "@faker-js/faker";

// ============================================================================
// Types
// ============================================================================

export interface TerminalSession {
  session_id: string;
  workflow_name: string;
  task_name: string;
  created_at: string;
  cwd: string;
  env: Record<string, string>;
  history: string[];
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ============================================================================
// Simulated Commands
// ============================================================================

const SIMULATED_COMMANDS: Record<string, (args: string[], session: TerminalSession) => CommandResult> = {
  ls: (_args, _session) => {
    const files = [
      "config.yaml",
      "train.py",
      "eval.py",
      "model.pt",
      "checkpoints/",
      "logs/",
      "data/",
      "requirements.txt",
      "README.md",
    ];
    return { stdout: files.join("\n"), stderr: "", exit_code: 0 };
  },

  pwd: (args, session) => {
    return { stdout: session.cwd, stderr: "", exit_code: 0 };
  },

  cd: (args, session) => {
    if (args.length === 0) {
      session.cwd = "/workspace";
    } else {
      const target = args[0];
      if (target === "..") {
        const parts = session.cwd.split("/").filter(Boolean);
        parts.pop();
        session.cwd = "/" + parts.join("/") || "/";
      } else if (target.startsWith("/")) {
        session.cwd = target;
      } else {
        session.cwd = `${session.cwd}/${target}`.replace("//", "/");
      }
    }
    return { stdout: "", stderr: "", exit_code: 0 };
  },

  cat: (args, _session) => {
    if (args.length === 0) {
      return { stdout: "", stderr: "cat: missing operand", exit_code: 1 };
    }

    const file = args[0];
    if (file === "config.yaml") {
      return {
        stdout: `# Training configuration
model:
  name: llama-7b
  precision: bf16

training:
  batch_size: 32
  learning_rate: 1e-4
  epochs: 10
  gradient_accumulation: 4

data:
  train_path: /data/train.jsonl
  eval_path: /data/eval.jsonl
`,
        stderr: "",
        exit_code: 0,
      };
    }

    if (file === "requirements.txt") {
      return {
        stdout: `torch>=2.1.0
transformers>=4.35.0
datasets>=2.14.0
wandb>=0.15.0
accelerate>=0.24.0
`,
        stderr: "",
        exit_code: 0,
      };
    }

    return { stdout: "", stderr: `cat: ${file}: No such file or directory`, exit_code: 1 };
  },

  echo: (args) => {
    return { stdout: args.join(" "), stderr: "", exit_code: 0 };
  },

  env: (args, session) => {
    const lines = Object.entries(session.env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    return { stdout: lines, stderr: "", exit_code: 0 };
  },

  whoami: () => {
    return { stdout: "root", stderr: "", exit_code: 0 };
  },

  hostname: () => {
    return {
      stdout: `dgx-a100-${faker.number.int({ min: 1, max: 100 }).toString().padStart(3, "0")}`,
      stderr: "",
      exit_code: 0,
    };
  },

  date: () => {
    return { stdout: new Date().toString(), stderr: "", exit_code: 0 };
  },

  "nvidia-smi": () => {
    const gpu = faker.number.int({ min: 80, max: 100 });
    const mem = faker.number.float({ min: 60, max: 79 }).toFixed(1);
    const temp = faker.number.int({ min: 55, max: 75 });

    return {
      stdout: `+-----------------------------------------------------------------------------+
| NVIDIA-SMI 535.129.03   Driver Version: 535.129.03   CUDA Version: 12.2     |
|-------------------------------+----------------------+----------------------+
| GPU  Name        Persistence-M| Bus-Id        Disp.A | Volatile Uncorr. ECC |
| Fan  Temp  Perf  Pwr:Usage/Cap|         Memory-Usage | GPU-Util  Compute M. |
|===============================+======================+======================|
|   0  NVIDIA A100-SXM4...  On  | 00000000:00:04.0 Off |                    0 |
| N/A   ${temp}C    P0   ${faker.number.int({ min: 100, max: 300 })}W / 400W |  ${mem}GiB / 80GiB |    ${gpu}%      Default |
+-------------------------------+----------------------+----------------------+
|   1  NVIDIA A100-SXM4...  On  | 00000000:00:05.0 Off |                    0 |
| N/A   ${temp + 2}C    P0   ${faker.number.int({ min: 100, max: 300 })}W / 400W |  ${(parseFloat(mem) + 1).toFixed(1)}GiB / 80GiB |    ${gpu - 2}%      Default |
+-------------------------------+----------------------+----------------------+

+-----------------------------------------------------------------------------+
| Processes:                                                                  |
|  GPU   GI   CI        PID   Type   Process name                  GPU Memory |
|        ID   ID                                                   Usage      |
|=============================================================================|
|    0   N/A  N/A     12345      C   python                          ${Math.floor(parseFloat(mem) * 1024)}MiB |
+-----------------------------------------------------------------------------+`,
      stderr: "",
      exit_code: 0,
    };
  },

  python: (args) => {
    if (args.includes("--version")) {
      return { stdout: "Python 3.10.12", stderr: "", exit_code: 0 };
    }
    if (args.length === 0) {
      return { stdout: "", stderr: "Interactive Python shell not supported in mock", exit_code: 1 };
    }
    return { stdout: "", stderr: "Mock terminal: Python execution simulated", exit_code: 0 };
  },

  pip: (args) => {
    if (args[0] === "list") {
      return {
        stdout: `Package           Version
----------------- -------
torch             2.1.2
transformers      4.36.0
datasets          2.15.0
numpy             1.24.0
pandas            2.0.3`,
        stderr: "",
        exit_code: 0,
      };
    }
    return { stdout: "", stderr: "pip command simulated", exit_code: 0 };
  },

  exit: () => {
    return { stdout: "logout", stderr: "", exit_code: 0 };
  },

  clear: () => {
    return { stdout: "\x1B[2J\x1B[0f", stderr: "", exit_code: 0 };
  },

  help: () => {
    return {
      stdout: `Available commands (simulated):
  ls, pwd, cd, cat, echo, env, whoami, hostname, date
  nvidia-smi, python, pip, clear, exit, help`,
      stderr: "",
      exit_code: 0,
    };
  },
};

// ============================================================================
// Simulator Class
// ============================================================================

export class TerminalSimulator {
  private sessions: Map<string, TerminalSession> = new Map();
  private baseSeed: number;

  constructor(baseSeed: number = 88888) {
    this.baseSeed = baseSeed;
  }

  /**
   * Create a new terminal session
   */
  createSession(workflowName: string, taskName: string): TerminalSession {
    const sessionId = faker.string.uuid();

    const session: TerminalSession = {
      session_id: sessionId,
      workflow_name: workflowName,
      task_name: taskName,
      created_at: new Date().toISOString(),
      cwd: "/workspace",
      env: {
        HOME: "/root",
        USER: "root",
        SHELL: "/bin/bash",
        PATH: "/usr/local/bin:/usr/bin:/bin",
        CUDA_VISIBLE_DEVICES: "0,1,2,3,4,5,6,7",
        PYTHONPATH: "/workspace",
        NCCL_DEBUG: "INFO",
        WORKFLOW_NAME: workflowName,
        TASK_NAME: taskName,
      },
      history: [],
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Execute a command
   */
  executeCommand(sessionId: string, command: string): CommandResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { stdout: "", stderr: "Session not found", exit_code: 1 };
    }

    // Parse command
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    // Add to history
    session.history.push(command);

    // Execute
    const handler = SIMULATED_COMMANDS[cmd];
    if (handler) {
      return handler(args, session);
    }

    return {
      stdout: "",
      stderr: `${cmd}: command not found`,
      exit_code: 127,
    };
  }

  /**
   * Get session
   */
  getSession(sessionId: string): TerminalSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Close session
   */
  closeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Get prompt string
   */
  getPrompt(session: TerminalSession): string {
    return `root@${session.task_name}:${session.cwd}# `;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

export const terminalSimulator = new TerminalSimulator();
