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
import { extractToken } from "@/lib/auth/jwt-utils";
import { decodeUserFromToken } from "@/lib/auth/decode-user";

/**
 * Returns current user info.
 *
 * Production: Envoy injects Authorization header with the JWT (via OAuth2 Proxy).
 * The JWT is decoded server-side to extract user claims.
 *
 * Dev: When no Authorization header is present, returns dev user info
 * so the UI renders without a real auth session.
 */
export async function GET(request: NextRequest) {
  const token = extractToken(request);
  const user = decodeUserFromToken(token);

  if (user) {
    return NextResponse.json(user);
  }

  if (process.env.NODE_ENV === "development") {
    return NextResponse.json({
      id: "dev-user",
      name: process.env.DEV_USER_NAME || "Dev User",
      email: process.env.DEV_USER_EMAIL || "dev@localhost",
      username: process.env.DEV_USER_NAME || "dev-user",
      isAdmin: true,
      initials: "DU",
    });
  }

  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}
