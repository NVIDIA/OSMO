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
 * Server-side authentication utilities — production build.
 *
 * Pure header readers: all identity comes from Envoy-injected OAuth2 Proxy headers.
 * No environment fallbacks. Aliased in by next.config.ts for production builds.
 */

import { headers } from "next/headers";
import { hasAdminRole } from "@/lib/auth/roles";
import type { User } from "@/lib/auth/user-context";

export async function getServerUserRoles(): Promise<string[]> {
  const headersList = await headers();
  const rolesHeader = headersList.get("x-osmo-roles") || "";
  return rolesHeader
    .split(/[,\s]+/)
    .map((role) => role.trim())
    .filter(Boolean);
}

export async function hasServerAdminRole(): Promise<boolean> {
  return hasAdminRole(await getServerUserRoles());
}

export async function getServerUsername(): Promise<string | null> {
  const headersList = await headers();
  return headersList.get("x-auth-request-preferred-username") || headersList.get("x-auth-request-user") || null;
}

export async function getServerUser(): Promise<User | null> {
  const headersList = await headers();
  const username = headersList.get("x-auth-request-preferred-username") || headersList.get("x-auth-request-user");
  if (!username) return null;

  const email = headersList.get("x-auth-request-email") || username;
  const name = headersList.get("x-auth-request-name") || deriveDisplayName(username);
  const roles = await getServerUserRoles();

  return {
    id: username,
    name,
    email,
    username,
    isAdmin: hasAdminRole(roles),
    initials: getInitials(name),
  };
}

function deriveDisplayName(username: string): string {
  const namePart = username.includes("@") ? username.split("@")[0] : username;
  if (!namePart) return "User";
  const parts = namePart.split(/[._-]+/).filter(Boolean);
  if (parts.length <= 1) return namePart;
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function getInitials(name: string): string {
  return name
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}
