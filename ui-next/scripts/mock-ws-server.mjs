#!/usr/bin/env node
// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Mock WebSocket Server for Terminal/PTY Simulation
 *
 * Run with: node scripts/mock-ws-server.mjs
 *
 * This server simulates the backend PTY WebSocket connection for development.
 * It runs on port 3001 and proxies through the Next.js dev server.
 */

import { WebSocketServer } from "ws";
import http from "http";

const PORT = 3001;

// ============================================================================
// ANSI Escape Codes
// ============================================================================

const ANSI = {
  RESET: "\x1b[0m",
  BLACK: "\x1b[30m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
  WHITE: "\x1b[37m",
  BRIGHT_BLACK: "\x1b[90m",
  BRIGHT_RED: "\x1b[91m",
  BRIGHT_GREEN: "\x1b[92m",
  BRIGHT_YELLOW: "\x1b[93m",
  BRIGHT_BLUE: "\x1b[94m",
  BRIGHT_CYAN: "\x1b[96m",
  BRIGHT_WHITE: "\x1b[97m",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",
  CLEAR_SCREEN: "\x1b[2J",
  CURSOR_HOME: "\x1b[H",
};

// ============================================================================
// Session Management
// ============================================================================

const sessions = new Map();

function generatePrompt(session) {
  const user = `${ANSI.BRIGHT_GREEN}root${ANSI.RESET}`;
  const at = `${ANSI.WHITE}@${ANSI.RESET}`;
  const host = `${ANSI.BRIGHT_CYAN}${session.taskName}${ANSI.RESET}`;
  const colon = `${ANSI.WHITE}:${ANSI.RESET}`;
  const path = `${ANSI.BRIGHT_BLUE}${session.cwd}${ANSI.RESET}`;
  const symbol = `${ANSI.WHITE}# ${ANSI.RESET}`;
  return `${user}${at}${host}${colon}${path}${symbol}`;
}

function generateNvidiaSmi() {
  const gpus = [0, 1, 2, 3, 4, 5, 6, 7];
  let output = `${ANSI.BRIGHT_WHITE}+-----------------------------------------------------------------------------+
| NVIDIA-SMI 535.129.03   Driver Version: 535.129.03   CUDA Version: 12.2     |
|-------------------------------+----------------------+----------------------+
| GPU  Name        Persistence-M| Bus-Id        Disp.A | Volatile Uncorr. ECC |
| Fan  Temp  Perf  Pwr:Usage/Cap|         Memory-Usage | GPU-Util  Compute M. |
|===============================+======================+======================|${ANSI.RESET}\n`;

  for (const gpu of gpus) {
    const temp = 45 + Math.floor(Math.random() * 30);
    const power = 100 + Math.floor(Math.random() * 250);
    const memUsed = (20 + Math.random() * 58).toFixed(1);
    const util = Math.floor(Math.random() * 100);

    const tempColor = temp > 70 ? ANSI.RED : temp > 60 ? ANSI.YELLOW : ANSI.GREEN;
    const utilColor = util > 80 ? ANSI.GREEN : util > 50 ? ANSI.YELLOW : ANSI.WHITE;

    output += `|   ${gpu}  NVIDIA A100-SXM4...  On  | 00000000:${gpu.toString(16).padStart(2, "0")}:00.0 Off |                    0 |
| N/A   ${tempColor}${temp}C${ANSI.RESET}    P0   ${power}W / 400W |  ${memUsed}GiB / 80GiB |    ${utilColor}${util.toString().padStart(3)}%${ANSI.RESET}      Default |
+-------------------------------+----------------------+----------------------+\n`;
  }

  output += `
${ANSI.BRIGHT_WHITE}+-----------------------------------------------------------------------------+
| Processes:                                                                  |
|  GPU   GI   CI        PID   Type   Process name                  GPU Memory |
|        ID   ID                                                   Usage      |
|=============================================================================|${ANSI.RESET}
|    0   N/A  N/A     ${10000 + Math.floor(Math.random() * 89999)}      C   ${ANSI.CYAN}python train.py${ANSI.RESET}                    61440MiB |
+-----------------------------------------------------------------------------+
`;
  return output;
}

function generateLsOutput() {
  return `${ANSI.BRIGHT_BLUE}checkpoints${ANSI.RESET}  ${ANSI.BRIGHT_BLUE}data${ANSI.RESET}  ${ANSI.BRIGHT_BLUE}logs${ANSI.RESET}  config.yaml  ${ANSI.BRIGHT_GREEN}train.py${ANSI.RESET}  ${ANSI.BRIGHT_GREEN}eval.py${ANSI.RESET}  model.pt  requirements.txt\r\n`;
}

function generateColorTest() {
  let output = `${ANSI.BOLD}=== ANSI Color Test ===${ANSI.RESET}\r\n\r\n`;
  output += `${ANSI.BOLD}Regular:${ANSI.RESET} `;
  output += `${ANSI.RED}█Red${ANSI.RESET} `;
  output += `${ANSI.GREEN}█Green${ANSI.RESET} `;
  output += `${ANSI.YELLOW}█Yellow${ANSI.RESET} `;
  output += `${ANSI.BLUE}█Blue${ANSI.RESET} `;
  output += `${ANSI.MAGENTA}█Magenta${ANSI.RESET} `;
  output += `${ANSI.CYAN}█Cyan${ANSI.RESET}\r\n`;
  output += `${ANSI.BOLD}Bright:${ANSI.RESET}  `;
  output += `${ANSI.BRIGHT_RED}█Red${ANSI.RESET} `;
  output += `${ANSI.BRIGHT_GREEN}█Green${ANSI.RESET} `;
  output += `${ANSI.BRIGHT_YELLOW}█Yellow${ANSI.RESET} `;
  output += `${ANSI.BRIGHT_BLUE}█Blue${ANSI.RESET} `;
  output += `${ANSI.BRIGHT_CYAN}█Cyan${ANSI.RESET}\r\n`;
  return output;
}

function processCommand(session, command) {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  switch (cmd) {
    case "":
      return "";

    case "ls":
      return generateLsOutput();

    case "cd":
      if (args[0]) {
        if (args[0] === "..") {
          const p = session.cwd.split("/").filter(Boolean);
          p.pop();
          session.cwd = "/" + p.join("/") || "/";
        } else if (args[0].startsWith("/")) {
          session.cwd = args[0];
        } else {
          session.cwd = `${session.cwd}/${args[0]}`.replace(/\/+/g, "/");
        }
      } else {
        session.cwd = "/workspace";
      }
      return "";

    case "pwd":
      return `${session.cwd}\r\n`;

    case "nvidia-smi":
      return generateNvidiaSmi();

    case "colors":
      return generateColorTest();

    case "clear":
      return ANSI.CLEAR_SCREEN + ANSI.CURSOR_HOME;

    case "help":
      return `${ANSI.BOLD}Available commands:${ANSI.RESET}\r\n` +
        `  ${ANSI.GREEN}ls${ANSI.RESET}           List files\r\n` +
        `  ${ANSI.GREEN}cd${ANSI.RESET} [dir]     Change directory\r\n` +
        `  ${ANSI.GREEN}pwd${ANSI.RESET}          Print working directory\r\n` +
        `  ${ANSI.GREEN}nvidia-smi${ANSI.RESET}   Show GPU status\r\n` +
        `  ${ANSI.GREEN}colors${ANSI.RESET}       Show ANSI color test\r\n` +
        `  ${ANSI.GREEN}train${ANSI.RESET}        Simulate training (streaming)\r\n` +
        `  ${ANSI.GREEN}logs${ANSI.RESET}         Simulate fast log streaming\r\n` +
        `  ${ANSI.GREEN}clear${ANSI.RESET}        Clear screen\r\n` +
        `  ${ANSI.GREEN}exit${ANSI.RESET}         Exit shell\r\n`;

    case "train":
      return "STREAM:training";

    case "logs":
      return "STREAM:logs";

    case "exit":
      return "EXIT";

    default:
      return `${ANSI.RED}${cmd}: command not found${ANSI.RESET}\r\n`;
  }
}

// ============================================================================
// HTTP Server (for health checks)
// ============================================================================

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", sessions: sessions.size }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// ============================================================================
// WebSocket Server
// ============================================================================

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathParts = url.pathname.split("/").filter(Boolean);

  // Expected path: /api/router/exec/{workflowName}/client/{sessionId}
  // or simplified: /exec/{workflowName}/{taskName}
  let workflowName = "unknown";
  let taskName = "unknown";
  let sessionId = Math.random().toString(36).substring(7);

  if (pathParts.length >= 5 && pathParts[0] === "api" && pathParts[1] === "router") {
    workflowName = pathParts[3];
    sessionId = pathParts[5];
    taskName = url.searchParams.get("task") || "task-0";
  } else if (pathParts.length >= 3 && pathParts[0] === "exec") {
    workflowName = pathParts[1];
    taskName = pathParts[2];
  }

  const session = {
    id: sessionId,
    workflowName,
    taskName,
    ws,
    cwd: "/workspace",
    rows: 24,
    cols: 80,
    inputBuffer: "",
    intervals: [],
  };

  sessions.set(sessionId, session);
  console.log(`[WS] New connection: ${workflowName}/${taskName} (${sessionId})`);

  // Send welcome message
  ws.send(
    `${ANSI.BRIGHT_GREEN}OSMO Shell${ANSI.RESET} - Connected to ${ANSI.CYAN}${taskName}${ANSI.RESET}\r\n` +
    `Type ${ANSI.YELLOW}help${ANSI.RESET} for available commands\r\n\r\n` +
    generatePrompt(session)
  );

  ws.on("message", (data) => {
    // First message should be resize: { Rows: number, Cols: number }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.Rows && msg.Cols) {
        session.rows = msg.Rows;
        session.cols = msg.Cols;
        console.log(`[WS] Resize: ${msg.Cols}x${msg.Rows}`);
        return;
      }
    } catch {
      // Not JSON, treat as input
    }

    // Handle input
    const input = data.toString();

    for (const char of input) {
      if (char === "\r" || char === "\n") {
        // Enter - process command
        const command = session.inputBuffer;
        session.inputBuffer = "";
        ws.send("\r\n");

        const result = processCommand(session, command);

        if (result === "EXIT") {
          ws.send("logout\r\n");
          ws.close();
          return;
        }

        if (result.startsWith("STREAM:")) {
          const streamType = result.substring(7);
          startStreaming(session, streamType);
        } else {
          ws.send(result);
          ws.send(generatePrompt(session));
        }
      } else if (char === "\x7f" || char === "\b") {
        // Backspace
        if (session.inputBuffer.length > 0) {
          session.inputBuffer = session.inputBuffer.slice(0, -1);
          ws.send("\b \b");
        }
      } else if (char === "\x03") {
        // Ctrl+C
        clearIntervals(session);
        ws.send("^C\r\n" + generatePrompt(session));
        session.inputBuffer = "";
      } else if (char === "\x04") {
        // Ctrl+D
        ws.send("\r\nlogout\r\n");
        ws.close();
      } else if (char === "\x0c") {
        // Ctrl+L
        ws.send(ANSI.CLEAR_SCREEN + ANSI.CURSOR_HOME + generatePrompt(session));
      } else {
        // Regular char
        session.inputBuffer += char;
        ws.send(char);
      }
    }
  });

  ws.on("close", () => {
    clearIntervals(session);
    sessions.delete(sessionId);
    console.log(`[WS] Disconnected: ${sessionId}`);
  });

  ws.on("error", (err) => {
    console.error(`[WS] Error: ${err.message}`);
  });
});

function clearIntervals(session) {
  for (const id of session.intervals) {
    clearInterval(id);
  }
  session.intervals = [];
}

function startStreaming(session, type) {
  const ws = session.ws;

  if (type === "training") {
    let epoch = 1;
    let step = 0;
    const totalSteps = 1000;

    ws.send(`${ANSI.CYAN}Starting training...${ANSI.RESET}\r\n`);
    ws.send(`Model: ${ANSI.BRIGHT_WHITE}llama-7b${ANSI.RESET}\r\n`);
    ws.send(`GPUs: ${ANSI.GREEN}8x A100-80GB${ANSI.RESET}\r\n\r\n`);

    const intervalId = setInterval(() => {
      step += 5 + Math.floor(Math.random() * 10);
      if (step >= totalSteps) {
        epoch++;
        step = 0;
        if (epoch > 10) {
          ws.send(`\r\n${ANSI.BRIGHT_GREEN}✓ Training complete!${ANSI.RESET}\r\n`);
          ws.send(generatePrompt(session));
          clearInterval(intervalId);
          return;
        }
      }

      const loss = (2.5 - epoch * 0.2 + (Math.random() - 0.5) * 0.1).toFixed(4);
      const progress = Math.floor((step / totalSteps) * 100);
      const bar = ANSI.GREEN + "█".repeat(Math.floor(progress / 5)) + ANSI.BRIGHT_BLACK + "░".repeat(20 - Math.floor(progress / 5)) + ANSI.RESET;

      ws.send(`\rEpoch ${epoch}/10 [${bar}] ${progress.toString().padStart(3)}% | Step ${step}/${totalSteps} | ${ANSI.CYAN}loss: ${loss}${ANSI.RESET}`);
    }, 200);

    session.intervals.push(intervalId);
  } else if (type === "logs") {
    let lineCount = 0;

    ws.send(`${ANSI.YELLOW}[LOG]${ANSI.RESET} Fast output streaming started...\r\n`);

    const intervalId = setInterval(() => {
      for (let i = 0; i < 10; i++) {
        lineCount++;
        const level = Math.random() > 0.9 ? `${ANSI.RED}ERROR${ANSI.RESET}` :
                     Math.random() > 0.8 ? `${ANSI.YELLOW}WARN${ANSI.RESET}` :
                     `${ANSI.CYAN}INFO${ANSI.RESET}`;
        ws.send(`${new Date().toISOString()} [${level}] Line ${lineCount}: Processing batch ${Math.floor(Math.random() * 1000)}\r\n`);
      }

      if (lineCount >= 500) {
        ws.send(`\r\n${ANSI.GREEN}Streaming complete (${lineCount} lines)${ANSI.RESET}\r\n`);
        ws.send(generatePrompt(session));
        clearInterval(intervalId);
      }
    }, 50);

    session.intervals.push(intervalId);
  }
}

// ============================================================================
// Start Server
// ============================================================================

httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  ${ANSI.BRIGHT_GREEN}Mock WebSocket Server${ANSI.RESET} for Terminal/PTY Simulation        ║
╠════════════════════════════════════════════════════════════════╣
║  WebSocket: ws://localhost:${PORT}/exec/{workflow}/{task}         ║
║  Health:    http://localhost:${PORT}/health                       ║
╠════════════════════════════════════════════════════════════════╣
║  ${ANSI.YELLOW}Commands:${ANSI.RESET} ls, cd, pwd, nvidia-smi, colors, train, logs    ║
║  ${ANSI.YELLOW}Controls:${ANSI.RESET} Ctrl+C (interrupt), Ctrl+D (exit), Ctrl+L (clear)║
╚════════════════════════════════════════════════════════════════╝
`);
});
