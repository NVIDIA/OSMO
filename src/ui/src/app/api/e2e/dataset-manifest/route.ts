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

import { NextResponse } from "next/server";
import { getE2eDatasetManifest } from "@/lib/e2e/dataset-manifest-fixtures";

/**
 * Dev-only manifest stub for Playwright E2E (browser-driven checks).
 *
 * Server-side `fetchManifest` resolves the same data in-process — see dataset-actions.ts.
 */
export async function GET(request: Request) {
  if (process.env.PLAYWRIGHT_E2E !== "1" || process.env.NODE_ENV !== "development") {
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(request.url);
  const caseParam = url.searchParams.get("case") ?? "default";

  return NextResponse.json(getE2eDatasetManifest(caseParam));
}
