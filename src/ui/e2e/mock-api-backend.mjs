// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal HTTP stub on port 9999 for Playwright E2E.
 *
 * With PLAYWRIGHT_E2E=1, Node MSW is disabled. Playwright sets NEXT_PUBLIC_MOCK_API=true
 * so server-side `getServerApiBaseUrl()` uses localhost:9999 for server-side API fetches.
 * Keep all logic here (test-only); do not add E2E branches to application src.
 */

import http from "node:http";

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(404).end();
    return;
  }
  let pathname = req.url;
  const q = pathname.indexOf("?");
  if (q !== -1) pathname = pathname.slice(0, q);

  const cancelMatch = pathname.match(/^\/api\/workflow\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    const name = decodeURIComponent(cancelMatch[1]);
    if (name.startsWith("bulk-denied")) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "Access forbidden" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name }));
    return;
  }

  res.writeHead(404).end();
});

server.listen(9999, "127.0.0.1", () => {
  console.log("[e2e mock-api-backend] listening on http://127.0.0.1:9999");
});
