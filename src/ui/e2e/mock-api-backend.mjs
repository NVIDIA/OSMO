// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Minimal HTTP stub on port 9999 for Playwright E2E.
 *
 * With PLAYWRIGHT_E2E=1, Node MSW is disabled. Playwright sets NEXT_PUBLIC_MOCK_API=true
 * so server-side `getServerApiBaseUrl()` uses localhost:9999; manifest fetches hit this process.
 * Keep all logic here (test-only); do not add E2E branches to application src.
 */

import http from "node:http";

const etag = "abc123";

const DEFAULT = [
  {
    relative_path: "placeholder.txt",
    size: 1,
    etag,
    storage_path: "s3://bucket/placeholder.txt",
    url: "http://localhost:9000/placeholder.txt",
  },
];

const TITLE = [
  {
    relative_path: "data/file1.csv",
    size: 1024,
    etag,
    storage_path: "s3://bucket/data/file1.csv",
    url: "http://localhost:9000/data/file1.csv",
  },
  {
    relative_path: "data/file2.json",
    size: 2048,
    etag,
    storage_path: "s3://bucket/data/file2.json",
    url: "http://localhost:9000/data/file2.json",
  },
];

const GRID = [
  {
    relative_path: "readme.md",
    size: 512,
    etag,
    storage_path: "s3://bucket/readme.md",
    url: "http://localhost:9000/readme.md",
  },
  {
    relative_path: "data/train.csv",
    size: 1024 * 1024,
    etag,
    storage_path: "s3://bucket/data/train.csv",
    url: "http://localhost:9000/data/train.csv",
  },
  {
    relative_path: "data/test.csv",
    size: 512 * 1024,
    etag,
    storage_path: "s3://bucket/data/test.csv",
    url: "http://localhost:9000/data/test.csv",
  },
  {
    relative_path: "models/model.pt",
    size: 100 * 1024 * 1024,
    etag,
    storage_path: "s3://bucket/models/model.pt",
    url: "http://localhost:9000/models/model.pt",
  },
];

/** @type {Map<string, typeof DEFAULT>} */
const byBucketName = new Map([
  [["my-bucket", "my-dataset"].join("\0"), TITLE],
  [["data-bucket", "file-dataset"].join("\0"), GRID],
]);

const server = http.createServer((req, res) => {
  if (!req.url || req.method !== "GET") {
    res.writeHead(404).end();
    return;
  }
  let pathname = req.url;
  const q = pathname.indexOf("?");
  if (q !== -1) pathname = pathname.slice(0, q);

  const m = pathname.match(/^\/api\/bucket\/([^/]+)\/dataset\/([^/]+)\/manifest$/);
  if (!m) {
    res.writeHead(404).end();
    return;
  }
  const bucket = decodeURIComponent(m[1]);
  const name = decodeURIComponent(m[2]);
  const body = JSON.stringify(byBucketName.get(`${bucket}\0${name}`) ?? DEFAULT);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(body);
});

server.listen(9999, "127.0.0.1", () => {
  console.log("[e2e mock-api-backend] listening on http://127.0.0.1:9999");
});
