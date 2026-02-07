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

import { NextRequest, NextResponse } from "next/server";
import { extractToken } from "@/lib/auth/jwt-helper";
import { decodeUserFromToken } from "@/lib/auth/decode-user";

/**
 * Get current user info from JWT
 *
 * This endpoint exists for future SSR needs (e.g., server-side auth checks,
 * personalized metadata, audit logging). Currently, the client decodes JWTs
 * directly for performance.
 *
 * In production: Envoy forwards JWT in Authorization header
 * In local dev: Supports cookie fallback for mock mode
 */
export async function GET(request: NextRequest) {
  const token = extractToken(request);
  const user = decodeUserFromToken(token);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.json(user);
}
