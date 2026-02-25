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

import { jwtDecode } from "jwt-decode";
import type { JwtClaims } from "@/lib/auth/jwt-utils.production";
import { extractRolesFromClaims, hasAdminRole } from "@/lib/auth/roles";
import type { User } from "@/lib/auth/user-context";

/**
 * Decode user information from JWT token.
 *
 * Used server-side by /api/me to extract user claims from the
 * Authorization header (injected by Envoy via OAuth2 Proxy).
 */
export function decodeUserFromToken(token: string | null): User | null {
  if (!token) {
    return null;
  }

  try {
    const claims = jwtDecode<JwtClaims>(token);

    const roles = extractRolesFromClaims(claims);
    const email = claims.email || claims.preferred_username || "";
    const username = claims.unique_name || claims.preferred_username || email.split("@")[0] || "user";

    return {
      id: claims.sub || "",
      name: claims.name || email.split("@")[0] || "User",
      username,
      email,
      isAdmin: hasAdminRole(roles),
      initials: getInitials(claims.name || email || "U"),
    };
  } catch (error) {
    console.error("Failed to decode JWT:", error);
    return null;
  }
}

function getInitials(name: string): string {
  return name
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}
