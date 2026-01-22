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
import { getJwtClaims, getUserRoles } from "@/lib/auth/jwt-helper";

/**
 * Get current user info from JWT
 *
 * In production: Envoy forwards JWT in Authorization header
 * In local dev: Use injected token from localStorage
 */
export async function GET(request: NextRequest) {
  const claims = getJwtClaims(request);

  if (!claims) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const roles = getUserRoles(request);

  return NextResponse.json({
    id: claims.sub,
    email: claims.email || claims.preferred_username,
    name: claims.name || claims.given_name || claims.email?.split("@")[0],
    roles,
  });
}
