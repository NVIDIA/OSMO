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
 * Shared flat-manifest JSON for Playwright E2E and `/api/e2e/dataset-manifest`.
 *
 * Server actions resolve manifest URLs in-process when PLAYWRIGHT_E2E=1 so we
 * never `fetch()` the Next dev server from itself (avoids deadlocks / flaky loopback).
 */

const etag = "abc123";

export function getE2eDatasetManifest(caseParam: string): unknown[] {
  if (caseParam === "empty") {
    return [];
  }

  if (caseParam === "title") {
    return [
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
  }

  if (caseParam === "grid") {
    return [
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
  }

  return [
    {
      relative_path: "placeholder.txt",
      size: 1,
      etag,
      storage_path: "s3://bucket/placeholder.txt",
      url: "http://localhost:9000/placeholder.txt",
    },
  ];
}
